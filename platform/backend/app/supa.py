"""Minimal Supabase PostgREST client for the backend.

The backend talks to the Creative Builder project with the service role key
(RLS is bypassed; our FastAPI auth is the boundary until direct client access
exists). Stdlib urllib like every other outbound call in this codebase.

Dormant until SUPABASE_URL + SUPABASE_SERVICE_KEY are configured — callers
get a LookupError and translate it to the 424 + missing_secrets shape.
"""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from typing import Any, Optional

from .secrets import get_secret

log = logging.getLogger(__name__)

_TIMEOUT = 20


def _config() -> Optional[tuple]:
    url = (get_secret("SUPABASE_URL") or "").strip().rstrip("/")
    key = (get_secret("SUPABASE_SERVICE_KEY") or "").strip()
    return (url, key) if url and key else None


def enabled() -> bool:
    return _config() is not None


def rest(method: str, path: str, payload: Any = None) -> Any:
    """One PostgREST call. `path` includes the table and any query string,
    e.g. "users?select=*&order=created_at.desc". Raises LookupError when
    unconfigured, RuntimeError on HTTP failure."""
    cfg = _config()
    if not cfg:
        raise LookupError("SUPABASE_URL/SUPABASE_SERVICE_KEY")
    url, key = cfg
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        f"{url}/rest/v1/{path}",
        data=body,
        method=method,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            # representation back, so PATCH/POST return the row they touched
            "Prefer": "return=representation",
        })
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as r:
            raw = r.read().decode("utf-8")
            return json.loads(raw) if raw.strip() else None
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        log.error("supabase rest: %s %s -> %s %s", method, path, e.code, detail)
        raise RuntimeError(f"Supabase request failed (HTTP {e.code}).")
    except Exception as e:
        raise RuntimeError(f"Supabase request failed: {e}")
