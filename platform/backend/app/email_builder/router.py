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
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile, File
from pydantic import BaseModel

from .. import brands as brands_mod
from ..auth import require_admin, require_user
from ..settings import settings
from . import core, export
from .blocks import LAYOUTS, layout_blocks

log = logging.getLogger(__name__)

_UPLOAD_MIME = {"image/png", "image/jpeg", "image/webp"}
_MAX_UPLOAD_BYTES = 10 * 1024 * 1024


def _public_block(b: dict) -> dict:
    return {
        "key": b.get("key"), "name": b.get("name"), "category": b.get("category"),
        "zone": b.get("zone") or "card",
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
             "sections", "tokens", "created_by", "created_at", "updated_at")} | {
        # '' for a parent, the parent's id for a language variant. A campaign is
        # authored once in English and translated outward, so the tree is one
        # level deep by design — a variant of a variant has no meaning here.
        "parent_id": c.get("parent_id") or "",
        # Monday.com item id. Blank until someone pastes it; each variant gets
        # its own, because Monday tracks them as separate items.
        "monday_id": c.get("monday_id") or "",
        # Draft until someone approves it — the UI's Approved/Draft switch.
        # A campaign is written before it is ready, so the safe default is the
        # one that is not live. Field name kept as `active` so existing stored
        # campaigns need no migration.
        "active": bool(c.get("active", False)),
    }


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
    monday_id: str = ""
    layout: str = ""


class CampaignPatch(BaseModel):
    name: Optional[str] = None
    subject: Optional[str] = None
    preheader: Optional[str] = None
    language: Optional[str] = None
    brand_id: Optional[str] = None
    sections: Optional[list] = None
    tokens: Optional[dict] = None
    monday_id: Optional[str] = None
    active: Optional[bool] = None


def build_email_builder_router() -> APIRouter:
    router = APIRouter(tags=["email-builder"])

    # ------------------------------------------------------------- blocks
    @router.get("/blocks")
    def list_blocks(all: int = 0, _user: dict = Depends(require_user)):
        with core.lock():
            bs = sorted(core.blocks().values(), key=lambda b: b.get("position", 500))
        if not all:
            bs = [b for b in bs if b.get("enabled", True)]
        return {"blocks": [_public_block(b) for b in bs], "layouts": LAYOUTS}

    # --------------------------------------------------------- campaigns
    @router.get("/campaigns")
    def list_campaigns(_user: dict = Depends(require_user)):
        with core.lock():
            cs = sorted(core.campaigns().values(),
                        key=lambda c: c.get("updated_at", ""), reverse=True)
        by_parent: dict = {}
        for c in cs:
            pid = c.get("parent_id") or ""
            if pid:
                by_parent[pid] = by_parent.get(pid, 0) + 1
        return {"campaigns": [
            {k: c.get(k) for k in ("id", "name", "subject", "brand_id", "language",
                                   "created_by", "created_at", "updated_at")}
            | {"blocks": len(c.get("sections") or []),
               "parent_id": c.get("parent_id") or "",
               "monday_id": c.get("monday_id") or "",
               "active": bool(c.get("active", False)),
               "variants": by_parent.get(c.get("id"), 0)}
            for c in cs]}

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
                        for k in layout_blocks(payload.layout) if k in available]
            c = {"id": core.new_campaign_id(), "name": name,
                 "subject": (payload.subject or "").strip()[:200], "preheader": "",
                 "brand_id": (payload.brand_id or "").strip(),
                 "language": (payload.language or "en").strip()[:8],
                 "sections": sections, "tokens": {},
                 "parent_id": "", "monday_id": (payload.monday_id or "").strip()[:32],
                 "active": False,
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
            for k in ("name", "subject", "preheader", "language", "brand_id", "monday_id"):
                if k in patch:
                    c[k] = str(patch[k]).strip()[:200]
            if "active" in patch:
                c["active"] = bool(patch["active"])
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
    def delete_campaign(cid: str, _user: dict = Depends(require_user)):
        """Delete a DRAFT. Approved campaigns refuse: an approved email is a
        record of what went (or is about to go) out, and destroying it should
        take two deliberate steps — un-approve, then delete."""
        with core.lock():
            c = core.campaigns().get(cid)
            if not c:
                raise HTTPException(404, "Campaign not found.")
            if c.get("active"):
                raise HTTPException(409, "This campaign is approved. Un-approve it first.")
            variants = [v for v in core.campaigns().values() if v.get("parent_id") == cid]
            approved = [v for v in variants if v.get("active")]
            if approved:
                langs = ", ".join(sorted(v.get("language") or "?" for v in approved))
                raise HTTPException(
                    409, f"Language variant(s) still approved ({langs}). "
                         "Un-approve them first.")
            # Draft variants go with their parent — leaving them behind would
            # strand translations under a parent that no longer exists,
            # invisible in a UI that lists parents.
            for i in [cid] + [v["id"] for v in variants]:
                core.campaigns().pop(i, None)
                core.delete_campaign_file(i)
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

    @router.post("/campaigns/{cid}/variants")
    def create_variants(cid: str, payload: dict, user: dict = Depends(require_user)):
        """Fan a finished parent out into one campaign per language.

        A variant is a full copy, not a reference: translation edits the copy,
        and a later parent tweak must NOT silently rewrite copy someone has
        already reviewed and signed off in nine languages. The cost is that
        parent changes do not propagate — which is the correct trade for
        regulated marketing mail.
        """
        wanted = [str(x).strip()[:8] for x in (payload.get("languages") or []) if str(x).strip()]
        if not wanted:
            raise HTTPException(422, "Pick at least one language.")

        with core.lock():
            parent = core.campaigns().get(cid)
            if not parent:
                raise HTTPException(404, "Campaign not found.")
            if parent.get("parent_id"):
                raise HTTPException(
                    409, "This is already a language variant. Create variants from the parent.")

            existing = {c.get("language") for c in core.campaigns().values()
                        if c.get("parent_id") == cid}
            existing.add(parent.get("language"))

            now = core._now()
            made = []
            for lang in wanted:
                if lang in existing:
                    continue  # already covered; asking twice is not an error
                child = {
                    "id": core.new_campaign_id(),
                    "name": parent.get("name") or "",
                    "subject": parent.get("subject") or "",
                    "preheader": parent.get("preheader") or "",
                    "brand_id": parent.get("brand_id") or "",
                    "language": lang,
                    # Deep-copied so editing a variant cannot reach back into
                    # the parent's slots through a shared dict.
                    "sections": json.loads(json.dumps(parent.get("sections") or [])),
                    "tokens": dict(parent.get("tokens") or {}),
                    "parent_id": cid,
                    "monday_id": "",
                    # Never live on arrival: an untranslated copy of the source
                    # is exactly what must not go out.
                    "active": False,
                    "created_by": user.get("email", ""),
                    "created_at": now, "updated_at": now,
                }
                core.campaigns()[child["id"]] = child
                core.persist_campaign(child)
                made.append(child)
                existing.add(lang)

        return {"created": [_public_campaign(c) for c in made],
                "skipped": [l for l in wanted if l not in {c["language"] for c in made}]}

    @router.get("/campaigns/{cid}/thumb")
    def campaign_thumb(cid: str, _user: dict = Depends(require_user)):
        """Composed HTML for a dashboard card thumbnail.

        A separate route rather than folding HTML into the list response: a
        dashboard of 40 campaigns would carry 40 composed emails in one payload
        whether or not the cards are on screen. One call per card, and the
        client caches on updated_at.
        """
        with core.lock():
            c = core.campaigns().get(cid)
            blocks_map = dict(core.blocks())
        if not c:
            raise HTTPException(404, "Campaign not found.")
        entity = _entity_for(c)
        out = export.compose_email(_with_brand_logo(c, entity), blocks_map, _asset_url, entity)
        return {"html": out["html"]}

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


# The logo slots from Settings > Brands, in the order email should prefer them.
# "Horizontal" is labelled "Page headers" there, which is exactly this job; the
# wordmark is the next best lockup; the square mark is the last resort so a
# brand that only has one still gets a logo instead of a gap.
LOGO_FIELDS = ("logo_wide", "logo_svg", "icon_svg")

_LOGO_PX = 320  # 2x the 160px the header block displays


def _hosted_logo(entity: dict) -> Optional[str]:
    """A hosted PNG for the brand's logo, or None.

    Reads the same fields Settings > Brands uploads into, and handles every
    format that screen accepts: raw SVG markup, a data: URI (what a PNG/JPG/
    WebP upload is stored as), or an absolute URL.

    Email cannot use any of those directly — SVG renders nowhere, and a data:
    URI is rejected by most clients and would eat a tenth of the 102KB budget —
    so each is materialised into a PNG file served by the public route. Named by
    content hash, so repeated composes reuse one file and a logo change produces
    a new URL rather than a stale cached one.
    """
    import base64
    import hashlib

    raw = ""
    for field in LOGO_FIELDS:
        v = str(entity.get(field) or "").strip()
        if v:
            raw = v
            break
    if not raw:
        return None

    if raw.startswith(("http://", "https://")):
        return raw  # already hosted; nothing to do

    aid = "logo-" + hashlib.sha1(raw.encode("utf-8")).hexdigest()[:24] + ".png"
    path = core.ASSETS_DIR / aid
    if path.exists():
        return aid

    png: Optional[bytes] = None
    if raw.startswith("<svg"):
        png = export.rasterise_svg(raw, width=_LOGO_PX)
    elif raw.startswith("data:"):
        try:
            head, _, b64 = raw.partition(",")
            data = base64.b64decode(b64) if "base64" in head else b64.encode("utf-8")
            png = _normalise_logo_png(data)
        except Exception:
            log.exception("email-builder: could not decode the uploaded brand logo")
            return None
    if not png:
        return None

    core.ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)
    return aid


def _normalise_logo_png(data: bytes) -> Optional[bytes]:
    """Any uploaded raster -> a PNG no wider than _LOGO_PX."""
    from PIL import Image

    try:
        im = Image.open(io.BytesIO(data))
        im.load()
    except Exception:
        log.exception("email-builder: unreadable brand logo upload")
        return None
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGBA")
    if im.width > _LOGO_PX:
        im.thumbnail((_LOGO_PX, _LOGO_PX * 4))
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def _with_brand_logo(project: dict, entity: Optional[dict]) -> dict:
    """Point the logo slot at the brand's hosted logo.

    Done here rather than in the compositor so compose_email stays pure: it is
    handed URLs and never writes files. An explicit per-campaign upload wins —
    this only fills a slot the author left alone.
    """
    if not entity:
        return project
    aid = _hosted_logo(entity)
    if not aid:
        return project

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
