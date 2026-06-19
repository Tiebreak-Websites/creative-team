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

from . import creative_director, engine
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
    style: str = ""                    # campaign look/vibe (fed to the director)
    effort: Optional[str] = None       # per-run GPT-5.5 thinking effort (None -> admin default)
    cards: Dict[str, dict] = field(default_factory=dict)   # key -> {title, subtitle, button}
    size_briefs: Dict[str, Dict[str, str]] = field(default_factory=dict)  # concept -> {size -> brief}
    director: dict = field(default_factory=dict)           # summary surfaced in the API

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
    """Deterministic fallback brief — used ONLY when the GPT-5.5 director is off or
    unavailable. A bold, concrete, high-CTR default (not a soft mood piece), since
    it can't see the specific subject the way the director can.
    """
    parts = [
        "High-impact paid-social ad built on ONE clear idea: the hook in bold confident "
        "display type with strong figure-ground contrast against a clean, saturated "
        "background; a single concrete hero relevant to the message (a real-looking "
        "generic person facing the viewer with confident, aspirational posture, and/or "
        "the actual product), deliberate directional lighting, punchy modern palette; "
        "scroll-stopping and premium. No watercolor wash, no bokeh particles, no abstract "
        "swooshes, no candlestick/line charts (even as props), no desk/hand-on-chin stock "
        "pose, no gambling or get-rich-quick symbolism."
    ]
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
    cards = {
        c.key: {"title": c.title, "subtitle": c.subtitle or "", "button": c.button or ""}
        for c in req.concepts
    }
    run = Run(
        id=run_id, status="queued", model=req.model, quality=req.quality,
        sizes=sizes, concepts=concepts, frames_plan=plan,
        frame_results=frame_results, dir=run_dir,
        created_at=now, updated_at=now, api_key=api_key,
        style=req.style or "", effort=req.effort, cards=cards,
    )
    STORE.add(run)
    _RUN_POOL.submit(execute_run, run_id)
    return run


# ---------------------------------------------------------------------------
# Execution
# ---------------------------------------------------------------------------
def _gen_one_frame(run: Run, frame: dict):
    fr = run.fr(frame["concept"], frame["size"])
    base = run.concepts[frame["concept"]]
    # Per-size creative brief from the GPT-5.5 director if present, else the base
    # (deterministic template) brief — so a frame is never left without direction.
    brief = run.size_briefs.get(frame["concept"], {}).get(frame["size"]) or base.get("creative_brief")
    concept = {**base, "creative_brief": brief}
    fr.status = "running"
    run.touch()

    try:
        if frame["mode"] == "edit":
            prompt = engine.build_recomp_prompt(
                concept, engine.MASTER_SIZE, frame["size"], art_direction=brief)
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
        run.director = {"used": False, "reason": "disabled"}
        return

    # Per-run effort (the user's choice) wins over the admin default when valid.
    effort = run.effort if (run.effort in creative_director.VALID_EFFORTS) else cfg["effort"]

    run.status = "directing"
    run.touch()

    def _one(ck: str):
        base = run.concepts[ck]
        card = run.cards.get(ck, {})
        try:
            result = creative_director.direct_concept(
                api_key=run.api_key, title=base.get("title", ""),
                subtitle=card.get("subtitle", ""), button=card.get("button", ""),
                style=run.style, locale=base.get("locale", "en"),
                sizes=run.sizes, model=cfg["model"], effort=effort,
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

    keys = list(run.concepts.keys())
    directed_sizes, failed, errors = 0, 0, []
    with ThreadPoolExecutor(max_workers=min(4, max(1, len(keys)))) as ex:
        for ck, v, err in ex.map(_one, keys):
            if v is None:
                failed += 1
                if err:
                    errors.append(err)
                run.size_briefs[ck] = {
                    s: run.concepts[ck].get("creative_brief", "") for s in run.sizes
                }
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
        # Phase 0 — GPT-5.5 creative direction (per-size briefs). Best-effort:
        # any failure falls back to the deterministic template brief.
        _direct_run(run)

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
            "title": run.concepts.get(f["concept"], {}).get("title", ""),
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
        "director": run.director,
        "banners": banners,
    }
