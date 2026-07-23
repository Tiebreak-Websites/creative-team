"""The Ready-for-Design work queue, shared by the Banner and LP builders.

ONE assembly for the Creative-Board pull so the two strips can't drift: items
at the ready status, filtered to the asset types a builder handles, matched to
builder vocabulary (brand_id / language / sizes), owner-scoped via the Monday
person linked to the signed-in account (Admin › Users), and carrying the
Monday Priority label + colour for the chip tint.

Each builder chooses its slice:
  banner  wanted={banner, landing page}, require_sizes=True — a banner request
          is real work only once the Banner Sizes column says what to build
  lp      wanted={landing page, prelander}, require_sizes=False
"""
from __future__ import annotations

import re
from typing import List, Optional, Set

from fastapi import HTTPException

_SIZE_RE = re.compile(r"(\d{2,4})\s*[x×]\s*(\d{2,4})")


def parse_sizes(text: str) -> List[str]:
    """Pull sizes out of the Monday Banner-Sizes column, whatever its
    separators — "300x250, 728x90", "300 x 250 / 160x600", a dropdown's joined
    labels. Two vocabularies are understood:

      WxH values      normalised to "WxH"
      bundle labels   the builder's own size bundles ("Standard bundle", plus
                      any admin-created ones) expand to their sizes — so the
                      Monday dropdown can carry the label the team already uses

    Order-preserving (explicit sizes first, then bundle expansions),
    de-duplicated."""
    out: List[str] = []
    seen = set()
    for w, h in _SIZE_RE.findall(text or ""):
        s = f"{int(w)}x{int(h)}"
        if s not in seen:
            seen.add(s)
            out.append(s)
    low = (text or "").lower()
    if low:
        from . import sizes_config
        for b in sizes_config.public_config().get("bundles") or []:
            label = str(b.get("label") or "").strip().lower()
            if label and label in low:
                for s in b.get("sizes") or []:
                    if s not in seen:
                        seen.add(s)
                        out.append(s)
    return out


def build_queue(user: dict, scope: str, wanted: Set[str],
                require_sizes: bool = False,
                exclude_ids: Optional[Set[str]] = None) -> dict:
    """Creative-Board items at "Ready for Design" for one builder.

    scope="mine" (default posture) narrows to tasks the signed-in user owns on
    Monday, resolved via the Monday person linked to their account in
    Admin › Users; "all" shows the whole queue. An unlinked user always gets
    the full list (there's no id to filter on) with linked=false, so the UI
    can nudge them to set the link. Raises the platform's 424 dormant shape
    until the Monday env exists.
    """
    from . import monday
    from . import brands as brands_mod
    from .lp_builder import core as lp_core
    if not monday.configured():
        raise HTTPException(424, detail={
            "missing_secrets": ["MONDAY_API_TOKEN"],
            "error": "The Monday integration activates once MONDAY_API_TOKEN is configured."})
    board = monday.creative_board_id()
    if not board:
        raise HTTPException(424, detail={
            "missing_secrets": ["MONDAY_BOARD_CCB_PARENT"],
            "error": "Set MONDAY_BOARD_CCB_PARENT to the Creative Board id."})
    status = monday.creative_ready_status()
    try:
        items = monday.items_at_status(status, board=board)
    except RuntimeError as e:
        raise HTTPException(502, str(e))
    langs = lp_core.languages() or lp_core.DEFAULT_LANGS
    brands = brands_mod.list_brands()
    mine_id = str(user.get("monday_user_id") or "").strip()
    linked = bool(mine_id)
    all_tasks, mine_tasks = [], []
    for it in items:
        if (it.get("asset_type") or "").strip().lower() not in wanted:
            continue
        # A task already turned into an asset leaves the queue (the asset
        # carries its Monday id) — offering to start it twice invites dupes.
        if exclude_ids and str(it.get("id") or "") in exclude_ids:
            continue
        sizes = parse_sizes(it.get("sizes") or "")
        if require_sizes and not sizes:
            continue
        owned = mine_id in (it.get("owner_ids") or [])
        task = {"item": {
            "id": it.get("id"), "name": it.get("name"), "url": it.get("url"),
            "asset_type": it.get("asset_type") or "",
            "brand": it.get("brand") or "", "language": it.get("language") or "",
            "market": it.get("market") or "", "brief": it.get("brief") or "",
            "figma_url": it.get("figma_url") or "", "deadline": it.get("deadline") or "",
            "owner": it.get("owner") or "",
            "priority": it.get("priority") or "", "priority_color": it.get("priority_color") or "",
        }, "match": {
            "brand_id": monday.match_brand(it.get("brand") or "", brands),
            "language": monday.match_language(it.get("language") or "", langs),
            "sizes": sizes,
            "asset_type": it.get("asset_type") or "",
        }}
        all_tasks.append(task)
        if owned:
            mine_tasks.append(task)
    show_mine = scope != "all" and linked
    return {"tasks": mine_tasks if show_mine else all_tasks, "status": status,
            "scope": "mine" if show_mine else "all", "linked": linked,
            "mine_count": len(mine_tasks) if linked else 0,
            "all_count": len(all_tasks)}


__all__ = ["build_queue", "parse_sizes"]
