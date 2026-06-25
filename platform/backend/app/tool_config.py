"""Per-tool, admin-editable configuration.

Each tool has a small JSON config — an `instructions` help/markdown blob shown
in the tool, plus an `options` object of tool-relevant editable settings. A
sensible DEFAULT lives in code; any saved override is stored at
`config/<tool_id>.json` and deep-merged over the default at read time, so a
partial save never loses the rest of the defaults.

Routes (mounted from main via build_config_router()):
  GET /api/tools/{tool_id}/config   (any logged-in user)  -> merged config
  PUT /api/tools/{tool_id}/config   (admin only)          -> validate + save

Auth is the platform contract built in parallel:
    from app.auth import require_user, require_admin
require_user yields the logged-in user; require_admin 403s unless role=="admin".
"""
from __future__ import annotations

import copy
import json
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException

from .auth import require_admin, require_user
from .settings import BACKEND_DIR

# Per-tool config files live here; created on import so the first PUT can write.
CONFIG_DIR = BACKEND_DIR / "config"
CONFIG_DIR.mkdir(parents=True, exist_ok=True)


# --- In-code defaults --------------------------------------------------------
# Keys are the registry tool ids. Each default is { instructions, options };
# `options` holds only tool-relevant, editable settings (preset lists / toggles
# / defaults) — never secrets.
DEFAULT_CONFIGS: dict[str, dict[str, Any]] = {
    "banner-builder": {
        "instructions": (
            "## Banner Builder\n"
            "Generate on-brand ad banners with a **GPT-5.5** creative director + OpenAI "
            "**gpt-image-2**.\n\n"
            "1. Write the banner copy (Title, optional Subtitle/Button) and pick a locale.\n"
            "2. Add one or more concept cards and set the campaign style.\n"
            "3. Choose the sizes to render, then generate and download as PNG.\n\n"
            "GPT-5.5 reasons over each concept and writes a bespoke creative brief for every "
            "size before gpt-image-2 renders it (configurable below). If the director is off "
            "or unavailable, a deterministic template brief is used instead.\n\n"
            "_Tip:_ keep headlines short — long copy is hard for the image model to render cleanly."
        ),
        "options": {
            "sizes": ["1080x1080", "1080x1920", "1200x628", "300x250", "728x90"],
            "defaultModel": "gpt-image-2",
            # Speed-first default so a run lands in ~1 min. gpt-image-2 "high" takes
            # ~2 min/image (measured live) — too slow; "medium" is ~half. Users can
            # still pick "high" per run for max fidelity (slower).
            "defaultQuality": "medium",  # low | medium | high
            "aiAssist": True,
            # GPT-5.5 "creative director": reasons per concept and writes a bespoke
            # creative brief for each size before gpt-image-2 renders it.
            "creativeDirector": {
                "enabled": True,
                "model": "gpt-5.5",
                # "low" by default for speed (~seconds). Higher effort = richer art
                # direction but adds latency; bump per-run when fidelity matters.
                "effort": "low",  # none|minimal|low|medium|high|xhigh
            },
        },
    },
    "qa": {
        "instructions": (
            "## Figma QA\n"
            "QA a localized Figma landing page against its source.\n\n"
            "Paste the localized frame URL (and a source URL for parity). The checks "
            "below run automatically; toggle any off that don't apply to this page."
        ),
        "options": {
            "checks": {
                "parity": True,
                "placeholders": True,
                "brokenImages": True,
                "overflow": True,
                "cta": True,
                "regulatorPhrases": True,
                "aiTone": False,
            },
            "defaultLanguage": "en",
        },
    },
    "creative-summary": {
        "instructions": (
            "## Creative Summary\n"
            "Paste a Figma landing-page URL. We read the LP copy and generate a short "
            "**bilingual** summary of what it promotes, written for a sales agent.\n\n"
            "Optionally post the summary back to the file as a pinned comment."
        ),
        "options": {},
    },
    "translate-figma": {
        "instructions": (
            "## Translate Figma\n"
            "Extract a Figma page's text, translate it into one or more locales with "
            "Claude, validate each, and download per-locale results.\n\n"
            "Pick target locales below; character limits and CTA roles are respected "
            "during translation."
        ),
        "options": {
            "defaultLocales": ["ja", "de", "fr", "es", "pt-BR"],
        },
    },
}


def _deep_merge(base: dict, override: dict) -> dict:
    """Recursively merge `override` onto a deep copy of `base`."""
    out = copy.deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = copy.deepcopy(value)
    return out


def _config_path(tool_id: str):
    return CONFIG_DIR / f"{tool_id}.json"


def _load_stored(tool_id: str) -> dict:
    path = _config_path(tool_id)
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return data if isinstance(data, dict) else {}


def merged_config(tool_id: str) -> dict:
    """Default for the tool, deep-merged with any saved override."""
    default = DEFAULT_CONFIGS[tool_id]
    return _deep_merge(default, _load_stored(tool_id))


def build_config_router() -> APIRouter:
    router = APIRouter(prefix="/api/tools", tags=["tool-config"])

    @router.get("/{tool_id}/config")
    def get_config(tool_id: str, _user: dict = Depends(require_user)):
        if tool_id not in DEFAULT_CONFIGS:
            raise HTTPException(status_code=404, detail=f"unknown tool id: {tool_id!r}")
        return merged_config(tool_id)

    @router.put("/{tool_id}/config")
    def put_config(
        tool_id: str,
        payload: dict = Body(default={}),
        _admin: dict = Depends(require_admin),
    ):
        if tool_id not in DEFAULT_CONFIGS:
            raise HTTPException(status_code=404, detail=f"unknown tool id: {tool_id!r}")
        if not isinstance(payload, dict):
            raise HTTPException(status_code=422, detail="config must be a JSON object")
        if not isinstance(payload.get("instructions"), str):
            raise HTTPException(status_code=422,
                                detail="'instructions' must be a string")
        if not isinstance(payload.get("options"), dict):
            raise HTTPException(status_code=422,
                                detail="'options' must be a JSON object")

        # Persist only the recognized keys, then return the freshly merged view.
        to_store = {
            "instructions": payload["instructions"],
            "options": payload["options"],
        }
        _config_path(tool_id).write_text(
            json.dumps(to_store, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        return merged_config(tool_id)

    return router
