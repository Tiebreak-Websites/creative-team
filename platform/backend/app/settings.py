"""Env-driven configuration for the platform backend.

Local-first defaults (localhost), but every value is env-overridable so a shared
deployment is a config change, not a code change. No secrets live here — those
are resolved lazily at run time by secrets.py and never stored on disk.
"""
import os
from pathlib import Path

# platform/backend/app/settings.py -> repo root is 4 parents up:
#   app -> backend -> platform -> <repo root>
APP_DIR = Path(__file__).resolve().parent
BACKEND_DIR = APP_DIR.parent
PLATFORM_DIR = BACKEND_DIR.parent
REPO_ROOT = PLATFORM_DIR.parent


def _env(name: str, default: str) -> str:
    v = os.environ.get(name)
    return v if v not in (None, "") else default


class Settings:
    # --- Network -----------------------------------------------------------
    HOST = _env("PLATFORM_HOST", "127.0.0.1")
    PORT = int(_env("PLATFORM_PORT", "8000"))
    # Vite dev-server origins for local work. In production the backend serves the
    # SPA itself (single origin), so no cross-origin browser access is needed and
    # the list is intentionally minimal — no "null", no wildcard.
    CORS_ORIGINS = [o.strip() for o in _env(
        "PLATFORM_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",") if o.strip()]

    # Behind TLS (a Cloudflare Tunnel / any HTTPS reverse proxy) the session
    # cookie must be Secure or browsers drop it. Local http dev keeps it False
    # so the cookie still sets over plain localhost. Set true on a deploy.
    COOKIE_SECURE = _env("PLATFORM_COOKIE_SECURE", "false").lower() in ("1", "true", "yes", "on")

    # Production detection for auth hardening — INDEPENDENT of the cookie flag so
    # a deploy that forgets PLATFORM_COOKIE_SECURE is still protected. True when
    # PLATFORM_ENV says so OR TLS cookies are on. In production the weak 'parola'
    # dev admin is refused, the app fails closed without a real admin, and the
    # API docs default off. Local dev (neither set) stays zero-config.
    ENV = _env("PLATFORM_ENV", "dev").strip().lower()
    IS_PRODUCTION = COOKIE_SECURE or ENV in ("prod", "production", "staging")

    # Interactive API docs (/docs, /redoc, /openapi.json). Handy locally; OFF by
    # default in production so an anonymous visitor only sees the login page.
    ENABLE_DOCS = _env(
        "PLATFORM_DOCS", "false" if IS_PRODUCTION else "true"
    ).lower() in ("1", "true", "yes", "on")

    # --- Built frontend (single-origin deploy) -----------------------------
    # Vite `npm run build` output. When this dir exists the backend serves the
    # React SPA itself, so the whole app is one origin: one tunnel route, the
    # session cookie is first-party, and no CORS is needed. In local dev the
    # dist usually doesn't exist and Vite (:5173) serves the UI instead.
    FRONTEND_DIST = Path(_env(
        "PLATFORM_FRONTEND_DIST", str(PLATFORM_DIR / "frontend" / "dist")
    ))

    # --- Runtime artifacts -------------------------------------------------
    # Per-run working dirs (generated PNGs). Gitignored.
    ARTIFACT_ROOT = Path(_env("PLATFORM_ARTIFACT_DIR", str(BACKEND_DIR / ".runs")))

    # Hard ceiling on concurrent OpenAI image calls across ALL runs/users
    # (gpt-image-2 rate-limit headroom — mirrors run.py's default concurrency).
    OPENAI_CONCURRENCY = int(_env("PLATFORM_OPENAI_CONCURRENCY", "6"))

    # Per-image read timeout (seconds) + retry count. High-quality gpt-image-2
    # renders (especially recompose/edit) routinely run past the old 180s default,
    # surfacing as "gen_http_error: read operation timed out". 300s + a couple of
    # retries covers them; both are env-overridable.
    OPENAI_IMAGE_TIMEOUT = int(_env("PLATFORM_OPENAI_TIMEOUT", "300"))
    OPENAI_IMAGE_MAX_RETRIES = int(_env("PLATFORM_OPENAI_MAX_RETRIES", "3"))

    # GPT-5.5 creative-director (the "thinking" pass) read timeout (seconds). An
    # "xhigh"/Extended reasoning pass can run minutes; the old 150s default made it
    # silently fall back to the template brief. 300s lets High finish; raise for xhigh.
    DIRECTOR_TIMEOUT = int(_env("PLATFORM_DIRECTOR_TIMEOUT", "300"))

    # Ordered .env search (mirrors the engine's ./ ../ ../../ ../../../ resolver).
    # Walking up several levels matters when running from a git worktree, where
    # the real .env lives at the main checkout root a few directories up.
    # os.environ always wins over any file.
    ENV_FILE_CANDIDATES = [
        *[base / ".env" for base in [REPO_ROOT, *list(REPO_ROOT.parents)[:3]]],
        Path.home() / ".env",
    ]


settings = Settings()
