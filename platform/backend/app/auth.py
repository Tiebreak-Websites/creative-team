"""Authentication: password login, JWT session cookies, and route guards.

Design goals (matches the rest of the platform):
- Local-first, env-overridable. One seeded admin out of the box; the user store
  is a module-level dict so more users can be added later without a schema.
- The signing secret survives restarts: env `PLATFORM_SECRET_KEY` wins, else a
  random key is generated once and persisted to `platform/backend/.secret_key`.
- Secrets and passwords are NEVER logged.

Session model: on login we set an httpOnly `session` cookie holding a signed JWT
(HS256, ~8h). `require_user` / `require_admin` decode+verify that cookie. Because
the Vite dev server proxies /api → :8000, the browser sees the API as same-origin,
so the cookie is first-party and `samesite="lax"` is enough (no CORS creds).
"""
from __future__ import annotations

import logging
import re
import secrets as _secrets
import threading
import time
from collections import deque
from datetime import datetime, timezone

import jwt
from fastapi import APIRouter, Body, Cookie, Depends, HTTPException, Request, Response
from passlib.context import CryptContext

from .secrets import get_secret
from .settings import BACKEND_DIR, settings

# --- Tunables --------------------------------------------------------------
TOKEN_TTL_SECONDS = 8 * 60 * 60  # ~8h sessions
COOKIE_NAME = "session"
JWT_ALG = "HS256"
_LOGIN_FAIL_DELAY = 0.4  # blunt brute force; constant-ish small delay on 401

# --- Login brute-force throttle (in-memory sliding window) -----------------
# A small fixed delay alone doesn't stop credential stuffing against a known
# admin email. Track FAILED logins per (client-ip, email) in a sliding window
# and return 429 once a key is over budget; a successful login clears the key.
# In-memory / single-process — mirrors the rest of the app's guards (runner.py).
_LOGIN_LOCK = threading.Lock()
_LOGIN_FAILS: dict[str, deque] = {}
_LOGIN_MAX_FAILS = 8      # failed attempts ...
_LOGIN_WINDOW = 900.0     # ... per 15 minutes, per (ip, email) before lockout

_SECRET_KEY_FILE = BACKEND_DIR / ".secret_key"

# bcrypt via passlib; verify is constant-time.
_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
# A real bcrypt hash verified against when the email is unknown, so a failed
# login runs one bcrypt-verify either way and can't be timed to enumerate
# valid emails. (Hash of a random constant; nothing verifies True against it.)
_DUMMY_HASH = _pwd.hash("no-such-user-timing-equalizer")

log = logging.getLogger(__name__)


# --- Signing key (persisted so sessions survive restarts) ------------------
def _load_secret_key() -> str:
    """Resolve the JWT signing key: env > persisted file > freshly generated.

    The generated key is written to `.secret_key` (gitignored) so tokens issued
    before a restart still verify afterwards. Never logged.
    """
    env_key = get_secret("PLATFORM_SECRET_KEY")
    if env_key:
        return env_key
    try:
        existing = _SECRET_KEY_FILE.read_text(encoding="utf-8").strip()
        if existing:
            return existing
    except OSError:
        pass
    generated = _secrets.token_urlsafe(48)
    try:
        _SECRET_KEY_FILE.write_text(generated, encoding="utf-8")
    except OSError:
        # If we can't persist (e.g. read-only fs), still run — sessions just
        # won't survive a restart. Don't crash the app over it.
        pass
    return generated


SECRET_KEY = _load_secret_key()


# --- User store (seeded with one admin; extensible) ------------------------
_DEV_ADMIN_EMAIL = "kristiyan.rusev@tiebreak.dev"


def _clean(value: str) -> str:
    """Strip whitespace and one layer of wrapping quotes from an env value.

    Pasting a bcrypt hash into a dashboard env field very often picks up a
    trailing newline or surrounding quotes; left in place those make passlib
    RAISE on verify — which verify_password swallows into a generic "invalid
    password", so a correct password mysteriously won't log in. Sanitizing on
    the way in removes that whole class of "I set the hash but can't log in" bugs.
    """
    return (value or "").strip().strip('"').strip("'").strip()


def _resolve_hash(credential: str) -> str:
    """A credential is either a bcrypt hash (used as-is) or a plaintext password
    (hashed now). Detection: bcrypt hashes start with the '$2' modular-crypt tag.
    Plaintext support lets users be managed in the env without the hash-paste trap."""
    c = _clean(credential)
    return c if c.startswith("$2") else _pwd.hash(c)


def _parse_users_env() -> dict[str, dict]:
    """Parse the PLATFORM_USERS env var into a {email: user} store.

    Format — one user per line (or ';'-separated), pipe-delimited fields:
        email|credential|role
    `credential` is a bcrypt hash ($2...) OR a plaintext password (hashed on
    load); `role` is 'admin' or 'user' (default 'user'). '|' is used because it
    never appears in emails, bcrypt hashes, or typical passwords. Blank/malformed
    entries are skipped and logged BY EMAIL ONLY (never the secret). Returns {}
    when PLATFORM_USERS is unset.

    Example:
        alice@acme.com|$2b$12$....|admin
        bob@acme.com|hunter2|user
    """
    raw = get_secret("PLATFORM_USERS") or ""
    out: dict[str, dict] = {}
    if not raw.strip():
        return out
    for record in re.split(r"[\n;]+", raw):
        record = record.strip()
        if not record:
            continue
        parts = record.split("|")
        email = _clean(parts[0]).lower() if parts else ""
        credential = parts[1] if len(parts) > 1 else ""
        role = _clean(parts[2]).lower() if len(parts) > 2 else ""
        if not email or not _clean(credential):
            log.warning("auth: skipping malformed PLATFORM_USERS entry for %r", email or "?")
            continue
        if role not in ("admin", "user", "copywriter"):
            role = "user"
        out[email] = {"email": email, "role": role, "password_hash": _resolve_hash(credential)}
    return out


def _seed_legacy_admin() -> dict[str, dict]:
    """The single admin from ADMIN_EMAIL + ADMIN_PASSWORD[_HASH] (back-compat).

    Returns {} when no password is configured behind TLS (prod): the caller then
    relies on PLATFORM_USERS, and fails closed if neither yields an admin. Local
    dev (no TLS) keeps the convenience 'parola' default.
    """
    email = (get_secret("ADMIN_EMAIL") or _DEV_ADMIN_EMAIL).strip().lower()
    pre_hashed = _clean(get_secret("ADMIN_PASSWORD_HASH") or "")
    if pre_hashed:
        if not pre_hashed.startswith("$2"):
            # Surface the most common misconfig in the logs without leaking the value.
            log.warning("auth: ADMIN_PASSWORD_HASH does not look like a bcrypt hash "
                        "(should start with '$2'); login will fail until it's corrected.")
        return {email: {"email": email, "role": "admin", "password_hash": pre_hashed}}
    plaintext = get_secret("ADMIN_PASSWORD")
    if plaintext:
        return {email: {"email": email, "role": "admin", "password_hash": _pwd.hash(plaintext)}}
    if settings.IS_PRODUCTION:
        return {}  # no weak default in prod — rely on PLATFORM_USERS / fail closed below
    log.warning("auth: using the INSECURE dev admin default (password 'parola'). "
                "Set ADMIN_PASSWORD_HASH + PLATFORM_ENV=production (or PLATFORM_COOKIE_SECURE=true) "
                "for any real deploy.")
    return {email: {"email": email, "role": "admin", "password_hash": _pwd.hash("parola")}}


def _seed_users() -> dict[str, dict]:
    """Module-level user store keyed by lowercased email.

    Combines the legacy single admin (ADMIN_EMAIL + ADMIN_PASSWORD[_HASH]) with
    any PLATFORM_USERS entries, which ADD to — and may override by email — the
    legacy admin, so a whole team can be managed from one env var. Fails closed in
    production if no admin is configured by either path.
    """
    users = _seed_legacy_admin()
    users.update(_parse_users_env())
    if settings.IS_PRODUCTION and not any(u["role"] == "admin" for u in users.values()):
        raise RuntimeError(
            "Refusing to start in production: configure an admin via ADMIN_PASSWORD_HASH "
            "(or ADMIN_PASSWORD), or a PLATFORM_USERS entry with role 'admin'."
        )
    return users


_USERS: dict[str, dict] = _seed_users()


def get_user(email: str) -> dict | None:
    return _USERS.get((email or "").strip().lower())


def list_role_users(role: str) -> list[dict]:
    """Env-store accounts with the given role — email + a display name.
    (SSO accounts live in the Supabase users table, queried separately.)"""
    return [{"email": u["email"], "name": u["email"].split("@")[0]}
            for u in _USERS.values() if u.get("role") == role]


def verify_password(plaintext: str, password_hash: str) -> bool:
    try:
        return _pwd.verify(plaintext, password_hash)
    except (ValueError, TypeError):
        return False


# --- Login throttle helpers ------------------------------------------------
def _client_ip(request: Request | None) -> str:
    """Best-effort client IP for the login throttle. Render sits directly in
    front of the app as the only reverse proxy, so it APPENDS the real peer
    address as the LAST hop of X-Forwarded-For; anything earlier in the list
    is attacker-supplied and untrustworthy (the first hop is exactly what a
    client would spoof to reset their own brute-force budget). Fall back to
    the socket peer if the header is absent."""
    if request is None:
        return "?"
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[-1].strip()
    return getattr(getattr(request, "client", None), "host", "") or "?"


def _login_key(request: Request | None, email: str) -> str:
    return f"{_client_ip(request)}|{(email or '').strip().lower()}"


def _login_throttled(key: str) -> bool:
    """True if this (ip, email) is over its failed-login budget. Prunes the window."""
    now = time.time()
    with _LOGIN_LOCK:
        dq = _LOGIN_FAILS.get(key)
        if not dq:
            return False
        while dq and now - dq[0] > _LOGIN_WINDOW:
            dq.popleft()
        if not dq:
            _LOGIN_FAILS.pop(key, None)
            return False
        return len(dq) >= _LOGIN_MAX_FAILS


def _record_login_fail(key: str) -> None:
    now = time.time()
    with _LOGIN_LOCK:
        dq = _LOGIN_FAILS.setdefault(key, deque())
        while dq and now - dq[0] > _LOGIN_WINDOW:
            dq.popleft()
        dq.append(now)


def _clear_login_fails(key: str) -> None:
    with _LOGIN_LOCK:
        _LOGIN_FAILS.pop(key, None)


# --- Tokens ----------------------------------------------------------------
def _issue_token(user: dict, extra: dict | None = None) -> str:
    now = int(time.time())
    payload = {
        "sub": user["email"],
        "role": user["role"],
        "iat": now,
        "exp": now + TOKEN_TTL_SECONDS,
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, SECRET_KEY, algorithm=JWT_ALG)


def _decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[JWT_ALG])
    except jwt.PyJWTError:
        return None


def _public_user(user: dict) -> dict:
    return {"email": user["email"], "role": user["role"]}


# --- Dependencies (route guards) -------------------------------------------
def require_user(session: str | None = Cookie(default=None)) -> dict:
    """Verify the session cookie and return the user dict, else 401.

    Two session kinds share the one cookie: password sessions resolve against
    the env-seeded store exactly as always; SSO sessions (claim sso=true)
    re-read role/access/sections from the Supabase users table through a short
    cache — role truth is the table, and a grant applies without re-login.
    """
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    claims = _decode_token(session)
    if not claims:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    if claims.get("sso"):
        from . import sso
        try:
            row = sso.profile(str(claims.get("uid") or ""))
        except LookupError:
            raise HTTPException(503, detail="Sign-in service is not configured.")
        except RuntimeError:
            raise HTTPException(503, detail="Sign-in service is unreachable — try again.")
        return sso.session_user(sso.gate(row))

    user = get_user(claims.get("sub", ""))
    if not user:
        raise HTTPException(status_code=401, detail="Unknown user")
    return _public_user(user)


def require_admin(user: dict = Depends(require_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def is_copywriter(user: dict) -> bool:
    """The text-only role: LP Builder on assigned pages, nothing else."""
    return (user or {}).get("role") == "copywriter"


def forbid_copywriter(user: dict = Depends(require_user)) -> dict:
    """Router gate for the tools outside the copywriter's scope."""
    if is_copywriter(user):
        raise HTTPException(status_code=403, detail="Not available for the copywriter role.")
    return user


# --- Router ----------------------------------------------------------------
def build_auth_router() -> APIRouter:
    """Public auth router mounted at /api/auth (no auth dependency)."""
    router = APIRouter(prefix="/api/auth", tags=["auth"])

    @router.post("/login")
    def login(request: Request, response: Response, payload: dict = Body(default={})):
        from . import sso as _sso
        if not _sso.password_login_allowed():
            # SSO is on and break-glass is not: the password door is closed.
            raise HTTPException(403, detail="Password sign-in is disabled — "
                                            "use your Microsoft work account.")
        email = (payload.get("email") or "").strip()
        password = payload.get("password") or ""
        key = _login_key(request, email)
        # Lockout: too many recent failures from this IP+email → refuse without
        # even checking the password, so credential stuffing can't grind on.
        if _login_throttled(key):
            time.sleep(_LOGIN_FAIL_DELAY)
            raise HTTPException(
                status_code=429,
                detail="Too many failed sign-in attempts. Please wait a few minutes and try again.",
            )
        user = get_user(email)
        # Always run one bcrypt-verify so an unknown email costs the same as a
        # wrong password — no timing signal to enumerate valid accounts.
        ok = verify_password(password, user["password_hash"] if user else _DUMMY_HASH)
        if not user or not ok:
            _record_login_fail(key)
            # Blunt brute force with a small fixed delay; never reveal which
            # half (email vs password) was wrong.
            time.sleep(_LOGIN_FAIL_DELAY)
            raise HTTPException(status_code=401, detail="Invalid email or password")

        _clear_login_fails(key)  # a good login resets the counter for this key
        token = _issue_token(user)
        response.set_cookie(
            key=COOKIE_NAME,
            value=token,
            httponly=True,
            samesite="lax",
            secure=settings.COOKIE_SECURE,  # True behind TLS (tunnel); see settings
            max_age=TOKEN_TTL_SECONDS,
            path="/",
        )
        return {"user": _public_user(user)}

    @router.get("/config")
    def auth_config():
        """Public: what the login screen should offer. All values are safe to
        ship to any browser (the publishable key is designed for it)."""
        from . import sso as _sso
        return _sso.config()

    @router.post("/sso-login")
    def sso_login(response: Response, payload: dict = Body(default={})):
        """Exchange a Supabase (Microsoft SSO) session for the builder's own
        cookie — once, at login. Pending users DO get a session: require_user
        gates them per request, so approval applies without re-login; the
        response tells the SPA to show the waiting screen meanwhile."""
        from . import sso as _sso
        if not _sso.enabled():
            raise HTTPException(404, detail="SSO is not enabled on this server.")
        token = (payload.get("access_token") or "").strip()
        if not token:
            raise HTTPException(422, detail="access_token is required.")
        try:
            ident = _sso.verify_access_token(token)
        except RuntimeError as e:
            raise HTTPException(503, detail=str(e))
        if not ident:
            raise HTTPException(401, detail="Microsoft sign-in could not be verified.")
        try:
            row = _sso.ensure_profile(ident["id"], ident["email"], ident["name"])
        except LookupError:
            raise HTTPException(503, detail="Sign-in service is not configured.")
        except RuntimeError as e:
            raise HTTPException(503, detail=str(e))
        _sso.invalidate(ident["id"])  # the freshest row on the first request

        user = _sso.session_user(row)
        token_out = _issue_token({"email": user["email"], "role": user["role"]},
                                 extra={"sso": True, "uid": ident["id"]})
        response.set_cookie(
            key=COOKIE_NAME,
            value=token_out,
            httponly=True,
            samesite="lax",
            secure=settings.COOKIE_SECURE,
            max_age=TOKEN_TTL_SECONDS,
            path="/",
        )
        pending = (row.get("access_status") or "pending") != "active" \
            or row.get("active") is False
        return {"user": user, "pending": pending}

    @router.post("/logout")
    def logout(response: Response):
        response.delete_cookie(key=COOKIE_NAME, path="/")
        return {"ok": True}

    @router.get("/me")
    def me(user: dict = Depends(require_user)):
        return {"user": user}

    return router


__all__ = ["require_user", "require_admin", "build_auth_router"]
