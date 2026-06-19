"""AI language + conversion-tone judgment for Figma QA (Phase 2 of /qa).

Sends the compact texts dump emitted by check.py to Claude and asks for two
kinds of findings via forced tool-use (structured JSON, like brief.py):
  - wrong-language : a text block that is obviously not in the target language.
  - tone           : a major copy block that is vague/hedged/filler/off-voice,
                     with a one-line "why it hurts conversion" and a rewrite.

This is best-effort: any failure (missing key, API error, bad JSON) returns an
empty findings list so the run still succeeds with the deterministic checks.
Secret values are never logged.
"""
from __future__ import annotations

import json
from typing import List

import anthropic

from ...settings import settings

_TOOL = {
    "name": "emit_findings",
    "description": "Emit language and conversion-tone QA findings for the page copy.",
    "input_schema": {
        "type": "object",
        "properties": {
            "findings": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "check": {
                            "type": "string",
                            "enum": ["wrong-language", "tone"],
                            "description": "wrong-language = not in the target language; "
                                           "tone = weak/off-voice conversion copy.",
                        },
                        "severity": {
                            "type": "string",
                            "enum": ["error", "warning"],
                        },
                        "device": {
                            "type": "string",
                            "description": "The device bucket this text came from "
                                           "(desktop / tablet / mobile).",
                        },
                        "nodeId": {
                            "type": "string",
                            "description": "The Figma node id of the offending text, copied "
                                           "verbatim from the input.",
                        },
                        "message": {
                            "type": "string",
                            "description": "One line. For wrong-language: what's wrong. For tone: "
                                           "what's weak + why it hurts conversion.",
                        },
                        "rewrite": {
                            "type": "string",
                            "description": "For tone findings only: one tighter suggested rewrite.",
                        },
                    },
                    "required": ["check", "severity", "device", "nodeId", "message"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["findings"],
        "additionalProperties": False,
    },
}


def _system_prompt(lang: str, voice: str, want_tone: bool) -> str:
    lines = [
        "You are a localization QA reviewer for marketing landing pages.",
        f"The target language is '{lang}'. The text blocks below are pulled from a "
        "localized Figma page, grouped by device. Each has an id, a role, and the text.",
        "",
        "Always run the WRONG-LANGUAGE check:",
        f"- Flag any text block that is obviously NOT in the target language ('{lang}') — "
        "e.g. a full English sentence on a non-English page, or mixed-language phrases.",
        "- Do NOT flag short brand names, product names, or common loanwords.",
        '- Emit each as {check:"wrong-language", severity:"error"}.',
    ]
    if want_tone:
        lines += [
            "",
            "Also run the CONVERSION-TONE check on major copy (hero/h1/h2, CTAs, and body "
            "with role 'body'):",
            f"- Target voice: {voice}",
            "- Flag blocks that are vague, hedged, filler, or tonally off. For each, the message "
            "must say what's weak AND why it hurts conversion, in one line. Provide one tighter "
            "'rewrite'.",
            '- Emit each as {check:"tone", severity:"error" (or "warning" for minor)} with a rewrite.',
            "- Be selective: only flag blocks that genuinely matter. Do not flag captions.",
        ]
    else:
        lines += ["", "Do NOT run the tone check this time. Only emit wrong-language findings."]
    lines += [
        "",
        "Copy every nodeId VERBATIM from the input. If nothing is wrong, emit an empty findings array.",
    ]
    return "\n".join(lines)


def judge(texts: dict, lang: str, voice: str, want_tone: bool, api_key: str) -> List[dict]:
    """Return a list of finding dicts (may be empty). Best-effort; never raises."""
    try:
        client = anthropic.Anthropic(api_key=api_key)
        user = (
            "Here is the page copy, grouped by device (keys ending in _ctas are CTA buttons):\n\n"
            + json.dumps(texts, ensure_ascii=False)
        )
        resp = client.messages.create(
            model=settings.BRIEF_MODEL,
            max_tokens=2000,
            system=_system_prompt(lang, voice, want_tone),
            tools=[_TOOL],
            tool_choice={"type": "tool", "name": "emit_findings"},
            messages=[{"role": "user", "content": user}],
        )
        for block in resp.content:
            if block.type == "tool_use" and block.name == "emit_findings":
                raw = block.input.get("findings", []) or []
                cleaned = (_clean(f) for f in raw)
                return [f for f in cleaned if f]
        return []
    except Exception:  # noqa: BLE001 — tone is best-effort; never fail the run
        return []


_ALLOWED = {"wrong-language", "tone"}


def _clean(f: dict):
    if not isinstance(f, dict):
        return None
    check = f.get("check")
    node_id = f.get("nodeId")
    message = f.get("message")
    if check not in _ALLOWED or not node_id or not message:
        return None
    out = {
        "check": check,
        "severity": "error" if f.get("severity") != "warning" else "warning",
        "device": f.get("device") or "",
        "nodeId": str(node_id),
        "message": str(message),
    }
    if check == "tone" and f.get("rewrite"):
        out["rewrite"] = str(f["rewrite"])
    return out
