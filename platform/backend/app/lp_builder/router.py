"""LP Builder HTTP routes (mounted at /api/tools/lp-builder)."""
from __future__ import annotations

import io
import json
import logging
import re
from typing import List

from fastapi import APIRouter, Body, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response

from ..auth import require_admin, require_user
from . import core, export

log = logging.getLogger("lp_builder")

_MAX_SECTIONS_PER_PAGE = 30
_MAX_UPLOAD_BYTES = 10 * 1024 * 1024
_UPLOAD_MIME = {"image/png", "image/jpeg", "image/webp"}

# Google-fonts catalog cache + a curated offline fallback so the font picker
# always has something sensible to offer.
_FONTS_CACHE: dict = {"at": 0.0, "list": None}
_FALLBACK_FONTS: List[tuple] = [
    ("Inter", "sans-serif"), ("Roboto", "sans-serif"), ("Open Sans", "sans-serif"),
    ("Poppins", "sans-serif"), ("Montserrat", "sans-serif"), ("Lato", "sans-serif"),
    ("Urbanist", "sans-serif"), ("Nunito", "sans-serif"), ("Raleway", "sans-serif"),
    ("Work Sans", "sans-serif"), ("Rubik", "sans-serif"), ("Manrope", "sans-serif"),
    ("DM Sans", "sans-serif"), ("Plus Jakarta Sans", "sans-serif"), ("Outfit", "sans-serif"),
    ("Figtree", "sans-serif"), ("Sora", "sans-serif"), ("Space Grotesk", "sans-serif"),
    ("Barlow", "sans-serif"), ("Kanit", "sans-serif"), ("Mulish", "sans-serif"),
    ("Karla", "sans-serif"), ("Josefin Sans", "sans-serif"), ("Exo 2", "sans-serif"),
    ("Playfair Display", "serif"), ("Merriweather", "serif"), ("Lora", "serif"),
    ("PT Serif", "serif"), ("Libre Baskerville", "serif"), ("Cormorant Garamond", "serif"),
    ("Crimson Text", "serif"), ("Source Serif 4", "serif"), ("Bitter", "serif"),
    ("Oswald", "display"), ("Bebas Neue", "display"), ("Anton", "display"),
    ("Archivo Black", "display"), ("Righteous", "display"), ("Abril Fatface", "display"),
    ("Caveat", "handwriting"), ("Pacifico", "handwriting"), ("Dancing Script", "handwriting"),
    ("JetBrains Mono", "monospace"), ("Fira Code", "monospace"), ("IBM Plex Mono", "monospace"),
    ("Noto Sans", "sans-serif"), ("Noto Sans Thai", "sans-serif"), ("Noto Sans JP", "sans-serif"),
]


def _enforce_owner(p: dict, user: dict) -> None:
    if (user or {}).get("role") == "admin":
        return
    if (p.get("created_by") or "").lower() == ((user or {}).get("email") or "").lower():
        return
    raise HTTPException(status_code=403, detail="Only the person who created this landing page can do that.")


def _clean_str(v, cap: int) -> str:
    return str(v or "").strip()[:cap]


def _clean_project_patch(payload: dict, p: dict) -> None:
    """Apply a whitelisted full-document update (the autosave PUT)."""
    if "name" in payload:
        p["name"] = _clean_str(payload.get("name"), 120) or p["name"]
    for k in ("brand_id", "language", "campaign_id", "fonts", "font_family", "meta_title", "meta_description"):
        if k in payload:
            p[k] = _clean_str(payload.get(k), 400) or ("" if k != "fonts" else "system")
    if "monday_id" in payload:  # Monday.com item id — digits only
        p["monday_id"] = re.sub(r"\D", "", str(payload.get("monday_id") or ""))[:20]
    if p.get("fonts") not in ("system", "google"):
        p["fonts"] = "system"
    if isinstance(payload.get("tokens"), dict):
        p["tokens"] = {k: _clean_str(v, 6000) for k, v in payload["tokens"].items()
                       if k in core.DEFAULT_TOKENS}
    if isinstance(payload.get("form"), dict):
        p["form"] = {"action_url": _clean_str(payload["form"].get("action_url"), 500),
                     "success_url": _clean_str(payload["form"].get("success_url"), 500)}
    if isinstance(payload.get("seo"), dict):
        s = payload["seo"]
        p["seo"] = {
            "og_title": _clean_str(s.get("og_title"), 200),
            "og_description": _clean_str(s.get("og_description"), 400),
            "og_image": _clean_str(s.get("og_image"), 6000),
            "favicon": _clean_str(s.get("favicon"), 6000),
            "canonical": _clean_str(s.get("canonical"), 500),
            "robots_index": s.get("robots_index", True) is not False,
        }
    if isinstance(payload.get("sections"), list):
        secs = []
        for s in payload["sections"][:_MAX_SECTIONS_PER_PAGE]:
            if not isinstance(s, dict) or not s.get("template_key"):
                continue
            secs.append({
                "iid": _clean_str(s.get("iid"), 24) or core.new_asset_id()[:8],
                "template_key": _clean_str(s.get("template_key"), 64),
                "texts": {str(k)[:80]: str(v)[:2000] for k, v in (s.get("texts") or {}).items()},
                "images": {str(k)[:80]: str(v)[:6000] for k, v in (s.get("images") or {}).items()},
                "images_mobile": {str(k)[:80]: str(v)[:6000] for k, v in (s.get("images_mobile") or {}).items()},
                "links": {str(k)[:80]: str(v)[:500] for k, v in (s.get("links") or {}).items()},
                "repeats": {str(k)[:80]: max(1, min(12, int(v)))
                            for k, v in (s.get("repeats") or {}).items()
                            if isinstance(v, (int, float))},
                "props": s.get("props") if isinstance(s.get("props"), dict) else {},
                # Layer names from the builder's tree, keyed the same way the
                # tree keys things ('title', 'steps.1', 'steps.1.icon'). Emitted
                # as data-name on export; descriptive only.
                "names": {str(k)[:80]: str(v)[:120] for k, v in (s.get("names") or {}).items()
                          if str(v).strip()},
            })
        p["sections"] = secs


def _public_section(s: dict, with_body: bool = False) -> dict:
    out = {
        "key": s["key"], "name": s.get("name", s["key"]), "category": s.get("category", "content"),
        "position": s.get("position", 999), "enabled": s.get("enabled", True),
        "built_in": bool(s.get("built_in")),
        # What the block calls each slot (Layers tree + exported data-name).
        "names": s.get("names") or {},
        "languages": sorted((s.get("texts") or {}).keys()),
        **core.parse_fields(s.get("html") or ""),
    }
    if with_body:
        out.update({"html": s.get("html") or "", "css": s.get("css") or "",
                    "texts": s.get("texts") or {}, "assets": s.get("assets") or {}})
    return out


def build_lp_builder_router() -> APIRouter:
    router = APIRouter()

    # ---- sections (the template library) -----------------------------------
    @router.get("/sections")
    def list_sections(all: bool = False, _user: dict = Depends(require_user)):
        with core.lock():
            secs = sorted(core.sections().values(), key=lambda s: s.get("position", 999))
        if not all:
            secs = [s for s in secs if s.get("enabled", True)]
        return {"sections": [_public_section(s, with_body=True) for s in secs],
                "languages": core.languages()}

    @router.post("/sections")
    def create_section(payload: dict = Body(default={}), user: dict = Depends(require_admin)):
        key = _clean_str(payload.get("key"), 48).lower()
        if not core.KEY_RE.match(key):
            raise HTTPException(status_code=422, detail="key must be lowercase letters/digits/dashes")
        with core.lock():
            if key in core.sections():
                raise HTTPException(status_code=409, detail="a section with that key already exists")
        clone_of = _clean_str(payload.get("clone_of"), 64)
        base = core.sections().get(clone_of) if clone_of else None
        s = {
            "key": key,
            "name": _clean_str(payload.get("name"), 80) or key,
            "category": _clean_str(payload.get("category"), 40) or (base or {}).get("category", "content"),
            "html": (base or {}).get("html", "<section class=\"lp-sec-" + key + "\">\n <div class=\"lp-wrap\">\n  <h2 data-lp-text=\"title\">New section</h2>\n </div>\n</section>"),
            "css": (base or {}).get("css", f".lp-sec-{key}{{padding:80px 0}}"),
            "texts": dict((base or {}).get("texts") or {"en": {"title": "New section"}}),
            "assets": dict((base or {}).get("assets") or {}),
            "position": int(payload.get("position") or ((base or {}).get("position", 999)) + 1),
            "enabled": True, "built_in": False,
            "updated_by": (user or {}).get("email") or "", "updated_at": core._now(),
        }
        if base is not None and base.get("html"):
            # a clone must not collide on CSS namespacing — rewrite the class root
            s["html"] = s["html"].replace(f"lp-sec-{base['key']}", f"lp-sec-{key}")
            s["css"] = s["css"].replace(f"lp-sec-{base['key']}", f"lp-sec-{key}")
        err = core.validate_section_html(s["html"])
        if err:
            raise HTTPException(status_code=422, detail=err)
        with core.lock():
            core.sections()[key] = s
        core.persist_section(s)
        return _public_section(s, with_body=True)

    @router.put("/sections/{key}")
    def update_section(key: str, payload: dict = Body(default={}), user: dict = Depends(require_admin)):
        with core.lock():
            s = core.sections().get(key)
            if s is None:
                raise HTTPException(status_code=404, detail="section not found")
            s = dict(s)
        if "html" in payload:
            html = str(payload.get("html") or "")[:200_000]
            err = core.validate_section_html(html)
            if err:
                raise HTTPException(status_code=422, detail=err)
            s["html"] = html
        if "css" in payload:
            css = str(payload.get("css") or "")[:200_000]
            if re.search(r"<\s*/?\s*style|@import|javascript\s*:", css, re.I):
                raise HTTPException(status_code=422, detail="css must be plain rules (no @import / tags)")
            s["css"] = css
        if isinstance(payload.get("texts"), dict):
            s["texts"] = {str(lang)[:8]: {str(k)[:80]: str(v)[:2000] for k, v in (d or {}).items()}
                          for lang, d in payload["texts"].items() if isinstance(d, dict)}
        if isinstance(payload.get("assets"), dict):
            s["assets"] = {str(k)[:80]: str(v)[:6000] for k, v in payload["assets"].items()}
        if "name" in payload:
            s["name"] = _clean_str(payload.get("name"), 80) or s["name"]
        if "category" in payload:
            s["category"] = _clean_str(payload.get("category"), 40) or s["category"]
        if "position" in payload:
            try:
                s["position"] = int(payload.get("position"))
            except (TypeError, ValueError):
                pass
        if "enabled" in payload:
            s["enabled"] = bool(payload.get("enabled"))
        s["updated_by"] = (user or {}).get("email") or ""
        s["updated_at"] = core._now()
        with core.lock():
            core.sections()[key] = s
        core.persist_section(s)
        return _public_section(s, with_body=True)

    @router.delete("/sections/{key}", status_code=204)
    def delete_section(key: str, _user: dict = Depends(require_admin)):
        with core.lock():
            s = core.sections().get(key)
            if s is None:
                raise HTTPException(status_code=404, detail="section not found")
            if s.get("built_in"):
                raise HTTPException(status_code=409, detail="built-in sections can only be disabled")
            in_use = any(inst.get("template_key") == key
                         for p in core.projects().values() for inst in p.get("sections") or [])
            if in_use:
                raise HTTPException(status_code=409, detail="this section is used by a landing page")
            core.sections().pop(key, None)
        core.delete_section_file(key)
        return Response(status_code=204)

    # ---- languages ----------------------------------------------------------
    @router.get("/languages")
    def get_languages(_user: dict = Depends(require_user)):
        return {"languages": core.languages()}

    @router.put("/languages")
    def put_languages(payload: dict = Body(default={}), _user: dict = Depends(require_admin)):
        langs = payload.get("languages")
        if not isinstance(langs, list) or not langs:
            raise HTTPException(status_code=422, detail="languages must be a non-empty list")
        cleaned = []
        for l in langs[:24]:
            code = _clean_str((l or {}).get("code"), 8).lower()
            label = _clean_str((l or {}).get("label"), 40)
            if re.fullmatch(r"[a-z]{2}(-[a-z]{2})?", code) and label:
                cleaned.append({"code": code, "label": label})
        if not cleaned:
            raise HTTPException(status_code=422, detail="no valid languages given")
        codes = {l["code"] for l in cleaned}
        with core.lock():
            used = {p.get("language") for p in core.projects().values()}
            missing = sorted(u for u in used if u and u not in codes)
            if missing:
                raise HTTPException(status_code=409,
                                    detail=f"language(s) in use by landing pages: {', '.join(missing)}")
            core._LANGS[:] = cleaned
        core.persist_langs()
        return {"languages": core.languages()}

    # ---- projects ------------------------------------------------------------
    def _cover_url(p: dict):
        """The page's own hero-ish image — the dashboard card cover.

        The MOBILE variant of a slot wins over the desktop one: the card is
        square, and a mobile hero is already cropped for a narrow frame, so it
        fills the tile instead of being letterboxed. Falls back to the desktop
        image for any slot without a mobile override.
        """
        preferred = ("creative", "hero", "photo", "image")

        def usable(v) -> bool:
            return bool(v) and not str(v).startswith("token:")

        for inst in p.get("sections") or []:
            mobile = inst.get("images_mobile") or {}
            images = inst.get("images") or {}
            for key in preferred:
                v = mobile.get(key) if usable(mobile.get(key)) else images.get(key)
                if usable(v):
                    return export.serve_url_for(str(v))
            for key, v in images.items():
                v = mobile.get(key) if usable(mobile.get(key)) else v
                if usable(v):
                    return export.serve_url_for(str(v))
        return None

    @router.get("/projects")
    def list_projects(_user: dict = Depends(require_user)):
        with core.lock():
            ps = sorted(core.projects().values(), key=lambda p: p.get("updated_at", ""), reverse=True)
        return {"projects": [{k: p.get(k) for k in
                              ("id", "name", "brand_id", "language", "monday_id", "campaign_id",
                               "created_by", "created_at", "updated_at")}
                             | {"sections": len(p.get("sections") or []),
                                "cover_url": _cover_url(p)} for p in ps]}

    def _seed_sections(brand_id: str) -> list:
        """A new project starts with the brand's full template laid out in Figma
        order (its sections are the ones whose category matches the brand), so
        the page opens ready-to-edit instead of blank. Texts render in the
        project's language via the compositor's per-language fallback."""
        if not brand_id:
            return []
        with core.lock():
            smap = dict(core.sections())
        picked = [s for s in smap.values()
                  if s.get("enabled", True) and (s.get("category") or "").lower() == brand_id.lower()]
        picked.sort(key=lambda s: s.get("position", 999))
        return [{"iid": core.new_asset_id()[:8], "template_key": s["key"],
                 "texts": {}, "images": {}, "images_mobile": {},
                 "links": {}, "repeats": {}, "props": {}}
                for s in picked]

    @router.post("/projects", status_code=201)
    def create_project(payload: dict = Body(default={}), user: dict = Depends(require_user)):
        name = _clean_str(payload.get("name"), 120)
        if not name:
            raise HTTPException(status_code=422, detail="give the landing page a name")
        lang = _clean_str(payload.get("language"), 8) or "en"
        if lang not in {l["code"] for l in core.languages()}:
            raise HTTPException(status_code=422, detail=f"unknown language '{lang}'")
        brand_id = _clean_str(payload.get("brand_id"), 64)
        p = {
            "id": core.new_project_id(), "name": name,
            "brand_id": brand_id,
            "language": lang,
            "monday_id": re.sub(r"\D", "", str(payload.get("monday_id") or ""))[:20],
            "campaign_id": _clean_str(payload.get("campaign_id"), 64),
            "sections": _seed_sections(brand_id), "tokens": dict(payload.get("tokens") or {}),
            "form": {"action_url": "", "success_url": ""}, "fonts": "system",
            "font_family": "",
            "meta_title": "", "meta_description": "",
            "seo": {"og_title": "", "og_description": "", "og_image": "",
                    "favicon": "", "canonical": "", "robots_index": True},
            "created_by": (user or {}).get("email") or "",
            "created_at": core._now(), "updated_at": core._now(),
        }
        with core.lock():
            core.projects()[p["id"]] = p
        core.persist_project(p)
        return p

    @router.get("/projects/{pid}")
    def get_project(pid: str, _user: dict = Depends(require_user)):
        p = core.projects().get(pid)
        if p is None:
            raise HTTPException(status_code=404, detail="landing page not found")
        return p

    @router.put("/projects/{pid}")
    def update_project(pid: str, payload: dict = Body(default={}), user: dict = Depends(require_user)):
        with core.lock():
            p = core.projects().get(pid)
            if p is None:
                raise HTTPException(status_code=404, detail="landing page not found")
            _enforce_owner(p, user)
            _clean_project_patch(payload, p)
            p["updated_at"] = core._now()
        core.persist_project(p)
        return p

    @router.post("/projects/{pid}/duplicate", status_code=201)
    def duplicate_project(pid: str, payload: dict = Body(default={}), user: dict = Depends(require_user)):
        src = core.projects().get(pid)
        if src is None:
            raise HTTPException(status_code=404, detail="landing page not found")
        import copy
        p = copy.deepcopy(src)
        lang = _clean_str(payload.get("language"), 8)
        p["id"] = core.new_project_id()
        p["name"] = _clean_str(payload.get("name"), 120) or (
            f"{src['name']} ({lang})" if lang and lang != src.get("language") else f"{src['name']} copy")
        if lang:
            if lang not in {l["code"] for l in core.languages()}:
                raise HTTPException(status_code=422, detail=f"unknown language '{lang}'")
            p["language"] = lang
            # duplicate-to-language: keep layout/images/props, DROP user text
            # overrides so the target language's template defaults show through
            for inst in p.get("sections") or []:
                inst["texts"] = {}
        p["created_by"] = (user or {}).get("email") or ""
        p["created_at"] = p["updated_at"] = core._now()
        with core.lock():
            core.projects()[p["id"]] = p
        core.persist_project(p)
        return p

    @router.delete("/projects/{pid}", status_code=204)
    def delete_project(pid: str, user: dict = Depends(require_user)):
        with core.lock():
            p = core.projects().get(pid)
            if p is None:
                raise HTTPException(status_code=404, detail="landing page not found")
            _enforce_owner(p, user)
            core.projects().pop(pid, None)
        core.delete_project_files(pid)
        return Response(status_code=204)

    # ---- composition (canvas + preview share the ONE compositor) -------------
    @router.get("/bundled/{name:path}")
    def bundled_asset(name: str, _user: dict = Depends(require_user)):
        """Template-bundled assets (icon library, section mockups/photos)."""
        p = export.bundled_path(name)
        if p is None:
            raise HTTPException(status_code=404, detail="no such bundled asset")
        media = {"svg": "image/svg+xml", "png": "image/png", "jpg": "image/jpeg",
                 "jpeg": "image/jpeg", "webp": "image/webp"}.get(p.suffix.lstrip(".").lower(), "application/octet-stream")
        return FileResponse(p, media_type=media, headers={"Cache-Control": "public, max-age=86400"})

    @router.get("/icons")
    def icon_library(_user: dict = Depends(require_user)):
        """The BrainTrade icon library — bundled SVGs, assignable to any image slot."""
        icons_dir = export.BUNDLED_DIR / "icons"
        out = []
        if icons_dir.is_dir():
            for f in sorted(icons_dir.glob("*.svg")):
                out.append({"name": f.stem.replace("-", " "),
                            "url": f"/api/tools/lp-builder/bundled/icons/{f.name}"})
        return {"icons": out}

    @router.get("/fonts")
    def google_fonts(_user: dict = Depends(require_user)):
        """The Google Fonts catalog for the page-font picker: [{family, category}].

        Fetched from Google's public metadata endpoint (no API key) and cached
        for a day; a curated built-in list keeps the picker working offline.
        """
        import time as _time
        import urllib.request as _rq
        now = _time.time()
        if _FONTS_CACHE["list"] and now - _FONTS_CACHE["at"] < 86400:
            return {"fonts": _FONTS_CACHE["list"]}
        try:
            req = _rq.Request("https://fonts.google.com/metadata/fonts",
                              headers={"User-Agent": "Mozilla/5.0"})
            raw = _rq.urlopen(req, timeout=10).read().decode("utf-8", "replace")
            data = json.loads(raw.lstrip(")]}'\n"))  # strip the XSSI prefix
            fonts = [{"family": f["family"], "category": (f.get("category") or "").lower()}
                     for f in data.get("familyMetadataList", []) if f.get("family")]
            if len(fonts) > 100:
                _FONTS_CACHE.update(at=now, list=fonts)
                return {"fonts": fonts}
        except Exception as e:  # noqa: BLE001 — offline/blocked: serve the fallback
            log.warning("lp-builder: google fonts catalog fetch failed: %s", e)
        return {"fonts": [{"family": f, "category": c} for f, c in _FALLBACK_FONTS]}

    @router.post("/compose")
    def compose(payload: dict = Body(default={}), _user: dict = Depends(require_user)):
        project = payload.get("project")
        if not isinstance(project, dict):
            raise HTTPException(status_code=422, detail="'project' is required")
        mode = "editor" if payload.get("mode") == "editor" else "preview"
        with core.lock():
            smap = dict(core.sections())
        # The admin section editor previews its UNSAVED draft through the same
        # compositor: the draft simply shadows the stored section.
        draft = payload.get("draft_section")
        if isinstance(draft, dict) and draft.get("key"):
            err = core.validate_section_html(str(draft.get("html") or ""))
            if err:
                raise HTTPException(status_code=422, detail=err)
            smap[str(draft["key"])] = draft
        # hide_scrollbars: the in-app canvas is a Figma-style surface (pan +
        # zoom, no scrollbars); real exports keep native scrolling.
        out = export.compose_page(project, smap, mode=mode, resolve_img=export.serve_url_for,
                                  hide_scrollbars=True)
        return {"html": out["html"]}

    # ---- runtime scripts -------------------------------------------------------
    # Served as EXTERNAL same-origin files because the app's production CSP is
    # script-src 'self' — inline <script> inside the canvas iframe (which
    # inherits that CSP via srcdoc) would silently never run.
    @router.get("/editor.js")
    def editor_js(_user: dict = Depends(require_user)):
        return Response(content=export.EDITOR_JS, media_type="application/javascript",
                        headers={"Cache-Control": "no-store"})

    @router.get("/page.js")
    def page_js(_user: dict = Depends(require_user)):
        return Response(content=export.SCRIPT_JS, media_type="application/javascript",
                        headers={"Cache-Control": "no-store"})

    # ---- assets ---------------------------------------------------------------
    @router.post("/assets")
    async def upload_asset(file: UploadFile = File(...), _user: dict = Depends(require_user)):
        if (file.content_type or "") not in _UPLOAD_MIME:
            raise HTTPException(status_code=422, detail="use a PNG, JPG or WebP image")
        data = await file.read()
        if not data or len(data) > _MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=422, detail="image must be under 10MB")
        return _store_asset_bytes(data)

    def _store_asset_bytes(data: bytes) -> dict:
        import io as _io
        from PIL import Image
        try:
            with Image.open(_io.BytesIO(data)) as im:
                im.load()
                im = im.convert("RGBA")
                w, h = im.size
                if max(w, h) > 2400:
                    im.thumbnail((2400, 2400))
                    w, h = im.size
                buf = _io.BytesIO()
                im.save(buf, format="PNG")
                data = buf.getvalue()
        except Exception:  # noqa: BLE001
            raise HTTPException(status_code=422, detail="could not read that image")
        aid = core.new_asset_id()
        core.ASSETS_DIR.mkdir(parents=True, exist_ok=True)
        (core.ASSETS_DIR / f"{aid}.png").write_bytes(data)
        return {"id": aid, "url": f"/api/tools/lp-builder/assets/{aid}.png", "width": w, "height": h}

    @router.post("/assets/import")
    def import_asset(payload: dict = Body(default={}), _user: dict = Depends(require_user)):
        """Copy an image from a sibling tool (LP Materials / banner gallery) into
        the LP Builder asset store so exports can bundle it."""
        url = _clean_str(payload.get("url"), 500)
        path = _sibling_asset_path(url)
        if path is None:
            raise HTTPException(status_code=422, detail="that image cannot be imported")
        return _store_asset_bytes(path.read_bytes())

    def _sibling_asset_path(url: str):
        from ..settings import settings as _settings
        m = re.fullmatch(r"/api/tools/lp-materials/reference/([a-f0-9]{32})\.png", url)
        if m:
            p = _settings.ARTIFACT_ROOT / "lp-materials" / "uploads" / f"{m.group(1)}.png"
            return p if p.is_file() else None
        m = re.fullmatch(r"/api/tools/lp-materials/jobs/(m_[a-f0-9]{12})/items/(\d{1,2})\.png", url)
        if m:
            p = _settings.ARTIFACT_ROOT / "lp-materials" / m.group(1) / f"item_{m.group(2)}.png"
            return p if p.is_file() else None
        m = re.fullmatch(r"/api/tools/banner-builder/runs/(r_[a-f0-9]{12})/banners/([A-Za-z0-9_]+__[0-9x]+)\.png", url)
        if m:
            p = _settings.ARTIFACT_ROOT / "banner-builder" / m.group(1) / f"{m.group(2)}.png"
            return p if p.is_file() else None
        return None

    @router.get("/assets/{aid}.png")
    def get_asset(aid: str):
        if not core._ID_RE.match(aid):
            raise HTTPException(status_code=404, detail="not found")
        p = core.ASSETS_DIR / f"{aid}.png"
        if not p.is_file():
            raise HTTPException(status_code=404, detail="not found")
        return FileResponse(str(p), media_type="image/png")

    # ---- browser preview --------------------------------------------------------
    @router.get("/projects/{pid}/preview.html")
    def preview_html(pid: str, _user: dict = Depends(require_user)):
        """The WORKING website in a real browser tab — same compositor as the
        canvas/export, served as a normal navigable page. Carries its own CSP:
        scripts stay same-origin, but the signup form may POST / fetch to the
        configured external action URL."""
        p = core.projects().get(pid)
        if p is None:
            raise HTTPException(status_code=404, detail="landing page not found")
        with core.lock():
            smap = dict(core.sections())
        out = export.compose_page(p, smap, mode="preview", resolve_img=export.serve_url_for)
        csp = ("default-src 'self'; img-src 'self' data: blob: https:; "
               "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
               "font-src 'self' https://fonts.gstatic.com data:; "
               "script-src 'self'; connect-src 'self' https:; form-action 'self' https:; "
               "frame-ancestors 'none'; base-uri 'self'; object-src 'none'")
        return Response(content=out["html"], media_type="text/html",
                        headers={"Content-Security-Policy": csp, "Cache-Control": "no-store"})

    # ---- export ----------------------------------------------------------------
    @router.get("/projects/{pid}/export.zip")
    def export_zip(pid: str, _user: dict = Depends(require_user)):
        p = core.projects().get(pid)
        if p is None:
            raise HTTPException(status_code=404, detail="landing page not found")
        with core.lock():
            smap = dict(core.sections())
        data = export.build_zip(p, smap)
        slug = re.sub(r"[^A-Za-z0-9]+", "-", p.get("name") or "landing-page").strip("-").lower() or "landing-page"
        return Response(content=data, media_type="application/zip",
                        headers={"Content-Disposition": f'attachment; filename="{slug}.zip"'})

    return router
