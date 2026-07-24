"""Floating suggestions / bug-report widget (all tools).

One JSON store on the durable artifact disk. Every user has their own thread
(they only ever see their own messages); admins see everything and flip a
checkmark when an idea ships — the "Implemented" state shows up next to the
message in the author's view.
"""
from __future__ import annotations

import datetime
import json
import logging
import threading
import uuid
from typing import List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException

from .auth import require_user
from .settings import settings

log = logging.getLogger(__name__)

_DIR = settings.ARTIFACT_ROOT / "feedback"
_PATH = _DIR / "messages.json"
_LOCK = threading.Lock()
_MSGS: Optional[List[dict]] = None
_MAX_TEXT = 2000
_MAX_MSGS = 5000  # oldest drop off; this is a suggestion box, not an archive


def _load() -> List[dict]:
    global _MSGS
    if _MSGS is None:
        try:
            data = json.loads(_PATH.read_text("utf-8"))
            _MSGS = data if isinstance(data, list) else []
        except FileNotFoundError:
            _MSGS = []
        except Exception as e:  # noqa: BLE001 — corrupted store must not kill the app
            log.warning("feedback: could not read store (%s) — starting empty", e)
            _MSGS = []
    return _MSGS


def _persist() -> None:
    try:
        _DIR.mkdir(parents=True, exist_ok=True)
        tmp = _PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(_MSGS, ensure_ascii=False), "utf-8")
        tmp.replace(_PATH)
    except Exception as e:  # noqa: BLE001
        log.warning("feedback: persist failed: %s", e)


def _now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def build_feedback_router() -> APIRouter:
    router = APIRouter()

    @router.get("")
    def list_feedback(user: dict = Depends(require_user)):
        is_admin = (user or {}).get("role") == "admin"
        with _LOCK:
            msgs = list(_load())
        if not is_admin:
            email = ((user or {}).get("email") or "").lower()
            msgs = [m for m in msgs if m.get("email") == email]
        # Normalize old records that predate replies so the UI can rely on the shape.
        msgs = [{**m, "replies": m.get("replies") or []} for m in msgs]
        return {"messages": msgs, "admin": is_admin}

    @router.post("", status_code=201)
    def post_feedback(payload: dict = Body(default={}), user: dict = Depends(require_user)):
        text = str(payload.get("text") or "").strip()[:_MAX_TEXT]
        if not text:
            raise HTTPException(status_code=422, detail="write something first")
        msg = {
            "id": uuid.uuid4().hex[:12],
            "email": ((user or {}).get("email") or "").lower(),
            "text": text,
            "created_at": _now(),
            "status": "open",
            "done_at": None,
            "replies": [],
        }
        with _LOCK:
            msgs = _load()
            msgs.append(msg)
            del msgs[:-_MAX_MSGS]
            _persist()
        return msg

    @router.patch("/{mid}")
    def set_status(mid: str, payload: dict = Body(default={}), user: dict = Depends(require_user)):
        """Admin checkmark: open <-> done ("Implemented")."""
        if (user or {}).get("role") != "admin":
            raise HTTPException(status_code=403, detail="admins only")
        status = "done" if payload.get("status") == "done" else "open"
        with _LOCK:
            msgs = _load()
            m = next((x for x in msgs if x.get("id") == mid), None)
            if m is None:
                raise HTTPException(status_code=404, detail="message not found")
            m["status"] = status
            m["done_at"] = _now() if status == "done" else None
            _persist()
        return m

    @router.post("/{mid}/reply", status_code=201)
    def reply(mid: str, payload: dict = Body(default={}), user: dict = Depends(require_user)):
        """Answer a suggestion. Admins can answer any thread; the original author
        can reply within their own — so it reads as a two-way chat. The author
        always sees admin answers in their thread."""
        is_admin = (user or {}).get("role") == "admin"
        email = ((user or {}).get("email") or "").lower()
        text = str(payload.get("text") or "").strip()[:_MAX_TEXT]
        if not text:
            raise HTTPException(status_code=422, detail="write a reply first")
        with _LOCK:
            msgs = _load()
            m = next((x for x in msgs if x.get("id") == mid), None)
            if m is None:
                raise HTTPException(status_code=404, detail="message not found")
            if not is_admin and m.get("email") != email:
                raise HTTPException(status_code=403, detail="you can only reply in your own thread")
            m.setdefault("replies", []).append(
                {"by": email, "text": text, "at": _now(), "admin": is_admin})
            _persist()
        return m

    return router
