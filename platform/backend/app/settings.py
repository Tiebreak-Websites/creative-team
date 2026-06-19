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
    # Vite dev server origins; override for a shared deployment. "null" lets the
    # Figma plugin's sandboxed iframe (Origin: null) reach the /api/plugin/* bridge.
    CORS_ORIGINS = [o.strip() for o in _env(
        "PLATFORM_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,null"
    ).split(",") if o.strip()]

    # --- Bundled Figma scripts (qa + translate, run as subprocesses) -------
    # The qa/translate scripts resolve their shared <base>/qa/.cache dir from
    # their own file location, so the qa/scripts + translate/scripts nesting
    # under this base must be preserved (see figma_scripts/).
    FIGMA_SCRIPTS_DIR = BACKEND_DIR / "figma_scripts"

    # --- Runtime artifacts -------------------------------------------------
    # Per-run working dirs (generated PNGs). Gitignored.
    ARTIFACT_ROOT = Path(_env("PLATFORM_ARTIFACT_DIR", str(BACKEND_DIR / ".runs")))

    # Hard ceiling on concurrent OpenAI image calls across ALL runs/users
    # (gpt-image-2 rate-limit headroom — mirrors run.py's default concurrency).
    OPENAI_CONCURRENCY = int(_env("PLATFORM_OPENAI_CONCURRENCY", "6"))

    # --- AI-assist (optional) ---------------------------------------------
    # Anthropic model for the creative-brief assist. Confirm the current id via
    # the /claude-api skill before trusting; overridable by env.
    BRIEF_MODEL = _env("PLATFORM_BRIEF_MODEL", "claude-sonnet-4-6")

    # Ordered .env search (mirrors the engine's ./ ../ ../../ ../../../ resolver).
    # Walking up several levels matters when running from a git worktree, where
    # the real .env lives at the main checkout root a few directories up.
    # os.environ always wins over any file.
    ENV_FILE_CANDIDATES = [
        *[base / ".env" for base in [REPO_ROOT, *list(REPO_ROOT.parents)[:3]]],
        Path.home() / ".env",
    ]


settings = Settings()
