"""Banner Builder job runner.

A run = N concepts x M sizes. The MVP master (1200x1200, mode=gen) is generated
first; every other size is a recompose (mode=edit) off that master PNG. The two
phases are separated by a hard barrier — recomp jobs read the master PNG from
disk, so all masters must land before any recomp starts.

Local-first storage: run state lives in an in-memory store (dict + lock); PNGs
live on disk under settings.ARTIFACT_ROOT/banner-builder/{run_id}/. A global
semaphore caps concurrent OpenAI calls across all runs/users so two browser
users can't oversaturate the rate limit.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
import uuid
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from . import brands as brands_store
from . import creative_director, engine, references as references_store
from .banner_engine import intent as intent_engine
from .banner_engine import logo_overlay, reshape
from .models import RunRequest
from .settings import settings

log = logging.getLogger(__name__)

TOOL_ID = "banner-builder"

# Hard ceiling on concurrent OpenAI image calls across ALL runs/users.
_OPENAI_SEM = threading.BoundedSemaphore(settings.OPENAI_CONCURRENCY)
# Each run orchestrates on its OWN daemon thread (see create_and_start_run), NOT a
# small fixed pool — otherwise a few slow/stuck runs saturate the pool and every
# later run sits in 'queued' forever (an endless frontend spinner). Actual OpenAI
# concurrency stays capped by _OPENAI_SEM above.

# Terminal run states the frontend stops polling on.
TERMINAL = {"completed", "partial", "failed", "cancelled"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _label(concept: str, size: str) -> str:
    return f"{concept}__{size}"


# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------
@dataclass
class FrameResult:
    concept: str
    size: str
    openai_size: str
    mode: str            # "gen" | "edit"
    phase: str           # "master" | "recomp"
    status: str = "pending"
    attempts: int = 0
    gen_ms: Optional[int] = None
    bytes: int = 0
    png_path: Optional[str] = None
    error: Optional[str] = None
    prompt: Optional[str] = None       # the exact prompt sent to the image model


@dataclass
class Run:
    id: str
    status: str
    model: str
    quality: str
    sizes: List[str]
    concepts: Dict[str, dict]          # key -> concept dict (engine-shaped)
    frames_plan: List[dict]            # [{concept, size, openai_size, mode, phase}]
    frame_results: Dict[str, FrameResult]
    dir: Path
    created_at: str
    updated_at: str
    api_key: str = ""                  # never serialized
    error: Optional[str] = None
    style: str = ""                    # campaign look/vibe (fed to the director)
    effort: Optional[str] = None       # per-run GPT-5.5 thinking effort (None -> admin default)
    intent: str = "general_ad"         # heuristic campaign intent (steers director + negatives)
    intent_meta: dict = field(default_factory=dict)  # {source, intent, confidence, ambiguous}
    cards: Dict[str, dict] = field(default_factory=dict)   # key -> {title, subtitle, button}
    size_briefs: Dict[str, Dict[str, str]] = field(default_factory=dict)  # concept -> {size -> brief}
    director: dict = field(default_factory=dict)           # summary surfaced in the API
    references: List[str] = field(default_factory=list)    # local paths, style-only (never serialized)
    cancelled: bool = False            # set by cancel(); checked between frames + phases
    # Resolved raster brand logo to composite onto each PNG, or None. corner is
    # one of 'tl','tr','bl','br'. logo: API-surfaced status of the overlay step.
    logo_raster: Optional[bytes] = None
    logo_corner: Optional[str] = None
    logo: dict = field(default_factory=dict)

    def touch(self):
        self.updated_at = _now()

    def fr(self, concept: str, size: str) -> FrameResult:
        return self.frame_results[_label(concept, size)]


class RunStore:
    def __init__(self):
        self._runs: Dict[str, Run] = {}
        self._lock = threading.Lock()

    def add(self, run: Run):
        with self._lock:
            self._runs[run.id] = run

    def get(self, run_id: str) -> Optional[Run]:
        with self._lock:
            return self._runs.get(run_id)

    def all(self) -> List[Run]:
        """Every run in the store (live + rehydrated from disk) — powers the
        shared gallery so all users see all banners."""
        with self._lock:
            return list(self._runs.values())

    def remove(self, run_id: str) -> None:
        with self._lock:
            self._runs.pop(run_id, None)


STORE = RunStore()


# --- Abuse / cost guards on the expensive /run endpoint --------------------
# All in-memory (single-process, mirrors the in-memory RunStore). A per-user
# sliding window caps how many runs one account can start; a short idempotency
# window collapses accidental duplicate submits (double-click / network retry)
# into the same run so they don't double the OpenAI spend.
_GUARD_LOCK = threading.Lock()
_USER_RUN_TIMES: Dict[str, deque] = {}
_IDEMPOTENCY: Dict[str, tuple] = {}   # key -> (timestamp, run_id)
_RATE_MAX = 30                        # max runs ...
_RATE_WINDOW = 600.0                  # ... per 10 minutes, per user
_IDEMP_TTL = 25.0                     # seconds an identical request maps to one run


def idempotency_key(user_key: str, req: RunRequest) -> str:
    """Stable key for an identical request from the same user (dedupe submits)."""
    payload = {
        "u": user_key,
        "concepts": [(c.title or "", c.subtitle or "", c.button or "") for c in req.concepts],
        "sizes": sorted(req.sizes or []),
        "style": req.style or "",
        "model": req.model, "quality": req.quality,
        "effort": req.effort or "", "locale": req.locale or "",
        "brand_id": getattr(req, "brand_id", "") or "",
    }
    return json.dumps(payload, sort_keys=True, ensure_ascii=False)


def idempotent_run(key: str) -> Optional[str]:
    """The run_id of an identical request seen within the TTL, else None."""
    now = time.time()
    with _GUARD_LOCK:
        for k in [k for k, (ts, _) in _IDEMPOTENCY.items() if now - ts > _IDEMP_TTL]:
            _IDEMPOTENCY.pop(k, None)
        hit = _IDEMPOTENCY.get(key)
        return hit[1] if hit else None


def remember_run(key: str, run_id: str) -> None:
    with _GUARD_LOCK:
        _IDEMPOTENCY[key] = (time.time(), run_id)


def rate_limit_ok(user_key: str) -> bool:
    """Record a run attempt; False when the user is over the sliding-window budget."""
    now = time.time()
    with _GUARD_LOCK:
        dq = _USER_RUN_TIMES.setdefault(user_key, deque())
        while dq and now - dq[0] > _RATE_WINDOW:
            dq.popleft()
        if len(dq) >= _RATE_MAX:
            return False
        dq.append(now)
        return True


# ---------------------------------------------------------------------------
# Card -> engine concept mapping
# ---------------------------------------------------------------------------
#
# A concept *card* is the simple thing a marketer types: Title (required),
# Subtitle (optional), Button (optional). The engine needs a richer dict —
# {title, locale, hook_phrase, creative_brief, cta?, button_combo?} — and it
# validates that hook_phrase is a verbatim substring of title. We synthesize
# that dict here, deterministically, so every card produces an engine-valid
# concept without any LLM in the loop.

def _derive_hook(title: str) -> str:
    """A 2-4 word verbatim fragment of the title (its leading words).

    Skips leading tokens that contain no alphanumeric character (e.g. a stray
    bullet or dash) and prefers starting at the first token of length >= 3, so the
    hook doesn't open on punctuation or a tiny stop-token. Prefers stopping at the
    first sentence boundary so the hook reads as a clean phrase; otherwise takes
    2-4 words. The returned fragment is always a *verbatim* (case-insensitive)
    substring of the title — what engine.validate_manifest requires of
    hook_phrase — so it is sliced directly out of the title rather than rebuilt
    from split tokens.
    """
    t = title.strip()
    if not t:
        return t
    words = t.split()
    # Skip leading tokens with no alphanumeric character (e.g. a stray "—" or
    # bullet) so the hook doesn't start on punctuation; prefer the first token of
    # length >= 3 as the starting point. Conservative: fall back to 0 if the whole
    # title is punctuation/short tokens, leaving behaviour unchanged for normal
    # titles whose first word already qualifies.
    start = 0
    for i, w in enumerate(words):
        if any(ch.isalnum() for ch in w):
            start = i
            break
    for i in range(start, len(words)):
        if any(ch.isalnum() for ch in words[i]) and len(words[i]) >= 3:
            start = i
            break
    # How many leading words to take (counting from `start`): stop at the first
    # word that ends a sentence (.!?), but always keep 2-4 words when there are
    # enough words remaining.
    rest = words[start:]
    take = 0
    for i, w in enumerate(rest):
        take = i + 1
        if take >= 2 and w[-1:] in ".!?":
            break
        if take >= 4:
            break
    take = min(take, 4)
    if len(rest) >= 2:
        take = max(take, 2)

    # Slice the verbatim substring spanning the chosen `take` words from `start`.
    consumed = 0
    idx = 0
    start_idx = None
    for w in rest[:take]:
        pos = t.lower().index(w.lower(), idx)
        if start_idx is None:
            start_idx = pos
        idx = pos + len(w)
        consumed += 1
        if consumed == take:
            break
    hook = t[(start_idx or 0):idx]
    # Trim trailing punctuation/space so the hook isn't left dangling on a "." —
    # rstrip only removes chars that are NOT part of any word, so it stays a
    # verbatim substring.
    return hook.rstrip(" .,:;!?-—–")


def _synthesize_brief(subtitle: str, style: str, angle: str = "") -> str:
    """Deterministic fallback brief — used ONLY when the GPT-5.5 director is off or
    unavailable. A bold, concrete, high-CTR default (not a soft mood piece), since
    it can't see the specific subject the way the director can.

    When `angle` is non-empty (the per-concept divergence direction from
    intent_engine.concept_angle), it is prepended as the dominant creative
    direction so multi-concept runs still diverge even with the director down.
    """
    parts = []
    ang = (angle or "").strip()
    if ang:
        parts.append(f"Dominant creative direction for this concept: {ang}.")
    parts.append(
        "High-impact paid-social ad built on ONE clear idea: the hook in bold confident "
        "display type with strong figure-ground contrast against a clean, saturated "
        "background; a single concrete hero relevant to the message (a real-looking "
        "generic person facing the viewer with confident, aspirational posture, and/or "
        "the actual product), deliberate directional lighting, punchy modern palette; "
        "scroll-stopping and premium. No watercolor wash, no bokeh particles, no abstract "
        "swooshes, no candlestick/line charts (even as props), no desk/hand-on-chin stock "
        "pose, no gambling or get-rich-quick symbolism."
    )
    sub = (subtitle or "").strip()
    if sub:
        parts.append(f"Supporting message to convey: {sub}.")
    sty = (style or "").strip()
    if sty:
        parts.append(f"Look and brand vibe: {sty}.")
    brief = " ".join(parts)
    if len(brief) > 600:
        brief = brief[:597].rstrip() + "…"
    return brief


def _pick_button_combo(style: str):
    """Auto-pick an approved [bg, text] pair from engine.BUTTON_COMBOS.

    Defaults to the first combo; nudges toward a hue when the campaign style
    names a colour, so the CTA fits the requested vibe.
    """
    combos = engine.BUTTON_COMBOS
    s = (style or "").lower()
    hue_hint = {
        "orange": "#F97316", "green": "#16A34A", "red": "#DC2626",
        "violet": "#7C3AED", "purple": "#7C3AED", "yellow": "#FACC15",
        "teal": "#14B8A6", "rose": "#BE123C", "pink": "#BE123C", "blue": "#2563EB",
    }
    for word, hexv in hue_hint.items():
        if word in s:
            for bg, text in combos:
                if bg.upper() == hexv:
                    return [bg, text]
    bg, text = combos[0]
    return [bg, text]


def card_to_concept(c, locale: str, style: str) -> dict:
    """Map one concept card (+ campaign locale/style) to an engine concept dict."""
    title = (c.title or "").strip()
    d = {
        "title": title,
        "locale": locale or "en",
        "hook_phrase": _derive_hook(title),
        "creative_brief": _synthesize_brief(c.subtitle or "", style or ""),
    }
    button = (c.button or "").strip()
    if button:
        d["cta"] = button
        d["button_combo"] = _pick_button_combo(style or "")
    return d


def normalize_sizes(sizes: List[str]) -> List[str]:
    seen = list(dict.fromkeys(sizes))          # dedupe, preserve order
    if engine.MASTER_SIZE not in seen:
        seen = [engine.MASTER_SIZE] + seen     # master is always present
    return seen


def validate_request(req: RunRequest):
    """Map cards -> engine concepts, then reuse the engine's OWN validators so
    the web path can't run anything the engine would reject.

    Returns (errors, concepts, sizes). errors == [] means safe to run.
    """
    if not req.concepts:
        return ["at least one concept is required"], {}, []
    if len(req.concepts) > 5:
        return ["cap is 5 concepts per run"], {}, []
    # Cost control: cap the number of user-requested sizes (counted BEFORE the
    # auto-injected master) so one run can't fan out into an unbounded image bill.
    if len(req.sizes) > 12:
        return ["cap is 12 sizes per run; please split into multiple runs"], {}, []
    for c in req.concepts:
        if not (c.title or "").strip():
            return ["every concept card needs a title"], {}, []

    concepts = {c.key: card_to_concept(c, req.locale, req.style or "") for c in req.concepts}
    sizes = normalize_sizes(req.sizes)
    manifest = {"concepts": concepts}
    urls_like = [
        {"concept": ck, "size": s, "openaiSize": engine.OPENAI_SIZE_MAP.get(s, "?")}
        for ck in concepts for s in sizes
    ]
    errors = list(engine.validate_manifest(manifest, urls_like, require_submit_url=False))
    for ck, c in concepts.items():
        ok, reason = engine.check_moderation(c)
        if not ok:
            errors.append(f"concept '{ck}': {reason}")
    return errors, concepts, sizes


def _build_plan(concepts: Dict[str, dict], sizes: List[str]) -> List[dict]:
    plan = []
    for ck in concepts:
        for s in sizes:
            # Safe lookup: validation already rejects unmapped sizes, but guard the
            # worker thread against a stray KeyError if an unknown size slips through.
            openai_size = engine.OPENAI_SIZE_MAP.get(s)
            if openai_size is None:
                continue
            is_master = (s == engine.MASTER_SIZE)
            plan.append({
                "concept": ck, "size": s,
                "openai_size": openai_size,
                "mode": "gen" if is_master else "edit",
                "phase": "master" if is_master else "recomp",
            })
    return plan


_VALID_CORNERS = {"tl", "tr", "bl", "br"}


def _resolve_brand(req: RunRequest):
    """Resolve req.brand_id -> (style_with_brand, logo_raster, logo_corner, logo_status).

    Folds the brand palette into the campaign style text (so the director keeps
    the design on-brand) and decodes the logo to raster bytes when a corner is
    requested. SVG logos can't be rasterized here (no rasterizer in the slim
    image) — colors still apply; the pixel overlay is deferred with a clear note.
    Never raises: a bad/missing brand degrades to "no brand".
    """
    style = (req.style or "").strip()
    corner = req.logo_corner if req.logo_corner in _VALID_CORNERS else None
    logo_status = {"requested": bool(req.brand_id), "applied": False,
                   "corner": corner, "reason": None}

    if not req.brand_id:
        return style, None, None, {"requested": False, "applied": False,
                                   "corner": None, "reason": None}

    brand = None
    try:
        brand = brands_store.get_brand(req.brand_id)
    except Exception:  # noqa: BLE001 — a storage hiccup must not break a run
        brand = None
    if not brand:
        logo_status["reason"] = "brand not found"
        return style, None, None, logo_status

    # Fold the palette into the art-direction text.
    colors = [c for c in (brand.get("colors") or []) if isinstance(c, str)]
    if colors:
        brand_line = (f"Brand palette: {', '.join(colors)}; keep the design on-brand "
                      f"using these brand colors.")
        style = f"{style} {brand_line}".strip() if style else brand_line

    if not corner:
        logo_status["reason"] = "no logo_corner requested"
        return style, None, None, logo_status

    kind, raster = logo_overlay.decode_logo(brand.get("logo_svg"))
    if kind == "raster" and raster:
        logo_status["reason"] = None
        return style, raster, corner, logo_status
    if kind == "svg":
        # No SVG rasterizer in python:3.12-slim — apply colors, skip the overlay.
        logo_status["reason"] = "svg logo not rasterized (no rasterizer installed); colors applied"
        log.info("banner-builder: SVG brand logo for brand %s not overlaid "
                 "(no rasterizer); TODO add cairosvg/resvg to enable.", req.brand_id)
        return style, None, None, logo_status
    logo_status["reason"] = "no usable logo on brand"
    return style, None, None, logo_status


def create_and_start_run(req: RunRequest, concepts: Dict[str, dict],
                         sizes: List[str], api_key: str) -> Run:
    run_id = "r_" + uuid.uuid4().hex[:12]
    run_dir = settings.ARTIFACT_ROOT / TOOL_ID / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    plan = _build_plan(concepts, sizes)
    frame_results = {
        _label(f["concept"], f["size"]): FrameResult(
            concept=f["concept"], size=f["size"], openai_size=f["openai_size"],
            mode=f["mode"], phase=f["phase"],
        )
        for f in plan
    }
    now = _now()
    cards = {
        c.key: {"title": c.title, "subtitle": c.subtitle or "", "button": c.button or ""}
        for c in req.concepts
    }
    # Brand palette folds into the style text; a raster logo is composited later.
    style, logo_raster, logo_corner, logo_status = _resolve_brand(req)
    # The deterministic template brief (the director's fallback) is built from the
    # style; re-synthesize it with the brand-augmented style so brand colors reach
    # the fallback path too. The director path reads run.style directly.
    if style and style != (req.style or "").strip():
        for c in req.concepts:
            ck = c.key
            if ck in concepts:
                concepts[ck]["creative_brief"] = _synthesize_brief(c.subtitle or "", style)
    # Resolve style-only reference images to existing local paths (drop unknowns).
    ref_paths = references_store.resolve_paths(req.references)
    run = Run(
        id=run_id, status="queued", model=req.model, quality=req.quality,
        sizes=sizes, concepts=concepts, frames_plan=plan,
        frame_results=frame_results, dir=run_dir,
        created_at=now, updated_at=now, api_key=api_key,
        style=style, effort=req.effort, cards=cards,
        references=ref_paths, logo_raster=logo_raster, logo_corner=logo_corner,
        logo=logo_status,
    )
    STORE.add(run)
    threading.Thread(target=execute_run, args=(run_id,), daemon=True,
                     name=f"bb-run-{run_id}").start()
    return run


# ---------------------------------------------------------------------------
# Execution
# ---------------------------------------------------------------------------
def _gen_one_frame(run: Run, frame: dict):
    fr = run.fr(frame["concept"], frame["size"])
    # Cancellation barrier: a frame still pending when cancel landed is left
    # untouched (status stays "pending"/marked cancelled) and never calls OpenAI.
    if run.cancelled:
        if fr.status == "pending":
            fr.status, fr.error = "cancelled", "run cancelled"
        return
    base = run.concepts[frame["concept"]]
    # Per-size creative brief from the GPT-5.5 director if present, else the base
    # (deterministic template) brief — so a frame is never left without direction.
    brief = run.size_briefs.get(frame["concept"], {}).get(frame["size"]) or base.get("creative_brief")
    concept = {**base, "creative_brief": brief}
    fr.status = "running"
    run.touch()

    # Defensive: a recomp (mode=="edit") whose size IS the master must never reach
    # build_recomp_prompt — it raises ValueError when target_size == master_size.
    # Normally only the master frame has that size, but if one ever slips through,
    # treat it as a master generation (the mode=="gen" path) instead of crashing.
    mode = frame["mode"]
    if mode == "edit" and frame["size"] == engine.MASTER_SIZE:
        mode = "gen"

    try:
        if mode == "edit":
            prompt = engine.build_recomp_prompt(
                concept, engine.MASTER_SIZE, frame["size"], art_direction=brief,
                intent=run.intent)
        else:
            prompt = engine.build_prompt(concept, frame["size"], intent=run.intent)
    except Exception as e:  # noqa: BLE001
        fr.status, fr.error = "prompt_failed", f"{type(e).__name__}: {e}"
        run.touch()
        return
    fr.prompt = prompt  # surface the exact generation prompt in the viewer

    ok, reason = engine.check_moderation(concept)
    if not ok:
        fr.status, fr.error = "moderation_skip", reason
        run.touch()
        return

    master_png = None
    if mode == "edit":
        master_png = str(run.dir / f"{frame['concept']}__{engine.MASTER_SIZE}.png")

    def _on_attempt(attempt):
        fr.attempts = attempt
        run.touch()

    t0 = time.time()
    with _OPENAI_SEM:
        try:
            png = engine.generate_png(
                api_key=run.api_key, prompt=prompt, mode=mode,
                openai_size=frame["openai_size"], model=run.model, quality=run.quality,
                master_png_path=master_png, on_attempt=_on_attempt,
            )
        except engine.GenError as e:
            fr.status, fr.error = e.status, e.message
            run.touch()
            return
        except Exception as e:  # noqa: BLE001
            fr.status, fr.error = "gen_failed", f"{type(e).__name__}: {e}"
            run.touch()
            return

    # Export EVERY banner at its EXACT requested pixel size. The image API only
    # emits 1024/1536-class sizes, so scale + center-crop to the precise box —
    # otherwise a "1200x1200" banner would download as the generated 1024x1024.
    try:
        _w, _h = (int(x) for x in frame["size"].split("x"))
        png = reshape.fit_cover(png, _w, _h)
    except Exception:  # noqa: BLE001 — never drop a frame over reshaping
        pass

    # Composite the brand logo (raster only) into the chosen corner. Best-effort:
    # a failure leaves the un-overlaid banner rather than dropping the frame.
    if run.logo_raster and run.logo_corner:
        try:
            png = logo_overlay.composite_logo_corner(png, run.logo_raster, run.logo_corner)
            run.logo["applied"] = True
        except Exception as e:  # noqa: BLE001
            run.logo.setdefault("reason", f"overlay failed: {type(e).__name__}: {e}")

    out_png = run.dir / f"{_label(frame['concept'], frame['size'])}.png"
    try:
        out_png.write_bytes(png)
    except Exception as e:  # noqa: BLE001 — a disk failure must FAIL the frame, never strand it as "running"
        fr.status, fr.error = "gen_failed", f"disk write failed: {type(e).__name__}: {e}"
        run.touch()
        return
    fr.status, fr.gen_ms, fr.bytes, fr.png_path = "ok", int((time.time() - t0) * 1000), len(png), str(out_png)
    run.touch()


def _run_phase(run: Run, frames: List[dict]):
    if not frames:
        return
    with ThreadPoolExecutor(max_workers=settings.OPENAI_CONCURRENCY) as ex:
        list(ex.map(lambda f: _gen_one_frame(run, f), frames))


def _finalize(run: Run) -> str:
    # A cancelled run is terminal as "cancelled" regardless of partial output;
    # any banners that finished before the cancel are kept on disk.
    if run.cancelled:
        return "cancelled"
    statuses = [fr.status for fr in run.frame_results.values()]
    ok = sum(1 for s in statuses if s == "ok")
    if ok == 0:
        return "failed"
    if ok == len(statuses):
        return "completed"
    return "partial"


def _mark_unfinished_cancelled(run: Run):
    """Flag every not-yet-finished frame as cancelled (finished 'ok' kept)."""
    for fr in run.frame_results.values():
        if fr.status in ("pending", "running"):
            fr.status, fr.error = "cancelled", "run cancelled"


def cancel(run_id: str) -> bool:
    """Request cancellation of a run. Returns False if the run is unknown.

    Sets a flag the master loop AND the recompose loop check between frames and
    between phases; already-finished banners are left intact. Idempotent — a
    terminal run simply stays terminal.
    """
    run = STORE.get(run_id)
    if run is None:
        return False
    run.cancelled = True
    # If the run already settled, don't reopen it; otherwise reflect cancelled
    # immediately so a fast poll sees it without waiting for the next barrier.
    if run.status not in TERMINAL:
        _mark_unfinished_cancelled(run)
        run.status = "cancelled"
    run.touch()
    return True


# ---------------------------------------------------------------------------
# Campaign intent classification (heuristic) — Phase 0a
# ---------------------------------------------------------------------------
def _classify_campaign(run: Run):
    """Heuristically classify the campaign intent from the run's copy + style.

    Sets run.intent (one of intent_engine.INTENTS) and run.intent_meta. Pure
    heuristic — no LLM call. NEVER raises: any failure degrades to the safe
    'general_ad' default so the live path stays backward compatible.
    """
    run.status = "classifying"
    run.touch()
    try:
        cards = [
            {
                "title": c.get("title", ""),
                "subtitle": c.get("subtitle", ""),
                "button": c.get("button", ""),
            }
            for c in run.cards.values()
        ]
        intent, confidence, ambiguous = intent_engine.classify_heuristic(cards, run.style or "")
        run.intent = intent
        run.intent_meta = {
            "source": "heuristic",
            "intent": intent,
            "confidence": confidence,
            "ambiguous": ambiguous,
        }
    except Exception as e:  # noqa: BLE001 — classification must never break a run
        run.intent = "general_ad"
        run.intent_meta = {
            "source": "heuristic",
            "intent": "general_ad",
            "confidence": 0.0,
            "ambiguous": True,
            "error": f"{type(e).__name__}: {e}",
        }
    run.touch()


# ---------------------------------------------------------------------------
# Creative direction (GPT-5.5) — Phase 0
# ---------------------------------------------------------------------------
def _director_config() -> dict:
    """Admin-editable director settings (options.creativeDirector) with safe
    defaults. Never raises — a config problem must not break a run."""
    enabled, model, effort = True, "gpt-5.5", "high"
    try:
        from .tool_config import merged_config
        cd = (merged_config(TOOL_ID).get("options") or {}).get("creativeDirector") or {}
        enabled = bool(cd.get("enabled", True))
        model = (str(cd.get("model") or "").strip() or "gpt-5.5")
        effort = str(cd.get("effort") or "high").strip()
    except Exception:  # noqa: BLE001
        pass
    if effort not in creative_director.VALID_EFFORTS:
        effort = "high"
    return {"enabled": enabled, "model": model, "effort": effort}


def _validate_director(*, title, base_hook, base_brief, base_button_combo,
                       has_cta, sizes, result) -> dict:
    """Enforce the engine's OWN rules on a director result; fall back per field.

    Pure (no network). Guarantees: hook is a verbatim substring of the title;
    every size has a moderation-clean brief; button_combo (when a CTA exists) is
    an approved pair. Anything the model got wrong reverts to the deterministic
    baseline, so the run is always engine-valid.
    """
    notes = []
    hook = (result.get("hook_phrase") or "").strip()
    if not (hook and hook.lower() in (title or "").lower()):
        if result.get("hook_phrase"):
            notes.append("hook not a substring of title; kept derived hook")
        hook = base_hook

    button_combo = base_button_combo
    if has_cta:
        bg = result.get("button_bg")
        if isinstance(bg, str) and bg.strip():
            for cbg, ctext in engine.BUTTON_COMBOS:
                if cbg.upper() == bg.strip().upper():
                    button_combo = [cbg, ctext]
                    break

    size_briefs, used = {}, 0
    model_briefs = result.get("size_briefs") or {}
    for s in sizes:
        b = (model_briefs.get(s) or "").strip()
        if b:
            ok, _ = engine.check_moderation(
                {"title": title, "hook_phrase": hook, "creative_brief": b})
            if ok:
                size_briefs[s] = b
                used += 1
                continue
            notes.append(f"{s}: brief failed moderation; used template")
        size_briefs[s] = base_brief
    return {"hook": hook, "button_combo": button_combo,
            "size_briefs": size_briefs, "sizes_directed": used, "notes": notes}


def _direct_run(run: Run):
    """Phase 0: GPT-5.5 art-directs each concept across all requested sizes.

    Concurrent across concepts, best-effort: a per-concept failure falls back to
    the deterministic template brief for that concept and the run proceeds.
    """
    cfg = _director_config()
    if not cfg["enabled"]:
        # Director disabled: frames fall back to each concept's base creative_brief.
        # Re-synthesize that brief AROUND the concept's angle so multi-concept runs
        # still diverge (same angles the director-ON path would have used). Single-
        # concept runs get "" from concept_angle and are unchanged.
        keys = list(run.concepts.keys())
        total = len(keys)
        for index, ck in enumerate(keys):
            angle = intent_engine.concept_angle(run.intent, index, total)
            if angle:
                card = run.cards.get(ck, {})
                run.concepts[ck]["creative_brief"] = _synthesize_brief(
                    card.get("subtitle", ""), run.style or "", angle=angle)
        run.director = {"used": False, "reason": "disabled"}
        return

    # Per-run effort (the user's choice) wins over the admin default when valid.
    effort = run.effort if (run.effort in creative_director.VALID_EFFORTS) else cfg["effort"]

    run.status = "directing"
    run.touch()

    # Stable concept ordering for multi-concept divergence: each concept gets a
    # deterministic 0-based index/total so intent.concept_angle can hand it a
    # DISTINCT creative direction (Principle 12). Single-concept runs get "".
    keys = list(run.concepts.keys())
    total = len(keys)

    def _one(item):
        index, ck = item
        base = run.concepts[ck]
        card = run.cards.get(ck, {})
        angle = intent_engine.concept_angle(run.intent, index, total)
        try:
            result = creative_director.direct_concept(
                api_key=run.api_key, title=base.get("title", ""),
                subtitle=card.get("subtitle", ""), button=card.get("button", ""),
                style=run.style, locale=base.get("locale", "en"),
                sizes=run.sizes, model=cfg["model"], effort=effort,
                references=run.references, intent=run.intent,
                concept_angle=angle,
            )
        except creative_director.DirectorError as e:
            return ck, None, str(e)
        v = _validate_director(
            title=base.get("title", ""), base_hook=base.get("hook_phrase", ""),
            base_brief=base.get("creative_brief", ""),
            base_button_combo=base.get("button_combo"),
            has_cta=bool(base.get("cta")), sizes=run.sizes, result=result,
        )
        return ck, v, None

    directed_sizes, failed, errors = 0, 0, []
    with ThreadPoolExecutor(max_workers=min(4, max(1, len(keys)))) as ex:
        for ck, v, err in ex.map(_one, list(enumerate(keys))):
            if v is None:
                failed += 1
                if err:
                    errors.append(err)
                # Director failed for this concept: fall back to the deterministic
                # template brief, but keep multi-concept divergence by re-synthesizing
                # it AROUND this concept's angle (the director-ON path used the same
                # angle), so a director outage doesn't collapse every concept to one
                # identical brief.
                angle = intent_engine.concept_angle(run.intent, keys.index(ck), total)
                card = run.cards.get(ck, {})
                fallback_brief = _synthesize_brief(card.get("subtitle", ""), run.style or "", angle=angle)
                run.size_briefs[ck] = {s: fallback_brief for s in run.sizes}
                continue
            run.concepts[ck]["hook_phrase"] = v["hook"]
            if v["button_combo"]:
                run.concepts[ck]["button_combo"] = v["button_combo"]
            run.size_briefs[ck] = v["size_briefs"]
            directed_sizes += v["sizes_directed"]

    run.director = {
        "used": failed < len(keys),
        "model": cfg["model"], "effort": effort,
        "concepts": len(keys), "failed": failed,
        "sizes_directed": directed_sizes,
        "error": (errors[0] if errors and failed == len(keys) else None),
    }
    run.touch()


def execute_run(run_id: str):
    run = STORE.get(run_id)
    if run is None:
        return
    try:
        # Cancel barrier — check before each phase so a cancel between phases
        # stops the run promptly with already-finished banners intact.
        if run.cancelled:
            _finish_cancelled(run)
            return

        # Phase 0a — heuristic campaign-intent classification (no LLM). Steers the
        # director + per-frame negatives. Never raises (defaults to general_ad).
        _classify_campaign(run)
        if run.cancelled:
            _finish_cancelled(run)
            return

        # Phase 0 — GPT-5.5 creative direction (per-size briefs). Best-effort:
        # any failure falls back to the deterministic template brief.
        _direct_run(run)
        if run.cancelled:
            _finish_cancelled(run)
            return

        # Phase 1 — masters (parallel), then BARRIER.
        run.status = "running_master"
        run.touch()
        master_frames = [f for f in run.frames_plan if f["phase"] == "master"]
        _run_phase(run, master_frames)
        if run.cancelled:
            _finish_cancelled(run)
            return

        ok_masters = {f["concept"] for f in master_frames
                      if run.fr(f["concept"], f["size"]).status == "ok"}
        if not ok_masters:
            # No master landed, so no recomp can run. Mark every still-pending recomp
            # frame master_missing (matching the per-concept branch below) so the UI
            # doesn't leave recomp tiles stuck on "Queued" for this failed run.
            for f in run.frames_plan:
                if f["phase"] == "recomp":
                    fr = run.fr(f["concept"], f["size"])
                    if fr.status == "pending":
                        fr.status, fr.error = "master_missing", "master generation failed"
            run.status, run.error = "failed", "all master frames failed"
            run.touch()
            return

        # Phase 2 — recomps (parallel). Concepts whose master failed are
        # pre-marked master_missing rather than attempted.
        recomp_frames = [f for f in run.frames_plan if f["phase"] == "recomp"]
        runnable = []
        for f in recomp_frames:
            if f["concept"] in ok_masters:
                runnable.append(f)
            else:
                fr = run.fr(f["concept"], f["size"])
                fr.status, fr.error = "master_missing", "master generation failed"
        if runnable and not run.cancelled:
            run.status = "running_recomp"
            run.touch()
            _run_phase(run, runnable)

        run.status = _finalize(run)
        run.touch()
    except Exception as e:  # noqa: BLE001
        run.status, run.error = "failed", f"{type(e).__name__}: {e}"
        run.touch()
    finally:
        # Guarantee terminality: a worker must NEVER leave a run in a non-terminal
        # state — that is exactly what produces an endless frontend spinner. If we
        # somehow exit without a terminal status, force 'failed' so the run settles
        # and the UI stops polling.
        if run.status not in TERMINAL:
            run.status, run.error = "failed", run.error or "run did not finish"
            run.touch()
        # Persist the terminal run so its banners + metadata survive a restart.
        _persist(run)


def _finish_cancelled(run: Run):
    """Settle a run that was cancelled mid-flight: mark unfinished frames and
    set the terminal 'cancelled' status (finished banners are kept)."""
    _mark_unfinished_cancelled(run)
    run.status = "cancelled"
    run.touch()


# ---------------------------------------------------------------------------
# Serialization for the API
# ---------------------------------------------------------------------------
def _counts(run: Run) -> dict:
    c = {"ok": 0, "failed": 0, "pending": 0, "running": 0, "cancelled": 0}
    for fr in run.frame_results.values():
        if fr.status == "ok":
            c["ok"] += 1
        elif fr.status in ("pending",):
            c["pending"] += 1
        elif fr.status in ("running",):
            c["running"] += 1
        elif fr.status == "cancelled":
            c["cancelled"] += 1
        else:
            c["failed"] += 1
    return c


def run_to_dict(run: Run) -> dict:
    banners = []
    for f in run.frames_plan:
        fr = run.fr(f["concept"], f["size"])
        label = _label(f["concept"], f["size"])
        card = run.cards.get(f["concept"], {})
        banners.append({
            "label": label, "concept": f["concept"], "size": f["size"],
            "title": run.concepts.get(f["concept"], {}).get("title", ""),
            "subtitle": card.get("subtitle", ""), "button": card.get("button", ""),
            "brief": run.size_briefs.get(f["concept"], {}).get(f["size"], ""),
            "prompt": fr.prompt,
            "mode": f["mode"], "phase": f["phase"], "status": fr.status,
            "attempts": fr.attempts, "gen_ms": fr.gen_ms, "bytes": fr.bytes,
            "error": fr.error,
            "url": (f"/api/tools/{TOOL_ID}/runs/{run.id}/banners/{label}.png"
                    if fr.status == "ok" else None),
        })
    return {
        "run_id": run.id, "status": run.status, "error": run.error,
        "cancelled": run.cancelled,
        "total": len(run.frames_plan),
        "completed": sum(1 for fr in run.frame_results.values() if fr.status == "ok"),
        "counts": _counts(run),
        "created_at": run.created_at, "updated_at": run.updated_at,
        "intent": run.intent,
        "intent_meta": run.intent_meta,
        "director": run.director,
        "logo": run.logo or None,
        "style": run.style or "",
        "banners": banners,
    }


# ---------------------------------------------------------------------------
# Durable storage — persist finished runs so banners survive restarts/redeploys
# ---------------------------------------------------------------------------
def _persist(run: Run) -> None:
    """Write a finished run's metadata to its dir as run.json (best-effort).

    Combined with the on-disk PNGs (under PLATFORM_ARTIFACT_DIR — a mounted disk
    in the cloud) this lets `rehydrate_runs()` restore the gallery after a
    restart/redeploy. A write failure must never affect the run.
    """
    try:
        (run.dir / "run.json").write_text(
            json.dumps(run_to_dict(run), ensure_ascii=False), encoding="utf-8"
        )
    except Exception:  # noqa: BLE001
        log.warning("banner-builder: could not persist run.json for %s", run.id)


def export_name(run: Run, concept: str, size: str) -> str:
    """Download filename for a banner (no extension): v{N}-{size}-{title}, where N
    is the version number from the concept key (c1 -> 1) and title is the concept
    title slugged. Used for single + zip downloads so names are consistent."""
    m = re.search(r"(\d+)", concept)
    v = m.group(1) if m else "1"
    title = (run.concepts.get(concept) or {}).get("title", "") or ""
    slug = re.sub(r"[^A-Za-z0-9]+", "-", title).strip("-").lower()[:60]
    return f"v{v}-{size}" + (f"-{slug}" if slug else "")


def delete_run(run: Run) -> None:
    """Delete a run entirely: remove its dir from the disk + drop it from the store."""
    try:
        import shutil
        if run.dir.exists():
            shutil.rmtree(run.dir, ignore_errors=True)
    except Exception:  # noqa: BLE001
        pass
    STORE.remove(run.id)


def delete_frame(run: Run, label: str) -> bool:
    """Delete ONE banner for everyone: remove its PNG from the disk, drop the frame
    from the run, and re-persist (or delete the whole run if nothing is left).
    Returns False if the label isn't part of the run."""
    if label not in {_label(f["concept"], f["size"]) for f in run.frames_plan}:
        return False
    try:
        (run.dir / f"{label}.png").unlink(missing_ok=True)
    except OSError:
        pass
    run.frames_plan = [f for f in run.frames_plan if _label(f["concept"], f["size"]) != label]
    run.frame_results.pop(label, None)
    run.touch()
    if run.frames_plan:
        _persist(run)
    else:
        delete_run(run)
    return True


def _run_from_dict(d: dict, run_dir: Path) -> Run:
    """Reconstruct a finished (read-only) Run from a persisted run.json, so the
    existing API + PNG-serving code works against it unchanged."""
    frames_plan: List[dict] = []
    frame_results: Dict[str, FrameResult] = {}
    concepts: Dict[str, dict] = {}
    cards: Dict[str, dict] = {}
    size_briefs: Dict[str, Dict[str, str]] = {}
    sizes: List[str] = []
    for b in d.get("banners", []):
        ck, size = b.get("concept", ""), b.get("size", "")
        mode, phase = b.get("mode", "gen"), b.get("phase", "master")
        frames_plan.append({"concept": ck, "size": size, "openai_size": "",
                            "mode": mode, "phase": phase})
        status, error = b.get("status", "ok"), b.get("error")
        png = run_dir / f"{_label(ck, size)}.png"
        # A previously-"ok" banner whose PNG is gone (e.g. it predates the mounted
        # disk) must NOT be served as ok — the frontend would render a broken image.
        # Downgrade it to "missing" so run_to_dict drops its url and the UI shows a
        # clean "unavailable" placeholder instead.
        if status == "ok" and not png.is_file():
            status, error = "missing", "image file is no longer on disk"
        frame_results[_label(ck, size)] = FrameResult(
            concept=ck, size=size, openai_size="", mode=mode, phase=phase,
            status=status, attempts=b.get("attempts", 0),
            gen_ms=b.get("gen_ms"), bytes=b.get("bytes", 0),
            png_path=str(png), error=error, prompt=b.get("prompt"),
        )
        concepts.setdefault(ck, {"title": b.get("title", "")})
        cards.setdefault(ck, {"title": b.get("title", ""),
                              "subtitle": b.get("subtitle", ""),
                              "button": b.get("button", "")})
        if b.get("brief"):
            size_briefs.setdefault(ck, {})[size] = b.get("brief", "")
        if size not in sizes:
            sizes.append(size)
    now = _now()
    return Run(
        id=d["run_id"], status=d.get("status", "completed"),
        model=d.get("model", "gpt-image-2"), quality=d.get("quality", "high"),
        sizes=sizes, concepts=concepts, frames_plan=frames_plan,
        frame_results=frame_results, dir=run_dir, cards=cards,
        size_briefs=size_briefs, style=d.get("style", ""),
        created_at=d.get("created_at", now), updated_at=d.get("updated_at", now),
        intent=d.get("intent", "general_ad"), intent_meta=d.get("intent_meta") or {},
        director=d.get("director") or {}, logo=d.get("logo") or {},
        cancelled=(d.get("status") == "cancelled"), error=d.get("error"),
    )


def rehydrate_runs() -> int:
    """Load persisted finished runs from disk into the store on startup, so the
    gallery survives a restart/redeploy. Best-effort and idempotent — a live run
    already in the store is never overwritten. Returns the number restored."""
    base = settings.ARTIFACT_ROOT / TOOL_ID
    if not base.exists():
        return 0
    n = 0
    for run_dir in sorted(base.iterdir()):
        meta = run_dir / "run.json"
        if not (run_dir.is_dir() and meta.is_file()) or STORE.get(run_dir.name) is not None:
            continue
        try:
            run = _run_from_dict(json.loads(meta.read_text(encoding="utf-8")), run_dir)
            # Skip a fully-dead run (no surviving banner image on disk) — it would
            # only show a card full of "unavailable" placeholders.
            if not any(fr.status == "ok" for fr in run.frame_results.values()):
                continue
            STORE.add(run)
            n += 1
        except Exception:  # noqa: BLE001
            log.warning("banner-builder: skipped unreadable run dir %s", run_dir.name)
    if n:
        log.info("banner-builder: rehydrated %d persisted run(s) from %s", n, base)
    return n


def storage_stats() -> dict:
    """Diagnostics for the banner artifact disk — proves banners land on (and
    survive on) the mounted persistent disk. Reports the resolved dir, disk
    total/free, exact run/PNG counts persisted, runs live in memory, and a
    `.first_seen` marker that, once written, MUST survive redeploys if the disk
    is truly persistent."""
    import os
    import shutil
    art = settings.ARTIFACT_ROOT
    base = art / TOOL_ID
    out: dict = {
        "artifact_dir": str(art),
        "persistent_env": bool(os.environ.get("PLATFORM_ARTIFACT_DIR")),
        "runs_in_memory": len(STORE.all()),
    }
    try:
        du = shutil.disk_usage(art if art.exists() else art.parent)
        out["total_gb"] = round(du.total / 1e9, 1)
        out["free_gb"] = round(du.free / 1e9, 1)
    except Exception:  # noqa: BLE001
        out["total_gb"] = None
    try:
        base.mkdir(parents=True, exist_ok=True)
        out["writable"] = True
        run_dirs = [d for d in base.iterdir() if d.is_dir()]
        run_jsons = [d for d in run_dirs if (d / "run.json").is_file()]
        out["runs_on_disk"] = len(run_jsons)
        out["pngs_on_disk"] = sum(1 for d in run_dirs for _ in d.glob("*.png"))
        # ok banners that run.json claims vs how many actually have a PNG on disk —
        # `missing_pngs` is the count that would otherwise show as broken images.
        ok_claimed = missing = 0
        for d in run_jsons:
            try:
                meta_d = json.loads((d / "run.json").read_text(encoding="utf-8"))
                for b in meta_d.get("banners", []):
                    if b.get("status") == "ok":
                        ok_claimed += 1
                        if not (d / f"{_label(b.get('concept', ''), b.get('size', ''))}.png").is_file():
                            missing += 1
            except Exception:  # noqa: BLE001
                pass
        out["ok_claimed"] = ok_claimed
        out["missing_pngs"] = missing
        marker = base / ".first_seen"
        if not marker.exists():
            marker.write_text(_now(), encoding="utf-8")
        out["first_seen"] = marker.read_text(encoding="utf-8")[:32]
    except Exception as e:  # noqa: BLE001
        out["writable"] = False
        out["error"] = type(e).__name__
    return out
