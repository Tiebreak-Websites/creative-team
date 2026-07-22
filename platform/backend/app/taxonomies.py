"""Admin-managed taxonomy lists: Target Markets and Domains.

The Admin panel's small vocabularies, one screen each — the same shape the
language registry has had all along: a short ordered list, edited whole,
consumed by pickers elsewhere. Kept deliberately tiny:

  markets  [{code, label}]   e.g. {"code": "br", "label": "Brazil"}
  domains  [{domain, note}]  e.g. {"domain": "braintrade.com", "note": "main"}

Persistence follows the platform pattern exactly: in-memory list is
authoritative, JSON on the artifact disk (.runs/config/), mirrored to the
Supabase tables (`markets`, `domains`) via pgdb, merged back at startup so
every install shares one list and a fresh disk repopulates itself.
"""
from __future__ import annotations

import json
import logging
import re
import threading
from typing import Dict, List

from fastapi import APIRouter, Body, HTTPException

from . import pgdb
from .settings import settings

log = logging.getLogger(__name__)

_DIR = settings.ARTIFACT_ROOT / "config"
_MARKETS_PATH = _DIR / "markets.json"
_DOMAINS_PATH = _DIR / "domains.json"

_LOCK = threading.RLock()
_MARKETS: List[dict] = []
_DOMAINS: List[dict] = []

_CODE_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,23}$")
# Pragmatic hostname check: labels of letters/digits/hyphens, at least one dot.
_DOMAIN_RE = re.compile(
    r"^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$")

_MAX_ITEMS = 100


def markets() -> List[dict]:
    with _LOCK:
        return [dict(m) for m in _MARKETS]


def domains() -> List[dict]:
    with _LOCK:
        return [dict(d) for d in _DOMAINS]


def _flush(path, data) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2),
                        encoding="utf-8")
    except Exception:
        log.exception("taxonomies: could not write %s", path)


def _market_rows(items: List[dict]) -> List[dict]:
    return [{"code": m["code"], "label": m.get("label") or "", "sort_order": i}
            for i, m in enumerate(items)]


def _domain_rows(items: List[dict]) -> List[dict]:
    return [{"domain": d["domain"], "note": d.get("note") or "", "sort_order": i}
            for i, d in enumerate(items)]


def set_markets(items: List[dict]) -> List[dict]:
    with _LOCK:
        _MARKETS[:] = items
        _flush(_MARKETS_PATH, _MARKETS)
    pgdb.mirror_replace("markets", "code", _market_rows(items))
    return markets()


def set_domains(items: List[dict]) -> List[dict]:
    with _LOCK:
        _DOMAINS[:] = items
        _flush(_DOMAINS_PATH, _DOMAINS)
    pgdb.mirror_replace("domains", "domain", _domain_rows(items))
    return domains()


def _load_file(path) -> List[dict]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def rehydrate() -> None:
    """Disk first; then, with Supabase configured, union with the tables
    (db order wins, disk-only entries appended) and push the result — the
    same self-healing merge the language list gets."""
    with _LOCK:
        _MARKETS[:] = [m for m in _load_file(_MARKETS_PATH) if m.get("code")]
        _DOMAINS[:] = [d for d in _load_file(_DOMAINS_PATH) if d.get("domain")]

    if not pgdb.enabled():
        return
    try:
        db_m = sorted(pgdb.select_all("markets"), key=lambda r: r.get("sort_order") or 0)
        db_d = sorted(pgdb.select_all("domains"), key=lambda r: r.get("sort_order") or 0)
    except Exception:
        log.exception("taxonomies: could not read tables — using disk alone")
        return
    with _LOCK:
        have = {m["code"] for m in db_m if m.get("code")}
        merged_m = ([{"code": r["code"], "label": r.get("label") or ""}
                     for r in db_m if r.get("code")]
                    + [m for m in _MARKETS if m["code"] not in have])
        _MARKETS[:] = merged_m
        _flush(_MARKETS_PATH, _MARKETS)

        have_d = {d["domain"] for d in db_d if d.get("domain")}
        merged_d = ([{"domain": r["domain"], "note": r.get("note") or ""}
                     for r in db_d if r.get("domain")]
                    + [d for d in _DOMAINS if d["domain"] not in have_d])
        _DOMAINS[:] = merged_d
        _flush(_DOMAINS_PATH, _DOMAINS)
    pgdb.mirror_replace("markets", "code", _market_rows(merged_m))
    pgdb.mirror_replace("domains", "domain", _domain_rows(merged_d))
    if merged_m or merged_d:
        log.info("taxonomies: %d market(s), %d domain(s) (merged with Supabase)",
                 len(merged_m), len(merged_d))


# ---- router (mounted behind require_admin) ---------------------------------

def _clean_markets(payload: dict) -> List[dict]:
    items = payload.get("markets")
    if not isinstance(items, list):
        raise HTTPException(422, "markets must be a list")
    out, seen = [], set()
    for m in items[:_MAX_ITEMS]:
        code = str((m or {}).get("code") or "").strip().lower()
        label = str((m or {}).get("label") or "").strip()[:60]
        if not _CODE_RE.fullmatch(code):
            raise HTTPException(422, f"'{code or '?'}' is not a valid market code "
                                     "(lowercase letters/digits/hyphens).")
        if not label:
            raise HTTPException(422, f"Market '{code}' needs a label.")
        if code not in seen:
            seen.add(code)
            out.append({"code": code, "label": label})
    return out


def _clean_domains(payload: dict) -> List[dict]:
    items = payload.get("domains")
    if not isinstance(items, list):
        raise HTTPException(422, "domains must be a list")
    out, seen = [], set()
    for d in items[:_MAX_ITEMS]:
        dom = str((d or {}).get("domain") or "").strip().lower().rstrip(".")
        dom = re.sub(r"^https?://", "", dom).split("/")[0]  # tolerate pasted URLs
        note = str((d or {}).get("note") or "").strip()[:80]
        if not _DOMAIN_RE.fullmatch(dom):
            raise HTTPException(422, f"'{dom or '?'}' is not a valid domain name.")
        if dom not in seen:
            seen.add(dom)
            out.append({"domain": dom, "note": note})
    return out


def build_taxonomies_router() -> APIRouter:
    router = APIRouter(tags=["admin-taxonomies"])

    @router.get("/markets")
    def get_markets():
        return {"markets": markets()}

    @router.put("/markets")
    def put_markets(payload: dict = Body(default={})):
        return {"markets": set_markets(_clean_markets(payload))}

    @router.get("/domains")
    def get_domains():
        return {"domains": domains()}

    @router.put("/domains")
    def put_domains(payload: dict = Body(default={})):
        return {"domains": set_domains(_clean_domains(payload))}

    return router
