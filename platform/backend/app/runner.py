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
# Build + validate
# ---------------------------------------------------------------------------
def _concept_dict(c) -> dict:
    d = {"title": c.title, "locale": c.locale or "en",
         "hook_phrase": c.hook_phrase, "creative_brief": c.creative_brief}
    if c.cta:
        d["cta"] = c.cta
        if c.button_combo:
            d["button_combo"] = list(c.button_combo)
    return d


def normalize_sizes(sizes: List[str]) -> List[str]:
    seen = list(dict.fromkeys(sizes))          # dedupe, preserve order
    if engine.MASTER_SIZE not in seen:
        seen = [engine.MASTER_SIZE] + seen     # master is always present
    return seen


def validate_request(req: RunRequest):
    """Reuse the engine's own validators so the web path and CLI agree.

    Returns (errors, concepts, sizes). errors == [] means safe to run.
    """
    if not req.concepts:
        return ["at least one concept is required"], {}, []
    if len(req.concepts) > 5:
        return ["cap is 5 concepts per run"], {}, []

    concepts = {c.key: _concept_dict(c) for c in req.concepts}
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
