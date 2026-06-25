"""Detect Title / Subtitle / Button from a pasted copy deck.

The user pastes a block of ad copy — often a numbered list where each item has a
Headline / Body / CTA — and we split it into structured concept cards. Handles:
  - labeled lines (Headline:/Title:/Hook:, Body:/Subtitle:/Description:, CTA:/Button:)
  - numbered separators (lines that are just "1", "2)", "#3", …)
  - blank-line-separated blocks
  - unlabeled blocks (positional guess: first line = title, a short trailing
    imperative line = button, the rest = subtitle)

Deterministic + dependency-free, so it never costs an API call and can't hallucinate.
"""
from __future__ import annotations

import re
from typing import List, Dict

_LABELS = {
    "title": ("headline", "title", "hook", "header", "head", "h1", "name"),
    "subtitle": ("body", "subtitle", "subheadline", "subhead", "sub-headline",
                 "sub headline", "description", "desc", "supporting", "subline",
                 "sub", "text", "copy", "paragraph"),
    "button": ("cta", "button", "action", "call to action", "call-to-action", "btn"),
}
# Value may be empty (label alone on its line, with the value on the next line).
_LABEL_RE = re.compile(r"^\s*([A-Za-z][A-Za-z \-]{0,24})\s*[:\-–]\s*(.*)$")
_NUM_ONLY_RE = re.compile(r"^\s*[#]?\s*\d+\s*[.)\]]?\s*$")


def _label_of(word: str):
    w = (word or "").strip().lower()
    for field, names in _LABELS.items():
        if w in names:
            return field
    return None


def _split_blocks(text: str) -> List[str]:
    lines = text.split("\n")
    if any(_NUM_ONLY_RE.match(ln) for ln in lines):
        blocks, cur = [], []
        for ln in lines:
            if _NUM_ONLY_RE.match(ln):
                if any(c.strip() for c in cur):
                    blocks.append("\n".join(cur).strip())
                cur = []
            else:
                cur.append(ln)
        if any(c.strip() for c in cur):
            blocks.append("\n".join(cur).strip())
        return [b for b in blocks if b.strip()]
    return [b.strip() for b in re.split(r"\n\s*\n", text) if b.strip()]


def _parse_block(block: str) -> Dict[str, str]:
    lines = [ln.strip() for ln in block.split("\n") if ln.strip()]
    if not lines:
        return {}
    fields = {"title": "", "subtitle": "", "button": ""}
    sub_parts: List[str] = []
    labeled = False
    cur = None  # current labeled field, for continuation lines
    for ln in lines:
        m = _LABEL_RE.match(ln)
        field = _label_of(m.group(1)) if m else None
        if field:
            labeled, cur = True, field
            val = m.group(2).strip()
            if field == "subtitle":
                if val:
                    sub_parts.append(val)
            elif not fields[field]:
                fields[field] = val
        elif labeled and cur:
            # a wrapped continuation of the current labeled field
            if cur == "subtitle":
                sub_parts.append(ln)
            elif fields[cur]:
                fields[cur] += " " + ln
            else:
                fields[cur] = ln
    if labeled:
        fields["subtitle"] = " ".join(sub_parts).strip()
        return fields
    # Unlabeled block: positional guess.
    title = lines[0]
    rest = lines[1:]
    button = ""
    if rest:
        last = rest[-1]
        # A short, imperative-looking trailing line with no sentence punctuation
        # is almost always the CTA.
        if len(last.split()) <= 8 and not last.rstrip().endswith((".", "!", "?", ":", ",")):
            button, rest = last, rest[:-1]
    return {"title": title, "subtitle": " ".join(rest).strip(), "button": button}


def parse_copy(text: str, max_concepts: int = 5) -> List[Dict[str, str]]:
    """Return up to `max_concepts` {title, subtitle, button} dicts from pasted text."""
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        return []
    out: List[Dict[str, str]] = []
    for blk in _split_blocks(text):
        c = _parse_block(blk)
        title = (c.get("title") or "").strip()
        if not title:
            continue
        out.append({
            "title": title[:200],
            "subtitle": (c.get("subtitle") or "").strip()[:300],
            "button": (c.get("button") or "").strip()[:80],
        })
        if len(out) >= max_concepts:
            break
    return out
