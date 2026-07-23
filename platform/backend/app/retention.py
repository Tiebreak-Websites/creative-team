"""Banner retention — delete runs past their shelf life so storage stays healthy.

Banners are working files, not an archive: the team downloads what it needs
and uploads it to the CreativeOPS catalogue, so a run's PNGs only have to
survive long enough to be reviewed and collected. Runs older than the window
(default 14 days, env `PLATFORM_BANNER_TTL_DAYS`) are deleted — directory and
in-memory record both, via runner.delete_run.

ONLY banner runs are swept. Landing pages and emails are kept forever on
purpose — their code/content is the archive the team comes back to.

Runs in a background daemon thread started from create_app() (same pattern as
the rehydrate threads): first pass after a short delay so rehydrate_runs has
repopulated the STORE, then every few hours. Deleting mid-generation is not a
real risk at a 14-day window (generation takes minutes), so age is the only
criterion — a 14-day-old "running" run is a zombie, not work in progress.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timedelta, timezone

from .secrets import get_secret

log = logging.getLogger(__name__)

_SWEEP_EVERY_S = 6 * 60 * 60   # re-check a few times a day; precision is not the point
_FIRST_DELAY_S = 120           # let bb-rehydrate fill the STORE before the first pass


def ttl_days() -> int:
    """The retention window in days. <= 0 disables the sweep entirely."""
    raw = (get_secret("PLATFORM_BANNER_TTL_DAYS") or "").strip()
    try:
        return int(raw) if raw else 14
    except ValueError:
        log.warning("retention: PLATFORM_BANNER_TTL_DAYS=%r is not a number — using 14", raw)
        return 14


def _created_at(run) -> datetime | None:
    try:
        dt = datetime.fromisoformat(run.created_at)
        # Legacy naive stamps are UTC by construction (_now()).
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def sweep_banner_runs() -> int:
    """Delete every banner run older than the window. Returns how many."""
    days = ttl_days()
    if days <= 0:
        return 0
    from . import runner
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    deleted = 0
    for run in runner.STORE.all():
        created = _created_at(run)
        if created is None or created >= cutoff:
            continue
        try:
            runner.delete_run(run)
            deleted += 1
            log.info("retention: deleted banner run %s (created %s, window %sd, creative %s)",
                     run.id, run.created_at, days, run.monday_id or "unfiled")
        except Exception as e:  # noqa: BLE001 — one bad run must not stop the sweep
            log.error("retention: could not delete run %s: %s", run.id, e)
    if deleted:
        log.info("retention: sweep removed %s run(s) older than %s days", deleted, days)
    return deleted


def start_retention_thread() -> None:
    """Start the periodic sweep (daemon; never blocks or fails startup)."""
    if ttl_days() <= 0:
        log.info("retention: disabled (PLATFORM_BANNER_TTL_DAYS <= 0)")
        return

    def _loop() -> None:
        time.sleep(_FIRST_DELAY_S)
        while True:
            try:
                sweep_banner_runs()
            except Exception as e:  # noqa: BLE001
                log.error("retention: sweep failed: %s", e)
            time.sleep(_SWEEP_EVERY_S)

    threading.Thread(target=_loop, daemon=True, name="banner-retention").start()


__all__ = ["sweep_banner_runs", "start_retention_thread", "ttl_days"]
