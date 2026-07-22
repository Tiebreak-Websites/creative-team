"""Supabase Postgres as the durable store — mirrored, never in the hot path.

The decision this implements (2026-07-22): the builder keeps its architecture
exactly as it is — FastAPI backend, in-memory dicts authoritative, JSON on the
artifact disk — and Supabase becomes where STORAGE and DATA durably live.
Nothing about generation, routing or auth changes.

How the mirror works:

  writes    every JSON persist keeps happening synchronously exactly as
            before, and the same record is UPSERTED to Postgres on a daemon
            thread — the events.py discipline: a database hop must never slow
            or fail a user's save. Failures log loudly; the disk copy is the
            safety net and the next write heals the row.
  deletes   same shape: disk first, mirrored DELETE behind it.
  startup   when the keys exist, rehydrate pulls each table and merges with
            whatever the disk has, newest `updated_at` wins per record — and
            anything the database is missing is pushed up. That makes the
            one-time `.runs` import automatic and idempotent: the first boot
            with keys migrates the data, every later boot is a no-op.

Without SUPABASE_URL/SUPABASE_SERVICE_KEY none of this runs and the builder
is byte-for-byte the app it was yesterday.

Both local dev and the deployed server point at the same project — that is
the point (one database), and per-record last-write-wins is acceptable for a
small team, the same trade Storage already makes for images.
"""
from __future__ import annotations

import logging
import queue
import threading
from typing import Any, Callable, Dict, List, Optional

from . import supa

log = logging.getLogger(__name__)


def enabled() -> bool:
    return supa.enabled()


# One writer thread + a queue, not a thread per write: campaign autosaves come
# in bursts and per-record ordering matters (an upsert overtaken by the delete
# that followed it would resurrect the row).
_Q: "queue.Queue[Callable[[], None]]" = queue.Queue()
_STARTED = threading.Event()


def _worker() -> None:
    while True:
        job = _Q.get()
        try:
            job()
        except Exception:
            log.exception("pgdb: mirror write failed (disk copy remains the net)")
        finally:
            _Q.task_done()


def _queue(job: Callable[[], None]) -> None:
    if not enabled():
        return
    if not _STARTED.is_set():
        _STARTED.set()
        threading.Thread(target=_worker, name="pgdb-mirror", daemon=True).start()
    _Q.put(job)


def flush(timeout: float = 10.0) -> None:
    """Wait for queued mirror writes — tests and shutdown hooks only."""
    if _STARTED.is_set():
        try:
            _Q.join()
        except Exception:
            pass


# ---- raw operations ---------------------------------------------------------

def _upsert(table: str, pk: str, row: Dict[str, Any]) -> None:
    supa.rest("POST", f"{table}?on_conflict={pk}", [row],
              prefer="resolution=merge-duplicates,return=minimal")


def _delete(table: str, pk: str, value: str) -> None:
    supa.rest("DELETE", f"{table}?{pk}=eq.{value}", prefer="return=minimal")


def select_all(table: str) -> List[dict]:
    """Synchronous full-table read — rehydrate only. Raises on failure so the
    caller can fall back to disk explicitly."""
    rows = supa.rest("GET", f"{table}?select=*")
    return rows if isinstance(rows, list) else []


# ---- row shapes (payload-first: the whole record is the jsonb payload; the
# ---- typed columns exist for queries and webhooks, extracted defensively) ---

def campaign_row(c: dict) -> dict:
    return {
        "id": str(c.get("id") or ""),
        "brand_id": str(c.get("brand_id") or ""),
        "parent_id": str(c.get("parent_id") or ""),
        "monday_id": str(c.get("monday_id") or ""),
        "language": str(c.get("language") or "en"),
        "name": str(c.get("name") or ""),
        "active": bool(c.get("active", False)),
        "payload": c,
        "created_by": c.get("created_by") or None,
        "updated_at": c.get("updated_at") or None,
    }


def email_block_row(b: dict) -> dict:
    return {"key": str(b.get("key") or ""), "built_in": bool(b.get("built_in", False)),
            "payload": b}


def lp_project_row(p: dict) -> dict:
    return {
        "id": str(p.get("id") or ""),
        "brand_id": str(p.get("brand_id") or ""),
        "monday_id": str(p.get("monday_id") or ""),
        "language": str(p.get("language") or "en"),
        "payload": p,
        "created_by": p.get("created_by") or None,
        "updated_at": p.get("updated_at") or None,
    }


def lp_section_row(s: dict) -> dict:
    return {"key": str(s.get("key") or ""), "built_in": bool(s.get("built_in", False)),
            "payload": s}


def brand_row(b: dict) -> dict:
    return {"id": str(b.get("id") or ""), "active": b.get("active", True) is not False,
            "payload": b}


# ---- mirrored writes (fire-and-forget) --------------------------------------

def mirror_upsert(table: str, pk: str, row: Dict[str, Any]) -> None:
    if row.get(pk):
        _queue(lambda: _upsert(table, pk, row))


def mirror_delete(table: str, pk: str, value: str) -> None:
    if value:
        _queue(lambda: _delete(table, pk, value))


def mirror_brands(brands: List[dict]) -> None:
    """Brands persist as a whole list; mirror as upsert-all + delete-missing so
    a brand removed from the list disappears from the table too."""
    rows = [brand_row(b) for b in brands if b.get("id")]
    ids = {r["id"] for r in rows}

    def job() -> None:
        if rows:
            supa.rest("POST", "brands?on_conflict=id", rows,
                      prefer="resolution=merge-duplicates,return=minimal")
        for have in select_all("brands"):
            if have.get("id") not in ids:
                _delete("brands", "id", have["id"])

    _queue(job)


def mirror_languages(langs: List[dict]) -> None:
    rows = [{"code": str(l.get("code") or ""), "label": str(l.get("label") or ""),
             "sort_order": i} for i, l in enumerate(langs) if l.get("code")]
    codes = {r["code"] for r in rows}

    def job() -> None:
        if rows:
            supa.rest("POST", "languages?on_conflict=code", rows,
                      prefer="resolution=merge-duplicates,return=minimal")
        for have in select_all("languages"):
            if have.get("code") not in codes:
                _delete("languages", "code", have["code"])

    _queue(job)


# ---- startup merge ----------------------------------------------------------

def _newer(a: Optional[str], b: Optional[str]) -> bool:
    """Is ISO timestamp `a` strictly newer than `b`? Missing loses; ISO-8601
    strings with a fixed offset compare correctly as strings only when the
    offsets match, so parse properly."""
    from datetime import datetime
    try:
        ta = datetime.fromisoformat(str(a))
    except Exception:
        return False
    try:
        tb = datetime.fromisoformat(str(b))
    except Exception:
        return True
    return ta > tb


def merge_records(table: str, pk: str, disk: Dict[str, dict],
                  row_of: Callable[[dict], dict],
                  stamp: str = "updated_at") -> Dict[str, dict]:
    """The rehydrate contract: pull the table, merge with disk records
    newest-wins per id, and push anything the database is missing or has
    stale. Returns the merged mapping for memory; on ANY database failure
    returns the disk records untouched (and logs) — startup must never break
    on a network problem.
    """
    if not enabled():
        return disk
    try:
        db_rows = select_all(table)
    except Exception:
        log.exception("pgdb: could not read %s — starting from disk alone", table)
        return disk

    merged: Dict[str, dict] = {}
    db_payloads: Dict[str, dict] = {}
    for r in db_rows:
        rec = r.get("payload")
        rid = str(r.get(pk) or "")
        if isinstance(rec, dict) and rid:
            db_payloads[rid] = rec
            merged[rid] = rec

    to_push: List[dict] = []
    for rid, rec in disk.items():
        have = db_payloads.get(rid)
        if have is None or _newer(rec.get(stamp), have.get(stamp)):
            merged[rid] = rec
            to_push.append(rec)

    if to_push:
        log.info("pgdb: pushing %d %s record(s) the database was missing/stale",
                 len(to_push), table)
        for rec in to_push:
            mirror_upsert(table, pk, row_of(rec))
    return merged
