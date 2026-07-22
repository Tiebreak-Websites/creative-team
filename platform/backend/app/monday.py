"""Monday.com pull integration — the builder asks Monday directly.

The Monday bridge has two directions with two different transports, on purpose:

  PULL (this module)  — a person is sitting in the create dialog waiting for
      the answer, so the builder asks Monday's GraphQL API synchronously with
      MONDAY_API_TOKEN. Routing this through n8n would add latency, a second
      secret and a hand-built workflow as a hard dependency — for zero gain.
  PUSH (events.py)    — state changes stream to n8n, which owns updating
      Monday statuses, notifications and any other automation. Asynchronous,
      retryable, and exactly what n8n is for.

Column mapping is by TITLE, not column id: titles ("Brand", "Languages",
"Layout #") are the stable vocabulary, while ids like dropdown0__1 are minted
fresh per board. The email builder's home board is CRM Tasks
(MONDAY_BOARD_CRM) — search and the ready-for-design list are scoped to it;
fetch-by-ID works for any item the token can see.

The workflow this feeds: production starts at the DESIGN stage. A task whose
Status hits "Ready for design" is the signal to build it here — it surfaces
in the builder under its brand, and one click creates the campaign carrying
the task's name, brand, layout label and language list. This module only
READS Monday; nothing here mutates the board.

Dormant until MONDAY_API_TOKEN is configured — callers get LookupError and
translate it to the platform's 424 + missing_secrets shape.
"""
from __future__ import annotations

import json
import logging
import re
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional

from .secrets import get_secret

log = logging.getLogger(__name__)

_API = "https://api.monday.com/v2"
_TIMEOUT = 20

# Board-column titles → our field names. Lowercased, punctuation collapsed.
# Covers the CRM Tasks board plus the Creative Board's older vocabulary, so
# fetch-by-ID stays useful across both.
_TITLE_MAP = {
    "status": "status",
    "sub status": "status",             # CRM subitems call it Sub-Status
    "priority": "priority",
    "type": "type",
    "asset type": "asset_type",
    "project type": "asset_type",
    "brand": "brand",
    "target brand": "brand",
    "label": "label",
    "labels": "label",                  # Marketing calendar pluralizes it
    "white label": "white_label",
    "language": "language",
    "languages": "languages",           # multi-select; text is comma-joined
    "base segment": "segment",
    "segment description": "segment_note",
    "creative types": "creative_types",
    "final content": "final_content",
    "additional comments materials": "brief",
    "figma links": "figma_url",
    "layout": "layout_label",           # "Layout #" squashes to "layout"
    "target market": "market",
    "deadline": "deadline",
    "due date": "deadline",
    "project start date": "start_date",
    "brief details": "brief",
    "description": "brief",
    "topic": "topic",
    "title": "topic",
    "figma url": "figma_url",
    "landing page url": "lp_url",
    "requestor": "requestor",
    "owner": "owner",
    "campaign owner": "owner",
}

# Monday's language labels/codes that don't literally equal the builder's.
_LANG_ALIASES = {
    "spanish latam": "spanish",
    "latam": "spanish",
    "malaysian": "malay",
    "thailand": "thai",
    "swe": "swedish",
    "nor": "norwegian",
    "jp": "japanese",
    "cn": "chinese",
}

# Monday brand labels → builder brand names, squashed-alphanumeric form.
_BRAND_ALIASES = {
    "wbs": "warrenbowieandsmith",
    "financero": "finansero",          # Marketing calendar spells it with a c
    "digitalspearhead": "dgsh",
}


def configured() -> bool:
    return bool((get_secret("MONDAY_API_TOKEN") or "").strip())


def crm_board_id() -> str:
    return (get_secret("MONDAY_BOARD_CRM") or "").strip()


def _gql(query: str, variables: Optional[dict] = None) -> dict:
    token = (get_secret("MONDAY_API_TOKEN") or "").strip()
    if not token:
        raise LookupError("MONDAY_API_TOKEN")
    req = urllib.request.Request(
        _API,
        data=json.dumps({"query": query, "variables": variables or {}}).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json",
                 "Authorization": token,
                 "API-Version": "2024-10"})
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as r:
            out = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        log.error("monday: HTTP %s %s", e.code, detail)
        raise RuntimeError(f"Monday API request failed (HTTP {e.code}).")
    except Exception as e:
        raise RuntimeError(f"Monday API request failed: {e}")
    if out.get("errors"):
        msg = "; ".join(str(x.get("message") or x) for x in out["errors"])[:300]
        log.error("monday: GraphQL errors: %s", msg)
        raise RuntimeError(f"Monday API error: {msg}")
    return out.get("data") or {}


def _squash(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", " ", (s or "").lower()).strip()


_COLS = """
    column_values {
      text type
      column { title }
      ... on BoardRelationValue { display_value }
    }"""


def _norm_cols(item: dict) -> Dict[str, str]:
    """Flatten column_values into our field names, by column title."""
    out: Dict[str, str] = {}
    for cv in item.get("column_values") or []:
        title = re.sub(r"\s+", " ", _squash((cv.get("column") or {}).get("title") or ""))
        field = _TITLE_MAP.get(title)
        if not field:
            continue
        # board_relation columns carry names in display_value, not text
        val = (cv.get("text") or cv.get("display_value") or "").strip()
        if val:
            out[field] = val
    return out


def _norm_item(item: dict, *, with_subitems: bool = True) -> dict:
    out = {"id": str(item.get("id") or ""),
           "name": item.get("name") or "",
           "url": item.get("url") or "",
           "board": ((item.get("board") or {}).get("name") or ""),
           "group": ((item.get("group") or {}).get("title") or "")}
    out.update(_norm_cols(item))
    if with_subitems:
        subs = []
        for s in item.get("subitems") or []:
            sub = {"id": str(s.get("id") or ""), "name": s.get("name") or ""}
            sub.update({k: v for k, v in _norm_cols(s).items()
                        if k in ("status", "language", "brand", "asset_type", "topic")})
            subs.append(sub)
        if subs:
            out["subitems"] = subs
    return out


def get_item(item_id: str) -> Optional[dict]:
    """One item with everything the builder cares about, or None."""
    q = f"""query ($ids: [ID!]) {{
      items (ids: $ids) {{
        id name url
        board {{ name }}
        group {{ title }}
        {_COLS}
        subitems {{ id name {_COLS} }}
      }}
    }}"""
    items = _gql(q, {"ids": [str(item_id)]}).get("items") or []
    return _norm_item(items[0]) if items else None


def search(term: str, limit: int = 8) -> List[dict]:
    """Name search on the CRM Tasks board — light rows for a picker list."""
    board = crm_board_id()
    if not board:
        return []
    q = f"""query ($board: [ID!], $limit: Int!, $term: CompareValue!) {{
      boards (ids: $board) {{
        items_page (limit: $limit, query_params: {{
          rules: [{{column_id: "name", compare_value: $term, operator: contains_text}}]
        }}) {{
          items {{ id name url group {{ title }} {_COLS} }}
        }}
      }}
    }}"""
    boards = _gql(q, {"board": [board], "limit": limit, "term": term}).get("boards") or []
    items = ((boards[0].get("items_page") or {}).get("items") or []) if boards else []
    return [_norm_item(i, with_subitems=False) for i in items]


def ready_status() -> str:
    """The Status label that means "start building this in the builder" —
    board-specific, so it is configuration, not code. The Marketing calendar
    uses lifecycle statuses; Planned is where upcoming campaigns wait for
    their creatives."""
    return (get_secret("MONDAY_READY_STATUS") or "Planned").strip()


def ready_for_design(limit: int = 50) -> List[dict]:
    """Every item at the configured queue status — the work list the builder
    surfaces. Matched by label TEXT (contains_text is the operator Monday's
    API actually honours for status text), so the filter survives label-id
    reshuffles on the board."""
    board = crm_board_id()
    if not board:
        return []
    q = f"""query ($board: [ID!], $limit: Int!, $status: CompareValue!) {{
      boards (ids: $board) {{
        items_page (limit: $limit, query_params: {{
          rules: [{{column_id: "status", compare_value: $status,
                    operator: contains_text}}]
        }}) {{
          items {{ id name url group {{ title }} {_COLS} }}
        }}
      }}
    }}"""
    boards = _gql(q, {"board": [board], "limit": limit,
                      "status": ready_status()}).get("boards") or []
    items = ((boards[0].get("items_page") or {}).get("items") or []) if boards else []
    return [_norm_item(i, with_subitems=False) for i in items]


# ---- matching Monday labels to builder vocabulary ---------------------------

def match_language(label: str, languages: List[dict]) -> str:
    """One Monday language label OR code → the builder's code, or ''."""
    want = _squash(label)
    if not want:
        return ""
    want = _LANG_ALIASES.get(want, want)
    # The CRM board uses codes ("EN", "PT") — try exact code first.
    for l in languages:
        if _squash(l.get("code") or "") == want:
            return l.get("code") or ""
    for l in languages:
        have = _squash(l.get("label") or "")
        if have and (have == want or have.startswith(want) or want.startswith(have)):
            return l.get("code") or ""
    return ""


def match_languages(text: str, languages: List[dict]) -> List[str]:
    """A comma-joined multi-select ("EN, IT, PL, SWE") → builder codes, in
    order, unknowns dropped."""
    out: List[str] = []
    for part in (text or "").split(","):
        code = match_language(part.strip(), languages)
        if code and code not in out:
            out.append(code)
    return out


def match_brand(label: str, brands: List[dict]) -> str:
    """Monday's Brand label → a builder brand id, or ''."""
    want = _squash(label).replace(" ", "")
    if not want:
        return ""
    want = _BRAND_ALIASES.get(want, want)
    for b in brands:
        have = _squash(b.get("name") or "").replace(" ", "")
        if have and (have == want or have in want or want in have):
            return b.get("id") or ""
    return ""
