"""Secret resolution for the backend.

Mirrors the banner engine's ordered .env search so the team has ONE mental
model: the process environment wins, then the first .env file (in order) that
defines the key. Values are NEVER logged — only their presence is.
"""
import os
from functools import lru_cache
from pathlib import Path

from .settings import settings


def _parse_env_file(path: Path) -> dict:
    out: dict = {}
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return out
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in out:
            out[key] = val
    return out


@lru_cache(maxsize=1)
def _file_env() -> dict:
    """Merge the candidate .env files; first file to define a key wins."""
    merged: dict = {}
    for candidate in settings.ENV_FILE_CANDIDATES:
        for k, v in _parse_env_file(candidate).items():
            merged.setdefault(k, v)
    return merged


def get_secret(name: str):
    """Return the secret value or None. os.environ wins over .env files."""
    v = os.environ.get(name)
    if v:
        return v
    return _file_env().get(name)


def has_secret(name: str) -> bool:
    return bool(get_secret(name))
