"""Style-only reference images for the creative director.

A user can upload 1-4 images that the GPT-5.5 creative director treats as STYLE
reference ONLY — palette, composition, mood, lighting. Any text/copy in them is
ignored; the user's Title/subtitle/button always win (the director is instructed
so in creative_director.py, and we never OCR or extract copy here).

Storage is deliberately ephemeral: files land in a temp dir under the artifact
root and are addressed by an opaque id. Ids are validated to a strict charset so
they can never escape the references dir (no path traversal).
"""
from __future__ import annotations

import uuid
from pathlib import Path
from typing import List, Optional, Tuple

from .settings import settings

# Temp dir for uploaded reference images. Under the (gitignored) artifact root so
# it shares the same lifecycle / cleanup as run working dirs.
REFERENCES_DIR = settings.ARTIFACT_ROOT / "banner-builder" / "_references"

MAX_FILES = 4
MAX_BYTES = 8 * 1024 * 1024  # ~8MB per image

# Accepted upload content types -> stored file extension. JPEG/PNG/WebP only.
_CONTENT_TYPE_EXT = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
}
# Magic-byte sniff so a wrong/missing Content-Type can't smuggle a non-image
# through. (signature_prefix, ext); WebP needs the 'WEBP' tag at offset 8.
_MAGIC = [
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"\xff\xd8\xff", "jpg"),
]
_ALLOWED_EXT = {"png", "jpg", "jpeg", "webp"}


class ReferenceError(Exception):
    """A reference upload was rejected (bad type, too big, too many)."""


def _sniff_ext(data: bytes, content_type: str, filename: str) -> Optional[str]:
    """Resolve a safe file extension from magic bytes, then Content-Type, then
    filename. Returns None when the payload is not an accepted image."""
    for sig, ext in _MAGIC:
        if data.startswith(sig):
            return ext
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    ct = (content_type or "").split(";")[0].strip().lower()
    if ct in _CONTENT_TYPE_EXT:
        return _CONTENT_TYPE_EXT[ct]
    ext = (filename.rsplit(".", 1)[-1] if "." in (filename or "") else "").lower()
    if ext in _ALLOWED_EXT:
        return "jpg" if ext == "jpeg" else ext
    return None


def save_references(items: List[Tuple[bytes, str, str]]) -> List[str]:
    """Persist uploaded images; return their ids (filenames inside REFERENCES_DIR).

    `items` is a list of (data, content_type, filename). Raises ReferenceError on
    a count/size/type violation so the caller can map it to a 4xx.
    """
    if not items:
        raise ReferenceError("at least one image is required")
    if len(items) > MAX_FILES:
        raise ReferenceError(f"at most {MAX_FILES} images allowed")

    REFERENCES_DIR.mkdir(parents=True, exist_ok=True)
    ids: List[str] = []
    for data, content_type, filename in items:
        if not data:
            raise ReferenceError("empty file")
        if len(data) > MAX_BYTES:
            raise ReferenceError(f"image exceeds {MAX_BYTES // (1024 * 1024)}MB cap")
        ext = _sniff_ext(data, content_type, filename or "")
        if not ext:
            raise ReferenceError("unsupported image type (png, jpg, webp only)")
        ref_id = f"ref_{uuid.uuid4().hex}.{ext}"
        (REFERENCES_DIR / ref_id).write_bytes(data)
        ids.append(ref_id)
    return ids


def _is_safe_id(ref_id: str) -> bool:
    """Reject anything that isn't a plain ref_<hex>.<ext> token (no traversal)."""
    if not ref_id or "/" in ref_id or "\\" in ref_id or ".." in ref_id:
        return False
    return ref_id.startswith("ref_")


def resolve_paths(ids: List[str]) -> List[str]:
    """Map reference ids to existing file paths, dropping unknown/unsafe ids.

    Best-effort by design: a stale id (temp dir cleared, backend restarted)
    simply isn't returned, so a run degrades to "no references" rather than
    failing.
    """
    out: List[str] = []
    if not ids:
        return out
    for ref_id in ids:
        if not isinstance(ref_id, str) or not _is_safe_id(ref_id):
            continue
        p = REFERENCES_DIR / ref_id
        if p.is_file():
            out.append(str(p))
    return out


__all__ = [
    "save_references", "resolve_paths", "ReferenceError",
    "REFERENCES_DIR", "MAX_FILES", "MAX_BYTES",
]
