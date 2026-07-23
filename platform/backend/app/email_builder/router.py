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
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile, File
from pydantic import BaseModel

from .. import brands as brands_mod
from .. import monday
from ..auth import require_admin, require_user
from ..lp_builder import core as lp_core
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
        # Snapshot of the linked Monday item at pull time (name, status, brand,
        # language, brief, subitems…). What the task LOOKED LIKE when linked —
        # a prefill source and provenance record, not a live mirror.
        "monday": c.get("monday") or None,
        # Hero-image brief derived from the approved copy — what the image
        # should show, in the copy's own terms. Seeds the hero generator.
        "image_brief": c.get("image_brief") or "",
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


def _ensure_placeholder(name: str) -> str:
    """Generate (once) and return the grey placeholder graphic for a slot.

    Drawn with Pillow rather than bundled: no binary in git, and the artifact
    disk is where every other email asset already lives. 1072x536 = 2x the
    536px the hero renders at.
    """
    aid = f"placeholder-{name}.png"
    path = core.ASSETS_DIR / aid
    from . import storage as supa
    if supa.enabled():
        if path.exists():
            url = supa.upload(aid, path.read_bytes())
            if url:
                return url
    elif path.exists():
        return aid
    from PIL import Image, ImageDraw

    W, H = 1072, 536
    grey = (178, 188, 204)
    im = Image.new("RGB", (W, H), (238, 241, 246))
    d = ImageDraw.Draw(im)
    fw, fh = 220, 160
    x0, y0 = (W - fw) // 2, (H - fh) // 2
    # the universal "image goes here" glyph: frame, sun, two mountains
    d.rounded_rectangle([x0, y0, x0 + fw, y0 + fh], radius=18, outline=grey, width=8)
    d.ellipse([x0 + 36, y0 + 30, x0 + 72, y0 + 66], fill=grey)
    d.polygon([(x0 + 20, y0 + fh - 20), (x0 + 88, y0 + 62), (x0 + 146, y0 + fh - 20)], fill=grey)
    d.polygon([(x0 + 112, y0 + fh - 20), (x0 + 166, y0 + 88), (x0 + fw - 16, y0 + fh - 20)], fill=grey)
    core.ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    im.save(path, "PNG", optimize=True)
    url = supa.upload(aid, path.read_bytes())
    return url or aid


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
    if raw.startswith("placeholder:"):
        # A block-level default (e.g. the hero) so an image slot is VISIBLE
        # before anything is uploaded, instead of silently absent. A pre-send
        # check refuses to let it ship quietly.
        raw = _ensure_placeholder(raw.split(":", 1)[1])
        if raw.startswith(("http://", "https://")):
            # Already a full Supabase URL — wrapping it in /e/img/ again
            # produced src="/e/img/https://…", which is how this line earned
            # its existence.
            return raw
        base = (settings.PUBLIC_BASE_URL or "").rstrip("/")
        return f"{base}/e/img/{raw}" if base else f"/e/img/{raw}"
    if raw.startswith("token:"):
        return ""  # resolved before compose, not here
    base = (settings.PUBLIC_BASE_URL or "").rstrip("/")
    return f"{base}/e/img/{raw}" if base else f"/e/img/{raw}"


# ------------------------------------------------------------- monday pull

# What a stored Monday snapshot may carry — a whitelist, because the payload
# arrives from the browser and lands in our campaign records verbatim.
_MONDAY_KEEP = ("id", "name", "url", "board", "group", "status", "priority",
                "type", "asset_type", "brand", "label", "white_label",
                "language", "languages", "layout_label", "market", "deadline",
                "start_date", "brief", "topic", "figma_url", "requestor",
                "owner", "segment", "segment_note", "creative_types",
                "final_content")
_MONDAY_SUB_KEEP = ("id", "name", "status", "language", "brand", "asset_type",
                    "topic")


def _monday_snapshot(raw: Optional[dict]) -> Optional[dict]:
    if not isinstance(raw, dict):
        return None
    snap = {k: str(raw[k])[:4000] for k in _MONDAY_KEEP
            if isinstance(raw.get(k), (str, int)) and str(raw[k]).strip()}
    subs = [{k: str(s[k])[:300] for k in _MONDAY_SUB_KEEP
             if isinstance(s.get(k), (str, int)) and str(s[k]).strip()}
            for s in (raw.get("subitems") or []) if isinstance(s, dict)][:40]
    if subs:
        snap["subitems"] = subs
    return snap or None


def _match_layout(label: str) -> str:
    """The task's "Layout #" label → a builder layout key ("Classic promo" →
    classic-promo), or '' when the label isn't one of ours."""
    want = re.sub(r"[^a-z0-9]+", "", (label or "").lower())
    if not want:
        return ""
    for l in LAYOUTS:
        for probe in (l.get("name") or "", l.get("key") or ""):
            if re.sub(r"[^a-z0-9]+", "", probe.lower()) == want:
                return l.get("key") or ""
    return ""


def _monday_match(item: dict) -> dict:
    """Resolve the item's Monday labels into builder vocabulary: a brand id,
    a layout key, and the task's language list as builder codes. The create
    flow itself always starts campaigns in English — the language list is for
    the variant fan-out that follows."""
    langs = lp_core.languages() or lp_core.DEFAULT_LANGS
    # The Marketing calendar has ONE "Language" column that may hold several
    # codes ("EN, AR") — treat whichever field arrived as the list source.
    lang_text = item.get("languages") or item.get("language") or ""
    return {
        "brand_id": monday.match_brand(item.get("brand") or "",
                                       brands_mod.list_brands()),
        "language": monday.match_language(item.get("language") or "", langs),
        "languages": monday.match_languages(lang_text, langs),
        "layout": _match_layout(item.get("layout_label") or ""),
    }


def _monday_dormant() -> HTTPException:
    return HTTPException(424, detail={
        "missing_secrets": ["MONDAY_API_TOKEN"],
        "error": "The Monday integration activates once MONDAY_API_TOKEN is configured."})


# ---------------------------------------------------------------- payloads

class CampaignCreate(BaseModel):
    name: str
    brand_id: str = ""
    language: str = "en"
    subject: str = ""
    monday_id: str = ""
    layout: str = ""
    # Snapshot of the pulled Monday item, stored on the campaign (whitelisted
    # by _monday_snapshot — never trusted verbatim).
    monday: Optional[dict] = None


class HeroGen(BaseModel):
    # Module level, not nested in the router builder: `from __future__ import
    # annotations` defers resolution to module scope, and a function-local
    # model silently degrades into a QUERY parameter there.
    brand_id: str = ""
    campaign_id: str = ""
    iid: str = ""
    brief: str = ""
    with_text: bool = False
    headline: str = ""
    subtitle: str = ""
    visual_style: str = "auto"
    people: str = "any"
    avoid: str = ""
    direction_override: str = ""


class CopyGen(BaseModel):
    # Module level for the same reason as HeroGen — a function-local model
    # degrades to query params under `from __future__ import annotations`.
    campaign_id: str = ""
    brief: str = ""
    # "" lets the brand's regulation decide the segment; an explicit value
    # (REG / NONREG / NONE) overrides it — the compliance choice, made once,
    # up front, so a % bonus can never reach a REG/EU audience.
    segment: str = ""
    tier: str = "Retail"


class CampaignPatch(BaseModel):
    name: Optional[str] = None
    subject: Optional[str] = None
    preheader: Optional[str] = None
    language: Optional[str] = None
    brand_id: Optional[str] = None
    sections: Optional[list] = None
    tokens: Optional[dict] = None
    monday_id: Optional[str] = None
    image_brief: Optional[str] = None
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
               # The Monday item's name (creative name) rides with the id on
               # every asset — pulled from the stored snapshot.
               "monday_name": ((c.get("monday") or {}).get("name") or ""),
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
                         # Seeded lorem sized to best practice — it lands as the
                         # instance's own text, so it is edited, not fought.
                         "texts": dict(seed or {}), "images": {}, "links": {}}
                        for k, seed in layout_blocks(payload.layout) if k in available]
            snap = _monday_snapshot(payload.monday)
            c = {"id": core.new_campaign_id(), "name": name,
                 "subject": (payload.subject or "").strip()[:200], "preheader": "",
                 "brand_id": (payload.brand_id or "").strip(),
                 "language": (payload.language or "en").strip()[:8],
                 "sections": sections, "tokens": {},
                 "parent_id": "",
                 # A pulled snapshot implies the link even when the field was
                 # not typed — the snapshot's id IS the Monday id.
                 "monday_id": ((payload.monday_id or "").strip()
                               or (snap or {}).get("id") or "")[:32],
                 "monday": snap,
                 "active": False,
                 "created_by": user.get("email", ""), "created_at": now, "updated_at": now}
            core.campaigns()[c["id"]] = c
            core.persist_campaign(c)
        from .. import events
        events.emit("email.campaign.created", events.campaign_snapshot(c))
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
            for k in ("name", "subject", "preheader", "language", "brand_id",
                      "monday_id", "image_brief"):
                if k in patch:
                    c[k] = str(patch[k]).strip()[:200]
            if "active" in patch:
                was_active = bool(c.get("active"))
                c["active"] = bool(patch["active"])
                # Approval is the "design is final" moment — squeeze the
                # campaign's images through Tinify exactly once, best effort.
                # Never blocks the save: a compression hiccup is not a reason
                # a finished campaign cannot ship.
                from .. import events
                if c["active"] != was_active:
                    events.emit(
                        "email.campaign.approved" if c["active"] else "email.campaign.unapproved",
                        events.campaign_snapshot(c))
                if c["active"] and not was_active:
                    try:
                        from . import compress
                        summary = compress.compress_campaign_assets(c)
                        if summary["files"]:
                            log.info("email-builder: tinified %d image(s), saved %d bytes (%s)",
                                     summary["files"], summary["saved_bytes"], cid)
                    except LookupError:
                        log.info("email-builder: TINIFY_API_KEY not set — approval "
                                 "compression skipped")
                    except Exception:
                        log.exception("email-builder: approval compression failed")
            if "tokens" in patch and isinstance(patch["tokens"], dict):
                c["tokens"] = {str(k)[:24]: str(v)[:40] for k, v in patch["tokens"].items()}
            if "sections" in patch and isinstance(patch["sections"], list):
                c["sections"] = [{
                    "iid": str(s.get("iid") or core.new_asset_id()[:8])[:16],
                    "block_key": str(s.get("block_key") or "")[:64],
                    "texts": {str(k)[:64]: str(v)[:4000] for k, v in (s.get("texts") or {}).items()},
                    "images": {str(k)[:64]: str(v)[:400] for k, v in (s.get("images") or {}).items()},
                    "links": {str(k)[:64]: str(v)[:600] for k, v in (s.get("links") or {}).items()},
                    # Spacing overrides only — whitelisted keys, integer px.
                    "props": {str(k): str(v).strip() for k, v in (s.get("props") or {}).items()
                              if str(k) in ("pad_top", "pad_bottom") and str(v).strip().isdigit()},
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

    # ------------------------------------------------------------- monday
    # The PULL half of the Monday bridge: the create dialog asks for a task
    # and gets back the item plus builder-vocabulary matches to prefill with.
    # (The PUSH half is events.py → n8n.)

    @router.get("/monday/item/{item_id}")
    def monday_item(item_id: str, _user: dict = Depends(require_user)):
        if not monday.configured():
            raise _monday_dormant()
        clean = item_id.strip()
        if not clean.isdigit():
            raise HTTPException(422, "A Monday item ID is a number.")
        try:
            item = monday.get_item(clean)
        except RuntimeError as e:
            raise HTTPException(502, str(e))
        if not item:
            raise HTTPException(404, "No Monday item with that ID (or the "
                                     "token cannot see it).")
        return {"item": item, "match": _monday_match(item)}

    @router.get("/monday/ready")
    def monday_ready(_user: dict = Depends(require_user)):
        """The work queue: CRM tasks whose Status is "Ready for design",
        each with its labels resolved into builder vocabulary. The dashboard
        surfaces these under their brand for one-click campaign creation."""
        if not monday.configured():
            raise _monday_dormant()
        try:
            items = monday.ready_for_design()
        except RuntimeError as e:
            raise HTTPException(502, str(e))
        return {"tasks": [{"item": i, "match": _monday_match(i)} for i in items],
                "status": monday.ready_status()}

    @router.get("/monday/search")
    def monday_search(q: str = "", _user: dict = Depends(require_user)):
        if not monday.configured():
            raise _monday_dormant()
        term = q.strip()
        if len(term) < 2:
            return {"items": []}
        # A pasted number is a lookup, not a search.
        if term.isdigit():
            try:
                item = monday.get_item(term)
            except RuntimeError as e:
                raise HTTPException(502, str(e))
            return {"items": [item] if item else []}
        try:
            return {"items": monday.search(term)}
        except RuntimeError as e:
            raise HTTPException(502, str(e))

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

            # Monday tracks each language as its own subitem with its own id.
            # If the parent was pulled from Monday, hand every variant the
            # subitem whose language matches — nobody should re-type ids that
            # were already fetched.
            langs = lp_core.languages() or lp_core.DEFAULT_LANGS
            subs_by_code: dict = {}
            for s in (parent.get("monday") or {}).get("subitems") or []:
                code = monday.match_language(s.get("language") or "", langs)
                if code and code not in subs_by_code:
                    subs_by_code[code] = str(s.get("id") or "")

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
                    "monday_id": subs_by_code.get(lang, ""),
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

        if made:
            from .. import events
            events.emit("email.variants.created", {
                "parent_id": cid,
                "languages": [c["language"] for c in made],
                "ids": [c["id"] for c in made],
            })
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

    @router.post("/hero/generate")
    def hero_generate(payload: HeroGen, _user: dict = Depends(require_user)):
        """AI hero image as a BACKGROUND JOB.

        The request only registers the job; the pipeline runs on a worker
        thread and writes the finished image into the campaign server-side —
        a refresh, navigation or closed laptop does not stop a generation,
        and an abandoned one still lands. The missing-key case stays a
        synchronous 424 so the UI can say so immediately.
        """
        from . import hero_ai, jobs
        from ..secrets import get_secret
        if not get_secret("OPENAI_API_KEY"):
            raise HTTPException(424, detail={"missing_secrets": ["OPENAI_API_KEY"],
                                             "error": "OPENAI_API_KEY is not configured."})
        cid = (payload.campaign_id or "").strip()
        iid = (payload.iid or "").strip()
        with core.lock():
            c = core.campaigns().get(cid)
            if not c or not any(s.get("iid") == iid for s in c.get("sections") or []):
                raise HTTPException(404, "Campaign or block not found.")
        # One generation per block at a time: a second click adopts the
        # running job instead of paying for a duplicate render.
        running = jobs.active_for(cid, iid, "hero")
        if running:
            return jobs.public(running)

        entity = _entity_for({"brand_id": payload.brand_id})
        kwargs = dict(
            entity=entity,
            brief=(payload.brief or "").strip()[:600],
            with_text=bool(payload.with_text),
            headline=(payload.headline or "").strip()[:120],
            subtitle=(payload.subtitle or "").strip()[:160],
            visual_style=payload.visual_style if payload.visual_style in
                ("auto", "photo", "illustration", "render3d") else "auto",
            people=payload.people if payload.people in ("any", "none") else "any",
            avoid=(payload.avoid or "").strip()[:200],
            direction_override=(payload.direction_override or "").strip()[:900],
        )

        def work() -> dict:
            out = hero_ai.generate_hero(**kwargs)
            return {"value": out["id"], "url": _asset_url(out["id"]),
                    "direction": out["direction"]}

        def apply(result: dict) -> None:
            # Server-side write-back: the whole point. If the user edited and
            # autosaved a stale copy in the tiny window before their page
            # learns the result, the UI re-applies on poll completion and the
            # next autosave converges — the hero cannot stay lost.
            with core.lock():
                camp = core.campaigns().get(cid)
                if not camp:
                    return
                for sct in camp.get("sections") or []:
                    if sct.get("iid") == iid:
                        sct.setdefault("images", {})["hero"] = result["value"]
                        camp["updated_at"] = core._now()
                        core.persist_campaign(camp)
                        return

        return jobs.public(jobs.start("hero", cid, iid, work, apply))

    @router.get("/hero/jobs/{job_id}")
    def hero_job(job_id: str, _user: dict = Depends(require_user)):
        from . import jobs
        j = jobs.get(job_id)
        if not j:
            raise HTTPException(404, "Job not found.")
        return jobs.public(j)

    @router.get("/hero/jobs")
    def hero_jobs(campaign_id: str = "", _user: dict = Depends(require_user)):
        from . import jobs
        return {"jobs": [jobs.public(j) for j in jobs.for_campaign(campaign_id)]}

    # -------------------------------------------------------------- AI copy
    @router.post("/copy/generate")
    def copy_generate(payload: CopyGen, _user: dict = Depends(require_user)):
        """AI copy for the whole email as a BACKGROUND JOB.

        The house copywriter (crm_copywriter.md) writes into the campaign's
        actual blocks — headline, each body paragraph, the CTA label, the offer
        callout, support and sign-off — plus subject A/B variants and the
        pre-header. Like the hero job it runs on a worker thread and writes the
        result server-side, so a refresh or a closed page never loses it.
        """
        from . import copy_ai, jobs
        from ..secrets import get_secret
        if not get_secret("OPENAI_API_KEY"):
            raise HTTPException(424, detail={"missing_secrets": ["OPENAI_API_KEY"],
                                             "error": "OPENAI_API_KEY is not configured."})
        cid = (payload.campaign_id or "").strip()
        with core.lock():
            c = core.campaigns().get(cid)
            if not c:
                raise HTTPException(404, "Campaign not found.")
            sections = [dict(s) for s in (c.get("sections") or [])]
        entity = _entity_for(c)
        spec = copy_ai.build_spec(sections)
        if not spec:
            raise HTTPException(422, "This layout has no copy blocks to write.")

        # One copy generation per campaign at a time (iid="" — it is the whole
        # email, not a single block); a second click adopts the running job.
        running = jobs.active_for(cid, "", "copy")
        if running:
            return jobs.public(running)

        segment = copy_ai.segment_for(entity, payload.segment)
        kwargs = dict(entity=entity, brief=(payload.brief or "").strip()[:1200],
                      segment=segment, tier=payload.tier, language=c.get("language") or "en",
                      spec=spec)

        def work() -> dict:
            return copy_ai.generate_copy(**kwargs)

        def apply(result: dict) -> None:
            # Server-side write-back: subject + pre-header on the campaign, and
            # each generated value onto its block instance by iid+key.
            by_iid_key = {(it["iid"], it["key"]): it["value"] for it in result.get("items", [])}
            with core.lock():
                camp = core.campaigns().get(cid)
                if not camp:
                    return
                subs = result.get("subjects") or []
                if subs:
                    camp["subject"] = subs[0]
                if result.get("preheader"):
                    camp["preheader"] = result["preheader"]
                if result.get("image_brief"):
                    camp["image_brief"] = result["image_brief"]
                for sct in camp.get("sections") or []:
                    iid = sct.get("iid")
                    texts = sct.setdefault("texts", {})
                    for (k_iid, k_key), val in by_iid_key.items():
                        if k_iid == iid:
                            texts[k_key] = val
                camp["updated_at"] = core._now()
                core.persist_campaign(camp)

        return jobs.public(jobs.start("copy", cid, "", work, apply))

    @router.get("/copy/jobs/{job_id}")
    def copy_job(job_id: str, _user: dict = Depends(require_user)):
        from . import jobs
        j = jobs.get(job_id)
        if not j:
            raise HTTPException(404, "Job not found.")
        return jobs.public(j)

    @router.get("/copy/jobs")
    def copy_jobs(campaign_id: str = "", _user: dict = Depends(require_user)):
        from . import jobs
        return {"jobs": [jobs.public(j) for j in jobs.for_campaign(campaign_id)
                         if j.get("kind") == "copy"]}

    @router.post("/copy/image-brief")
    def copy_image_brief(payload: CopyGen, _user: dict = Depends(require_user)):
        """A hero-image brief built from the campaign's CURRENT content — the
        approved copy read live, so it reflects any inline edits. Short and
        synchronous: it only fills the generator's brief field. Reuses the
        CopyGen payload for its campaign_id."""
        from . import copy_ai
        from ..secrets import get_secret
        if not get_secret("OPENAI_API_KEY"):
            raise HTTPException(424, detail={"missing_secrets": ["OPENAI_API_KEY"],
                                             "error": "OPENAI_API_KEY is not configured."})
        cid = (payload.campaign_id or "").strip()
        with core.lock():
            c = core.campaigns().get(cid)
            if not c:
                raise HTTPException(404, "Campaign not found.")
            sections = [dict(s) for s in (c.get("sections") or [])]
            subject = c.get("subject") or ""
        entity = _entity_for(c)
        digest = copy_ai.content_digest(sections)
        try:
            brief = copy_ai.image_brief(entity=entity, subject=subject,
                                        headline=digest["headline"],
                                        body=digest["body"], offer=digest["offer"])
        except ValueError as e:
            raise HTTPException(422, str(e))
        except RuntimeError as e:
            raise HTTPException(502, str(e))
        # Persist it too, so the seed survives a reload even before any save.
        with core.lock():
            camp = core.campaigns().get(cid)
            if camp:
                camp["image_brief"] = brief
                camp["updated_at"] = core._now()
                core.persist_campaign(camp)
        return {"brief": brief}

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
    """Store an upload in the format email best practice actually wants.

    JPEG for photographic content, PNG only where transparency demands it —
    forcing everything to PNG (the old behaviour) turned a photo upload into
    a megabyte-class file, and slow-loading images are skipped emails. If a
    TinyPNG-style squeeze is ever added, this function is its single hook.
    """
    from PIL import Image

    im = Image.open(io.BytesIO(data))
    im.load()
    im = im.convert("RGBA") if im.mode not in ("RGB", "RGBA") else im
    # 1200px wide is plenty for a 600px email at 2x, and keeps us clear of the
    # size budget that Gmail clips against.
    if im.width > 1200:
        im.thumbnail((1200, 1200 * 4))

    transparent = im.mode == "RGBA" and im.getchannel("A").getextrema()[0] < 255
    buf = io.BytesIO()
    if transparent:
        im.save(buf, format="PNG", optimize=True)
        ext = ".png"
    else:
        if im.mode != "RGB":
            im = im.convert("RGB")
        im.save(buf, format="JPEG", quality=85, optimize=True, progressive=True)
        ext = ".jpg"
    aid = core.new_asset_id() + ext
    # Supabase first (returns the full CDN URL as the stored value); the
    # Render disk stays as the fallback and the home of pre-migration assets.
    from . import storage as supa
    url = supa.upload(aid, buf.getvalue())
    if url:
        return url
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
    return _materialise_logo(raw)


def _materialise_logo(raw: str) -> Optional[str]:
    """One stored logo value (SVG markup, data: URI or URL) -> a hosted asset."""
    import base64
    import hashlib

    if not raw:
        return None

    if raw.startswith(("http://", "https://")):
        return raw  # already hosted; nothing to do

    aid = "logo-" + hashlib.sha1(raw.encode("utf-8")).hexdigest()[:24] + ".png"
    path = core.ASSETS_DIR / aid
    from . import storage as supa
    if path.exists():
        return supa.upload(aid, path.read_bytes()) or aid

    png: Optional[bytes] = None
    if raw.startswith("<svg"):
        png = export.rasterise_svg(raw, width=_LOGO_PX)
        if not png:
            # No rasteriser on this machine (libcairo is in the Docker image,
            # not in a local macOS venv). Serve the SVG itself so the logo is
            # visible in previews TODAY — mail clients cannot render SVG, but
            # a deployed compose rasterises to PNG before anything is sent.
            if "<script" in raw.lower() or "onload=" in raw.lower():
                log.warning("email-builder: refusing scripted SVG logo")
                return None
            aid_svg = "logo-" + hashlib.sha1(raw.encode("utf-8")).hexdigest()[:24] + ".svg"
            path_svg = core.ASSETS_DIR / aid_svg
            if not path_svg.exists():
                core.ASSETS_DIR.mkdir(parents=True, exist_ok=True)
                path_svg.write_text(raw, encoding="utf-8")
            from . import storage as supa
            return supa.upload(aid_svg, path_svg.read_bytes()) or aid_svg
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
    return supa.upload(aid, png) or aid


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
    # The dark-mode wordmark, when Settings has one. Composed as a hidden
    # sibling the prefers-color-scheme swap reveals — dark-lettered logos
    # otherwise vanish on dark backgrounds.
    dark_aid = _materialise_logo(str(entity.get("logo_svg_dark") or "").strip())

    def fill(images: dict) -> dict:
        out = dict(images or {})
        if not out.get("logo"):
            out["logo"] = aid
        if dark_aid and not out.get("logo_dark"):
            out["logo_dark"] = dark_aid
        return out

    out = dict(project)
    out["sections"] = [
        {**s, "images": fill(s.get("images"))}
        if s.get("block_key") == "em-logo-header" else s
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
        media = {".png": "image/png", ".svg": "image/svg+xml",
                 ".jpg": "image/jpeg"}.get(path.suffix.lower())
        if not path.is_file() or not media:
            raise HTTPException(404, "Not found.")
        return Response(
            content=path.read_bytes(),
            media_type=media,
            # Immutable: the filename is content-derived, so a sent email keeps
            # rendering the image it was composed with.
            headers={"Cache-Control": "public, max-age=31536000, immutable"},
        )

    return router
