"""Creative Summary core: read a Figma LP, generate a bilingual summary, and
(optionally) post it back as a pinned Figma comment.

The deliverable mirrors the team's `creative-summary` skill:
  - A short bilingual summary written from the LEAD's perspective.
  - Always starts with "The lead is interested in...".
  - Local-market language on top, English below. English-only LPs get one row.
  - <= 200 characters per version, one paragraph, no bullets/fluff, never names
    the publisher/brand.

Figma is read via the REST API (GET /v1/files/{key}); the summary is authored by
the Claude API. Secret VALUES are never logged — only their presence is checked
upstream (router) and never echoed here.
"""
from __future__ import annotations

import re
from typing import Optional

import anthropic
import httpx

from ...settings import settings

FIGMA_API = "https://api.figma.com/v1"

# How much LP copy to feed the model. The skill says hero/subhero/CTA are enough;
# we cap the node count and total characters so a huge file can't blow the prompt.
MAX_TEXT_NODES = 60
MAX_COPY_CHARS = 6000


class SummaryError(Exception):
    """A user-facing failure (bad URL, Figma rejected the token, no copy, etc.).

    `status` is the HTTP status the router should surface.
    """

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


# --------------------------------------------------------------------------- #
# Figma URL parsing
# --------------------------------------------------------------------------- #
def parse_figma_url(url: str) -> tuple[str, Optional[str]]:
    """Return (file_key, node_id|None) from a Figma file/design URL.

    file_key is the path segment after /file/ or /design/. node_id comes from the
    ?node-id=1-2 query param, normalized to Figma's "1:2" form.
    """
    if not url or not url.strip():
        raise SummaryError("Provide a Figma file URL.", status=422)
    raw = url.strip()

    m = re.search(r"/(?:file|design)/([A-Za-z0-9]+)", raw)
    if not m:
        # Allow pasting a bare file key too.
        if re.fullmatch(r"[A-Za-z0-9]{8,}", raw):
            return raw, None
        raise SummaryError(
            "Could not find a Figma file key in that URL. Expected a "
            "figma.com/file/... or /design/... link.",
            status=422,
        )
    file_key = m.group(1)

    node_id: Optional[str] = None
    nm = re.search(r"[?&]node-id=([^&]+)", raw)
    if nm:
        # URL form is "1-2" (or url-encoded "1%3A2"); Figma's API wants "1:2".
        node_id = nm.group(1).replace("%3A", ":").replace("-", ":")
    return file_key, node_id


# --------------------------------------------------------------------------- #
# Figma read
# --------------------------------------------------------------------------- #
def _figma_get(path: str, token: str, params: Optional[dict] = None) -> dict:
    try:
        resp = httpx.get(
            f"{FIGMA_API}{path}",
            headers={"X-Figma-Token": token},
            params=params,
            timeout=60.0,
        )
    except httpx.HTTPError as e:
        raise SummaryError(f"Could not reach Figma: {type(e).__name__}.", status=502)
    if resp.status_code == 403:
        raise SummaryError(
            "Figma rejected the request (403). Check that FIGMA_API_KEY has "
            "access to this file.",
            status=502,
        )
    if resp.status_code == 404:
        raise SummaryError("Figma file not found (404). Check the URL.", status=404)
    if resp.status_code >= 400:
        raise SummaryError(f"Figma API error ({resp.status_code}).", status=502)
    return resp.json()


def _bbox(node: dict) -> Optional[dict]:
    return node.get("absoluteBoundingBox")


def _first_page(doc: dict) -> dict:
    children = doc.get("children") or []
    if not children:
        raise SummaryError("This Figma file has no pages.", status=422)
    return children[0]


def _pick_frame(page: dict, node_id: Optional[str]) -> dict:
    """Choose the target frame.

    If a node-id was given and resolves to a frame, use it. Otherwise prefer a
    top-level frame named like "Desktop", else the widest top-level FRAME.
    """
    top = [c for c in (page.get("children") or [])
           if c.get("type") in ("FRAME", "COMPONENT", "INSTANCE", "SECTION")]

    if node_id:
        match = _find_node(page, node_id)
        if match is not None:
            return match

    if not top:
        raise SummaryError(
            "No top-level frame found on the first page of this file.", status=422
        )

    named = [f for f in top if "desktop" in (f.get("name") or "").lower()]
    pool = named or top

    def width(f: dict) -> float:
        b = _bbox(f) or {}
        return float(b.get("width") or 0)

    return max(pool, key=width)


def _find_node(root: dict, node_id: str) -> Optional[dict]:
    if root.get("id") == node_id:
        return root
    for child in root.get("children") or []:
        found = _find_node(child, node_id)
        if found is not None:
            return found
    return None


def _collect_text(node: dict, out: list[str]) -> None:
    """Depth-first collect TEXT node `characters`, capped at MAX_TEXT_NODES."""
    if len(out) >= MAX_TEXT_NODES:
        return
    if node.get("type") == "TEXT":
        chars = (node.get("characters") or "").strip()
        if chars:
            out.append(chars)
    for child in node.get("children") or []:
        if len(out) >= MAX_TEXT_NODES:
            return
        _collect_text(child, out)


def extract_lp(file_key: str, node_id: Optional[str], token: str) -> dict:
    """Read the file, pick the target frame, and return its copy + placement."""
    data = _figma_get(f"/files/{file_key}", token)
    doc = data.get("document") or {}
    page = _first_page(doc)
    frame = _pick_frame(page, node_id)

    texts: list[str] = []
    _collect_text(frame, texts)
    copy = "\n".join(texts).strip()
    if len(copy) > MAX_COPY_CHARS:
        copy = copy[:MAX_COPY_CHARS]

    box = _bbox(frame) or {}
    return {
        "file_name": data.get("name") or file_key,
        "frame": {
            "node_id": frame.get("id"),
            "name": frame.get("name") or "Frame",
            "x": box.get("x"),
            "y": box.get("y"),
            "width": box.get("width"),
            "height": box.get("height"),
        },
        "copy": copy,
        "text_node_count": len(texts),
    }


# --------------------------------------------------------------------------- #
# Claude: author the bilingual summary
# --------------------------------------------------------------------------- #
_INSUFFICIENT = "Unable to generate summary: insufficient visible LP content."

_SUMMARY_TOOL = {
    "name": "emit_summary",
    "description": "Emit the bilingual creative summary for the landing page.",
    "input_schema": {
        "type": "object",
        "properties": {
            "language": {
                "type": "string",
                "description": "Name of the detected local-market language present in the LP "
                               "(e.g. 'Arabic', 'German'). Use 'English' if the LP is English-only.",
            },
            "english_only": {
                "type": "boolean",
                "description": "true if the LP contains only English copy.",
            },
            "local_summary": {
                "type": "string",
                "description": "The summary in the detected local-market language. "
                               "Max 200 characters. If the LP is English-only, write it in English.",
            },
            "english_summary": {
                "type": "string",
                "description": "A direct English translation of the local summary. "
                               "Max 200 characters. Omit / leave empty when english_only is true.",
            },
        },
        "required": ["language", "english_only", "local_summary"],
        "additionalProperties": False,
    },
}

_SYSTEM = (
    "You write a 'Creative Summary' that a sales agent reads to instantly understand "
    "what a landing page (LP) is promoting. Follow these non-negotiable rules:\n"
    "- Write from the LEAD's perspective: what they want to learn, do, or invest in.\n"
    "- Every summary MUST begin with the words 'The lead is interested in'. In the local "
    "language, begin with the natural equivalent of that phrase.\n"
    "- Maximum 200 characters per version. One short paragraph. No bullet points, no fluff, "
    "no vague filler, no misleading claims.\n"
    "- Mention the specific asset, topic, or market (e.g. stocks, AI, crypto, oil, S&P 500). "
    "Stock names and ticker symbols are allowed (e.g. Tesla, AAPL, Saudi Aramco).\n"
    "- DO NOT mention the LP publisher or brand name.\n"
    "- Detect the LP's local-market language from its copy. If a non-English version exists "
    "alongside English, treat the non-English language as the local language. If the LP is "
    "English-only, set english_only=true and write the summary once in English. Never invent "
    "a language that is not present in the LP.\n"
    "- Always emit via the emit_summary tool."
)


def _clip(text: str, limit: int = 200) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def generate_summary(copy: str, api_key: str) -> dict:
    """Return {language, english_only, local_summary, english_summary} for the copy."""
    if not copy or len(copy.strip()) < 8:
        return {
            "language": "English",
            "english_only": True,
            "local_summary": _INSUFFICIENT,
            "english_summary": "",
        }

    client = anthropic.Anthropic(api_key=api_key)
    user = (
        "Here is the visible copy from the landing page (hero / subhero / CTA first):\n\n"
        f"{copy}\n\n"
        "Produce the bilingual Creative Summary now."
    )
    try:
        resp = client.messages.create(
            model=settings.BRIEF_MODEL,
            max_tokens=600,
            system=_SYSTEM,
            tools=[_SUMMARY_TOOL],
            tool_choice={"type": "tool", "name": "emit_summary"},
            messages=[{"role": "user", "content": user}],
        )
    except anthropic.AuthenticationError:
        raise SummaryError("ANTHROPIC_API_KEY was rejected by Anthropic.", status=502)
    except anthropic.APIStatusError as e:
        raise SummaryError(f"Claude API error ({e.status_code}).", status=502)
    except anthropic.APIError as e:  # network / timeout / etc.
        raise SummaryError(f"Claude API call failed: {type(e).__name__}.", status=502)

    payload: dict = {}
    for block in resp.content:
        if getattr(block, "type", None) == "tool_use" and block.name == "emit_summary":
            payload = block.input or {}
            break

    local = _clip(payload.get("local_summary") or "")
    english = _clip(payload.get("english_summary") or "")
    english_only = bool(payload.get("english_only"))
    language = (payload.get("language") or "English").strip() or "English"

    if not local:
        local, english_only, language = _INSUFFICIENT, True, "English"
        english = ""
    if english_only:
        english = ""

    return {
        "language": language,
        "english_only": english_only,
        "local_summary": local,
        "english_summary": english,
    }


# --------------------------------------------------------------------------- #
# Render the deliverable
# --------------------------------------------------------------------------- #
def render_text(result: dict) -> str:
    """Plain-text summary: local row, then English row (if any)."""
    lines = [result["local_summary"]]
    if not result["english_only"] and result["english_summary"]:
        lines.append("")
        lines.append(result["english_summary"])
    return "\n".join(lines)


def render_markdown(result: dict, frame_name: str) -> str:
    md = ["# Creative Summary", ""]
    if result["english_only"]:
        md.append(result["local_summary"])
    else:
        md.append(f"**{result['language']}**  ")
        md.append(result["local_summary"])
        md.append("")
        md.append("**English**  ")
        md.append(result["english_summary"])
    md.append("")
    md.append(f"_Frame: {frame_name}_")
    return "\n".join(md)


# --------------------------------------------------------------------------- #
# Figma write: post the summary as a pinned comment on the frame
# --------------------------------------------------------------------------- #
def post_comment(file_key: str, frame: dict, message: str, token: str) -> bool:
    """POST /v1/files/{key}/comments, pinned to the frame.

    Pinning uses client_meta with the frame's node id + a node_offset so the
    comment lands at the frame's top-left corner.
    """
    client_meta: dict = {}
    if frame.get("node_id"):
        client_meta = {"node_id": frame["node_id"], "node_offset": {"x": 0, "y": 0}}
    body = {"message": message}
    if client_meta:
        body["client_meta"] = client_meta
    try:
        resp = httpx.post(
            f"{FIGMA_API}/files/{file_key}/comments",
            headers={"X-Figma-Token": token, "Content-Type": "application/json"},
            json=body,
            timeout=60.0,
        )
    except httpx.HTTPError as e:
        raise SummaryError(f"Could not post the Figma comment: {type(e).__name__}.", status=502)
    if resp.status_code >= 400:
        raise SummaryError(
            f"Figma rejected the comment ({resp.status_code}).", status=502
        )
    return True


# --------------------------------------------------------------------------- #
# figma_ops for the companion Figma plugin (canvas placement)
# --------------------------------------------------------------------------- #
def build_figma_ops(frame: dict, summary_text: str) -> list[dict]:
    x = frame.get("x")
    y = frame.get("y")
    width = frame.get("width")
    op = {
        "op": "create_text",
        "text": summary_text,
        "name": "Creative Summary",
        "x": x if x is not None else 0,
        "y": (y - 220) if isinstance(y, (int, float)) else 0,
        "width": width if width is not None else 900,
        "fontSize": 16,
    }
    return [op]
