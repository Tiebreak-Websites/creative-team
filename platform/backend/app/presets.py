"""Saved campaign presets — reusable briefs for the Banner Builder.

A *preset* bundles a whole campaign setup (sizes + art direction + brand + model /
quality / effort + locale, and optionally the concept cards) so a team can launch a
consistent campaign in one click instead of rebuilding it from a blank form each
time. The payload shape is owned by the frontend; the backend stores it as an
opaque, size-capped JSON blob and never interprets it — so the preset can evolve
with the UI without a backend change.

Storage mirrors brands.py: a single JSON file at `config/presets.json` holding a
list of preset objects. Shared across the team (like brands); any logged-in user
may create/update/delete (presets are non-destructive — they only pre-fill a form).

Preset shape:
    {
        "id":         "<uuid hex>",        # server-generated
        "name":       "Q3 Launch — IN",
        "created_by": "alice@acme.com",    # who saved it (display only)
        "created_at": "<iso8601>",
        "data":       { ... }              # opaque campaign config (frontend-owned)
    }

Routes (mounted under /api/tools/banner-builder by runs_router.build_router):
  GET    /presets         -> {"presets": [...]}
  POST   /presets         -> {"preset": Preset}
  PUT    /presets/{id}     -> {"preset": Preset}
  DELETE /presets/{id}     -> 204
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import Response

from .auth import require_user
from .settings import settings

# Persistent artifact disk — the backend package dir is ephemeral in the cloud
# (tool_config.py migrates every legacy *.json from the old dir, incl. this).
PRESETS_DIR = settings.ARTIFACT_ROOT / "config"
PRESETS_DIR.mkdir(parents=True, exist_ok=True)
PRESETS_PATH = PRESETS_DIR / "presets.json"

_MAX_PRESETS = 200
# Cap the serialized payload so a preset can't bloat the store / memory.
_MAX_DATA_CHARS = 200_000


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# --- Storage ----------------------------------------------------------------
def _load() -> List[dict]:
    if not PRESETS_PATH.exists():
        return []
    try:
        data = json.loads(PRESETS_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []
    return data if isinstance(data, list) else []


def _save(presets: List[dict]) -> None:
    PRESETS_PATH.write_text(
        json.dumps(presets, indent=2, ensure_ascii=False), encoding="utf-8"
    )


# --- Validation / coercion ---------------------------------------------------
def _validate_name(name: Any) -> str:
    if not isinstance(name, str) or not name.strip():
        raise HTTPException(status_code=422, detail="'name' is required")
    return name.strip()[:120]


def _clean_data(data: Any) -> dict:
    """Accept only a JSON-serializable dict within the size cap; store verbatim."""
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail="'data' must be an object")
    try:
        encoded = json.dumps(data, ensure_ascii=False)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="'data' must be JSON-serializable")
    if len(encoded) > _MAX_DATA_CHARS:
        raise HTTPException(status_code=422, detail="preset is too large")
    return data


def _public(preset: dict) -> dict:
    return {
        "id": preset.get("id"),
        "name": preset.get("name", ""),
        "created_by": preset.get("created_by", ""),
        "created_at": preset.get("created_at", ""),
        "data": preset.get("data") or {},
    }


# --- Router ------------------------------------------------------------------
def build_presets_router() -> APIRouter:
    """Presets CRUD. Mounted under /api/tools/banner-builder by the runs router, so
    the parent's require_user dependency already covers every route. Any logged-in
    user may manage the shared preset library."""
    router = APIRouter()

    @router.get("/presets")
    def get_presets(_user: dict = Depends(require_user)):
        return {"presets": [_public(p) for p in _load()]}

    @router.post("/presets")
    def create_preset(payload: dict = Body(default={}), user: dict = Depends(require_user)):
        name = _validate_name(payload.get("name"))
        presets = _load()
        if len(presets) >= _MAX_PRESETS:
            raise HTTPException(status_code=422, detail=f"preset limit reached (max {_MAX_PRESETS})")
        preset = {
            "id": uuid.uuid4().hex,
            "name": name,
            "created_by": (user or {}).get("email", ""),
            "created_at": _now(),
            "data": _clean_data(payload.get("data")),
        }
        presets.append(preset)
        _save(presets)
        return {"preset": _public(preset)}

    @router.put("/presets/{preset_id}")
    def update_preset(preset_id: str, payload: dict = Body(default={}),
                      _user: dict = Depends(require_user)):
        presets = _load()
        for p in presets:
            if p.get("id") == preset_id:
                if "name" in payload:
                    p["name"] = _validate_name(payload.get("name"))
                if "data" in payload:
                    p["data"] = _clean_data(payload.get("data"))
                _save(presets)
                return {"preset": _public(p)}
        raise HTTPException(status_code=404, detail="preset not found")

    @router.delete("/presets/{preset_id}", status_code=204)
    def delete_preset(preset_id: str, _user: dict = Depends(require_user)):
        presets = _load()
        kept = [p for p in presets if p.get("id") != preset_id]
        if len(kept) == len(presets):
            raise HTTPException(status_code=404, detail="preset not found")
        _save(kept)
        return Response(status_code=204)

    return router


__all__ = ["build_presets_router", "PRESETS_PATH"]
