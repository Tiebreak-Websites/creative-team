"""CRM Email Builder — HTTP routes.

Two routers, because they have opposite auth requirements:

  build_email_builder_router()  mounted behind require_user — the tool itself
  build_public_email_router()   mounted with NO auth — image serving

The second exists because a recipient opening an email in Gmail has no session
with us. Every LP asset route sits behind require_user, so reusing them would
401 on every image in every inbox. Serving is read-only, restricted to this
tool's asset directory, and the 32-hex id is the capability.
"""
from __future__ import annotations

import io
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile, File
from pydantic import BaseModel

from .. import brands as brands_mod
from ..auth import require_admin, require_user
from ..settings import settings
from . import core, export
from .blocks import DEFAULT_LAYOUT

log = logging.getLogger(__name__)

_UPLOAD_MIME = {"image/png", "image/jpeg", "image/webp"}
_MAX_UPLOAD_BYTES = 10 * 1024 * 1024


def _public_block(b: dict) -> dict:
    return {
        "key": b.get("key"), "name": b.get("name"), "category": b.get("category"),
        "position": b.get("position", 500), "enabled": b.get("enabled", True),
        "built_in": b.get("built_in", False),
        "html": b.get("html") or "", "texts": b.get("texts") or {},
        "assets": b.get("assets") or {}, "names": b.get("names") or {},
        "fields": core.parse_fields(b.get("html") or "")["fields"],
        "tokens_used": core.tokens_used(b.get("html") or ""),
    }


def _public_campaign(c: dict) -> dict:
    return {k: c.get(k) for k in
            ("id", "name", "subject", "preheader", "brand_id", "language",
             "sections", "tokens", "created_by", "created_at", "updated_at")}


def _entity_for(project: dict) -> Optional[dict]:
    bid = str(project.get("brand_id") or "").strip()
    if not bid:
        return None
    try:
        return brands_mod.get_brand(bid)
    except Exception:
        log.exception("email-builder: could not read brand %s", bid)
        return None


def _asset_url(raw: str) -> str:
    """Storage value -> the absolute URL that goes in the email.

    Today assets live on the Render persistent disk and are served by
    build_public_email_router(). The S3 swap replaces this function alone —
    nothing in the compositor or the blocks knows where images live.
    """
    raw = str(raw or "").strip()
    if not raw:
        return ""
    if raw.startswith(("http://", "https://", "data:")):
        return raw
    if raw.startswith("token:"):
        return ""  # resolved before compose, not here
    base = (settings.PUBLIC_BASE_URL or "").rstrip("/")
    return f"{base}/e/img/{raw}" if base else f"/e/img/{raw}"


# ---------------------------------------------------------------- payloads

class CampaignCreate(BaseModel):
    name: str
    brand_id: str = ""
    language: str = "en"
    subject: str = ""


class CampaignPatch(BaseModel):
    name: Optional[str] = None
    subject: Optional[str] = None
    preheader: Optional[str] = None
    language: Optional[str] = None
    brand_id: Optional[str] = None
    sections: Optional[list] = None
    tokens: Optional[dict] = None


def build_email_builder_router() -> APIRouter:
    router = APIRouter(tags=["email-builder"])

    # ------------------------------------------------------------- blocks
    @router.get("/blocks")
    def list_blocks(all: int = 0, _user: dict = Depends(require_user)):
        with core.lock():
            bs = sorted(core.blocks().values(), key=lambda b: b.get("position", 500))
        if not all:
            bs = [b for b in bs if b.get("enabled", True)]
        return {"blocks": [_public_block(b) for b in bs]}

    # --------------------------------------------------------- campaigns
    @router.get("/campaigns")
    def list_campaigns(_user: dict = Depends(require_user)):
        with core.lock():
            cs = sorted(core.campaigns().values(),
                        key=lambda c: c.get("updated_at", ""), reverse=True)
        return {"campaigns": [
            {k: c.get(k) for k in ("id", "name", "subject", "brand_id", "language",
                                   "created_by", "created_at", "updated_at")}
            | {"blocks": len(c.get("sections") or [])} for c in cs]}

    @router.post("/campaigns")
    def create_campaign(payload: CampaignCreate, user: dict = Depends(require_user)):
        name = (payload.name or "").strip()[:120]
        if not name:
            raise HTTPException(422, "A campaign name is required.")
        now = core._now()
        # Seeded with the standard layout so a new campaign opens ready to edit
        # rather than blank — same behaviour as a new landing page.
        with core.lock():
            available = {k: b for k, b in core.blocks().items() if b.get("enabled", True)}
            sections = [{"iid": core.new_asset_id()[:8], "block_key": k,
                         "texts": {}, "images": {}, "links": {}}
                        for k in DEFAULT_LAYOUT if k in available]
            c = {"id": core.new_campaign_id(), "name": name,
                 "subject": (payload.subject or "").strip()[:200], "preheader": "",
                 "brand_id": (payload.brand_id or "").strip(),
                 "language": (payload.language or "en").strip()[:8],
                 "sections": sections, "tokens": {},
                 "created_by": user.get("email", ""), "created_at": now, "updated_at": now}
            core.campaigns()[c["id"]] = c
            core.persist_campaign(c)
        return _public_campaign(c)

    @router.get("/campaigns/{cid}")
    def get_campaign(cid: str, _user: dict = Depends(require_user)):
        with core.lock():
            c = core.campaigns().get(cid)
        if not c:
            raise HTTPException(404, "Campaign not found.")
        return _public_campaign(c)

    @router.put("/campaigns/{cid}")
    def save_campaign(cid: str, payload: CampaignPatch, _user: dict = Depends(require_user)):
        with core.lock():
            c = core.campaigns().get(cid)
            if not c:
                raise HTTPException(404, "Campaign not found.")
            patch = payload.model_dump(exclude_none=True)
            for k in ("name", "subject", "preheader", "language", "brand_id"):
                if k in patch:
                    c[k] = str(patch[k]).strip()[:200]
            if "tokens" in patch and isinstance(patch["tokens"], dict):
                c["tokens"] = {str(k)[:24]: str(v)[:40] for k, v in patch["tokens"].items()}
            if "sections" in patch and isinstance(patch["sections"], list):
                c["sections"] = [{
                    "iid": str(s.get("iid") or core.new_asset_id()[:8])[:16],
                    "block_key": str(s.get("block_key") or "")[:64],
                    "texts": {str(k)[:64]: str(v)[:4000] for k, v in (s.get("texts") or {}).items()},
                    "images": {str(k)[:64]: str(v)[:400] for k, v in (s.get("images") or {}).items()},
                    "links": {str(k)[:64]: str(v)[:600] for k, v in (s.get("links") or {}).items()},
                } for s in patch["sections"][:60] if isinstance(s, dict)]
            c["updated_at"] = core._now()
            core.persist_campaign(c)
        return _public_campaign(c)

    @router.delete("/campaigns/{cid}", status_code=204)
    def delete_campaign(cid: str, _user: dict = Depends(require_admin)):
        with core.lock():
            core.campaigns().pop(cid, None)
            core.delete_campaign_file(cid)
        return Response(status_code=204)

    # ----------------------------------------------------------- compose
    @router.post("/compose")
    def compose(payload: dict, _user: dict = Depends(require_user)):
        project = payload.get("project") or {}
        with core.lock():
            blocks_map = dict(core.blocks())
        entity = _entity_for(project)
        project = _with_brand_logo(project, entity)
        return export.compose_email(project, blocks_map, _asset_url, entity)

    # ------------------------------------------------------------ assets
    @router.post("/assets")
    async def upload_asset(file: UploadFile = File(...), _user: dict = Depends(require_user)):
        if (file.content_type or "") not in _UPLOAD_MIME:
            raise HTTPException(415, "PNG, JPEG or WebP only.")
        data = await file.read()
        if len(data) > _MAX_UPLOAD_BYTES:
            raise HTTPException(413, "Images must be under 10MB.")
        aid = _store_asset_bytes(data)
        return {"id": aid, "url": _asset_url(aid)}

    return router


def _store_asset_bytes(data: bytes) -> str:
    """Normalise to PNG on the artifact disk. Returns '<32hex>.png'."""
    from PIL import Image

    im = Image.open(io.BytesIO(data))
    im.load()
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGBA")
    # 1200px wide is plenty for a 600px email at 2x, and keeps us clear of the
    # size budget that Gmail clips against.
    if im.width > 1200:
        im.thumbnail((1200, 1200 * 4))
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    aid = core.new_asset_id() + ".png"
    core.ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    (core.ASSETS_DIR / aid).write_bytes(buf.getvalue())
    return aid


def _with_brand_logo(project: dict, entity: Optional[dict]) -> dict:
    """Materialise the brand's SVG logo as a hosted PNG and point the logo slot
    at it.

    Done here rather than in the compositor so compose_email stays pure: it is
    handed URLs, it never writes files. Cached by content so repeated composes
    of the same brand reuse one file.
    """
    if not entity:
        return project
    svg = str(entity.get("logo_wide") or entity.get("logo_svg") or "").strip()
    if not svg.startswith("<svg"):
        return project

    import hashlib
    aid = "logo-" + hashlib.sha1(svg.encode("utf-8")).hexdigest()[:24] + ".png"
    path = core.ASSETS_DIR / aid
    if not path.exists():
        png = export.rasterise_svg(svg, width=320)
        if not png:
            return project  # no rasteriser — slot stays empty, alt text carries it
        core.ASSETS_DIR.mkdir(parents=True, exist_ok=True)
        path.write_bytes(png)

    out = dict(project)
    out["sections"] = [
        {**s, "images": {**(s.get("images") or {}), "logo": aid}}
        if s.get("block_key") == "em-logo-header" and not (s.get("images") or {}).get("logo")
        else s
        for s in (project.get("sections") or [])
    ]
    return out


def build_public_email_router() -> APIRouter:
    """Unauthenticated image serving. Mounted at /e — see the module docstring."""
    router = APIRouter(tags=["email-public"])

    @router.get("/img/{name}")
    def serve_image(name: str):
        # Resolve and confine to the asset dir: the name reaches us from an
        # inbox, so it is fully untrusted input.
        try:
            path = (core.ASSETS_DIR / name).resolve()
            path.relative_to(core.ASSETS_DIR.resolve())
        except Exception:
            raise HTTPException(404, "Not found.")
        if not path.is_file() or path.suffix.lower() != ".png":
            raise HTTPException(404, "Not found.")
        return Response(
            content=path.read_bytes(),
            media_type="image/png",
            # Immutable: the filename is content-derived, so a sent email keeps
            # rendering the image it was composed with.
            headers={"Cache-Control": "public, max-age=31536000, immutable"},
        )

    return router
