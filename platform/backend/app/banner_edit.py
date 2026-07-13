"""Banner Edit — text correction on an already-generated banner.

The user attaches a banner (from the gallery or an upload), marks the text
region(s) to fix, and types the replacement text. The correction is a MASKED
OpenAI images/edits call — and the preservation contract is enforced in code:
after the model returns, ONLY the masked regions are composited back onto the
original PNG (Pillow), so every pixel outside the marked regions is the
original, guaranteed — never the raw model output.

Flow (all routes mounted under /api/tools/banner-builder):
  POST /edits/source            upload a source image           -> {id, width, height}
  GET  /edits/source/{id}.png   serve an uploaded source
  POST /edits/detect            vision pass: text blocks + typography of the source
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
                 timeout: int = 120) -> dict:
    """POST /v1/responses with an input image + strict JSON schema; return the
    parsed dict. Raises RuntimeError on any failure (callers decide fallback)."""
    import base64
    b64 = base64.b64encode(image_bytes).decode("ascii")
    payload = json.dumps({
        "model": _VISION_MODEL,
        "reasoning": {"effort": effort},
        "input": [
            {"role": "system", "content": system},
            {"role": "user", "content": [
                {"type": "input_text", "text": user_text},
                {"type": "input_image", "image_url": f"data:image/png;base64,{b64}"},
            ]},
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
def _edit_instruction(regions: List[dict], typography: str) -> str:
    lines = [
        "This is a finished advertising banner. The old text inside the transparent "
        "(masked) regions has ALREADY BEEN ERASED — the blur there is only a "
        "placeholder. Repaint each masked region as instructed below.",
    ]
    for i, r in enumerate(regions, 1):
        cur = (r.get("current_text") or "").strip()
        was = f" (it previously read “{cur}”)" if cur else ""
        hint = (r.get("hints") or "").strip()
        hint = f" {hint}." if hint else ""
        where = f"around {round(r['x_pct'])}%,{round(r['y_pct'])}% of the frame"
        if r.get("mode") == "remove":
            lines.append(
                f"Masked region {i} ({where}): the text{was} is REMOVED for good. "
                "Reconstruct ONLY the clean background there, seamlessly continuing the "
                f"surrounding design — render NO text in this region.{hint}"
            )
        else:
            lines.append(
                f"Masked region {i} ({where}): "
                f"render EXACTLY this text{was}: “{r['new_text']}”.{hint}"
            )
    typo = f" Typography notes: {typography}." if typography else ""
    lines.append(
        "The SECOND attached image is the ORIGINAL banner before erasing — copy its "
        "typography for each replacement (font style, weight, size, color, case, "
        "effects and alignment of the text that used to sit there), but take the "
        f"WORDING only from the instructions above, never from that image.{typo}"
    )
    lines.append(
        "Every replacement must fit ENTIRELY inside its masked region with a clear "
        "margin on all sides — scale the text down if needed; letters must never "
        "touch or cross the region edge. Perfect spelling exactly as given, including "
        "punctuation and diacritics. Change nothing outside the masked regions; add "
        "no other text, no logos, no watermarks."
    )
    return "\n".join(lines)


# Padding around each marked region before masking/erasing: replacement text is
# rarely the same length as the original, so the model needs breathing room —
# and the erase must swallow the old text entirely (its anti-aliased fringes
# included) so nothing ghosts through or clips at the box edge.
def _pad_region(r: dict, width: int, height: int) -> dict:
    rx = width * r["x_pct"] / 100.0
    ry = height * r["y_pct"] / 100.0
    rw = width * r["w_pct"] / 100.0
    rh = height * r["h_pct"] / 100.0
    pad_x = max(16.0, rh * 0.5)
    pad_y = max(12.0, rh * 0.35)
    x0 = max(0.0, rx - pad_x)
    y0 = max(0.0, ry - pad_y)
    x1 = min(float(width), rx + rw + pad_x)
    y1 = min(float(height), ry + rh + pad_y)
    return {"x_pct": x0 / width * 100.0, "y_pct": y0 / height * 100.0,
            "w_pct": (x1 - x0) / width * 100.0, "h_pct": (y1 - y0) / height * 100.0}


def _erase_regions(img, regions: List[dict]):
    """Blur-erase the marked regions in the image the MODEL sees, so the old
    text simply is not there to be reproduced (the main ghosting fix). The blur
    radius scales with the largest region so text strokes fully dissolve; the
    model then reconstructs the background and paints the new text over it."""
    from PIL import ImageFilter
    w, h = img.size
    max_rh = max((h * r["h_pct"] / 100.0 for r in regions), default=40.0)
    blurred = img.filter(ImageFilter.GaussianBlur(max(24.0, max_rh * 0.6)))
    out = img.copy()
    for r in regions:
        x = int(w * r["x_pct"] / 100.0)
        y = int(h * r["y_pct"] / 100.0)
        ww = max(1, int(w * r["w_pct"] / 100.0))
        hh = max(1, int(h * r["h_pct"] / 100.0))
        box = (x, y, min(x + ww, w), min(y + hh, h))
        out.paste(blurred.crop(box), box)
    return out


def _build_mask(width: int, height: int, regions: List[dict]):
    """Opaque canvas with fully-transparent rectangles where edits are allowed
    (the images/edits mask contract: transparent = editable)."""
    from PIL import Image, ImageDraw
    mask = Image.new("RGBA", (width, height), (0, 0, 0, 255))
    draw = ImageDraw.Draw(mask)
    for r in regions:
        x = int(width * r["x_pct"] / 100.0)
        y = int(height * r["y_pct"] / 100.0)
        w = max(1, int(width * r["w_pct"] / 100.0))
        h = max(1, int(height * r["h_pct"] / 100.0))
        draw.rectangle([x, y, min(x + w, width - 1), min(y + h, height - 1)],
                       fill=(0, 0, 0, 0))
    return mask


def _composite_preserving(original, model_out, mask):
    """Paste the model's output back onto the ORIGINAL, but only inside the
    masked regions (feathered ~3px so the seam blends). Everything outside the
    regions stays the original pixels — the preservation guarantee."""
    from PIL import ImageFilter
    editable = mask.getchannel("A").point(lambda v: 255 - v)  # 255 where editable
    editable = editable.filter(ImageFilter.GaussianBlur(3))
    from PIL import Image
    return Image.composite(model_out, original, editable)


def _qa_candidate(api_key: str, png_bytes: bytes, present: List[str],
                  absent: List[str]) -> dict:
    """Vision read-back: replacements rendered exactly AND erased text is gone.
    Never raises."""
    if not present and not absent:
        return {"qa_ok": None, "qa_read": ""}
    parts = []
    if present:
        parts.append("Text(s) that MUST appear in the image exactly:\n"
                     + "\n".join(f"- “{t}”" for t in present))
    if absent:
        parts.append("Text(s) that were ERASED and must NOT appear anywhere "
                     "(matches=true only if the text is completely gone):\n"
                     + "\n".join(f"- “{t}”" for t in absent))
    try:
        data = _vision_json(
            api_key,
            system=("You are a meticulous proofreader for ad creatives. Check the image "
                    "against the checklist. For required texts, exact match means "
                    "spelling, punctuation and diacritics all correct (ignore line-break "
                    "differences and purely stylistic all-caps). For erased texts, "
                    "matches=true means NO trace of that text remains."),
            user_text="\n\n".join(parts),
            image_bytes=png_bytes,
            schema_name="edit_qa", schema=_QA_SCHEMA, effort="low",
        )
        results = data.get("results") or []
        ok = bool(results) and all(bool(r.get("matches")) for r in results)
        read = "; ".join(str(r.get("read") or "") for r in results)[:300]
        return {"qa_ok": ok, "qa_read": read}
    except Exception as e:  # noqa: BLE001
        log.warning("banner-edit QA failed: %s", e)
        return {"qa_ok": None, "qa_read": ""}


def _run_candidate(job: dict, index: int) -> None:
    """Generate ONE candidate: masked edit -> resize back -> composite -> QA."""
    from PIL import Image
    d: Path = job["dir"]
    try:
        # The style reference (the original, text intact) rides along as a second
        # image[] so the model can match typography even though the first image
        # has the old text erased.
        style_ref = d / "style_ref.png"
        with _EDIT_SEM:
            out_bytes = engine.generate_png(
                api_key=job["api_key"], prompt=job["prompt"], mode="edit",
                openai_size=job["gen_size"], model="gpt-image-2",
                quality=job.get("quality") or "high",
                master_png_path=str(d / "source_gen.png"),
                mask_png_path=str(d / "mask_gen.png"),
                extra_image_paths=[str(style_ref)] if style_ref.is_file() else None,
                timeout=settings.OPENAI_IMAGE_TIMEOUT,
                max_retries=settings.OPENAI_IMAGE_MAX_RETRIES,
            )
        with Image.open(d / "source.png") as original:
            original = original.convert("RGBA")
            with Image.open(io.BytesIO(out_bytes)) as out:
                out = out.convert("RGBA").resize(original.size, Image.LANCZOS)
            with Image.open(d / "mask.png") as mask:
                comp = _composite_preserving(original, out, mask)
        buf = io.BytesIO()
        comp.save(buf, format="PNG")
        comp_bytes = buf.getvalue()
        (d / f"cand_{index}.png").write_bytes(comp_bytes)
        qa = _qa_candidate(
            job["api_key"], comp_bytes,
            [r["new_text"] for r in job["regions"] if r.get("mode") != "remove"],
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

    @router.post("/edits", status_code=202)
    def create_edit(payload: dict = Body(default={}), user: dict = Depends(require_user)):
        """Start a text-correction job: masked edit of the source with N candidates."""
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
            # Mask + erase use PADDED regions (breathing room for length changes);
            # the instruction keeps the user's original coordinates for reference.
            padded = [_pad_region(r, w, h) for r in regions]
            mask = _build_mask(w, h, padded)
            mask.save(job_dir / "mask.png")
            # The model sees the source with the old text ERASED (blur fill) —
            # nothing to ghost — plus the untouched original as a style reference.
            prefilled = _erase_regions(im, padded)
            prefilled.save(job_dir / "prefilled.png")
            prefilled.resize((gw, gh), Image.LANCZOS).save(job_dir / "source_gen.png")
            im.resize((gw, gh), Image.LANCZOS).save(job_dir / "style_ref.png")
            mask.resize((gw, gh), Image.NEAREST).save(job_dir / "mask_gen.png")

        job = {
            "id": job_id, "status": "running", "error": None,
            "created_by": user_key, "created_at": runner._now(),
            "dir": job_dir, "width": w, "height": h,
            "regions": regions, "candidates": candidates,
            "results": [None] * candidates,
            "prompt": _edit_instruction(regions, typography),
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
