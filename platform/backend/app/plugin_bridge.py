"""Bridge between web-tool runs and the companion Figma plugin.

A web tool run produces `figma_ops` (canvas operations it can't perform itself —
the Figma REST API can't write to the canvas). The backend stages those ops here
keyed by a short code (and the file key); the Figma plugin — running inside the
user's Figma file — fetches them and applies them to the canvas.

CORS for the plugin's sandboxed iframe (Origin: "null") is handled by the app's
CORSMiddleware, which allows "null" (see settings.CORS_ORIGINS).
"""
from __future__ import annotations

import threading
import uuid

from fastapi import APIRouter, Body, HTTPException

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


def build_plugin_router() -> APIRouter:
    r = APIRouter(prefix="/api/plugin", tags=["plugin"])

    @r.post("/stage")
    def stage(payload: dict = Body(default={})):
        code = record(payload.get("tool") or "", (payload.get("file_key") or "").strip(),
                      payload.get("ops") or [], payload.get("label") or "")
        return {"code": code}

    @r.get("/ops/{code}")
    def get_ops(code: str):
        with _LOCK:
            rec = _BY_CODE.get(code.strip().upper())
        if not rec:
            raise HTTPException(status_code=404, detail="not found")
        return rec

    @r.get("/latest")
    def latest(file_key: str = ""):
        with _LOCK:
            c = _LATEST_BY_FILE.get(file_key.strip())
            rec = _BY_CODE.get(c) if c else None
        if not rec:
            raise HTTPException(status_code=404, detail="none staged for this file")
        return rec

    return r
