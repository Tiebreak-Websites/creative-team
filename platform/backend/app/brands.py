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
    """Every stored brand (empty list when none/unreadable)."""
    return _load()


def get_brand(brand_id: str) -> Optional[dict]:
    """One brand by id, or None."""
    if not brand_id:
        return None
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


def _clean_logo(logo_svg: Any) -> Optional[str]:
    if logo_svg is None:
        return None
    if isinstance(logo_svg, str):
        s = logo_svg.strip()
        return s or None
    return None


def _public(brand: dict) -> dict:
    """The Brand shape returned to clients (stable key order)."""
    return {
        "id": brand.get("id"),
        "name": brand.get("name", ""),
        "colors": brand.get("colors", []) or [],
        "logo_svg": brand.get("logo_svg"),
    }


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
        }
        brands = _load()
        brands.append(brand)
        _save(brands)
        return {"brand": _public(brand)}

    @router.put("/brands/{brand_id}")
    def update_brand(brand_id: str, payload: dict = Body(default={}),
                     _admin: dict = Depends(require_admin)):
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
                _save(brands)
                return {"brand": _public(b)}
        raise HTTPException(status_code=404, detail="brand not found")

    @router.delete("/brands/{brand_id}", status_code=204)
    def delete_brand(brand_id: str, _admin: dict = Depends(require_admin)):
        brands = _load()
        kept = [b for b in brands if b.get("id") != brand_id]
        if len(kept) == len(brands):
            raise HTTPException(status_code=404, detail="brand not found")
        _save(kept)
        return Response(status_code=204)

    return router


__all__ = ["build_brands_router", "list_brands", "get_brand", "BRANDS_PATH"]
