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

import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from . import engine
from .models import RunRequest
from .settings import settings

TOOL_ID = "banner-builder"

# Hard ceiling on concurrent OpenAI image calls across ALL runs/users.
_OPENAI_SEM = threading.BoundedSemaphore(settings.OPENAI_CONCURRENCY)
# Pool that runs the per-run orchestration so POST /run returns immediately.
_RUN_POOL = ThreadPoolExecutor(max_workers=4, thread_name_prefix="bb-run")

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


STORE = RunStore()


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

    Prefers stopping at the first sentence boundary so the hook reads as a clean
    phrase; otherwise takes the first 2-4 words. The returned fragment is always
    a *verbatim* (case-insensitive) substring of the title — what
    engine.validate_manifest requires of hook_phrase — so it is sliced directly
    out of the title rather than rebuilt from split tokens.
    """
    t = title.strip()
    if not t:
        return t
    words = t.split()
    # How many leading words to take: stop at the first word that ends a
    # sentence (.!?), but always keep 2-4 words when the title is long enough.
    take = 0
    for i, w in enumerate(words):
        take = i + 1
        if take >= 2 and w[-1:] in ".!?":
            break
        if take >= 4:
            break
    take = min(take, 4)
    if len(words) >= 2:
        take = max(take, 2)

    # Slice the verbatim substring spanning the first `take` words.
    consumed = 0
    idx = 0
    for w in words[:take]:
        idx = t.lower().index(w.lower(), idx) + len(w)
        consumed += 1
        if consumed == take:
            break
    hook = t[:idx]
    # Trim trailing punctuation/space so the hook isn't left dangling on a "." —
    # rstrip only removes chars that are NOT part of any word, so it stays a
    # verbatim substring.
    return hook.rstrip(" .,:;!?-—–")


def _synthesize_brief(subtitle: str, style: str) -> str:
    """Build ~250-400 chars of creative-brief prose from subtitle + style.

    Composes the user's optional subtitle and campaign style on top of a clean,
    modern poster default. The result is free-form prose (the shape the engine's
    creative_brief expects), never a template list.
    """
    parts = [
        "Clean modern poster: the hook set in bold confident display type, "
        "anchored upper-left against a smooth thematic gradient with generous "
        "breathing room; editorial, premium, uncluttered."
    ]
    sub = (subtitle or "").strip()
    if sub:
        parts.append(f"Supporting message to convey: {sub}.")
    sty = (style or "").strip()
    if sty:
        parts.append(f"Look and brand vibe: {sty}.")
    else:
        parts.append("Restrained, contemporary palette; soft directional light; calm but high-impact mood.")
    brief = " ".join(parts)
    # Keep it inside the ~250-400 char band the engine brief is tuned for.
    if len(brief) > 400:
        brief = brief[:397].rstrip() + "…"
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
            is_master = (s == engine.MASTER_SIZE)
            plan.append({
                "concept": ck, "size": s,
                "openai_size": engine.OPENAI_SIZE_MAP[s],
                "mode": "gen" if is_master else "edit",
                "phase": "master" if is_master else "recomp",
            })
    return plan


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
    run = Run(
        id=run_id, status="queued", model=req.model, quality=req.quality,
        sizes=sizes, concepts=concepts, frames_plan=plan,
        frame_results=frame_results, dir=run_dir,
        created_at=now, updated_at=now, api_key=api_key,
    )
    STORE.add(run)
    _RUN_POOL.submit(execute_run, run_id)
    return run


# ---------------------------------------------------------------------------
# Execution
# ---------------------------------------------------------------------------
def _gen_one_frame(run: Run, frame: dict):
    fr = run.fr(frame["concept"], frame["size"])
    concept = run.concepts[frame["concept"]]
    fr.status = "running"
    run.touch()

    try:
        if frame["mode"] == "edit":
            prompt = engine.build_recomp_prompt(concept, engine.MASTER_SIZE, frame["size"])
        else:
            prompt = engine.build_prompt(concept, frame["size"])
    except Exception as e:  # noqa: BLE001
        fr.status, fr.error = "prompt_failed", f"{type(e).__name__}: {e}"
        run.touch()
        return

    ok, reason = engine.check_moderation(concept)
    if not ok:
        fr.status, fr.error = "moderation_skip", reason
        run.touch()
        return

    master_png = None
    if frame["mode"] == "edit":
        master_png = str(run.dir / f"{frame['concept']}__{engine.MASTER_SIZE}.png")

    def _on_attempt(attempt):
        fr.attempts = attempt
        run.touch()

    t0 = time.time()
    with _OPENAI_SEM:
        try:
            png = engine.generate_png(
                api_key=run.api_key, prompt=prompt, mode=frame["mode"],
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

    out_png = run.dir / f"{_label(frame['concept'], frame['size'])}.png"
    out_png.write_bytes(png)
    fr.status, fr.gen_ms, fr.bytes, fr.png_path = "ok", int((time.time() - t0) * 1000), len(png), str(out_png)
    run.touch()


def _run_phase(run: Run, frames: List[dict]):
    if not frames:
        return
    with ThreadPoolExecutor(max_workers=settings.OPENAI_CONCURRENCY) as ex:
        list(ex.map(lambda f: _gen_one_frame(run, f), frames))


def _finalize(run: Run) -> str:
    statuses = [fr.status for fr in run.frame_results.values()]
    ok = sum(1 for s in statuses if s == "ok")
    if ok == 0:
        return "failed"
    if ok == len(statuses):
        return "completed"
    return "partial"


def execute_run(run_id: str):
    run = STORE.get(run_id)
    if run is None:
        return
    try:
        # Phase 1 — masters (parallel), then BARRIER.
        run.status = "running_master"
        run.touch()
        master_frames = [f for f in run.frames_plan if f["phase"] == "master"]
        _run_phase(run, master_frames)

        ok_masters = {f["concept"] for f in master_frames
                      if run.fr(f["concept"], f["size"]).status == "ok"}
        if not ok_masters:
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
        if runnable:
            run.status = "running_recomp"
            run.touch()
            _run_phase(run, runnable)

        run.status = _finalize(run)
        run.touch()
    except Exception as e:  # noqa: BLE001
        run.status, run.error = "failed", f"{type(e).__name__}: {e}"
        run.touch()


# ---------------------------------------------------------------------------
# Serialization for the API
# ---------------------------------------------------------------------------
def _counts(run: Run) -> dict:
    c = {"ok": 0, "failed": 0, "pending": 0, "running": 0}
    for fr in run.frame_results.values():
        if fr.status == "ok":
            c["ok"] += 1
        elif fr.status in ("pending",):
            c["pending"] += 1
        elif fr.status in ("running",):
            c["running"] += 1
        else:
            c["failed"] += 1
    return c


def run_to_dict(run: Run) -> dict:
    banners = []
    for f in run.frames_plan:
        fr = run.fr(f["concept"], f["size"])
        label = _label(f["concept"], f["size"])
        banners.append({
            "label": label, "concept": f["concept"], "size": f["size"],
            "mode": f["mode"], "phase": f["phase"], "status": fr.status,
            "attempts": fr.attempts, "gen_ms": fr.gen_ms, "bytes": fr.bytes,
            "error": fr.error,
            "url": (f"/api/tools/{TOOL_ID}/runs/{run.id}/banners/{label}.png"
                    if fr.status == "ok" else None),
        })
    return {
        "run_id": run.id, "status": run.status, "error": run.error,
        "total": len(run.frames_plan),
        "completed": sum(1 for fr in run.frame_results.values() if fr.status == "ok"),
        "counts": _counts(run),
        "created_at": run.created_at, "updated_at": run.updated_at,
        "banners": banners,
    }
