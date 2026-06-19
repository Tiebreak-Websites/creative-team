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

import secrets as _secrets
import time
from datetime import datetime, timezone

import jwt
from fastapi import APIRouter, Body, Cookie, Depends, HTTPException, Response
from passlib.context import CryptContext

from .secrets import get_secret
from .settings import BACKEND_DIR

# --- Tunables --------------------------------------------------------------
TOKEN_TTL_SECONDS = 8 * 60 * 60  # ~8h sessions
COOKIE_NAME = "session"
JWT_ALG = "HS256"
_LOGIN_FAIL_DELAY = 0.4  # blunt brute force; constant-ish small delay on 401

_SECRET_KEY_FILE = BACKEND_DIR / ".secret_key"

# bcrypt via passlib; verify is constant-time.
_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")


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
def _seed_users() -> dict[str, dict]:
    """Module-level user store keyed by lowercased email.

    Seeds exactly one admin from env. Accepts a pre-hashed `ADMIN_PASSWORD_HASH`
    (preferred for shared deploys) or hashes `ADMIN_PASSWORD` at import time.
    """
    email = (get_secret("ADMIN_EMAIL") or "kristiyan.rusev@tiebreak.dev").strip().lower()
    pre_hashed = get_secret("ADMIN_PASSWORD_HASH")
    if pre_hashed:
        pw_hash = pre_hashed
    else:
        plaintext = get_secret("ADMIN_PASSWORD") or "parola"
        pw_hash = _pwd.hash(plaintext)
    return {
        email: {"email": email, "role": "admin", "password_hash": pw_hash},
    }


_USERS: dict[str, dict] = _seed_users()


def get_user(email: str) -> dict | None:
    return _USERS.get((email or "").strip().lower())


def verify_password(plaintext: str, password_hash: str) -> bool:
    try:
        return _pwd.verify(plaintext, password_hash)
    except (ValueError, TypeError):
        return False


# --- Tokens ----------------------------------------------------------------
def _issue_token(user: dict) -> str:
    now = int(time.time())
    payload = {
        "sub": user["email"],
        "role": user["role"],
        "iat": now,
        "exp": now + TOKEN_TTL_SECONDS,
    }
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
    """Verify the session cookie and return the user dict, else 401."""
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    claims = _decode_token(session)
    if not claims:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    user = get_user(claims.get("sub", ""))
    if not user:
        raise HTTPException(status_code=401, detail="Unknown user")
    return _public_user(user)


def require_admin(user: dict = Depends(require_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# --- Router ----------------------------------------------------------------
def build_auth_router() -> APIRouter:
    """Public auth router mounted at /api/auth (no auth dependency)."""
    router = APIRouter(prefix="/api/auth", tags=["auth"])

    @router.post("/login")
    def login(response: Response, payload: dict = Body(default={})):
        email = (payload.get("email") or "").strip()
        password = payload.get("password") or ""
        user = get_user(email)
        if not user or not verify_password(password, user["password_hash"]):
            # Blunt brute force with a small fixed delay; never reveal which
            # half (email vs password) was wrong.
            time.sleep(_LOGIN_FAIL_DELAY)
            raise HTTPException(status_code=401, detail="Invalid email or password")

        token = _issue_token(user)
        response.set_cookie(
            key=COOKIE_NAME,
            value=token,
            httponly=True,
            samesite="lax",
            secure=False,  # localhost over http; flip to True behind TLS
            max_age=TOKEN_TTL_SECONDS,
            path="/",
        )
        return {"user": _public_user(user)}

    @router.post("/logout")
    def logout(response: Response):
        response.delete_cookie(key=COOKIE_NAME, path="/")
        return {"ok": True}

    @router.get("/me")
    def me(user: dict = Depends(require_user)):
        return {"user": user}

    return router


__all__ = ["require_user", "require_admin", "build_auth_router"]
