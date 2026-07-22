"""AI copywriter for the LP Builder — writes a page's copy in one shot.

Mirrors email_builder.copy_ai: the voice lives in lp_copywriter.md loaded
verbatim as the system prompt (swap that file to change how the team writes —
no code change), the model is GPT-5.5 through lp_materials._llm_json at a
FIXED effort (nothing about the AI is user-configurable), and output is
validated to exactly the (iid, key) slots the caller asked to fill.

Runs as a background job so a page refresh never orphans a generation. The
pre-write texts of every touched section are snapshotted on the job, backing
the one-click per-section "Restore previous text".
"""
from __future__ import annotations

import copy as _copy
import functools
import logging
import threading
import uuid
from pathlib import Path

from ..lp_materials import _llm_json
from . import core

log = logging.getLogger("lp_builder")

# "The smartest it offers", pinned in code — deliberately not a setting.
EFFORT = "high"
TIMEOUT_S = 300
MAX_BRIEF = 2000
_MAX_VALUE = 2000          # mirrors the autosave clamp on instance texts
_CONTEXT_VALUE_CAP = 300   # kept-section copy is context, not payload

_PROMPT_PATH = Path(__file__).with_name("lp_copywriter.md")

_JOBS: dict[str, dict] = {}
_LOCK = threading.Lock()

_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["items", "meta_title", "meta_description"],
    "properties": {
        "items": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["iid", "key", "value"],
            "properties": {"iid": {"type": "string"}, "key": {"type": "string"},
                           "value": {"type": "string"}},
        }},
        # Always present (strict schema); empty strings when meta wasn't asked for.
        "meta_title": {"type": "string"},
        "meta_description": {"type": "string"},
    },
}


@functools.lru_cache(maxsize=1)
def system_prompt() -> str:
    return _PROMPT_PATH.read_text(encoding="utf-8")


def _lang_label(code: str) -> str:
    for l in core.languages():
        if l.get("code") == code:
            return str(l.get("label") or code)
    return code


def _resolved_texts(tpl: dict, inst: dict, lang: str) -> dict:
    """Slot key -> currently rendered value, mirroring the compositor's
    fallback order (instance override → language default → en default)."""
    vals = dict((tpl.get("texts") or {}).get("en") or {})
    if lang != "en":
        vals.update((tpl.get("texts") or {}).get(lang) or {})
    vals.update({k: v for k, v in (inst.get("texts") or {}).items()})
    return {str(k): str(v) for k, v in vals.items()}


def _build_spec(project: dict, smap: dict, modes: dict, brief: str,
                include_meta: bool) -> tuple[dict, set]:
    """The user payload for the LLM + the exact (iid, key) pairs it may fill.

    Slot keys come from the section's authored per-language defaults plus any
    instance overrides — the concrete keys the compositor renders (including
    repeat-item keys like 'steps.0.title') — so no HTML parsing is needed here.
    """
    lang = project.get("language") or "en"
    sections, targets = [], set()
    for inst in project.get("sections") or []:
        iid = str(inst.get("iid") or "")
        tpl = smap.get(inst.get("template_key") or "")
        if not iid or not tpl:
            continue
        names = {**(tpl.get("names") or {}), **(inst.get("names") or {})}
        values = _resolved_texts(tpl, inst, lang)
        entry = {"iid": iid, "section": str(tpl.get("name") or tpl.get("key") or "")}
        if modes.get(iid) == "rewrite" and values:
            entry["mode"] = "rewrite"
            entry["fields"] = [{
                "key": k,
                "label": str(names.get(k) or k),
                "current": v,
                "target_chars": max(24, len(v)) if v else 80,
            } for k, v in values.items()]
            targets.update((iid, k) for k in values)
        else:
            entry["mode"] = "context"
            entry["copy"] = {k: v[:_CONTEXT_VALUE_CAP] for k, v in values.items()}
        sections.append(entry)
    spec = {
        "page": {
            "name": str(project.get("name") or ""),
            "brand": str(project.get("brand_id") or ""),
            "language": {"code": lang, "label": _lang_label(lang)},
            "brief": brief,
        },
        "write_meta": bool(include_meta),
        "current_meta": {"title": str(project.get("meta_title") or ""),
                         "description": str(project.get("meta_description") or "")},
        "sections": sections,
    }
    return spec, targets


def public_job(job: dict) -> dict:
    return {k: v for k, v in job.items() if not k.startswith("_") and k != "before"}


def get_job(job_id: str) -> dict | None:
    with _LOCK:
        return _JOBS.get(job_id)


def active_job_for(pid: str) -> dict | None:
    with _LOCK:
        for j in _JOBS.values():
            if j.get("project_id") == pid and j.get("status") in ("queued", "running"):
                return j
    return None


def start_job(*, api_key: str, project_id: str, brief: str, modes: dict,
              include_meta: bool, user_email: str) -> dict:
    job = {
        "id": "cw_" + uuid.uuid4().hex[:12],
        "project_id": project_id,
        "status": "queued",
        "error": None,
        "rewrote_iids": [],
        "meta_written": False,
        "created_by": user_email,
        "created_at": core._now(),
        "brief": brief[:MAX_BRIEF],
        "_api_key": api_key,
        "_modes": dict(modes),
        "_include_meta": bool(include_meta),
        "before": {},
    }
    with _LOCK:
        _JOBS[job["id"]] = job
    threading.Thread(target=_run, args=(job,), daemon=True,
                     name=f"lp-copy-{job['id']}").start()
    return job


def _run(job: dict) -> None:
    try:
        job["status"] = "running"
        pid = job["project_id"]
        with core.lock():
            live = core.projects().get(pid)
            if live is None:
                raise RuntimeError("landing page not found")
            project = _copy.deepcopy(live)
            smap = dict(core.sections())
        spec, targets = _build_spec(project, smap, job["_modes"], job["brief"],
                                    job["_include_meta"])
        if not targets:
            raise RuntimeError("no rewritable text in the selected sections")
        import json as _json
        out = _llm_json(
            job.pop("_api_key"),
            system=system_prompt(),
            user_text=_json.dumps(spec, ensure_ascii=False),
            schema_name="lp_copy", schema=_SCHEMA,
            effort=EFFORT, timeout=TIMEOUT_S, max_output_tokens=16000,
        )
        fills: dict[str, dict] = {}
        unknown = 0
        for item in out.get("items") or []:
            iid, key = str(item.get("iid") or ""), str(item.get("key") or "")
            if (iid, key) not in targets:
                unknown += 1
                continue
            value = str(item.get("value") or "").strip()
            if value:
                fills.setdefault(iid, {})[key] = value[:_MAX_VALUE]
        if unknown:
            log.warning("lp-copy %s: dropped %d off-spec item(s)", job["id"], unknown)
        if not fills:
            raise RuntimeError("the model returned no usable copy — try again")

        meta_title = str(out.get("meta_title") or "").strip()[:400]
        meta_desc = str(out.get("meta_description") or "").strip()[:400]
        with core.lock():
            live = core.projects().get(pid)
            if live is None:
                raise RuntimeError("landing page disappeared during generation")
            by_iid = {i.get("iid"): i for i in live.get("sections") or []}
            before: dict[str, dict] = {}
            for iid, kv in fills.items():
                inst = by_iid.get(iid)
                if inst is None:  # section removed mid-flight — skip it
                    continue
                before[iid] = dict(inst.get("texts") or {})
                texts = dict(inst.get("texts") or {})
                texts.update(kv)
                inst["texts"] = texts
            if job["_include_meta"] and (meta_title or meta_desc):
                before["__meta__"] = {"meta_title": live.get("meta_title") or "",
                                      "meta_description": live.get("meta_description") or ""}
                if meta_title:
                    live["meta_title"] = meta_title
                if meta_desc:
                    live["meta_description"] = meta_desc
                job["meta_written"] = True
            live["brief"] = job["brief"]
            live["updated_at"] = core._now()
            snapshot = _copy.deepcopy(live)
        core.persist_project(snapshot)
        job["before"] = before
        job["rewrote_iids"] = sorted(k for k in before if k != "__meta__")
        job["status"] = "done"
    except Exception as e:  # noqa: BLE001 — the job carries the error to the UI
        log.warning("lp-copy %s failed: %s", job.get("id"), e)
        job["error"] = str(e)
        job["status"] = "error"
    finally:
        job.pop("_api_key", None)
        job.pop("_modes", None)


def restore_section(job: dict, iid: str) -> dict:
    """Put a section's texts (or '__meta__') back to the pre-generation snapshot."""
    before = (job.get("before") or {}).get(iid)
    if before is None:
        raise KeyError("nothing to restore for that section")
    with core.lock():
        p = core.projects().get(job["project_id"])
        if p is None:
            raise KeyError("landing page not found")
        if iid == "__meta__":
            p["meta_title"] = before.get("meta_title") or ""
            p["meta_description"] = before.get("meta_description") or ""
        else:
            for inst in p.get("sections") or []:
                if inst.get("iid") == iid:
                    inst["texts"] = dict(before)
                    break
            else:
                raise KeyError("that section is no longer on the page")
        p["updated_at"] = core._now()
        snapshot = _copy.deepcopy(p)
    core.persist_project(snapshot)
    return snapshot
