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

# Reuse the same config dir tool_config writes to, so all editable state lives
# in one place; created on import so the first POST can write.
BRANDS_DIR = BACKEND_DIR / "config"
BRANDS_DIR.mkdir(parents=True, exist_ok=True)
BRANDS_PATH = BRANDS_DIR / "brands.json"

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
        "logo_svg": _asset("braintrade", "bt2-l.svg"),
        "builtin": True,
    },
]
_BUILTIN_IDS = {b["id"] for b in BUILTIN_BRANDS}


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
    """Built-in brands first, then any admin-stored brands (deduped by id)."""
    stored = [b for b in _load() if b.get("id") not in _BUILTIN_IDS]
    return [*BUILTIN_BRANDS, *stored]


def get_brand(brand_id: str) -> Optional[dict]:
    """One brand by id (built-in or stored), or None."""
    if not brand_id:
        return None
    for b in BUILTIN_BRANDS:
        if b.get("id") == brand_id:
            return b
    for b in _load():
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
        # Brand-kit hints (all optional) folded into the art direction at run time.
        "font": brand.get("font"),
        "accent": brand.get("accent"),
        "voice": brand.get("voice"),
        "builtin": bool(brand.get("builtin")),
    }
    # Built-ins may annotate each colour with a human role (CTA / Background / …).
    if brand.get("swatches"):
        out["swatches"] = brand["swatches"]
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
            "font": _clean_text(payload.get("font")),
            "accent": _clean_accent(payload.get("accent")),
            "voice": _clean_text(payload.get("voice"), limit=300),
        }
        brands = _load()
        brands.append(brand)
        _save(brands)
        return {"brand": _public(brand)}

    @router.put("/brands/{brand_id}")
    def update_brand(brand_id: str, payload: dict = Body(default={}),
                     _admin: dict = Depends(require_admin)):
        if brand_id in _BUILTIN_IDS:
            raise HTTPException(status_code=403, detail="Built-in brands can't be edited.")
        brands = _load()
        for b in brands:
            if b.get("id") == brand_id:
                # Partial update: only the keys present in the body change.
                if "name" in payload:
                    b["name"] = _validate_name(payload.get("name"))
                if "colors" in payload:
                    b["colors"] = _clean_colors(payload.get("colors"))
                if "logo_svg" in payload:
                    b["logo_svg"] = _clean_logo(payload.get("logo_svg"))
                if "font" in payload:
                    b["font"] = _clean_text(payload.get("font"))
                if "accent" in payload:
                    b["accent"] = _clean_accent(payload.get("accent"))
                if "voice" in payload:
                    b["voice"] = _clean_text(payload.get("voice"), limit=300)
                _save(brands)
                return {"brand": _public(b)}
        raise HTTPException(status_code=404, detail="brand not found")

    @router.delete("/brands/{brand_id}", status_code=204)
    def delete_brand(brand_id: str, _admin: dict = Depends(require_admin)):
        if brand_id in _BUILTIN_IDS:
            raise HTTPException(status_code=403, detail="Built-in brands can't be deleted.")
        brands = _load()
        kept = [b for b in brands if b.get("id") != brand_id]
        if len(kept) == len(brands):
            raise HTTPException(status_code=404, detail="brand not found")
        _save(kept)
        return Response(status_code=204)

    return router


__all__ = ["build_brands_router", "list_brands", "get_brand", "BRANDS_PATH"]
