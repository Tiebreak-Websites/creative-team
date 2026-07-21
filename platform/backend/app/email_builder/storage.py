"""Supabase Storage backend for email images — Phase 1 of the migration.

When SUPABASE_URL + SUPABASE_SERVICE_KEY are configured, every new email
asset uploads to the public `email-assets` bucket and its value becomes the
full CDN URL. That kills two constraints at once: PLATFORM_PUBLIC_BASE_URL
(URLs are absolute by construction) and the app-served /e route for new
assets (the CDN serves them).

Without the secrets, everything behaves exactly as before — assets on the
Render disk behind /e. Same dormant-until-configured discipline as the
OpenAI and Tinify features, and the fallback also catches upload failures:
a storage hiccup must never cost someone their upload.

Existing disk assets are untouched; /e keeps serving them. New writes simply
land in the better place.
"""
from __future__ import annotations

import logging
import urllib.error
import urllib.request
from typing import Optional

from ..secrets import get_secret

log = logging.getLogger(__name__)

_BUCKET = "email-assets"
_TIMEOUT = 30

_MEDIA = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
}

# Idempotence cache: content-hashed names (logos, the placeholder) get
# re-materialised on every compose; one upload per process is plenty. Uploads
# use x-upsert, so a stale entry after a restart is harmless.
_uploaded: set = set()


def _config() -> Optional[tuple]:
    url = (get_secret("SUPABASE_URL") or "").strip().rstrip("/")
    key = (get_secret("SUPABASE_SERVICE_KEY") or "").strip()
    return (url, key) if url and key else None


def enabled() -> bool:
    return _config() is not None


def public_url(name: str) -> str:
    cfg = _config()
    return f"{cfg[0]}/storage/v1/object/public/{_BUCKET}/{name}" if cfg else name


def upload(name: str, data: bytes) -> Optional[str]:
    """Upload bytes as `name`; returns the public URL, or None on any failure
    so callers can fall back to the disk path."""
    cfg = _config()
    if not cfg:
        return None
    if name in _uploaded:
        return public_url(name)
    url, key = cfg
    ext = name[name.rfind("."):].lower()
    req = urllib.request.Request(
        f"{url}/storage/v1/object/{_BUCKET}/{name}",
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": _MEDIA.get(ext, "application/octet-stream"),
            "x-upsert": "true",
        })
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as r:
            r.read()
        _uploaded.add(name)
        return public_url(name)
    except urllib.error.HTTPError as e:
        log.error("supabase storage: %s uploading %s — %s", e.code, name,
                  e.read().decode("utf-8", "replace")[:200])
    except Exception:
        log.exception("supabase storage: upload failed for %s", name)
    return None
