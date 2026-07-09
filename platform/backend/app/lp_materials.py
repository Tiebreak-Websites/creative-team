"""LP Materials — small creative assets for landing pages.

Three generators, one shared pattern (user text -> GPT-5.5 composes the image
prompt -> gpt-image-2 renders -> per-item regenerate + zip):

  1. AVATARS   — review/testimonial profile pictures (1:1). Names are analysed
     by an LLM (any language/script) into {country, gender, age}; the pictures
     are DELIBERATELY imperfect — cropped from group photos, low quality,
     candid — maximum realism, never stock-photo pretty. A deterministic Pillow
     "degrade" pass (downscale/JPEG/noise) finishes the authenticity.
  2. CARDS     — the 3-6 image "benefits/steps" section (4:3 by default). One
     direction pass gives the whole set a shared look (and, optionally, ONE
     persona reused across every card), then each card gets its own scene.
  3. ADVERTORIAL — one editorial image visualizing a long-copy block (the LLM
     condenses the copy into its single strongest visual moment), N candidates.

HARD RULE baked into every prompt AND checked by a vision QA pass: generated
images contain NO text, NO letters, NO logos, NO watermarks.

Jobs persist as job.json + PNGs under ARTIFACT_ROOT/lp-materials/{job_id}/ (the
persistent disk in prod) and rehydrate on startup — same durability story as
banner runs, but a separate store so the banner gallery stays banners-only.

Routes (mounted at /api/tools/lp-materials, session-gated):
  POST /avatars/detect   names -> detected {language,country,gender,age} rows
  POST /avatars          start an avatar job          -> 202 job
  POST /cards            start a card-set job         -> 202 job
  POST /advertorial      start an advertorial job     -> 202 job
  GET  /jobs             all jobs, newest first (shared, like the banner gallery)
  GET  /jobs/{id}        poll one job
  GET  /jobs/{id}/items/{i}.png[?download=1]
  POST /jobs/{id}/items/{i}/regenerate   (owner)
  DELETE /jobs/{id}                      (owner/admin)
  GET  /jobs/{id}/download.zip
"""
from __future__ import annotations

import base64
import io
import json
import logging
import re
import threading
import time
import urllib.error
import urllib.request
import uuid
import zipfile
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import APIRouter, Body, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse

from . import engine, runner
from .auth import require_user
from .banner_engine import reshape
from .creative_director import OPENAI_RESPONSES_URL, _extract_output_text
from .secrets import get_secret
from .settings import settings

log = logging.getLogger(__name__)

LP_ROOT = settings.ARTIFACT_ROOT / "lp-materials"
# Uploaded HERO reference images (the landing page's hero visual): section cards
# and advertorials anchor their look to it. Customers deliberately do NOT.
UPLOADS_DIR = LP_ROOT / "uploads"
_ID_RE = re.compile(r"^[a-f0-9]{32}$")
_UPLOAD_MIME = {"image/png", "image/jpeg", "image/webp"}
_MAX_UPLOAD_BYTES = 10 * 1024 * 1024
_MAX_MARKET = 120

_MAX_AVATAR_ROWS = 20
_MAX_CARDS = 6
_MIN_CARDS = 3
_MAX_ADV_CANDIDATES = 3
_MAX_TITLE = 200
_MAX_TEXT = 2000

# Exact-pixel export sizes per aspect (all generatable via engine.ensure_size).
_ASPECT_SIZES = {"1:1": "800x800", "4:3": "1200x900", "16:9": "1200x674"}

_GEN_SEM = threading.Semaphore(2)
_JOBS: Dict[str, dict] = {}
_JOBS_LOCK = threading.Lock()
_LLM_MODEL = "gpt-5.5"

_NO_TEXT_RULE = ("The image must contain absolutely NO text, NO letters, NO numbers, "
                 "NO captions, NO logos, NO watermarks, NO UI elements.")

_OPENAI_SECRET = {"env": "OPENAI_API_KEY", "label": "OpenAI API key",
                  "docs_url": "https://platform.openai.com/api-keys", "present": False}


# ---------------------------------------------------------------------------
# LLM helper — structured JSON via the Responses API (optionally with an image)
# ---------------------------------------------------------------------------
def _llm_json(api_key: str, *, system: str, user_text: str, schema_name: str,
              schema: dict, effort: str = "medium", timeout: int = 150,
              image_bytes: Optional[bytes] = None) -> dict:
    if image_bytes is not None:
        b64 = base64.b64encode(image_bytes).decode("ascii")
        user_content = [
            {"type": "input_text", "text": user_text},
            {"type": "input_image", "image_url": f"data:image/png;base64,{b64}"},
        ]
    else:
        user_content = user_text
    payload = json.dumps({
        "model": _LLM_MODEL,
        "reasoning": {"effort": effort},
        "input": [
            {"role": "system", "content": system},
            {"role": "user", "content": user_content},
        ],
        "text": {"format": {"type": "json_schema", "name": schema_name,
                            "strict": True, "schema": schema}},
        "max_output_tokens": 8000,
    }).encode("utf-8")
    req = urllib.request.Request(
        OPENAI_RESPONSES_URL, data=payload, method="POST",
        headers={"Authorization": f"Bearer {api_key}",
                 "Content-Type": "application/json; charset=utf-8"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:300]
        log.warning("lp-materials LLM HTTP %s: %s", e.code, detail)
        raise RuntimeError(f"language-model call failed (HTTP {e.code})")
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"{type(e).__name__}: {e}")
    text = _extract_output_text(body)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        raise RuntimeError("language-model output was not valid JSON")


_DETECT_NAMES_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["rows"],
    "properties": {"rows": {"type": "array", "items": {
        "type": "object", "additionalProperties": False,
        "required": ["name", "language", "country", "gender", "age"],
        "properties": {
            "name": {"type": "string"},
            "language": {"type": "string", "description": "language/script of the name (e.g. Thai)"},
            "country": {"type": "string", "description": "most likely country/nationality for this name"},
            "gender": {"type": "string", "enum": ["female", "male"]},
            "age": {"type": "string", "enum": ["20s", "30s", "40s", "50s", "60s"],
                    "description": "a plausible age band for a product reviewer with this name"},
        },
    }}},
}

_CARDS_DIRECTION_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["shared_direction", "persona", "scenes"],
    "properties": {
        "shared_direction": {"type": "string", "description":
            "~2 sentences: palette, lighting, mood, photographic style shared by the whole set"},
        "persona": {"type": "string", "description":
            "when a recurring person was requested: a DETAILED physical description (age, "
            "ethnicity, build, hair, clothing) reused verbatim in every scene; else empty string"},
        "scenes": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["index", "scene"],
            "properties": {
                "index": {"type": "integer"},
                "scene": {"type": "string", "description":
                    "~2-3 sentences of concrete art direction visualizing THIS card's message "
                    "(subject, action, setting, composition) — a scene, not an abstract concept"},
            },
        }},
    },
}

_ADVERTORIAL_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["scene"],
    "properties": {"scene": {"type": "string", "description":
        "~3 sentences of concrete art direction for ONE editorial photograph capturing the "
        "single strongest visual moment of the story (subject, action, setting, lighting)"}},
}

_NO_TEXT_QA_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["has_text", "seen"],
    "properties": {
        "has_text": {"type": "boolean", "description": "true if ANY readable text/letters/logos appear"},
        "seen": {"type": "string", "description": "what text was seen, if any (short)"},
    },
}


# ---------------------------------------------------------------------------
# Deterministic authenticity degrade (avatars) — Pillow only
# ---------------------------------------------------------------------------
def _degrade(png_bytes: bytes) -> bytes:
    """Make a too-clean render read like a real casual photo: downscale/upscale
    softness, a JPEG round-trip's artifacts, mild noise. Deterministic-ish and
    cheap — far more reliable than asking the model to 'look low quality'."""
    from PIL import Image, ImageEnhance
    with Image.open(io.BytesIO(png_bytes)) as im:
        im = im.convert("RGB")
        w, h = im.size
        small = im.resize((max(1, int(w * 0.55)), max(1, int(h * 0.55))), Image.BILINEAR)
        im = small.resize((w, h), Image.BILINEAR)
        im = ImageEnhance.Sharpness(im).enhance(0.85)
        im = ImageEnhance.Color(im).enhance(0.92)
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=72)
        buf.seek(0)
        with Image.open(buf) as jj:
            out = io.BytesIO()
            jj.convert("RGB").save(out, format="PNG")
            return out.getvalue()


def _avatar_prompt(row: dict, style: dict) -> str:
    gender_word = {"female": "woman", "male": "man"}.get(row.get("gender"), "person")
    parts = [
        f"Amateur but likeable profile photo of a real, ordinary {row.get('age', '30s')} "
        f"{row.get('country', '')} {gender_word} — the kind of picture a happy customer "
        "uses as their account profile photo.",
        # The customer look: eye contact + a natural slight smile. Still a real
        # person's snapshot, never a studio portrait.
        "Facing the camera and looking INTO the lens with a relaxed, natural slight "
        "smile — warm, friendly and confident; a genuinely good, likeable profile "
        "picture moment.",
    ]
    if style.get("group_crop", True):
        parts.append("Cropped out of a larger casual photo: framing slightly off-center, "
                     "a sliver of another person's shoulder or arm at the frame edge.")
    if style.get("low_quality", True):
        parts.append("Everyday smartphone photo quality: slightly soft focus, mild noise, "
                     "uneven real-world lighting or direct flash, colors a touch washed out.")
    if style.get("candid", True):
        parts.append("An unstaged real-life moment — imperfect angle and a busy everyday "
                     "background (street, cafe, living room) — but still looking at the camera.")
    parts.append(
        "An ordinary, believable face and body with imperfect skin and everyday clothes — "
        "absolutely NOT a model, NOT studio lighting, NOT a professional portrait, no bokeh "
        "beauty shot. Head and shoulders visible, roughly centered enough to crop square. "
        + _NO_TEXT_RULE
    )
    return " ".join(parts)


# ---------------------------------------------------------------------------
# Job store + persistence + rehydrate
# ---------------------------------------------------------------------------
def _now() -> str:
    return runner._now()


def _persist_job(job: dict) -> None:
    try:
        data = {k: job[k] for k in ("id", "kind", "status", "error", "created_by",
                                    "created_at", "updated_at", "params")}
        data["items"] = [{k: it.get(k) for k in ("index", "label", "size", "prompt",
                                                 "status", "error", "qa", "degrade")}
                         for it in job["items"]]
        (job["dir"] / "job.json").write_text(json.dumps(data, ensure_ascii=False),
                                             encoding="utf-8")
    except Exception:  # noqa: BLE001
        log.warning("lp-materials: could not persist job %s", job.get("id"))


def rehydrate_jobs() -> int:
    """Restore persisted jobs on startup (idempotent, best-effort). A job that
    was mid-generation when the server died settles its unfinished items to
    'failed' (their prompts are kept, so per-item regenerate still works)."""
    if not LP_ROOT.exists():
        return 0
    n = 0
    for d in sorted(LP_ROOT.iterdir()):
        meta = d / "job.json"
        if not (d.is_dir() and meta.is_file()) or _JOBS.get(d.name) is not None:
            continue
        try:
            data = json.loads(meta.read_text(encoding="utf-8"))
            items = []
            for it in data.get("items", []):
                st = it.get("status")
                if st in ("pending", "running"):
                    st, it["error"] = "failed", "interrupted by a server restart — regenerate"
                png = d / f"item_{it.get('index')}.png"
                if st == "ok" and not png.is_file():
                    st, it["error"] = "failed", "image file is no longer on disk"
                items.append({**it, "status": st})
            job = {
                "id": data["id"], "kind": data.get("kind", ""),
                "status": data.get("status") if data.get("status") in ("done", "partial", "failed") else "done",
                "error": data.get("error"),
                "created_by": data.get("created_by", ""),
                "created_at": data.get("created_at", _now()),
                "updated_at": data.get("updated_at", _now()),
                "params": data.get("params", {}), "items": items,
                "dir": d, "api_key": "",
            }
            # Recompute a sane terminal status from the item states.
            oks = sum(1 for it in items if it["status"] == "ok")
            job["status"] = "done" if oks == len(items) and items else ("partial" if oks else "failed")
            with _JOBS_LOCK:
                _JOBS[job["id"]] = job
            n += 1
        except Exception:  # noqa: BLE001
            log.warning("lp-materials: skipping unreadable job dir %s", d.name)
    if n:
        log.info("lp-materials: rehydrated %d job(s)", n)
    return n


def _public_job(job: dict) -> dict:
    return {
        "job_id": job["id"], "kind": job["kind"], "status": job["status"],
        "error": job.get("error"), "created_by": job.get("created_by", ""),
        "created_at": job["created_at"], "updated_at": job["updated_at"],
        "params": {k: v for k, v in (job.get("params") or {}).items() if k != "api_key"},
        "items": [{
            "index": it["index"], "label": it.get("label", ""), "size": it.get("size", ""),
            "status": it["status"], "error": it.get("error"), "qa": it.get("qa"),
            "url": (f"/api/tools/lp-materials/jobs/{job['id']}/items/{it['index']}.png"
                    if it["status"] == "ok" else None),
        } for it in job["items"]],
    }


# ---------------------------------------------------------------------------
# Generation workers
# ---------------------------------------------------------------------------
def _no_text_qa(api_key: str, png_bytes: bytes) -> Optional[str]:
    """Vision check for the no-text rule. Returns a warning string or None.
    Fail-open: a QA failure never fails the item."""
    try:
        data = _llm_json(
            api_key,
            system="You inspect generated marketing images for accidental text.",
            user_text="Does this image contain ANY readable text, letters, numbers, logos or watermarks?",
            schema_name="no_text_qa", schema=_NO_TEXT_QA_SCHEMA, effort="low",
            timeout=90, image_bytes=png_bytes,
        )
        if data.get("has_text"):
            seen = str(data.get("seen") or "").strip()[:120]
            return f"text detected in image{': ' + seen if seen else ''} — regenerate"
    except Exception:  # noqa: BLE001
        pass
    return None


def _gen_item(job: dict, index: int) -> None:
    it = job["items"][index]
    it["status"] = "running"
    job["updated_at"] = _now()
    try:
        w, h = (int(x) for x in it["size"].split("x"))
        with _GEN_SEM:
            png = engine.generate_png(
                api_key=job["api_key"], prompt=it["prompt"], mode="gen",
                openai_size=engine.OPENAI_SIZE_MAP[it["size"]],
                model="gpt-image-2", quality=str(job["params"].get("quality") or "medium"),
                timeout=settings.OPENAI_IMAGE_TIMEOUT,
                max_retries=settings.OPENAI_IMAGE_MAX_RETRIES,
            )
        try:
            png = reshape.fit_export(png, w, h)
        except Exception:  # noqa: BLE001 — never drop an item over reshaping
            pass
        if it.get("degrade"):
            try:
                png = _degrade(png)
            except Exception:  # noqa: BLE001
                pass
        (job["dir"] / f"item_{index}.png").write_bytes(png)
        it["qa"] = _no_text_qa(job["api_key"], png)
        it["status"], it["error"] = "ok", None
    except engine.GenError as e:
        it["status"], it["error"] = "failed", e.message
    except Exception as e:  # noqa: BLE001
        log.warning("lp-materials item %s/%s failed: %s", job["id"], index, e)
        it["status"], it["error"] = "failed", type(e).__name__
    finally:
        with _JOBS_LOCK:
            job["updated_at"] = _now()
            if all(x["status"] in ("ok", "failed") for x in job["items"]):
                oks = sum(1 for x in job["items"] if x["status"] == "ok")
                job["status"] = "done" if oks == len(job["items"]) else ("partial" if oks else "failed")
                if job["status"] == "failed":
                    job["error"] = next((x.get("error") for x in job["items"] if x.get("error")), None)
                job["api_key"] = ""
            _persist_job(job)


def _spawn_items(job: dict, indices: List[int]) -> None:
    for i in indices:
        threading.Thread(target=_gen_item, args=(job, i), daemon=True,
                         name=f"lpm-{job['id']}-{i}").start()


def _new_job(kind: str, created_by: str, params: dict, items: List[dict],
             api_key: str) -> dict:
    job_id = "m_" + uuid.uuid4().hex[:12]
    d = LP_ROOT / job_id
    d.mkdir(parents=True, exist_ok=True)
    now = _now()
    job = {
        "id": job_id, "kind": kind, "status": "running", "error": None,
        "created_by": created_by, "created_at": now, "updated_at": now,
        "params": params, "items": items, "dir": d, "api_key": api_key,
    }
    with _JOBS_LOCK:
        _JOBS[job_id] = job
    _persist_job(job)
    _spawn_items(job, list(range(len(items))))
    return job


def _require_key():
    api_key = get_secret("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=424, detail="missing OpenAI key")
    return api_key


def _rate_limit(user: dict) -> str:
    user_key = (user or {}).get("email") or "user"
    if not runner.rate_limit_ok(user_key):
        raise HTTPException(status_code=429,
                            detail="You've started a lot of jobs in a short time. Please wait a minute.")
    return user_key


def _slug(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", (s or "").strip()).strip("-").lower()[:60] or "item"


def _resolve_reference(payload: dict):
    """Optional hero-reference id -> (path, id) or (None, "")."""
    rid = str(payload.get("reference") or "").strip()
    if not rid:
        return None, ""
    if not _ID_RE.match(rid):
        raise HTTPException(status_code=422, detail="bad reference id")
    png = UPLOADS_DIR / f"{rid}.png"
    if not png.is_file():
        raise HTTPException(status_code=404, detail="hero image not found — upload it again")
    return png, rid


def _market_line(market: str) -> str:
    return (f" TARGET MARKET: {market}. Cast people who authentically look like this "
            "market's audience (ethnicity, styling) and localize the setting and "
            "atmosphere to it." if market else "")


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------
def build_lp_materials_router() -> APIRouter:
    router = APIRouter()

    # ---- hero reference (guides cards + advertorial; NOT customers) --------
    @router.post("/reference")
    async def upload_reference(file: UploadFile = File(...), _user: dict = Depends(require_user)):
        """Upload the landing page's HERO image (PNG/JPG/WebP ≤10MB). Its id is
        passed to /cards and /advertorial so the whole set anchors to its look."""
        if (file.content_type or "") not in _UPLOAD_MIME:
            raise HTTPException(status_code=422, detail="use a PNG, JPG or WebP image")
        data = await file.read()
        if not data or len(data) > _MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=422, detail="image must be under 10MB")
        from PIL import Image
        try:
            with Image.open(io.BytesIO(data)) as im:
                im.load()
                im = im.convert("RGB")
                # The reference only steers style — cap its size so the vision
                # payload stays small whatever the user uploads.
                im.thumbnail((1536, 1536))
                buf = io.BytesIO()
                im.save(buf, format="PNG")
        except Exception:  # noqa: BLE001
            raise HTTPException(status_code=422, detail="could not read that image")
        rid = uuid.uuid4().hex
        UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
        (UPLOADS_DIR / f"{rid}.png").write_bytes(buf.getvalue())
        return {"id": rid, "url": f"/api/tools/lp-materials/reference/{rid}.png"}

    @router.get("/reference/{rid}.png")
    def get_reference(rid: str):
        if not _ID_RE.match(rid):
            raise HTTPException(status_code=404, detail="not found")
        png = UPLOADS_DIR / f"{rid}.png"
        if not png.is_file():
            raise HTTPException(status_code=404, detail="not found")
        return FileResponse(str(png), media_type="image/png")

    # ---- customers (profile pictures) --------------------------------------
    @router.post("/avatars/detect")
    def detect_names(payload: dict = Body(default={}), _user: dict = Depends(require_user)):
        """Names (any language/script) -> {language, country, gender, age} per row,
        shown as editable chips before generating."""
        api_key = _require_key()
        names = [str(n).strip()[:120] for n in (payload.get("names") or []) if str(n).strip()]
        if not names:
            raise HTTPException(status_code=422, detail="enter at least one name")
        names = names[:_MAX_AVATAR_ROWS]
        market = str(payload.get("market") or "").strip()[:_MAX_MARKET]
        market_rule = (
            f" The campaign targets this market: {market}. Set `country` to that market's "
            "people for every name that plausibly belongs to it (the customer photos must "
            "look like the target market's audience); only deviate when a name clearly "
            "belongs to a different culture."
            if market else ""
        )
        try:
            data = _llm_json(
                api_key,
                system=("You analyse personal names for a testimonial generator. For each "
                        "name, infer the language/script it is written in, the most likely "
                        "country, the likely gender, and a plausible age band for a product "
                        f"reviewer. Keep the name EXACTLY as given.{market_rule}"),
                user_text="Names:\n" + "\n".join(f"- {n}" for n in names),
                schema_name="name_rows", schema=_DETECT_NAMES_SCHEMA, effort="low",
            )
        except RuntimeError as e:
            raise HTTPException(status_code=502, detail=str(e))
        by_name = {str(r.get("name", "")).strip(): r for r in (data.get("rows") or [])}
        rows = []
        for n in names:  # keep the user's order; fall back per name
            r = by_name.get(n) or {}
            rows.append({
                "name": n,
                "language": str(r.get("language") or "")[:60],
                # The target market is AUTHORITATIVE for the customer's look —
                # a review section for the Thai market shows Thai faces whatever
                # script the name uses. The per-row chip stays editable for the
                # rare deliberate exception.
                "country": market or str(r.get("country") or "")[:60],
                "gender": r.get("gender") if r.get("gender") in ("female", "male") else "female",
                "age": r.get("age") if r.get("age") in ("20s", "30s", "40s", "50s", "60s") else "30s",
            })
        return {"rows": rows}

    @router.post("/avatars", status_code=202)
    def create_avatars(payload: dict = Body(default={}), user: dict = Depends(require_user)):
        api_key = _require_key()
        user_key = _rate_limit(user)
        rows_in = payload.get("rows")
        if not isinstance(rows_in, list) or not rows_in:
            raise HTTPException(status_code=422, detail="add at least one name row")
        if len(rows_in) > _MAX_AVATAR_ROWS:
            raise HTTPException(status_code=422, detail=f"at most {_MAX_AVATAR_ROWS} avatars per job")
        style_in = payload.get("style") or {}
        style = {
            "group_crop": bool(style_in.get("group_crop", True)),
            "low_quality": bool(style_in.get("low_quality", True)),
            "candid": bool(style_in.get("candid", True)),
            "degrade": bool(style_in.get("degrade", True)),
        }
        # The target market drives the customers' nationality: rows without an
        # explicit country fall back to it. (The hero image deliberately does
        # NOT influence customer photos.)
        market = str(payload.get("market") or "").strip()[:_MAX_MARKET]
        size = _ASPECT_SIZES["1:1"]
        engine.ensure_size(size)
        items = []
        for i, r in enumerate(rows_in):
            if not isinstance(r, dict) or not str(r.get("name") or "").strip():
                raise HTTPException(status_code=422, detail=f"rows[{i}] needs a name")
            row = {
                "name": str(r.get("name")).strip()[:120],
                "country": str(r.get("country") or "")[:60] or market,
                "gender": r.get("gender") if r.get("gender") in ("female", "male") else "female",
                "age": r.get("age") if r.get("age") in ("20s", "30s", "40s", "50s", "60s") else "30s",
            }
            items.append({
                "index": i, "label": row["name"], "size": size,
                "prompt": _avatar_prompt(row, style),
                "status": "pending", "error": None, "qa": None,
                "degrade": style["degrade"],
            })
        job = _new_job("avatars", user_key,
                       {"style": style, "rows": [it["label"] for it in items],
                        "market": market, "quality": "medium"},
                       items, api_key)
        return _public_job(job)

    # ---- section cards -----------------------------------------------------
    @router.post("/cards", status_code=202)
    def create_cards(payload: dict = Body(default={}), user: dict = Depends(require_user)):
        api_key = _require_key()
        user_key = _rate_limit(user)
        cards_in = payload.get("cards")
        if not isinstance(cards_in, list) or not (_MIN_CARDS <= len(cards_in) <= _MAX_CARDS):
            raise HTTPException(status_code=422,
                                detail=f"between {_MIN_CARDS} and {_MAX_CARDS} cards")
        cards = []
        for i, c in enumerate(cards_in):
            title = str((c or {}).get("title") or "").strip()[:_MAX_TITLE]
            text = str((c or {}).get("text") or "").strip()[:600]
            if not title:
                raise HTTPException(status_code=422, detail=f"cards[{i}] needs a title")
            cards.append({"title": title, "text": text})
        same_person = bool(payload.get("same_person"))
        aspect = payload.get("aspect") if payload.get("aspect") in _ASPECT_SIZES else "4:3"
        size = _ASPECT_SIZES[aspect]
        engine.ensure_size(size)
        style_note = str(payload.get("style_note") or "").strip()[:400]
        market = str(payload.get("market") or "").strip()[:_MAX_MARKET]
        hero_path, hero_id = _resolve_reference(payload)

        persona_rule = (
            "The user wants the SAME single person to appear in EVERY scene. Invent one "
            "specific, believable persona and describe them in detail in `persona`; every "
            "scene must feature exactly that person doing what the card describes."
            if same_person else
            "Each scene may cast freely (different people, or objects/environments when "
            "that visualizes the card better). Set `persona` to an empty string."
        )
        hero_rule = (
            " The attached image is the HERO visual of the landing page these cards will sit "
            "on. Anchor the whole set to it: mirror its palette, lighting, mood, art style "
            "and general world in `shared_direction` so the cards read as the same campaign. "
            "Do NOT copy its composition and IGNORE any text in it."
            if hero_path else ""
        )
        try:
            direction = _llm_json(
                api_key,
                system=("You art-direct a SET of small landing-page images (one per card). "
                        "They must read as one family: define a shared palette / lighting / "
                        "photographic style, then one concrete scene per card that visualizes "
                        "its message. Scenes are literal and concrete (subject, action, "
                        "setting) — never abstract concepts or symbol soup. The images will "
                        f"contain no text whatsoever. {persona_rule}{hero_rule}{_market_line(market)}"),
                user_text=(
                    (f"Style note from the user: {style_note}\n\n" if style_note else "")
                    + "Cards:\n"
                    + "\n".join(f"{i + 1}. {c['title']}" + (f" — {c['text']}" if c["text"] else "")
                                for i, c in enumerate(cards))
                ),
                schema_name="card_set_direction", schema=_CARDS_DIRECTION_SCHEMA,
                effort="medium",
                image_bytes=hero_path.read_bytes() if hero_path else None,
            )
        except RuntimeError as e:
            raise HTTPException(status_code=502, detail=str(e))
        shared = str(direction.get("shared_direction") or "").strip()
        persona = str(direction.get("persona") or "").strip() if same_person else ""
        scenes = {int(s.get("index", -1)): str(s.get("scene") or "").strip()
                  for s in (direction.get("scenes") or []) if isinstance(s, dict)}
        items = []
        for i, c in enumerate(cards):
            scene = scenes.get(i + 1) or scenes.get(i) or f"A concrete, literal visualization of: {c['title']}. {c['text']}"
            prompt = " ".join(filter(None, [
                "Professional advertising photograph for a landing page.",
                f"Scene: {scene}",
                f"Recurring person (must look IDENTICAL in every image of this set): {persona}." if persona else "",
                f"Shared set style: {shared}" if shared else "",
                _market_line(market).strip(),
                "Crisp, editorial, color-graded commercial photography.",
                _NO_TEXT_RULE,
            ]))
            items.append({"index": i, "label": c["title"], "size": size,
                          "prompt": prompt, "status": "pending", "error": None,
                          "qa": None, "degrade": False})
        job = _new_job("cards", user_key,
                       {"cards": cards, "same_person": same_person, "aspect": aspect,
                        "shared_direction": shared, "persona": persona,
                        "style_note": style_note, "market": market,
                        "reference": hero_id, "quality": "medium"},
                       items, api_key)
        return _public_job(job)

    # ---- advertorial -------------------------------------------------------
    @router.post("/advertorial", status_code=202)
    def create_advertorial(payload: dict = Body(default={}), user: dict = Depends(require_user)):
        api_key = _require_key()
        user_key = _rate_limit(user)
        title = str(payload.get("title") or "").strip()[:_MAX_TITLE]
        text = str(payload.get("text") or "").strip()[:_MAX_TEXT]
        if not title and not text:
            raise HTTPException(status_code=422, detail="enter the advertorial title and text")
        aspect = payload.get("aspect") if payload.get("aspect") in _ASPECT_SIZES else "4:3"
        size = _ASPECT_SIZES[aspect]
        engine.ensure_size(size)
        try:
            candidates = int(payload.get("candidates") or 2)
        except (TypeError, ValueError):
            candidates = 2
        candidates = max(1, min(_MAX_ADV_CANDIDATES, candidates))
        market = str(payload.get("market") or "").strip()[:_MAX_MARKET]
        hero_path, hero_id = _resolve_reference(payload)
        hero_rule = (
            " The attached image is the HERO visual of the landing page this advertorial "
            "sits on — mirror its palette, lighting, mood and art style so the image reads "
            "as the same campaign. Do NOT copy its composition; IGNORE any text in it."
            if hero_path else ""
        )
        try:
            direction = _llm_json(
                api_key,
                system=("You art-direct ONE editorial photograph that will sit beside a "
                        "long advertorial text on a landing page. Read the story and pick "
                        "its SINGLE strongest visual moment — one scene, one subject, told "
                        "like documentary/editorial photography. Concrete and literal; the "
                        f"image will contain no text.{hero_rule}{_market_line(market)}"),
                user_text=f"Title: {title}\n\nText:\n{text}",
                schema_name="advertorial_scene", schema=_ADVERTORIAL_SCHEMA, effort="medium",
                image_bytes=hero_path.read_bytes() if hero_path else None,
            )
        except RuntimeError as e:
            raise HTTPException(status_code=502, detail=str(e))
        scene = str(direction.get("scene") or "").strip()
        prompt = " ".join(filter(None, [
            "Editorial documentary photograph for an advertorial article.",
            f"Scene: {scene}" if scene else f"A concrete scene visualizing: {title}. {text[:300]}",
            _market_line(market).strip(),
            "Natural, believable, story-telling composition; crisp editorial color grade.",
            _NO_TEXT_RULE,
        ]))
        items = [{"index": i, "label": title or "advertorial", "size": size,
                  "prompt": prompt, "status": "pending", "error": None,
                  "qa": None, "degrade": False}
                 for i in range(candidates)]
        job = _new_job("advertorial", user_key,
                       {"title": title, "text": text, "aspect": aspect,
                        "scene": scene, "market": market, "reference": hero_id,
                        "quality": "medium"},
                       items, api_key)
        return _public_job(job)

    # ---- jobs (shared list, like the banner gallery) ------------------------
    @router.get("/jobs")
    def list_jobs(limit: int = 100):
        with _JOBS_LOCK:
            jobs = sorted(_JOBS.values(), key=lambda j: j["created_at"], reverse=True)
        return {"jobs": [_public_job(j) for j in jobs[: max(1, min(limit, 300))]]}

    @router.get("/jobs/{job_id}")
    def get_job(job_id: str):
        job = _JOBS.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="job not found")
        return _public_job(job)

    @router.get("/jobs/{job_id}/items/{index}.png")
    def get_item(job_id: str, index: int, download: int = 0):
        job = _JOBS.get(job_id)
        if job is None or not (0 <= index < len(job["items"])):
            raise HTTPException(status_code=404, detail="not found")
        png = job["dir"] / f"item_{index}.png"
        if not png.is_file():
            raise HTTPException(status_code=404, detail="not generated yet")
        it = job["items"][index]
        fname = f"{_slug(it.get('label', ''))}-{it.get('size', '')}.png"
        disposition = "attachment" if download else "inline"
        return FileResponse(str(png), media_type="image/png",
                            headers={"Content-Disposition": f'{disposition}; filename="{fname}"'})

    @router.post("/jobs/{job_id}/items/{index}/regenerate")
    def regenerate_item(job_id: str, index: int, user: dict = Depends(require_user)):
        job = _JOBS.get(job_id)
        if job is None or not (0 <= index < len(job["items"])):
            raise HTTPException(status_code=404, detail="not found")
        email = ((user or {}).get("email") or "").lower()
        if (user or {}).get("role") != "admin" and (job.get("created_by") or "").lower() != email:
            raise HTTPException(status_code=403, detail="Only the person who started this job can do that.")
        api_key = _require_key()
        with _JOBS_LOCK:
            job["api_key"] = api_key
            it = job["items"][index]
            if it["status"] == "running":
                raise HTTPException(status_code=409, detail="that item is already generating")
            it["status"], it["error"], it["qa"] = "pending", None, None
            job["status"] = "running"
        _spawn_items(job, [index])
        return _public_job(job)

    @router.delete("/jobs/{job_id}", status_code=204)
    def delete_job(job_id: str, user: dict = Depends(require_user)):
        job = _JOBS.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="job not found")
        email = ((user or {}).get("email") or "").lower()
        if (user or {}).get("role") != "admin" and (job.get("created_by") or "").lower() != email:
            raise HTTPException(status_code=403, detail="Only the person who started this job can delete it.")
        try:
            import shutil
            shutil.rmtree(job["dir"], ignore_errors=True)
        except Exception:  # noqa: BLE001
            pass
        with _JOBS_LOCK:
            _JOBS.pop(job_id, None)
        return Response(status_code=204)

    @router.get("/jobs/{job_id}/download.zip")
    def download_zip(job_id: str):
        job = _JOBS.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="job not found")
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            seen: set = set()
            for it in job["items"]:
                png = job["dir"] / f"item_{it['index']}.png"
                if it["status"] == "ok" and png.is_file():
                    arc = f"{_slug(it.get('label', ''))}-{it.get('size', '')}.png"
                    if arc in seen:
                        arc = f"{arc[:-4]}-{it['index']}.png"
                    seen.add(arc)
                    zf.write(str(png), arcname=arc)
        buf.seek(0)
        return StreamingResponse(
            buf, media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="lp-materials-{job["kind"]}_{job["created_at"][:10]}.zip"'})

    return router


__all__ = ["build_lp_materials_router", "rehydrate_jobs"]
