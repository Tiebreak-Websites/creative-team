"""CRM Email Builder — stores, block parsing, sanitization.

Same persistence pattern as the LP Builder: in-memory dicts are authoritative
while the process lives, JSON flushed best-effort to the artifact disk,
rehydrated on startup. Built-in blocks are seeded from code and can be
OVERRIDDEN or disabled, never deleted.

Blocks are table-based email HTML annotated with data attributes:
  data-em-text="key"   editable single-line text (must be a LEAF element)
  data-em-rich="key"   editable multi-line text (leaf; \\n -> <br> at compose)
  data-em-img="key"    image slot (<img src>)
  data-em-link="key"   href slot

Why a separate DSL from the LP Builder's data-lp-*: a block is valid for exactly
one medium. An LP section uses flexbox and CSS variables, which Outlook's Word
engine cannot read; an email block is nested tables with literal hex. Sharing
one namespace would let a block be dropped into the wrong compositor and render
as garbage, so the attribute name is the type check.

Colour tokens are `{{primary}}`-style placeholders substituted with LITERAL HEX
at compose time — never CSS custom properties, which Outlook ignores.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import uuid
from pathlib import Path
from typing import Dict, List, Optional

from ..settings import settings

log = logging.getLogger(__name__)

EMAIL_ROOT = settings.ARTIFACT_ROOT / "email-builder"
BLOCKS_DIR = EMAIL_ROOT / "blocks"
CAMPAIGNS_DIR = EMAIL_ROOT / "campaigns"
ASSETS_DIR = EMAIL_ROOT / "assets"

_LOCK = threading.RLock()
_BLOCKS: Dict[str, dict] = {}
_CAMPAIGNS: Dict[str, dict] = {}

ASSET_ID_RE = re.compile(r"^[a-f0-9]{32}$")
KEY_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,48}$")
FIELD_RE = re.compile(r'data-em-(text|rich|img|link)="([A-Za-z0-9_.-]+)"')
TOKEN_RE = re.compile(r"\{\{([a-z0-9_]{1,24})\}\}")

# The canvas is a fixed 600px table. Not a max-width: email has no fluid
# layout, and 600 is the width every client has agreed on for twenty years.
EMAIL_WIDTH = 600

# Gmail clips a message past ~102KB and hides everything below the fold behind
# "View entire message" — including the unsubscribe link, which turns into spam
# complaints. Warn well before the cliff.
SIZE_WARN_BYTES = 90_000
SIZE_LIMIT_BYTES = 102_000

# Resolved to literal hex at compose. Mirrors brands.TOKEN_KEYS so a brand maps
# straight across, plus the two email-only surfaces.
DEFAULT_TOKENS: Dict[str, str] = {
    "primary": "#E71E25",
    "accent": "#0A0F2E",
    "cta": "#E71E25",
    "cta_text": "#FFFFFF",
    "bg": "#F4F6FB",       # the area AROUND the 600px card
    "card": "#FFFFFF",     # the card itself
    "text": "#0B1220",
    "muted": "#5B6472",
    "border": "#E4E8F0",
    # Fill for the highlight panel. Neutral by default so it recedes behind
    # the CTA instead of competing with it; a brand can override it.
    "tint": "#F4F6FB",
}

# Web-safe only. A brand font renders in Apple Mail and almost nowhere else, so
# the stack has to stand on its own rather than degrade into a surprise.
DEFAULT_FONT = "Arial, Helvetica, sans-serif"

# Tags that are stripped or actively raise spam score in mail clients.
_BANNED_TAGS = ("script", "iframe", "object", "embed", "form", "input",
                "svg", "base", "link", "meta", "video", "audio")
_BANNED_RE = re.compile(r"<\s*/?\s*(" + "|".join(_BANNED_TAGS) + r")\b", re.I)
_ON_ATTR_RE = re.compile(r"\son[a-z]+\s*=", re.I)
_BAD_URL_RE = re.compile(r"(javascript:|data:text/html|vbscript:)", re.I)

# Properties Outlook's Word engine cannot render. Blocks using them would look
# correct in the preview and broken in the client that matters most.
_UNSAFE_CSS_RE = re.compile(
    r"(display\s*:\s*(flex|grid)|position\s*:\s*(absolute|fixed|sticky)"
    r"|var\s*\(\s*--|box-shadow|object-fit|aspect-ratio|color-mix|@import)", re.I)


def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def lock() -> threading.RLock:
    return _LOCK


def blocks() -> Dict[str, dict]:
    return _BLOCKS


def campaigns() -> Dict[str, dict]:
    return _CAMPAIGNS


def new_campaign_id() -> str:
    return "em_" + uuid.uuid4().hex[:12]


def new_asset_id() -> str:
    return uuid.uuid4().hex


def validate_block_html(html: str) -> Optional[str]:
    """Returns an error string, or None when the block is safe to ship.

    Rejects what mail clients strip and what Outlook cannot render — catching
    the second class here is the point: a flexbox block previews perfectly in
    the builder and collapses in the client with the strictest engine.
    """
    if not html or not html.strip():
        return "Block HTML is empty."
    if _BANNED_RE.search(html):
        return ("Email blocks cannot contain script, form, iframe, svg or link tags — "
                "mail clients strip them and they raise spam score.")
    if _ON_ATTR_RE.search(html):
        return "Inline event handlers (onclick=…) are not allowed."
    if _BAD_URL_RE.search(html):
        return "javascript:, vbscript: and data:text/html URLs are not allowed."
    bad = _UNSAFE_CSS_RE.search(html)
    if bad:
        return (f"'{bad.group(0)}' does not render in Outlook (Word engine). "
                "Use nested tables, literal hex colours and padding on <td>.")
    # A text slot is filled by regex between '>' and '</', so it must be a leaf.
    for m in FIELD_RE.finditer(html):
        kind, key = m.group(1), m.group(2)
        if kind not in ("text", "rich"):
            continue
        after = html[m.end():]
        gt = after.find(">")
        if gt == -1:
            return f"Malformed tag around slot '{key}'."
        inner = after[gt + 1:]
        nxt_open, nxt_close = inner.find("<"), inner.find("</")
        if nxt_open != -1 and nxt_open != nxt_close:
            return (f"Text slot '{key}' must be on a leaf element "
                    "(no nested tags inside it).")
    return None


def parse_fields(html: str) -> dict:
    """The slots a block exposes, in document order, de-duplicated."""
    seen, fields = set(), []
    for m in FIELD_RE.finditer(html or ""):
        kind, key = m.group(1), m.group(2)
        if key in seen:
            continue
        seen.add(key)
        fields.append({"kind": kind, "key": key})
    return {"fields": fields}


def tokens_used(html: str) -> List[str]:
    """Which {{token}} placeholders a block references — lets the editor warn
    about a typo'd token before it silently composes as an empty colour."""
    return sorted({m.group(1) for m in TOKEN_RE.finditer(html or "")})


# --------------------------------------------------------------------------
# persistence — best effort, never raises into a request

def _flush_json(path: Path, data) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        log.exception("email-builder: could not write %s", path)


def persist_block(b: dict) -> None:
    _flush_json(BLOCKS_DIR / f"{b['key']}.json", b)


def persist_campaign(c: dict) -> None:
    _flush_json(CAMPAIGNS_DIR / f"{c['id']}.json", c)


def delete_campaign_file(cid: str) -> None:
    try:
        (CAMPAIGNS_DIR / f"{cid}.json").unlink(missing_ok=True)
    except Exception:
        log.exception("email-builder: could not delete campaign %s", cid)


def rehydrate() -> None:
    """Seed built-in blocks from code, then layer any disk overrides on top.

    Runs synchronously at startup (like the LP Builder) because the block
    library must exist before the first /blocks request.
    """
    from .blocks import BUILTIN_BLOCKS

    with _LOCK:
        _BLOCKS.clear()
        for b in BUILTIN_BLOCKS:
            _BLOCKS[b["key"]] = {**b, "built_in": True}

        if BLOCKS_DIR.exists():
            for p in sorted(BLOCKS_DIR.glob("*.json")):
                try:
                    rec = json.loads(p.read_text(encoding="utf-8"))
                except Exception:
                    log.exception("email-builder: skipping unreadable block %s", p)
                    continue
                key = rec.get("key")
                if not key:
                    continue
                # A disk record for a built-in is an OVERRIDE, not a replacement:
                # built_in stays true so the UI still refuses to delete it.
                rec["built_in"] = key in _BLOCKS and _BLOCKS[key].get("built_in", False)
                _BLOCKS[key] = rec

        _CAMPAIGNS.clear()
        if CAMPAIGNS_DIR.exists():
            for p in sorted(CAMPAIGNS_DIR.glob("*.json")):
                try:
                    rec = json.loads(p.read_text(encoding="utf-8"))
                except Exception:
                    log.exception("email-builder: skipping unreadable campaign %s", p)
                    continue
                if rec.get("id"):
                    _CAMPAIGNS[rec["id"]] = rec

    log.info("email-builder: %d blocks, %d campaigns", len(_BLOCKS), len(_CAMPAIGNS))
