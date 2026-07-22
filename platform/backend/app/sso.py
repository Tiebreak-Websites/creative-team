"""Microsoft SSO via Supabase Auth — session exchange and the live access gate.

The CreativeOPS model on the builder's own project, adapted to the fact that
this app HAS a backend with its own session cookie:

    Browser ── signInWithSSO ──► Supabase Auth ── SAML ──► Microsoft Entra
       │                            (MFA via Conditional Access)
       │◄─────────── Supabase session lands back in the SPA ────────────┘
       │
       └── POST /api/auth/sso-login {access_token}   ← ONCE, at login
             backend verifies the token against Supabase's own /auth/v1/user,
             ensures the public.users row (handle_new_user normally made it),
             and issues the builder's OWN session cookie.

Every later request runs on that cookie exactly as today — with one upgrade:
for SSO sessions, role / access_status / sections are re-read from the users
table through a short TTL cache, so "Grant access" in Settings → Users takes
effect within seconds, no re-login. Role truth is the TABLE, never a JWT
claim (the CreativeOPS rule).

Dormant until PLATFORM_SSO=on. With the flag off nothing here runs and the
password login is byte-for-byte what it was.
"""
from __future__ import annotations

import json
import logging
import threading
import time
import urllib.error
import urllib.request
from typing import Any, Dict, Optional

from fastapi import HTTPException

from . import supa
from .secrets import get_secret

log = logging.getLogger(__name__)

# Browser-safe by design (it is shipped to every client); env-overridable.
_DEFAULT_PUBLISHABLE_KEY = "sb_publishable_esM5Vcf8uAYkGa2U6SsiuA_0l-jApIk"
_TIMEOUT = 15
_PROFILE_TTL = 10.0  # seconds — how stale a role/access read may be

_CACHE_LOCK = threading.Lock()
_PROFILE_CACHE: Dict[str, tuple] = {}  # uid -> (expires_at, row)


def _flag(name: str, default: str = "") -> str:
    return (get_secret(name) or default).strip().lower()


def enabled() -> bool:
    return _flag("PLATFORM_SSO") in ("on", "true", "1", "yes")


def password_login_allowed() -> bool:
    """With SSO off, password login is simply how the app works. With SSO on,
    it survives only as explicit break-glass."""
    if not enabled():
        return True
    return _flag("PLATFORM_PASSWORD_LOGIN") in ("on", "true", "1", "break-glass")


def domain() -> str:
    return (get_secret("PLATFORM_SSO_DOMAIN") or "tiebreak.dev").strip()


def supabase_url() -> str:
    return (get_secret("SUPABASE_URL") or "").strip().rstrip("/")


def publishable_key() -> str:
    return (get_secret("PLATFORM_SUPABASE_PUBLISHABLE_KEY")
            or _DEFAULT_PUBLISHABLE_KEY).strip()


def config() -> dict:
    """What the login screen needs to render — all public values."""
    return {
        "sso": enabled(),
        "sso_domain": domain(),
        "supabase_url": supabase_url(),
        "publishable_key": publishable_key(),
        "password_login": password_login_allowed(),
    }


# ---- token verification -----------------------------------------------------

def verify_access_token(token: str) -> Optional[dict]:
    """Ask Supabase itself who this access token belongs to.

    One network call at LOGIN only (never per request), which buys us out of
    JWKS/algorithm drift entirely: if Supabase says the token is good, it is.
    Returns {"id", "email", "name"} or None for an invalid/expired token.
    """
    base = supabase_url()
    if not base or not token:
        return None
    req = urllib.request.Request(
        f"{base}/auth/v1/user",
        headers={"apikey": publishable_key(),
                 "Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as r:
            u = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            return None
        log.error("sso: /auth/v1/user HTTP %s", e.code)
        raise RuntimeError("Could not reach the sign-in service.")
    except Exception as e:
        raise RuntimeError(f"Could not reach the sign-in service: {e}")
    uid = str(u.get("id") or "")
    email = str(u.get("email") or "").strip().lower()
    meta = u.get("user_metadata") or {}
    name = str(meta.get("full_name") or meta.get("name") or "").strip()
    if not uid or not email:
        return None
    return {"id": uid, "email": email, "name": name}


# ---- the users-table profile ------------------------------------------------

def ensure_profile(uid: str, email: str, name: str) -> dict:
    """The public.users row for this auth user. The handle_new_user trigger
    normally created it on first sign-in; the insert here is the belt-and-
    braces fallback. Table defaults make new rows viewer + pending."""
    rows = supa.rest("GET", f"users?id=eq.{uid}&select=*")
    if rows:
        return rows[0]
    made = supa.rest("POST", "users", [{"id": uid, "email": email,
                                        "name": name or None}])
    log.info("sso: provisioned users row for %s (viewer, pending)", email)
    return made[0] if made else {"id": uid, "email": email, "name": name,
                                 "role": "viewer", "access_status": "pending",
                                 "active": True, "sections": None}


def profile(uid: str) -> Optional[dict]:
    """The users row, cached for a few seconds — fresh enough that granting
    access applies almost immediately, cheap enough for every request."""
    now = time.time()
    with _CACHE_LOCK:
        hit = _PROFILE_CACHE.get(uid)
        if hit and hit[0] > now:
            return hit[1]
    rows = supa.rest("GET", f"users?id=eq.{uid}&select=*")
    row = rows[0] if rows else None
    with _CACHE_LOCK:
        _PROFILE_CACHE[uid] = (now + _PROFILE_TTL, row)
    return row


def invalidate(uid: str) -> None:
    """Drop the cached profile — the admin panel calls this after a PATCH so
    grants and role changes apply on the user's very next request."""
    with _CACHE_LOCK:
        _PROFILE_CACHE.pop(uid, None)


def gate(row: Optional[dict]) -> dict:
    """The access decision for an SSO session. Returns the row when the user
    may enter; raises the 401/403 the frontend understands otherwise."""
    if not row:
        raise HTTPException(401, detail="Unknown user")
    if row.get("active") is False:
        raise HTTPException(403, detail={
            "code": "deactivated",
            "error": "This account has been deactivated."})
    if (row.get("access_status") or "pending") != "active":
        raise HTTPException(403, detail={
            "code": "pending_access",
            "error": "Signed in — awaiting access approval from an admin."})
    return row


def session_user(row: dict) -> Dict[str, Any]:
    """The user dict the rest of the app sees for an SSO session. Same keys
    password sessions produce, plus name/sections for the UI."""
    return {
        "email": row.get("email") or "",
        "role": row.get("role") or "viewer",
        "name": row.get("name") or "",
        "sections": row.get("sections"),
        # The linked Monday person (set in Admin › Users) — lets the banner/LP
        # queue show a user only the tasks they own on the Creative Board.
        "monday_user_id": row.get("monday_user_id") or "",
        "monday_user_name": row.get("monday_user_name") or "",
        "sso": True,
    }
