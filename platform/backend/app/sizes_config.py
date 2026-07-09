"""Team-managed banner size groups, bundles and custom sizes.

Powers three things:
  1. the size picker groups — ONE organization shared by the dashboard's left
     rail and the "Add sizes" picker in the banner detail view,
  2. one-click size *bundles* (e.g. "Standard bundle"),
  3. user-added CUSTOM sizes, kept in a dedicated "Custom sizes" group.

Persisted as ONE JSON file on the artifact disk (settings.ARTIFACT_ROOT), NOT
under backend config/ — the artifact disk is the mounted persistent disk on the
cloud deploy, so custom sizes and admin edits survive restarts and redeploys
exactly like the runs themselves.

Shape:
    {
      "groups":  [{"id": "...", "label": "Most used", "sizes": ["1200x674", ...]}, ...],
      "bundles": [{"id": "...", "label": "Standard bundle", "sizes": [...]}, ...]
    }
List order IS the display order — admins reorder by moving entries.

Routes (mounted under /api/tools/banner-builder by runs_router.build_router):
  GET  /size-config        (any logged-in user) -> full config + all known sizes
  POST /size-config/custom (any logged-in user) -> add ONE custom size
  PUT  /size-config        (admin)              -> replace groups + bundles
"""
from __future__ import annotations

import json
import logging
import threading
import uuid
from typing import Any, Dict, List

from fastapi import APIRouter, Body, Depends, HTTPException

from .auth import require_admin, require_user
from . import engine
from .settings import settings

log = logging.getLogger(__name__)

CUSTOM_GROUP_ID = "custom"
CUSTOM_GROUP_LABEL = "Custom sizes"

_MAX_GROUPS = 50
_MAX_BUNDLES = 20
_MAX_SIZES_PER_GROUP = 100
_MAX_LABEL = 60

# The team's master size sheet — the previous frontend-hardcoded organization,
# now the seed for the editable store (admins take it from here).
DEFAULT_GROUPS: List[Dict[str, Any]] = [
    {"id": "most-used", "label": "Most used",
     "sizes": ["1200x674", "1200x1200", "1200x800", "1200x628", "960x1200", "1080x1080", "1080x1920", "1440x1800"]},
    {"id": "meta", "label": "Meta · Facebook · Instagram",
     "sizes": ["1080x1080", "1080x1350", "1080x1920", "1200x628", "1440x1800"]},
    {"id": "x-twitter", "label": "X · Twitter", "sizes": ["1080x1080", "1200x628"]},
    {"id": "google-display", "label": "Google · Display",
     "sizes": ["1200x628", "1200x1200", "1200x300", "512x128", "600x600"]},
    {"id": "google-demand-gen", "label": "Google · Demand Gen",
     "sizes": ["1200x628", "1200x1200", "960x1200"]},
    {"id": "google-pmax", "label": "Google · Performance Max",
     "sizes": ["1200x628", "1200x1200", "1200x300", "960x1200"]},
    {"id": "google-app", "label": "Google · App", "sizes": ["1200x628", "1200x1500", "1200x1200"]},
    {"id": "google-search", "label": "Google · Search", "sizes": ["1200x1200", "1200x628"]},
    {"id": "google-youtube", "label": "Google · Video · YouTube",
     "sizes": ["1920x1080", "1080x1920", "1080x1080", "1280x720", "300x60"]},
    {"id": "snapchat", "label": "Snapchat", "sizes": ["1080x1920", "800x800", "720x1280"]},
    {"id": "taboola", "label": "Taboola", "sizes": ["1200x674"]},
    {"id": "outbrain", "label": "Outbrain", "sizes": ["1200x1200"]},
    {"id": "mgid", "label": "MGID", "sizes": ["1200x800"]},
    {"id": "adskeeper", "label": "AdsKeeper", "sizes": ["1200x800"]},
    {"id": "propellerads", "label": "PropellerAds", "sizes": ["1200x800"]},
    {"id": "criteo-display", "label": "Criteo · Display",
     "sizes": ["300x250", "728x90", "160x600", "300x600", "970x250", "320x50"]},
    {"id": "criteo-native", "label": "Criteo · Native", "sizes": ["600x600", "600x315", "600x500"]},
    {"id": CUSTOM_GROUP_ID, "label": CUSTOM_GROUP_LABEL, "sizes": []},
]

DEFAULT_BUNDLES: List[Dict[str, Any]] = [
    {"id": "standard", "label": "Standard bundle",
     "sizes": ["1200x1200", "1200x628", "960x1200"]},
]

_PATH = settings.ARTIFACT_ROOT / "config" / "sizes.json"
# RLock: the route handlers hold it across read-modify-write, and _load/_save
# re-acquire it internally.
_LOCK = threading.RLock()


# --- Storage ----------------------------------------------------------------
# The config is served from an in-memory CACHE (loaded from disk once, lazily)
# and every write updates the cache FIRST, then flushes to disk best-effort.
# This guarantees an admin's save takes effect immediately and consistently
# even if the disk flush fails — and the flush result is surfaced to the
# client (`persisted`) instead of silently re-reading a stale/missing file,
# which used to make a failed save look like an instant revert.
_CACHE: Dict[str, Any] = {}
_PERSIST_OK = True


def _defaults() -> Dict[str, Any]:
    return {
        "groups": [dict(g, sizes=list(g["sizes"])) for g in DEFAULT_GROUPS],
        "bundles": [dict(b, sizes=list(b["sizes"])) for b in DEFAULT_BUNDLES],
    }


def _load_disk() -> Dict[str, Any]:
    try:
        data = json.loads(_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return _defaults()
    if not isinstance(data, dict) or not isinstance(data.get("groups"), list):
        return _defaults()
    data.setdefault("bundles", [])
    return data


def _load() -> Dict[str, Any]:
    """The current config (cached; disk read only on first touch)."""
    with _LOCK:
        if not _CACHE:
            _CACHE.update(_load_disk())
        return {"groups": list(_CACHE["groups"]), "bundles": list(_CACHE.get("bundles") or [])}


def _save(cfg: Dict[str, Any]) -> bool:
    """Update the cache (always succeeds), then flush to disk. Returns whether
    the DISK write worked — callers surface that so a broken disk is a visible
    warning, never a silent revert."""
    global _PERSIST_OK
    with _LOCK:
        _CACHE.clear()
        _CACHE.update({"groups": list(cfg["groups"]), "bundles": list(cfg.get("bundles") or [])})
    try:
        _PATH.parent.mkdir(parents=True, exist_ok=True)
        _PATH.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
        _PERSIST_OK = True
    except OSError as e:  # config still works in-memory for this process
        log.error("sizes-config: could not persist %s: %s", _PATH, e)
        _PERSIST_OK = False
    return _PERSIST_OK


# --- Validation / coercion ----------------------------------------------------
def normalize_size(value: Any) -> str:
    """'1200 × 628' / '1200*628' / '1200X628' -> '1200x628' (not validated here)."""
    if not isinstance(value, str):
        return ""
    s = value.strip().lower().replace("×", "x").replace("*", "x")
    return "".join(s.split())


def _clean_sizes(values: Any, where: str) -> List[str]:
    """Normalize + validate + register a size list; raises 422 on a bad entry."""
    if not isinstance(values, list):
        raise HTTPException(status_code=422, detail=f"{where}: sizes must be a list")
    out: List[str] = []
    for v in values[:_MAX_SIZES_PER_GROUP]:
        s = normalize_size(v)
        if not s or s in out:
            continue
        ok, why = engine.ensure_size(s)
        if not ok:
            raise HTTPException(status_code=422, detail=f"{where}: '{s}' — {why}")
        out.append(s)
    return out


def _clean_label(value: Any, fallback: str = "") -> str:
    s = (value if isinstance(value, str) else "").strip()[:_MAX_LABEL]
    if not s and not fallback:
        raise HTTPException(status_code=422, detail="every group/bundle needs a label")
    return s or fallback


def register_known_sizes() -> None:
    """Register every stored size with the engine so custom sizes stay
    generatable after a restart (add-sizes / regenerate / new runs)."""
    cfg = _load()
    for coll in (cfg.get("groups") or []) + (cfg.get("bundles") or []):
        for s in coll.get("sizes") or []:
            if isinstance(s, str):
                engine.ensure_size(normalize_size(s))


def all_sizes() -> List[str]:
    """Every size offered anywhere (built-ins + registered customs)."""
    return engine.known_sizes()


def public_config() -> Dict[str, Any]:
    cfg = _load()
    groups = [
        {"id": str(g.get("id") or uuid.uuid4().hex), "label": str(g.get("label") or ""),
         "sizes": [s for s in (g.get("sizes") or []) if isinstance(s, str)]}
        for g in cfg.get("groups") or []
    ]
    bundles = [
        {"id": str(b.get("id") or uuid.uuid4().hex), "label": str(b.get("label") or ""),
         "sizes": [s for s in (b.get("sizes") or []) if isinstance(s, str)]}
        for b in cfg.get("bundles") or []
    ]
    return {
        "groups": groups,
        "bundles": bundles,
        "sizes": all_sizes(),
        "master_size": engine.MASTER_SIZE,
        "custom_group_id": CUSTOM_GROUP_ID,
        # Whether the LAST write reached the disk — false means changes hold for
        # this process but may be lost on restart (check the server logs).
        "persisted": _PERSIST_OK,
    }


# --- Router -------------------------------------------------------------------
def build_sizes_router() -> APIRouter:
    router = APIRouter()

    @router.get("/size-config")
    def get_config(_user: dict = Depends(require_user)):
        return public_config()

    @router.post("/size-config/custom")
    def add_custom_size(payload: dict = Body(default={}), _user: dict = Depends(require_user)):
        """Any logged-in user can add a custom size; it lands in the shared
        "Custom sizes" group so the whole team can reuse it."""
        size = normalize_size(payload.get("size"))
        if not size:
            raise HTTPException(status_code=422, detail="'size' is required (e.g. 500x500)")
        ok, why = engine.ensure_size(size)
        if not ok:
            raise HTTPException(status_code=422, detail=why)
        with _LOCK:
            cfg = _load()
            group = next((g for g in cfg["groups"] if g.get("id") == CUSTOM_GROUP_ID), None)
            if group is None:
                group = {"id": CUSTOM_GROUP_ID, "label": CUSTOM_GROUP_LABEL, "sizes": []}
                cfg["groups"].append(group)
            sizes = [s for s in (group.get("sizes") or []) if isinstance(s, str)]
            if size not in sizes:
                if len(sizes) >= _MAX_SIZES_PER_GROUP:
                    raise HTTPException(status_code=422,
                                        detail=f"the custom group is full ({_MAX_SIZES_PER_GROUP} sizes)")
                sizes.append(size)
                group["sizes"] = sizes
                _save(cfg)
        return {"size": size, **public_config()}

    @router.put("/size-config")
    def put_config(payload: dict = Body(default={}), _admin: dict = Depends(require_admin)):
        """Admin replaces the whole organization: groups (order = position) and
        bundles. Every size is validated and registered; the custom group is
        re-added (empty) if the payload dropped it."""
        groups_in = payload.get("groups")
        bundles_in = payload.get("bundles")
        if not isinstance(groups_in, list) or not isinstance(bundles_in, list):
            raise HTTPException(status_code=422, detail="'groups' and 'bundles' lists are required")
        if len(groups_in) > _MAX_GROUPS or len(bundles_in) > _MAX_BUNDLES:
            raise HTTPException(status_code=422,
                                detail=f"cap is {_MAX_GROUPS} groups / {_MAX_BUNDLES} bundles")
        groups: List[Dict[str, Any]] = []
        seen_ids: set = set()
        for i, g in enumerate(groups_in):
            if not isinstance(g, dict):
                raise HTTPException(status_code=422, detail=f"groups[{i}] must be an object")
            gid = str(g.get("id") or uuid.uuid4().hex)
            if gid in seen_ids:
                gid = uuid.uuid4().hex
            seen_ids.add(gid)
            label = _clean_label(g.get("label"),
                                 fallback=CUSTOM_GROUP_LABEL if gid == CUSTOM_GROUP_ID else "")
            groups.append({"id": gid, "label": label,
                           "sizes": _clean_sizes(g.get("sizes"), f"group '{label}'")})
        if not any(g["id"] == CUSTOM_GROUP_ID for g in groups):
            groups.append({"id": CUSTOM_GROUP_ID, "label": CUSTOM_GROUP_LABEL, "sizes": []})
        bundles: List[Dict[str, Any]] = []
        for i, b in enumerate(bundles_in):
            if not isinstance(b, dict):
                raise HTTPException(status_code=422, detail=f"bundles[{i}] must be an object")
            label = _clean_label(b.get("label"))
            sizes = _clean_sizes(b.get("sizes"), f"bundle '{label}'")
            if not sizes:
                raise HTTPException(status_code=422, detail=f"bundle '{label}' needs at least one size")
            bundles.append({"id": str(b.get("id") or uuid.uuid4().hex), "label": label, "sizes": sizes})
        with _LOCK:
            _save({"groups": groups, "bundles": bundles})
        return public_config()

    return router


# Custom sizes referenced by stored groups/bundles must be generatable in THIS
# process too (regenerate / add-sizes / new runs after a restart).
register_known_sizes()

__all__ = ["build_sizes_router", "public_config", "all_sizes", "normalize_size",
           "register_known_sizes", "CUSTOM_GROUP_ID"]
