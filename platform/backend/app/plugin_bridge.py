"""Legacy staging shim for the retired Figma plugin.

A couple of legacy web tools (translate, creative summary) still call `record()`
to stage canvas ops and return a short code. The public, unauthenticated fetch
endpoints the Figma plugin used to read those ops have been REMOVED — the plugin
is retired and the anonymous bridge was an attack surface. `record()` is kept so
those tools keep returning without error; the staged ops are simply never read.
"""
from __future__ import annotations

import threading
import uuid

_LOCK = threading.Lock()
_BY_CODE: dict[str, dict] = {}
_LATEST_BY_FILE: dict[str, str] = {}
_ORDER: list[str] = []
_CAP = 500


def record(tool: str, file_key: str, ops: list, label: str = "") -> str:
    """Stage canvas ops for the plugin. Returns the short code the user enters in
    the plugin (or that the plugin auto-resolves via /latest by file key)."""
    code = uuid.uuid4().hex[:12].upper()
    rec = {"code": code, "tool": tool, "label": label or tool,
           "file_key": file_key or "", "ops": ops or []}
    with _LOCK:
        _BY_CODE[code] = rec
        _ORDER.append(code)
        if file_key:
            _LATEST_BY_FILE[file_key] = code
        while len(_ORDER) > _CAP:
            old = _ORDER.pop(0)
            _BY_CODE.pop(old, None)
    return code
