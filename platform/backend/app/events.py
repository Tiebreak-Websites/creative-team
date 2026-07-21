"""Outbound automation events → n8n.

The builder's half of the n8n bridge (instance: courses.n8n.plexop.dev).
Every meaningful state change POSTs a small JSON event to N8N_WEBHOOK_URL
with `Authorization: Bearer N8N_WEBHOOK_SECRET` — the same header-auth
contract CreativeOPS's webhooks use, so workflows are interchangeable.

Design rules:
  - fire-and-forget on a daemon thread: an automation hop must NEVER slow or
    fail a user's save
  - dormant until both env vars exist (the platform's standard discipline)
  - one flat payload shape: {event, source, data} — n8n switches on `event`

Interim architecture note: CreativeOPS never calls n8n from the app because
it HAS no app — it is browser-only and cannot hold a secret. Our backend can,
so direct emission is correct today; once Phase 3 puts the data in Postgres,
these same events can move to Supabase database webhooks without the n8n
side changing shape.
"""
from __future__ import annotations

import json
import logging
import threading
import urllib.request
from typing import Any, Dict

from .secrets import get_secret

log = logging.getLogger(__name__)

_TIMEOUT = 10


def configured() -> bool:
    return bool((get_secret("N8N_WEBHOOK_URL") or "").strip()
                and (get_secret("N8N_WEBHOOK_SECRET") or "").strip())


def emit(event: str, data: Dict[str, Any]) -> None:
    """Queue an event for delivery. Returns immediately; never raises."""
    url = (get_secret("N8N_WEBHOOK_URL") or "").strip()
    secret = (get_secret("N8N_WEBHOOK_SECRET") or "").strip()
    if not url or not secret:
        log.debug("n8n event %s skipped — not configured", event)
        return
    payload = {"event": event, "source": "creative-builder", "data": data}
    threading.Thread(target=_deliver, args=(url, secret, payload),
                     name="n8n-emit", daemon=True).start()


def _deliver(url: str, secret: str, payload: dict) -> None:
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/json",
                     "Authorization": f"Bearer {secret}"})
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as r:
            r.read()
        log.info("n8n event delivered: %s", payload.get("event"))
    except Exception as e:
        # Logged, never raised — the user's action already succeeded.
        log.warning("n8n event %s failed: %s", payload.get("event"), e)


def campaign_snapshot(c: dict) -> Dict[str, Any]:
    """The fields an automation actually needs — small on purpose."""
    return {
        "id": c.get("id"),
        "name": c.get("name"),
        "subject": c.get("subject"),
        "brand_id": c.get("brand_id"),
        "language": c.get("language"),
        "parent_id": c.get("parent_id") or "",
        "monday_id": c.get("monday_id") or "",
        "approved": bool(c.get("active")),
    }
