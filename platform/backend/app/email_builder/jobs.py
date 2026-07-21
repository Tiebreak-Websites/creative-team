"""Background generation jobs for the email builder.

A generation must survive the browser: refresh, navigation, closed laptop.
So the request only REGISTERS a job; a daemon thread runs the pipeline and,
crucially, writes the finished result into the campaign SERVER-SIDE. The
page polls to show progress, but nothing depends on it still being open —
an abandoned generation still lands in the campaign.

Same job idiom as lp_materials: in-memory registry behind a lock, one small
JSON mirror on the artifact disk, rehydrate marks anything mid-flight as
failed (a process restart genuinely does kill the thread — that is the one
honest limit, and lying about it would be worse).
"""
from __future__ import annotations

import json
import logging
import threading
import uuid
from typing import Callable, Dict, List, Optional

from . import core

log = logging.getLogger(__name__)

_LOCK = threading.RLock()
_JOBS: Dict[str, dict] = {}
_PATH = core.EMAIL_ROOT / "jobs.json"
_KEEP = 50  # finished jobs retained for the UI to read; older ones pruned


def _persist() -> None:
    try:
        _PATH.parent.mkdir(parents=True, exist_ok=True)
        _PATH.write_text(json.dumps(list(_JOBS.values()), ensure_ascii=False),
                         encoding="utf-8")
    except Exception:
        log.exception("email-jobs: could not persist")


def rehydrate() -> None:
    with _LOCK:
        _JOBS.clear()
        try:
            for j in json.loads(_PATH.read_text(encoding="utf-8")):
                if j.get("id"):
                    _JOBS[j["id"]] = j
        except FileNotFoundError:
            pass
        except Exception:
            log.exception("email-jobs: unreadable jobs file, starting empty")
        # A restart kills worker threads; anything still "running" is dead.
        for j in _JOBS.values():
            if j.get("status") == "running":
                j["status"] = "failed"
                j["error"] = "Interrupted by a server restart — generate again."
        _persist()


def public(j: dict) -> dict:
    return {k: j.get(k) for k in
            ("id", "kind", "campaign_id", "iid", "status", "error", "result",
             "created_at")}


def get(job_id: str) -> Optional[dict]:
    with _LOCK:
        j = _JOBS.get(job_id)
        return dict(j) if j else None


def for_campaign(campaign_id: str) -> List[dict]:
    with _LOCK:
        return [dict(j) for j in _JOBS.values()
                if j.get("campaign_id") == campaign_id]


def active_for(campaign_id: str, iid: str, kind: str) -> Optional[dict]:
    with _LOCK:
        for j in _JOBS.values():
            if (j.get("status") == "running" and j.get("kind") == kind
                    and j.get("campaign_id") == campaign_id and j.get("iid") == iid):
                return dict(j)
    return None


def start(kind: str, campaign_id: str, iid: str,
          work: Callable[[], dict],
          apply: Callable[[dict], None]) -> dict:
    """Register and launch. `work` runs the pipeline and returns the result;
    `apply` writes that result into the campaign — BOTH run on the worker
    thread, so the outcome lands whether or not any browser is watching."""
    job = {"id": uuid.uuid4().hex[:12], "kind": kind,
           "campaign_id": campaign_id, "iid": iid,
           "status": "running", "error": None, "result": None,
           "created_at": core._now()}
    with _LOCK:
        _JOBS[job["id"]] = job
        # prune old finished jobs so the file never grows unbounded
        done = sorted((j for j in _JOBS.values() if j["status"] != "running"),
                      key=lambda j: j.get("created_at") or "")
        for old in done[:-_KEEP] if len(done) > _KEEP else []:
            _JOBS.pop(old["id"], None)
        _persist()

    def _run() -> None:
        try:
            result = work()
            try:
                apply(result)
                result["applied"] = True
            except Exception:
                # The image exists; only the write-back failed. Say so rather
                # than calling the whole generation a failure.
                log.exception("email-jobs: result apply failed (%s)", job["id"])
                result["applied"] = False
            with _LOCK:
                job["status"] = "done"
                job["result"] = result
                _persist()
        except ValueError as e:
            _fail(str(e))
        except LookupError:
            _fail("OPENAI_API_KEY is not configured on this server.")
        except Exception as e:
            log.exception("email-jobs: %s failed", job["id"])
            _fail(str(e) or "Generation failed.")

    def _fail(msg: str) -> None:
        with _LOCK:
            job["status"] = "failed"
            job["error"] = msg[:300]
            _persist()

    threading.Thread(target=_run, name=f"em-job-{job['id']}", daemon=True).start()
    return dict(job)
