"""Banner Edit — text correction on an already-generated banner.

The user attaches a banner (from the gallery or an upload), marks the text
region(s) to fix, and types the replacement text. The correction is a
WHOLE-IMAGE regeneration (images/edits with the original as input, NO mask):
the model recreates the entire banner — same scene, person, layout, colors —
applying ONLY the requested text changes. Regenerating the whole canvas keeps
every element coherent (no mask seams, no half-repainted buttons); the trade
is that fine details may drift slightly between takes, which is why the UI
keeps every take side-by-side until one is accepted. Both the corrections AND
the texts that must stay are spelled out in the prompt (the model reproduces
listed strings far more reliably than text it has to read off pixels), and a
vision QA pass reads the result back to badge each candidate.

Flow (all routes mounted under /api/tools/banner-builder):
  POST /edits/source            upload a source image           -> {id, width, height}
  GET  /edits/source/{id}.png   serve an uploaded source
  POST /edits/detect            vision pass: text blocks + typography of the source
  POST /edits/spellcheck        typo guard: suggest fixes for typed replacement text
  POST /edits                   start a correction job (N candidates)   -> 202 job
  GET  /edits/{job_id}          poll the job (candidates fill in as they finish)
  GET  /edits/{job_id}/files/{name}.png   serve source / candidate images
  POST /edits/{job_id}/accept   accept a candidate -> a normal Run (gallery,
                                persistence and add-sizes recompose for free)

Jobs are a WORKING SESSION: files live under ARTIFACT_ROOT/banner-edits (so
candidates survive within a deploy), but job metadata is in-memory — a restart
mid-edit just means redoing the edit. The durable artifact is the accepted run.
"""
from __future__ import annotations

import io
import json
import logging
import re
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import APIRouter, Body, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from . import engine, runner
from .auth import require_user
from .creative_director import OPENAI_RESPONSES_URL, _extract_output_text
from .secrets import get_secret
from .settings import settings

log = logging.getLogger(__name__)

EDITS_ROOT = settings.ARTIFACT_ROOT / "banner-edits"
UPLOADS_DIR = EDITS_ROOT / "uploads"

_MAX_REGIONS = 6
_MAX_CANDIDATES = 3
_MAX_TEXT = 300
_MAX_UPLOAD_BYTES = 10 * 1024 * 1024
_UPLOAD_MIME = {"image/png", "image/jpeg", "image/webp"}
_ID_RE = re.compile(r"^[a-f0-9]{32}$")
_FILE_RE = re.compile(r"^(source|cand_[0-9])$")

# Edits are expensive image calls — cap concurrency independently of the main
# banner semaphore so a big batch of corrections can't starve generations.
_EDIT_SEM = threading.Semaphore(2)

_JOBS: Dict[str, dict] = {}
_JOBS_LOCK = threading.Lock()
_VISION_MODEL = "gpt-5.5"

_OPENAI_SECRET = {"env": "OPENAI_API_KEY", "label": "OpenAI API key",
                  "docs_url": "https://platform.openai.com/api-keys", "present": False}


# ---------------------------------------------------------------------------
# Vision helper — one structured-JSON call with an attached image
# ---------------------------------------------------------------------------
def _vision_json(api_key: str, *, system: str, user_text: str, image_bytes: bytes,
                 schema_name: str, schema: dict, effort: str = "low",
                 timeout: int = 120, reference_bytes: Optional[bytes] = None) -> dict:
    """POST /v1/responses with an input image + strict JSON schema; return the
    parsed dict. `reference_bytes` (optional) attaches a second image BEFORE
    the candidate — image 1 = reference, image 2 = candidate — so checklist
    prompts can compare against an approved design. Raises RuntimeError on any
    failure (callers decide fallback)."""
    import base64

    def _img(data: bytes) -> dict:
        return {"type": "input_image",
                "image_url": "data:image/png;base64," + base64.b64encode(data).decode("ascii")}

    content = [{"type": "input_text", "text": user_text}]
    if reference_bytes is not None:
        content.append(_img(reference_bytes))
    content.append(_img(image_bytes))
    payload = json.dumps({
        "model": _VISION_MODEL,
        "reasoning": {"effort": effort},
        "input": [
            {"role": "system", "content": system},
            {"role": "user", "content": content},
        ],
        "text": {"format": {"type": "json_schema", "name": schema_name,
                            "strict": True, "schema": schema}},
        "max_output_tokens": 4000,
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
        log.warning("banner-edit vision HTTP %s: %s", e.code, detail)
        raise RuntimeError(f"vision call failed (HTTP {e.code})")
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"{type(e).__name__}: {e}")
    text = _extract_output_text(body)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        raise RuntimeError("vision output was not valid JSON")


_DETECT_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["blocks", "typography"],
    "properties": {
        "blocks": {
            "type": "array",
            "description": "Every distinct text block visible in the image.",
            "items": {
                "type": "object", "additionalProperties": False,
                "required": ["x_pct", "y_pct", "w_pct", "h_pct", "text"],
                "properties": {
                    "x_pct": {"type": "number", "description": "left edge, % of width (0-100)"},
                    "y_pct": {"type": "number", "description": "top edge, % of height (0-100)"},
                    "w_pct": {"type": "number", "description": "width, % of width"},
                    "h_pct": {"type": "number", "description": "height, % of height"},
                    "text": {"type": "string", "description": "the text exactly as it reads"},
                },
            },
        },
        "typography": {
            "type": "string",
            "description": ("One sentence describing the dominant typography: font vibe "
                            "(serif/sans/display), weight, case, color (hex if clear), any "
                            "effects — used to match the style when replacing text."),
        },
    },
}

_SPELL_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["suggestions"],
    "properties": {
        "suggestions": {
            "type": "array",
            "description": "ONLY the inputs that contain an obvious misspelling.",
            "items": {
                "type": "object", "additionalProperties": False,
                "required": ["text", "suggestion"],
                "properties": {
                    "text": {"type": "string", "description": "the input string, verbatim"},
                    "suggestion": {"type": "string",
                                   "description": "the corrected string (same case/punctuation style)"},
                },
            },
        },
    },
}


def _spell_json(api_key: str, texts: List[str], timeout: int = 45) -> dict:
    """Text-only GPT call: flag obvious misspellings in ad copy. Raises on failure
    (the caller fails soft — the typo guard must never block a generation)."""
    payload = json.dumps({
        "model": _VISION_MODEL,
        "reasoning": {"effort": "low"},
        "input": [
            {"role": "system", "content": (
                "You are a spellchecker for advertising copy, any language. The user "
                "sends a JSON array of strings. For each string, decide whether it "
                "contains an OBVIOUS misspelling of a common word (like 'oputinity' "
                "for 'opportunity' or 'verry' for 'very'). If so, emit a suggestion: "
                "'text' is the input string COPIED CHARACTER-FOR-CHARACTER, and "
                "'suggestion' is that string corrected — fix ONLY the misspelled "
                "words, preserve everything else (case, punctuation, spacing, "
                "emoji). NEVER flag brand names, product names, invented or stylized "
                "words, abbreviations, or correctly-spelled text in any language. "
                "When in doubt, do not flag. Emit nothing for strings that need no "
                "fix.")},
            {"role": "user", "content": json.dumps(texts, ensure_ascii=False)},
        ],
        "text": {"format": {"type": "json_schema", "name": "spell_suggestions",
                            "strict": True, "schema": _SPELL_SCHEMA}},
        "max_output_tokens": 1500,
    }).encode("utf-8")
    req = urllib.request.Request(
        OPENAI_RESPONSES_URL, data=payload, method="POST",
        headers={"Authorization": f"Bearer {api_key}",
                 "Content-Type": "application/json; charset=utf-8"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8")
    return json.loads(_extract_output_text(body))


_QA_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["results"],
    "properties": {
        "results": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False,
                "required": ["expected", "read", "matches"],
                "properties": {
                    "expected": {"type": "string"},
                    "read": {"type": "string", "description": "what the image actually shows"},
                    "matches": {"type": "boolean",
                                "description": "true only if it reads EXACTLY as expected (spelling, diacritics, punctuation)"},
                },
            },
        },
    },
}


# ---------------------------------------------------------------------------
# Source resolution
# ---------------------------------------------------------------------------
def _resolve_source(src: dict) -> tuple[Path, str]:
    """{run_id,label} (gallery pick) or {upload} (uploaded id) -> (png path, title)."""
    if not isinstance(src, dict):
        raise HTTPException(status_code=422, detail="'source' is required")
    run_id, label = str(src.get("run_id") or ""), str(src.get("label") or "")
    if run_id and label:
        run = runner.STORE.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="source run not found")
        if label not in {runner._label(f["concept"], f["size"]) for f in run.frames_plan}:
            raise HTTPException(status_code=404, detail="unknown source banner")
        png = run.dir / f"{label}.png"
        if not png.is_file():
            raise HTTPException(status_code=404, detail="the source image is no longer on disk")
        concept = label.partition("__")[0]
        title = (run.concepts.get(concept) or {}).get("title", "")
        return png, title
    upload = str(src.get("upload") or "")
    if upload:
        if not _ID_RE.match(upload):
            raise HTTPException(status_code=422, detail="bad upload id")
        png = UPLOADS_DIR / f"{upload}.png"
        if not png.is_file():
            raise HTTPException(status_code=404, detail="uploaded image not found — upload it again")
        return png, ""
    raise HTTPException(status_code=422, detail="source needs {run_id,label} or {upload}")


# ---------------------------------------------------------------------------
# The correction job
# ---------------------------------------------------------------------------
def _where(r: dict) -> str:
    """Human position words for a region ('the upper left', 'the bottom center')
    — thirds grid off the region's center. The model follows these far better
    than raw percentages."""
    cx = r["x_pct"] + r["w_pct"] / 2.0
    cy = r["y_pct"] + r["h_pct"] / 2.0
    v = "top" if cy < 33 else "middle" if cy < 66 else "bottom"
    h = "left" if cx < 33 else "center" if cx < 66 else "right"
    return f"the {v} {h}" if (v, h) != ("middle", "center") else "the center"


def _edit_instruction(regions: List[dict], typography: str,
                      keep_texts: List[str]) -> str:
    """Whole-image reproduction prompt: recreate the attached banner exactly,
    applying only the listed text changes. Unchanged texts are SPELLED OUT too
    — the model reproduces listed strings far more reliably than text it has
    to read off the pixels."""
    lines = [
        "The attached image is a finished advertising banner. Recreate THIS EXACT "
        "banner as a faithful 1:1 reproduction: identical composition and layout, "
        "the SAME person (same face, expression, pose, hair, clothing), the same "
        "background and scene, the same colors, lighting, graphic elements, logos, "
        "icons and button shapes. Apply ONLY the following text changes:",
    ]
    for i, r in enumerate(regions, 1):
        cur = (r.get("current_text") or "").strip()
        hint = (r.get("hints") or "").strip()
        hint = f" {hint}." if hint else ""
        where = _where(r)
        if r.get("mode") == "remove":
            what = f"the text “{cur}”" if cur else "the marked text"
            lines.append(
                f"{i}. In {where}: {what} is REMOVED for good — nothing replaces it; "
                f"the background simply continues there.{hint}"
            )
        else:
            was = f" that previously read “{cur}”" if cur else ""
            lines.append(
                f"{i}. In {where}: the text{was} now reads EXACTLY: “{r['new_text']}” — "
                f"keep the same font style, weight, color, case and alignment it had.{hint}"
            )
    if keep_texts:
        lines.append(
            "Every OTHER text on the banner stays exactly as it is — reproduce these "
            "verbatim, letter-perfect:\n"
            + "\n".join(f"- “{t}”" for t in keep_texts)
        )
    typo = f" Typography notes: {typography}." if typography else ""
    lines.append(
        "Perfect spelling exactly as given, including punctuation and diacritics. "
        "If a replacement is longer or shorter than the original, adjust its size or "
        "line breaks naturally without changing the overall layout. Add no new text, "
        f"no extra logos, no watermarks.{typo}"
    )
    return "\n".join(lines)


def _qa_candidate(api_key: str, png_bytes: bytes, present: List[str],
                  absent: List[str], artifacts: bool = False,
                  reference_png: Optional[bytes] = None) -> dict:
    """Vision read-back: replacements rendered exactly AND erased text is gone.
    `artifacts=True` (the recompose QA) adds a layout-artifact sweep — ghost/
    duplicated text or a second CTA button fails the check. `reference_png`
    (the approved master) additionally judges the candidate AGAINST it: same
    hero at similar prominence, background continuity behind the subject,
    palette held. Never raises."""
    if not present and not absent and not artifacts:
        return {"qa_ok": None, "qa_read": ""}
    parts = []
    if reference_png is not None:
        parts.append(
            "Two images are attached. IMAGE 1 is the APPROVED MASTER (the "
            "reference design). IMAGE 2 is the CANDIDATE being checked. Every "
            "checklist entry below is judged on IMAGE 2; the master is context.")
    if present:
        parts.append("Text(s) that MUST appear in the image exactly:\n"
                     + "\n".join(f"- “{t}”" for t in present))
    if absent:
        parts.append("Text(s) that were ERASED and must NOT appear anywhere "
                     "(matches=true only if the text is completely gone):\n"
                     + "\n".join(f"- “{t}”" for t in absent))
    if artifacts:
        parts.append(
            "Layout-artifact sweep (ONE checklist entry; matches=true ONLY if the "
            "image is completely CLEAN of ALL of these): duplicated text blocks or "
            "the same wording appearing twice; ghost, faded, partial or cut-off "
            "letters near any edge; leftover fragments of a different layout behind "
            "the design; more than one call-to-action button (including a partial "
            "button stub). In `read`, name any artifact found and where it sits.")
    if reference_png is not None:
        parts.append(
            "Master-fidelity check (ONE checklist entry; matches=true ONLY if ALL "
            "hold on the candidate): the SAME hero person/product as the master, "
            "at similar visual prominence — not shrunken into a small badge or "
            "corner sticker; every background line/structure that passes behind "
            "the subject re-emerges on the other side at the SAME height, angle "
            "and thickness (no offset jump where it meets the silhouette); the "
            "palette matches the master with no new dominant color. In `read`, "
            "name what diverged and where.")
    try:
        data = _vision_json(
            api_key,
            system=("You are a meticulous proofreader for ad creatives. Check the image "
                    "against the checklist. For required texts, exact match means "
                    "spelling, punctuation and diacritics all correct (ignore line-break "
                    "differences and purely stylistic all-caps). For erased texts, "
                    "matches=true means NO trace of that text remains. For a "
                    "layout-artifact sweep, matches=true means the image is completely "
                    "clean of every listed artifact. For a master-fidelity check, "
                    "matches=true means the candidate holds every listed property "
                    "relative to the master."),
            user_text="\n\n".join(parts),
            image_bytes=png_bytes,
            schema_name="edit_qa", schema=_QA_SCHEMA, effort="low",
            reference_bytes=reference_png,
        )
        results = data.get("results") or []
        ok = bool(results) and all(bool(r.get("matches")) for r in results)
        read = "; ".join(str(r.get("read") or "") for r in results)[:300]
        return {"qa_ok": ok, "qa_read": read}
    except Exception as e:  # noqa: BLE001
        log.warning("banner-edit QA failed: %s", e)
        return {"qa_ok": None, "qa_read": ""}


def _run_candidate(job: dict, index: int) -> None:
    """Generate ONE candidate: whole-image reproduction with the text changes
    (no mask — the model recreates the entire banner) -> resize back -> QA."""
    from PIL import Image
    d: Path = job["dir"]
    try:
        with _EDIT_SEM:
            out_bytes = engine.generate_png(
                api_key=job["api_key"], prompt=job["prompt"], mode="edit",
                openai_size=job["gen_size"], model="gpt-image-2",
                quality=job.get("quality") or "high",
                master_png_path=str(d / "source_gen.png"),
                timeout=settings.OPENAI_IMAGE_TIMEOUT,
                max_retries=settings.OPENAI_IMAGE_MAX_RETRIES,
            )
        with Image.open(d / "source.png") as original:
            size = original.size
        with Image.open(io.BytesIO(out_bytes)) as out:
            out = out.convert("RGBA").resize(size, Image.LANCZOS)
            buf = io.BytesIO()
            out.save(buf, format="PNG")
        comp_bytes = buf.getvalue()
        (d / f"cand_{index}.png").write_bytes(comp_bytes)
        # QA reads back the replacements AND the texts that must stay — whole-image
        # regeneration means every string on the banner is at stake.
        qa = _qa_candidate(
            job["api_key"], comp_bytes,
            [r["new_text"] for r in job["regions"] if r.get("mode") != "remove"]
            + list(job.get("keep_texts") or []),
            [r["current_text"] for r in job["regions"]
             if r.get("mode") == "remove" and r.get("current_text")],
        )
        result = {"index": index, "ready": True, "error": None, **qa}
    except engine.GenError as e:
        result = {"index": index, "ready": False, "error": e.message, "qa_ok": None, "qa_read": ""}
    except Exception as e:  # noqa: BLE001
        log.warning("banner-edit candidate %s/%s failed: %s", job["id"], index, e)
        result = {"index": index, "ready": False,
                  "error": f"{type(e).__name__}", "qa_ok": None, "qa_read": ""}
    with _JOBS_LOCK:
        job["results"][index] = result
        if all(r is not None for r in job["results"]):
            job["status"] = ("done" if any(r.get("ready") for r in job["results"])
                             else "failed")
            if job["status"] == "failed":
                job["error"] = next((r.get("error") for r in job["results"] if r.get("error")),
                                    "all candidates failed")
            job["api_key"] = ""  # done with it


def _start_job(job: dict) -> None:
    for i in range(job["candidates"]):
        threading.Thread(target=_run_candidate, args=(job, i), daemon=True,
                         name=f"bb-edit-{job['id']}-{i}").start()


def _public_job(job: dict) -> dict:
    return {
        "job_id": job["id"],
        "status": job["status"],
        "error": job.get("error"),
        "width": job["width"], "height": job["height"],
        "regions": [{k: r[k] for k in ("x_pct", "y_pct", "w_pct", "h_pct",
                                       "current_text", "new_text", "mode")} for r in job["regions"]],
        "source_url": f"/api/tools/banner-builder/edits/{job['id']}/files/source.png",
        "candidates": [
            None if r is None else {
                "index": r["index"], "ready": r["ready"], "error": r.get("error"),
                "qa_ok": r.get("qa_ok"), "qa_read": r.get("qa_read"),
                "url": (f"/api/tools/banner-builder/edits/{job['id']}/files/cand_{r['index']}.png"
                        if r["ready"] else None),
            }
            for r in job["results"]
        ],
        "created_at": job["created_at"],
    }


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------
def build_edits_router() -> APIRouter:
    router = APIRouter()

    @router.post("/edits/source")
    async def upload_source(file: UploadFile = File(...), _user: dict = Depends(require_user)):
        """Upload a banner to correct (PNG/JPG/WebP, ≤10MB). Stored normalized to
        PNG; returns an id to pass as {"source": {"upload": id}}."""
        if (file.content_type or "") not in _UPLOAD_MIME:
            raise HTTPException(status_code=422, detail="use a PNG, JPG or WebP image")
        data = await file.read()
        if not data or len(data) > _MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=422, detail="image must be under 10MB")
        from PIL import Image
        try:
            with Image.open(io.BytesIO(data)) as im:
                im.load()
                im = im.convert("RGBA")
                w, h = im.size
                buf = io.BytesIO()
                im.save(buf, format="PNG")
        except Exception:  # noqa: BLE001
            raise HTTPException(status_code=422, detail="could not read that image")
        uid = uuid.uuid4().hex
        UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
        (UPLOADS_DIR / f"{uid}.png").write_bytes(buf.getvalue())
        return {"id": uid, "width": w, "height": h,
                "url": f"/api/tools/banner-builder/edits/source/{uid}.png"}

    @router.get("/edits/source/{upload_id}.png")
    def get_source(upload_id: str):
        if not _ID_RE.match(upload_id):
            raise HTTPException(status_code=404, detail="not found")
        png = UPLOADS_DIR / f"{upload_id}.png"
        if not png.is_file():
            raise HTTPException(status_code=404, detail="not found")
        return FileResponse(str(png), media_type="image/png")

    @router.post("/edits/detect")
    def detect(payload: dict = Body(default={}), _user: dict = Depends(require_user)):
        """Vision pass over the source: every text block (bbox in % + the text it
        reads) plus a one-line typography description — pre-fills the region cards."""
        api_key = get_secret("OPENAI_API_KEY")
        if not api_key:
            return JSONResponse(status_code=424, content={"missing_secrets": [_OPENAI_SECRET]})
        png, _title = _resolve_source(payload.get("source") or {})
        image_bytes = png.read_bytes()
        try:
            data = _vision_json(
                api_key,
                system=("You locate text on advertising banners. Return every distinct "
                        "text block (headline, subtitle, button label, disclaimers) with a "
                        "TIGHT bounding box as percentages of the image dimensions, plus a "
                        "one-sentence description of the dominant typography."),
                user_text="Locate all text blocks in this banner.",
                image_bytes=image_bytes,
                schema_name="text_blocks", schema=_DETECT_SCHEMA, effort="low",
            )
        except RuntimeError as e:
            raise HTTPException(status_code=502, detail=str(e))
        blocks = []
        for b in (data.get("blocks") or [])[:12]:
            try:
                blocks.append({
                    "x_pct": max(0.0, min(100.0, float(b["x_pct"]))),
                    "y_pct": max(0.0, min(100.0, float(b["y_pct"]))),
                    "w_pct": max(0.5, min(100.0, float(b["w_pct"]))),
                    "h_pct": max(0.5, min(100.0, float(b["h_pct"]))),
                    "text": str(b.get("text") or "")[:_MAX_TEXT],
                })
            except (KeyError, TypeError, ValueError):
                continue
        return {"blocks": blocks, "typography": str(data.get("typography") or "")[:400]}

    @router.post("/edits/spellcheck")
    def spellcheck(payload: dict = Body(default={}), _user: dict = Depends(require_user)):
        """Typo guard: flag obvious misspellings in the typed replacement texts
        BEFORE a generation is spent. Non-blocking by design — brand names and
        stylized words are never flagged, and any failure returns no suggestions."""
        api_key = get_secret("OPENAI_API_KEY")
        texts = [str(t).strip()[:_MAX_TEXT]
                 for t in (payload.get("texts") or []) if str(t).strip()][:8]
        if not api_key or not texts:
            return {"suggestions": []}
        try:
            data = _spell_json(api_key, texts)
        except Exception as e:  # noqa: BLE001 — the guard must never block
            log.warning("banner-edit spellcheck failed: %s", e)
            return {"suggestions": []}
        out = []
        for s in (data.get("suggestions") or [])[:8]:
            text = str((s or {}).get("text") or "")
            sugg = str((s or {}).get("suggestion") or "").strip()[:_MAX_TEXT]
            # Only echo suggestions that map to an actual input and change it.
            if sugg and text in texts and sugg != text:
                out.append({"text": text, "suggestion": sugg})
        return {"suggestions": out}

    @router.post("/edits", status_code=202)
    def create_edit(payload: dict = Body(default={}), user: dict = Depends(require_user)):
        """Start a text-correction job: whole-image regeneration with N candidates."""
        api_key = get_secret("OPENAI_API_KEY")
        if not api_key:
            return JSONResponse(status_code=424, content={"missing_secrets": [_OPENAI_SECRET]})
        user_key = (user or {}).get("email") or "user"
        if not runner.rate_limit_ok(user_key):
            raise HTTPException(status_code=429,
                                detail="You've started a lot of jobs in a short time. Please wait a minute.")
        png, title = _resolve_source(payload.get("source") or {})
        regions_in = payload.get("regions")
        if not isinstance(regions_in, list) or not regions_in:
            raise HTTPException(status_code=422, detail="mark at least one region to correct")
        if len(regions_in) > _MAX_REGIONS:
            raise HTTPException(status_code=422, detail=f"at most {_MAX_REGIONS} regions per job")
        regions: List[dict] = []
        for i, r in enumerate(regions_in):
            if not isinstance(r, dict):
                raise HTTPException(status_code=422, detail=f"regions[{i}] must be an object")
            try:
                reg = {
                    "x_pct": max(0.0, min(100.0, float(r.get("x_pct")))),
                    "y_pct": max(0.0, min(100.0, float(r.get("y_pct")))),
                    "w_pct": max(0.5, min(100.0, float(r.get("w_pct")))),
                    "h_pct": max(0.5, min(100.0, float(r.get("h_pct")))),
                }
            except (TypeError, ValueError):
                raise HTTPException(status_code=422, detail=f"regions[{i}] has bad coordinates")
            mode = "remove" if r.get("mode") == "remove" else "replace"
            new_text = str(r.get("new_text") or "").strip()
            if mode == "replace" and not new_text:
                raise HTTPException(status_code=422, detail=f"regions[{i}] needs the new text")
            reg["mode"] = mode
            reg["new_text"] = new_text[:_MAX_TEXT]
            reg["current_text"] = str(r.get("current_text") or "").strip()[:_MAX_TEXT]
            reg["hints"] = str(r.get("hints") or "").strip()[:200]
            regions.append(reg)
        # ONE candidate by default — the user generates more only when the
        # first isn't right (the UI keeps earlier candidates around to compare).
        try:
            candidates = int(payload.get("candidates") or 1)
        except (TypeError, ValueError):
            candidates = 1
        candidates = max(1, min(_MAX_CANDIDATES, candidates))
        quality = payload.get("quality") if payload.get("quality") in ("low", "medium", "high") else "high"
        typography = str(payload.get("typography") or "").strip()[:400]
        # Texts elsewhere on the banner that must survive the whole-image
        # regeneration — spelled out in the prompt AND read back by QA.
        keep_texts = [str(t).strip()[:_MAX_TEXT]
                      for t in (payload.get("keep_texts") or []) if str(t).strip()][:8]

        from PIL import Image
        job_id = uuid.uuid4().hex
        job_dir = EDITS_ROOT / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        with Image.open(png) as im:
            im = im.convert("RGBA")
            w, h = im.size
            im.save(job_dir / "source.png")
            size = f"{w}x{h}"
            ok, why = engine.ensure_size(size)
            if not ok:
                raise HTTPException(status_code=422, detail=f"unsupported image size: {why}")
            gen_size = engine.OPENAI_SIZE_MAP[size]
            gw, gh = (int(x) for x in gen_size.split("x"))
            # The model regenerates the WHOLE banner from the original (no mask).
            im.resize((gw, gh), Image.LANCZOS).save(job_dir / "source_gen.png")

        job = {
            "id": job_id, "status": "running", "error": None,
            "created_by": user_key, "created_at": runner._now(),
            "dir": job_dir, "width": w, "height": h,
            "regions": regions, "candidates": candidates,
            "keep_texts": keep_texts,
            "results": [None] * candidates,
            "prompt": _edit_instruction(regions, typography, keep_texts),
            "gen_size": gen_size, "api_key": api_key, "quality": quality,
            "source_title": title,
        }
        with _JOBS_LOCK:
            _JOBS[job_id] = job
        _start_job(job)
        return _public_job(job)

    @router.get("/edits/{job_id}")
    def get_job(job_id: str):
        job = _JOBS.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="job not found — it may predate a server restart")
        return _public_job(job)

    @router.get("/edits/{job_id}/files/{name}.png")
    def get_job_file(job_id: str, name: str):
        job = _JOBS.get(job_id)
        if job is None or not _FILE_RE.match(name):
            raise HTTPException(status_code=404, detail="not found")
        png = job["dir"] / f"{name}.png"
        if not png.is_file():
            raise HTTPException(status_code=404, detail="not found")
        return FileResponse(str(png), media_type="image/png")

    @router.post("/edits/{job_id}/accept")
    def accept(job_id: str, payload: dict = Body(default={}), user: dict = Depends(require_user)):
        """Accept a candidate: it becomes a normal completed Run (one master frame),
        so the gallery, persistence and add-sizes recompose all apply."""
        job = _JOBS.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="job not found")
        email = ((user or {}).get("email") or "").lower()
        if (user or {}).get("role") != "admin" and job["created_by"].lower() != email:
            raise HTTPException(status_code=403, detail="Only the person who started this edit can accept it.")
        try:
            index = int(payload.get("candidate"))
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="'candidate' index is required")
        result = next((r for r in job["results"] if r and r["index"] == index and r["ready"]), None)
        if result is None:
            raise HTTPException(status_code=409, detail="that candidate is not ready")
        png = job["dir"] / f"cand_{index}.png"
        if not png.is_file():
            raise HTTPException(status_code=404, detail="candidate image is gone")
        title = (str(payload.get("title") or "").strip()
                 or job["regions"][0]["new_text"] or job.get("source_title") or "Edited banner")
        src = payload.get("edited_from") if isinstance(payload.get("edited_from"), dict) else None
        try:
            run = runner.create_run_from_image(
                png.read_bytes(), title=title[:200], created_by=job["created_by"],
                edited_from=src,
            )
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
        return {"run": runner.run_to_dict(run)}

    return router


__all__ = ["build_edits_router"]
