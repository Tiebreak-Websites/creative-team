"""Admin user management — the CreativeOPS model on the builder's own project.

The flow this administers: SSO first-login auto-provisions a `users` row as
`viewer` + `access_status='pending'` (the handle_new_user trigger), the person
is held at a pending gate, and an admin grants role, access and per-surface
sections here. Role truth is the table, never a JWT claim.

Routes are mounted behind require_admin. Everything proxies the Supabase
`users` table via the service key; with no keys configured the routes answer
424 + missing_secrets, the platform's standard dormant-feature shape.
"""
from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import supa

log = logging.getLogger(__name__)

ROLES = ("viewer", "user", "admin")
ACCESS = ("pending", "active")
# The builder's app surfaces — the vocabulary `users.sections` grants against.
SECTIONS = ("banners", "lps", "emails", "settings")


class UserPatch(BaseModel):
    role: Optional[str] = None
    access_status: Optional[str] = None
    active: Optional[bool] = None
    # null = role defaults; explicit list (even empty) is authoritative —
    # CreativeOPS semantics, kept identical on purpose.
    sections: Optional[List[str]] = None
    clear_sections: bool = False


def _missing() -> HTTPException:
    return HTTPException(424, detail={
        "missing_secrets": ["SUPABASE_URL", "SUPABASE_SERVICE_KEY"],
        "error": "User management activates once the Supabase keys are configured."})


def build_admin_users_router() -> APIRouter:
    router = APIRouter(tags=["admin-users"])

    @router.get("/users")
    def list_users():
        try:
            rows = supa.rest(
                "GET",
                "users?select=id,email,name,role,access_status,active,sections,created_at"
                "&order=created_at.desc")
        except LookupError:
            raise _missing()
        except RuntimeError as e:
            raise HTTPException(502, str(e))
        # Pending people first — they are the reason an admin opens this panel.
        rows = sorted(rows or [], key=lambda r: (r.get("access_status") != "pending",
                                                 str(r.get("name") or r.get("email") or "")))
        return {"users": rows, "sections": list(SECTIONS), "roles": list(ROLES)}

    @router.patch("/users/{uid}")
    def patch_user(uid: str, payload: UserPatch):
        fields: dict = {}
        if payload.role is not None:
            if payload.role not in ROLES:
                raise HTTPException(422, "Unknown role.")
            fields["role"] = payload.role
        if payload.access_status is not None:
            if payload.access_status not in ACCESS:
                raise HTTPException(422, "Unknown access status.")
            fields["access_status"] = payload.access_status
        if payload.active is not None:
            fields["active"] = bool(payload.active)
        if payload.clear_sections:
            fields["sections"] = None
        elif payload.sections is not None:
            bad = [s for s in payload.sections if s not in SECTIONS]
            if bad:
                raise HTTPException(422, f"Unknown section(s): {', '.join(bad)}")
            fields["sections"] = payload.sections
        if not fields:
            raise HTTPException(422, "Nothing to change.")
        try:
            rows = supa.rest("PATCH", f"users?id=eq.{uid}", fields)
        except LookupError:
            raise _missing()
        except RuntimeError as e:
            raise HTTPException(502, str(e))
        if not rows:
            raise HTTPException(404, "User not found.")
        # Grants and role changes take effect on the user's NEXT request, not
        # their next login — drop their cached profile.
        from . import sso
        sso.invalidate(uid)
        return rows[0]

    return router
