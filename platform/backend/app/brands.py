"""Admin-managed brands, persisted to a JSON file under the backend.

A *brand* bundles a palette and an optional logo so a run can be kept on-brand:
the colors are folded into the GPT-5.5 art direction, and a raster logo can be
composited onto each finished banner (see runner._composite_logo).

Storage mirrors tool_config.py: a single JSON file at `config/brands.json`
holding a list of brand objects. A read returns the parsed list (empty when the
file is missing/corrupt); a write replaces the whole list atomically enough for
this local-first, low-write workload.

Brand shape:
    {
        "id":       "<uuid hex>",          # server-generated
        "name":     "Acme",
        "colors":   ["#0A2540", "#00D4FF"],
        "logo_svg": "<svg .../>" | "data:image/png;base64,..." | null
    }

`logo_svg` is named for the common case (an inline SVG string) but also accepts a
raster data: URI — that is what makes pixel compositing reliable without an SVG
rasterizer (see runner). Anything else is stored verbatim and simply not overlaid.

Routes (mounted under /api/tools/banner-builder by runs_router.build_router):
  GET    /brands         (any logged-in user)  -> {"brands": [...]}
  POST   /brands         (admin)               -> {"brand": Brand}
  PUT    /brands/{id}     (admin)               -> {"brand": Brand}
  DELETE /brands/{id}     (admin)               -> 204
"""
from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from typing import Any, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import Response

from .auth import require_admin, require_user
from .settings import BACKEND_DIR

# Admin-created brands must SURVIVE deploys: the backend package dir is
# ephemeral in the cloud (each deploy ships a fresh image), so the store lives
# on the persistent artifact disk. Anything saved at the old ephemeral path is
# migrated once (covers local dev; on prod the old file died with each deploy).
from .settings import settings as _settings  # noqa: E402

BRANDS_DIR = _settings.ARTIFACT_ROOT / "config"
BRANDS_DIR.mkdir(parents=True, exist_ok=True)
BRANDS_PATH = BRANDS_DIR / "brands.json"
_LEGACY_BRANDS_PATH = BACKEND_DIR / "config" / "brands.json"
if _LEGACY_BRANDS_PATH.exists() and not BRANDS_PATH.exists():
    try:
        BRANDS_PATH.write_text(_LEGACY_BRANDS_PATH.read_text(encoding="utf-8"), encoding="utf-8")
    except OSError:
        pass

_HEX_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
_MAX_COLORS = 12

# Bundled brand assets (logos), committed under the app package so they ship in
# the Docker image and survive the ephemeral cloud disk.
_ASSETS = Path(__file__).resolve().parent / "assets" / "brands"


def _asset(*parts: str) -> Optional[str]:
    """Read a committed brand asset (e.g. an SVG logo) as text, or None."""
    try:
        return (_ASSETS.joinpath(*parts)).read_text(encoding="utf-8").strip() or None
    except OSError:
        return None


# --- Built-in brands ---------------------------------------------------------
# Hard-coded, always-present brands. Unlike stored brands they survive restarts
# and the ephemeral cloud disk, so a team brand is "just there". They appear in
# the Brands tab and the run's brand selector exactly like stored brands, but
# can't be edited or deleted. `swatches` carries human-readable colour roles for
# the showcase card; `colors` stays the canonical palette fed to the art director.
BUILTIN_BRANDS: List[dict] = [
    {
        "id": "braintrade",
        "name": "BrainTrade",
        "colors": ["#FF7532", "#070851", "#F1F5F1"],
        "swatches": [
            {"hex": "#FF7532", "role": "Primary · CTA"},
            {"hex": "#070851", "role": "Background"},
            {"hex": "#F1F5F1", "role": "Warm white"},
        ],
        # The ORIGINAL full logo (wordmark + waves); older marks kept as files.
        "logo_svg": _asset("braintrade", "bt-original.svg") or _asset("braintrade", "bt2-l.svg"),
        # White-lettered variant served wherever the app shows the logo on dark.
        "logo_svg_dark": _asset("braintrade", "Braintrade_logo_white_text.svg"),
        # Landing-page design tokens the LP Builder reads on brand pick.
        "lp": {"bg": "#FBFBFB", "card": "#FFFFFF"},
        "builtin": True,
    },
]
_BUILTIN_IDS = {b["id"] for b in BUILTIN_BRANDS}


def _merged_builtin(base: dict, stored: List[dict]) -> dict:
    """A built-in brand with any admin-saved override applied on top. The
    override lives in brands.json under the SAME id; `builtin` stays True so
    the UI badges it and DELETE means 'reset to defaults'."""
    override = next((b for b in stored if b.get("id") == base["id"]), None)
    if not override:
        return base
    merged = {**base, **{k: v for k, v in override.items() if k != "builtin"}}
    merged["builtin"] = True
    return merged


# --- Storage ----------------------------------------------------------------
def _load() -> List[dict]:
    if not BRANDS_PATH.exists():
        return []
    try:
        data = json.loads(BRANDS_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []
    return data if isinstance(data, list) else []


def _save(brands: List[dict]) -> None:
    BRANDS_PATH.write_text(
        json.dumps(brands, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def list_brands() -> List[dict]:
    """Built-in brands (with admin overrides applied) first, then stored ones."""
    stored = _load()
    builtins = [_merged_builtin(b, stored) for b in BUILTIN_BRANDS]
    rest = [b for b in stored if b.get("id") not in _BUILTIN_IDS]
    return [*builtins, *rest]


def get_brand(brand_id: str) -> Optional[dict]:
    """One brand by id (built-in incl. overrides, or stored), or None."""
    if not brand_id:
        return None
    stored = _load()
    for b in BUILTIN_BRANDS:
        if b.get("id") == brand_id:
            return _merged_builtin(b, stored)
    for b in stored:
        if b.get("id") == brand_id:
            return b
    return None


# --- Validation / coercion ---------------------------------------------------
def _clean_colors(colors: Any) -> List[str]:
    """Keep only well-formed #RGB / #RRGGBB hex strings, uppercased, deduped."""
    if not isinstance(colors, list):
        return []
    out: List[str] = []
    for c in colors:
        if isinstance(c, str) and _HEX_RE.match(c.strip()):
            h = c.strip().upper()
            if h not in out:
                out.append(h)
    return out[:_MAX_COLORS]


_MAX_LOGO_CHARS = 2_000_000  # ~2MB cap on the logo string (inline SVG / data: URI)


def _clean_logo(logo_svg: Any) -> Optional[str]:
    if logo_svg is None:
        return None
    if isinstance(logo_svg, str):
        # Reject an oversized payload before storing it (DoS / memory bloat).
        if len(logo_svg) > _MAX_LOGO_CHARS:
            raise HTTPException(status_code=422, detail="logo is too large")
        s = logo_svg.strip()
        return s or None
    return None


def _clean_text(value: Any, limit: int = 200) -> Optional[str]:
    """A short free-text brand-kit hint (typography / tone of voice), trimmed."""
    if not isinstance(value, str):
        return None
    s = value.strip()
    return s[:limit] or None


def _clean_accent(value: Any) -> Optional[str]:
    """A single #RGB/#RRGGBB accent / CTA-colour hint, uppercased, or None."""
    if isinstance(value, str) and _HEX_RE.match(value.strip()):
        return value.strip().upper()
    return None


def _public(brand: dict) -> dict:
    """The Brand shape returned to clients (stable key order)."""
    out: dict = {
        "id": brand.get("id"),
        "name": brand.get("name", ""),
        "colors": brand.get("colors", []) or [],
        "logo_svg": brand.get("logo_svg"),
        "logo_svg_dark": brand.get("logo_svg_dark"),
        # Brand-kit hints (all optional) folded into the art direction at run time.
        "font": brand.get("font"),
        "accent": brand.get("accent"),
        "voice": brand.get("voice"),
        "builtin": bool(brand.get("builtin")),
    }
    # Built-ins may annotate each colour with a human role (CTA / Background / …).
    if brand.get("swatches"):
        out["swatches"] = brand["swatches"]
    # Landing-page token hints (website background / card fill) for the LP Builder.
    if brand.get("lp"):
        out["lp"] = brand["lp"]
    return out


def _validate_name(name: Any) -> str:
    if not isinstance(name, str) or not name.strip():
        raise HTTPException(status_code=422, detail="'name' is required")
    return name.strip()[:120]


# --- Router ------------------------------------------------------------------
def build_brands_router() -> APIRouter:
    """Brands CRUD. Mounted under /api/tools/banner-builder by the runs router,
    so the parent's require_user dependency already covers every route; admin
    writes self-gate with require_admin exactly like the tool-config PUT."""
    router = APIRouter()

    @router.get("/brands")
    def get_brands(_user: dict = Depends(require_user)):
        return {"brands": [_public(b) for b in list_brands()]}

    @router.post("/brands")
    def create_brand(payload: dict = Body(default={}), _admin: dict = Depends(require_admin)):
        name = _validate_name(payload.get("name"))
        brand = {
            "id": uuid.uuid4().hex,
            "name": name,
            "colors": _clean_colors(payload.get("colors")),
            "logo_svg": _clean_logo(payload.get("logo_svg")),
            "logo_svg_dark": _clean_logo(payload.get("logo_svg_dark")),
            "font": _clean_text(payload.get("font")),
            "accent": _clean_accent(payload.get("accent")),
            "voice": _clean_text(payload.get("voice"), limit=300),
        }
        brands = _load()
        brands.append(brand)
        _save(brands)
        return {"brand": _public(brand)}

    def _apply_patch(b: dict, payload: dict) -> None:
        """Partial update: only the keys present in the body change."""
        if "name" in payload:
            b["name"] = _validate_name(payload.get("name"))
        if "colors" in payload:
            b["colors"] = _clean_colors(payload.get("colors"))
        if "logo_svg" in payload:
            b["logo_svg"] = _clean_logo(payload.get("logo_svg"))
        if "logo_svg_dark" in payload:
            b["logo_svg_dark"] = _clean_logo(payload.get("logo_svg_dark"))
        if "font" in payload:
            b["font"] = _clean_text(payload.get("font"))
        if "accent" in payload:
            b["accent"] = _clean_accent(payload.get("accent"))
        if "voice" in payload:
            b["voice"] = _clean_text(payload.get("voice"), limit=300)
        if "lp" in payload and isinstance(payload.get("lp"), dict):
            lp = {k: v.strip().upper() for k, v in payload["lp"].items()
                  if k in ("bg", "card") and isinstance(v, str) and _HEX_RE.match(v.strip())}
            b["lp"] = lp or None

    @router.put("/brands/{brand_id}")
    def update_brand(brand_id: str, payload: dict = Body(default={}),
                     _admin: dict = Depends(require_admin)):
        brands = _load()
        # Built-ins are editable too: the edit is stored as an OVERRIDE record
        # under the same id (the code defaults stay as the fallback; deleting
        # the brand later resets it to those defaults).
        if brand_id in _BUILTIN_IDS:
            override = next((b for b in brands if b.get("id") == brand_id), None)
            if override is None:
                base = next(b for b in BUILTIN_BRANDS if b["id"] == brand_id)
                override = {k: v for k, v in base.items() if k != "builtin"}
                brands.append(override)
            _apply_patch(override, payload)
            _save(brands)
            return {"brand": _public(_merged_builtin(
                next(b for b in BUILTIN_BRANDS if b["id"] == brand_id), brands))}
        for b in brands:
            if b.get("id") == brand_id:
                _apply_patch(b, payload)
                _save(brands)
                return {"brand": _public(b)}
        raise HTTPException(status_code=404, detail="brand not found")

    @router.delete("/brands/{brand_id}", status_code=204)
    def delete_brand(brand_id: str, _admin: dict = Depends(require_admin)):
        brands = _load()
        if brand_id in _BUILTIN_IDS:
            # For a built-in, delete = RESET to the shipped defaults.
            kept = [b for b in brands if b.get("id") != brand_id]
            if len(kept) == len(brands):
                raise HTTPException(status_code=409,
                                    detail="Built-in brands can't be deleted — and this one has no edits to reset.")
            _save(kept)
            return Response(status_code=204)
        kept = [b for b in brands if b.get("id") != brand_id]
        if len(kept) == len(brands):
            raise HTTPException(status_code=404, detail="brand not found")
        _save(kept)
        return Response(status_code=204)

    return router


__all__ = ["build_brands_router", "list_brands", "get_brand", "BRANDS_PATH"]
