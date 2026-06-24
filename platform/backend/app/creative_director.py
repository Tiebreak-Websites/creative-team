"""creative_director.py — GPT-5.5 "creative director" for the Banner Builder.

Given one concept card (Title + optional Subtitle / Button) plus the campaign
style + locale, GPT-5.5 reasons (extended / "high" effort) about the strongest
visual concept and writes a BESPOKE creative-direction paragraph for EACH
requested size/aspect — together with a shared hook fragment and CTA colour.
gpt-image-2 then renders from those briefs (the master via
/v1/images/generations, the other sizes via /v1/images/edits), so each aspect
gets its own art direction while the campaign stays visually coherent.

One reasoning pass per concept emits all of its per-size briefs at once: the
model sees every format together, so the sizes stay on-brand with each other —
cheaper and more consistent than an isolated call per size.

Stdlib only (urllib), same constraint as engine_core. The OpenAI Responses API
shape used here (POST /v1/responses, reasoning.effort, text.format json_schema)
is the documented GA contract for gpt-5.5.

This module makes the network call and returns a *shape-checked* dict. ENGINE
rule enforcement (hook must be a verbatim substring of the Title, brief
moderation, approved button combos) lives in runner._validate_director so the
deterministic fallback path is reused and a director result can never run
anything the engine itself would reject.
"""
from __future__ import annotations

import base64
import json
import os
import urllib.error
import urllib.request

from .banner_engine import prompts
from .banner_engine.intent import DEFAULT_INTENT, INTENT_DIRECTION
from .banner_engine.prompts import (
    BRAND_DEFENCE_LINE,
    BUTTON_COMBOS,
    LAYOUT_BASE,
    LAYOUT_FAMILY,
    SYSTEM_HEADER,
)

OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"

# Reasoning effort tiers accepted by the Responses API (model-dependent; gpt-5.5
# supports all of these and defaults to "medium").
VALID_EFFORTS = {"none", "minimal", "low", "medium", "high", "xhigh"}

_APPROVED_BGS = [bg for bg, _ in BUTTON_COMBOS]


class DirectorError(Exception):
    """Terminal failure of the creative-direction step.

    The caller (runner) treats this as "use the deterministic template brief"
    so a run never fails just because the director was unavailable.
    """


# ---------------------------------------------------------------------------
# Structured-output schema (strict json_schema)
# ---------------------------------------------------------------------------
def _schema(sizes: list) -> dict:
    """A strict schema: shared hook + button colour + one brief per size.

    Strict mode requires additionalProperties:false and every property listed in
    `required`. Sizes are an ARRAY of {size, creative_brief} (not dynamic keys),
    which strict mode allows; `size` is enum-locked to the requested sizes.
    """
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["hook_phrase", "button_bg", "sizes"],
        "properties": {
            "hook_phrase": {
                "type": "string",
                "description": (
                    "A 2-5 word fragment copied VERBATIM (case-insensitive) from the "
                    "Title — the type-hero repeated across every size."
                ),
            },
            "button_bg": {
                "type": ["string", "null"],
                "enum": _APPROVED_BGS + [None],
                "description": (
                    "CTA button background hex chosen from the approved list for strong "
                    "contrast against the design. null when the concept has no button."
                ),
            },
            "sizes": {
                "type": "array",
                "description": "Exactly one entry per requested size.",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["size", "creative_brief"],
                    "properties": {
                        "size": {"type": "string", "enum": list(sizes)},
                        "creative_brief": {
                            "type": "string",
                            "description": (
                                "~300-450 chars of concrete art direction for THIS aspect: a "
                                "distinctive concept, medium (advertising photo / bold graphic "
                                "/ 3D), hero subject (a real-looking generic person facing the "
                                "viewer with confident posture, and/or the actual product), "
                                "composition, palette, lighting, mood. On-subject — never an "
                                "abstract gradient, never a desk/hand-on-chin stock pose. No "
                                "bullet lists, no archetype labels."
                            ),
                        },
                    },
                },
            },
        },
    }


# Extensions whose bytes we know how to inline as a data: URI for the model.
_REF_MIME = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp"}

# The single instruction that keeps reference images STYLE-only. Stated in the
# system prompt AND repeated next to the images so the model can't drift into
# lifting copy/headlines from them.
REFERENCE_STYLE_RULE = (
    "STYLE REFERENCE IMAGES: the attached image(s) are mood/style reference ONLY. "
    "Borrow their palette, composition, lighting, texture and overall mood. IGNORE "
    "any words, headlines, logos, numbers or copy that appear in them — do NOT read, "
    "transcribe, reuse or be influenced by their text. The Title/subtitle/button "
    "given below are the ONLY copy; they always win. Treat the references as visual "
    "inspiration for HOW the ad should look, never WHAT it should say."
)


def _reference_image_parts(reference_paths) -> list:
    """Read reference image files and return Responses-API `input_image` content
    parts (base64 data: URIs). Unreadable/oversized/unknown files are skipped, so
    a bad reference degrades to 'no reference' rather than failing the call."""
    parts: list = []
    for path in reference_paths or []:
        try:
            ext = os.path.splitext(path)[1].lstrip(".").lower()
            mime = _REF_MIME.get(ext)
            if not mime:
                continue
            with open(path, "rb") as fh:
                raw = fh.read()
            if not raw or len(raw) > 8 * 1024 * 1024:
                continue
            b64 = base64.b64encode(raw).decode("ascii")
            parts.append({"type": "input_image",
                          "image_url": f"data:{mime};base64,{b64}"})
        except OSError:
            continue
    return parts


def _build_messages(*, title, subtitle, button, style, locale, sizes,
                    has_references=False, intent=DEFAULT_INTENT,
                    concept_angle=""):
    size_lines = [
        f"- {s} [{LAYOUT_FAMILY.get(s, 'TARGET')}]: {LAYOUT_BASE.get(s, '')}"
        for s in sizes
    ]
    angle_directive = (concept_angle or "").strip()
    angle_block = (
        f"THIS CONCEPT'S DISTINCT CREATIVE DIRECTION (highest priority — build the "
        f"entire brief AROUND it): {angle_directive}\n\n"
        if angle_directive else ""
    )
    system = (
        "You are the creative director for a HIGH-CTR paid-social ad system. A separate "
        "image model (gpt-image-2) renders each size purely from the brief you write, so "
        "your brief IS the design. Your job: a scroll-stopping ad that drives clicks — "
        "concrete and on-subject, never a generic mood piece. Think hard, then output strict JSON.\n\n"
        f"{angle_block}"
        f"Premise: {SYSTEM_HEADER}\n\n"
        "Direct the ad like a pro:\n"
        "- Commit to exactly ONE dominant visual idea/metaphor that dramatizes the offer "
        "— a concept, not a literal stock depiction. Cut any prop that competes (no symbol soup).\n"
        "- Pick the MEDIUM that best sells THIS offer: advertising photography (a "
        "real-looking, generic non-celebrity human subject and/or the actual product as "
        "the hero), bold graphic/typographic, or 3D. Default to a concrete, literal, "
        "on-subject hero image — NEVER an abstract gradient or 'atmosphere' background.\n"
        "- Specify the CRAFT so it renders like a real ad, not a generic AI image: for "
        "photography name the camera/lens (50-85mm), lighting (soft key + rim, or dramatic "
        "as fits), depth of field, angle, and an editorial commercial-advertising style — "
        "crisp, color-graded, premium; for graphic/3D name the finish, lighting and texture.\n"
        "- Stop the scroll: high figure-ground contrast, a deliberate palette and "
        "lighting drawn from THIS offer, one clear focal subject.\n"
        "- If a person strengthens the ad, direct a specific subject (who they are, "
        "wardrobe, lighting) who FACES THE VIEWER with confident, aspirational posture and "
        "eye contact. NEVER the 'businessperson at a desk, hand on chin, looking down at "
        "paperwork or a laptop' stock cliche. If a product or object is the point, show it for real.\n"
        "- Design as direct-response: when there is a CTA, make the button a HERO element "
        "with strong contrast and a clear eye-path to it; keep every line of copy high-contrast and legible.\n"
        "- VARY the composition across concepts — do not default every ad to 'headline-left / "
        "subject-right'; use full-bleed, centered or paneled layouts as the idea demands. "
        "Within ONE concept keep all sizes consistent (same subject, palette, hook treatment), "
        "varying only the crop per aspect.\n"
        f"- Campaign art direction for this intent: {INTENT_DIRECTION[intent]}\n"
        "- hook_phrase MUST be copied verbatim (case-insensitive) from the Title; it is the type-hero.\n"
        "- Each creative_brief is free prose (~300-450 chars): concept, medium, hero subject, "
        "composition, palette, lighting, mood — concrete and art-directed. No bullet lists, no archetype names.\n\n"
        f"Boundaries: {prompts.hard_negatives_for(intent)}\n\n"
        f"{BRAND_DEFENCE_LINE}"
    )
    if has_references:
        system = system + "\n\n" + REFERENCE_STYLE_RULE
    parts = []
    if angle_directive:
        parts.append(
            "This concept's distinct creative direction (build the brief AROUND "
            f"it, do NOT make it a variation of another concept): {angle_directive}"
        )
    parts.append(f'Title (verbatim, never paraphrase): "{title}"')
    if subtitle:
        parts.append(f"Supporting message: {subtitle}")
    if button:
        parts.append(f'CTA button text: "{button}" — pick an approved button_bg with strong contrast.')
    else:
        parts.append("No CTA button — set button_bg to null.")
    if style:
        parts.append(f"Campaign look / brand vibe: {style}")
    parts.append(f"Locale: {locale}")
    if has_references:
        parts.append(REFERENCE_STYLE_RULE)
    parts.append(
        "Requested sizes (write one bespoke brief per size, art-directed to its layout):\n"
        + "\n".join(size_lines)
    )
    return system, "\n".join(parts)


# ---------------------------------------------------------------------------
# Response parsing
# ---------------------------------------------------------------------------
def _extract_output_text(body: str) -> str:
    """Pull the assistant's text from a Responses API body.

    Prefers the top-level `output_text` convenience field; otherwise walks the
    `output` array for the `message` item's `output_text` content parts. Reasoning
    items are skipped.
    """
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return ""
    ot = data.get("output_text")
    if isinstance(ot, str) and ot.strip():
        return ot
    chunks = []
    for item in data.get("output", []) or []:
        if item.get("type") != "message":
            continue
        for part in item.get("content", []) or []:
            if part.get("type") in ("output_text", "text") and isinstance(part.get("text"), str):
                chunks.append(part["text"])
    return "".join(chunks)


def _normalize(data: dict) -> dict:
    hook = (data.get("hook_phrase") or "").strip()
    button_bg = data.get("button_bg")
    if isinstance(button_bg, str):
        button_bg = button_bg.strip() or None
    size_briefs = {}
    for entry in data.get("sizes", []) or []:
        if not isinstance(entry, dict):
            continue
        s = (entry.get("size") or "").strip()
        b = (entry.get("creative_brief") or "").strip()
        if s and b:
            size_briefs[s] = b
    return {"hook_phrase": hook, "button_bg": button_bg, "size_briefs": size_briefs}


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------
def direct_concept(*, api_key, title, subtitle="", button="", style="", locale="en",
                   sizes, model="gpt-5.5", effort="high", timeout=600,
                   references=None, intent=DEFAULT_INTENT, concept_angle="") -> dict:
    """Ask GPT-5.5 to art-direct one concept across all requested sizes.

    timeout defaults to 600s so an "xhigh" (Extended) reasoning pass finishes
    rather than timing out into the deterministic fallback.

    `references` (optional) is a list of local image file paths used as STYLE
    reference ONLY — palette/composition/mood/lighting. The model is explicitly
    told to ignore any text/copy in them; the Title/subtitle/button always win.

    Returns {"hook_phrase": str, "button_bg": str|None, "size_briefs": {size: brief}}.
    Raises DirectorError on any terminal failure (the caller falls back to the
    deterministic template). Does no engine-rule validation itself.
    """
    if not sizes:
        raise DirectorError("no sizes requested")
    if not api_key:
        raise DirectorError("missing OPENAI_API_KEY")
    effort = effort if effort in VALID_EFFORTS else "high"
    # Defensive: an unknown intent must never KeyError into the fallback path.
    intent = intent if intent in INTENT_DIRECTION else DEFAULT_INTENT
    sizes = list(sizes)
    image_parts = _reference_image_parts(references)
    system, user = _build_messages(
        title=title, subtitle=subtitle or "", button=button or "",
        style=style or "", locale=locale or "en", sizes=sizes,
        has_references=bool(image_parts), intent=intent,
        concept_angle=concept_angle or "",
    )
    # When style references are attached, the user turn becomes multimodal: the
    # text part plus one input_image part per reference. Otherwise a plain string.
    if image_parts:
        user_content = [{"type": "input_text", "text": user}, *image_parts]
    else:
        user_content = user
    payload = json.dumps({
        "model": model,
        "reasoning": {"effort": effort},
        "input": [
            {"role": "system", "content": system},
            {"role": "user", "content": user_content},
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "banner_direction",
                "strict": True,
                "schema": _schema(sizes),
            }
        },
        "max_output_tokens": 16000,
    }).encode("utf-8")

    req = urllib.request.Request(
        OPENAI_RESPONSES_URL, data=payload, method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json; charset=utf-8",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:300]
        raise DirectorError(f"HTTP {e.code}: {detail}")
    except Exception as e:  # noqa: BLE001 - any network/parse failure -> fallback
        raise DirectorError(f"{type(e).__name__}: {e}")

    text = _extract_output_text(body)
    if not text.strip():
        raise DirectorError("no output_text in response")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise DirectorError(f"output not valid JSON: {e}")
    return _normalize(data)
