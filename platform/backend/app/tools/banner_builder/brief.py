"""AI-assist: turn banner text into engine-valid concept dicts via the Claude API.

The model only authors the hook fragment, the creative-brief prose, and (when a
CTA is present) the button colour. The backend forces the verbatim title/CTA and
runs the result through the engine's OWN validators (validate_manifest +
check_moderation) — with a deterministic repair pass and one corrective re-ask —
so nothing invalid can reach generation. Manual editing in the UI is always the
fallback; this just pre-fills.

Model: a Sonnet-class model (fast/cheap for constrained JSON authoring),
overridable via PLATFORM_BRIEF_MODEL. Structured output is forced with a tool.
"""
from typing import List

import anthropic

from ... import engine
from ...models import SuggestRequest
from ...secrets import get_secret
from ...settings import settings


class BriefError(Exception):
    def __init__(self, errors: List[str]):
        self.errors = errors
        super().__init__("; ".join(errors))


_APPROVED_BG = [bg for bg, _ in engine.BUTTON_COMBOS]
_BG_TO_PAIR = {bg.upper(): [bg, text] for bg, text in engine.BUTTON_COMBOS}

_TOOL = {
    "name": "emit_concepts",
    "description": "Emit the creative concepts for the banner run.",
    "input_schema": {
        "type": "object",
        "properties": {
            "concepts": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "hook_phrase": {
                            "type": "string",
                            "description": "A 2-4 word fragment copied VERBATIM (same words, any case) "
                                           "from the banner text. Rotate to a different fragment per concept.",
                        },
                        "creative_brief": {
                            "type": "string",
                            "description": "~250-400 characters of prose: visual direction, hook treatment "
                                           "(colour/weight/placement), palette, atmosphere/surface, mood. "
                                           "Free-form prose, no bullet list.",
                        },
                        "button_bg": {
                            "type": "string",
                            "enum": _APPROVED_BG,
                            "description": "CTA button background colour, chosen for strong contrast against "
                                           "the design. Required ONLY when a CTA is present.",
                        },
                    },
                    "required": ["hook_phrase", "creative_brief"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["concepts"],
        "additionalProperties": False,
    },
}


def _system_prompt(has_cta: bool) -> str:
    combos = ", ".join(f"{bg}/{text}" for bg, text in engine.BUTTON_COMBOS)
    lines = [
        "You are the creative director for a paid-social banner generator. You write concept "
        "briefs that an image model will render. Follow these non-negotiable rules:",
        "- The banner TITLE is fixed (the user's verbatim text). You do NOT write or paraphrase it.",
        "- hook_phrase MUST be 2-4 consecutive words copied verbatim (case-insensitive) from the "
        "banner text. Rotate the hook across concepts so each leads with a different fragment.",
        "- creative_brief is ~250-400 characters of prose covering visual direction, hook treatment "
        "(colour/weight/placement), palette, atmosphere/surface, and mood. No template, no bullets.",
        "Brief-authoring DON'Ts:",
        "- Never name a real building/landmark — use generic silhouettes (e.g. 'twin-tower skyline', "
        "not 'Petronas Towers').",
        "- Never request a brand's logo, wordmark, glyph, droplet, or branded packaging — "
        "brand-adjacent colour is fine, brand marks are not.",
        "- Never request icon rows, infographic icon sets, or feature-grid icons unless the copy "
        "explicitly calls for them.",
        "- People are photo-real but generic and partially obscured (back of head, profile, "
        "over-the-shoulder). Never an identifiable real person; no politicians or celebrities.",
    ]
    if has_cta:
        lines.append(
            f"- A CTA button is present. For EACH concept set button_bg to one of these approved "
            f"backgrounds (bg/text pairs): {combos}. Pick the strongest contrast against your design."
        )
    return "\n".join(lines)


def _call(client, model, system, user, extra_user=None) -> list:
    messages = [{"role": "user", "content": user}]
    if extra_user:
        messages.append({"role": "user", "content": extra_user})
    resp = client.messages.create(
        model=model,
        max_tokens=2000,
        system=system,
        tools=[_TOOL],
        tool_choice={"type": "tool", "name": "emit_concepts"},
        messages=messages,
    )
    for block in resp.content:
        if block.type == "tool_use" and block.name == "emit_concepts":
            return block.input.get("concepts", []) or []
    return []


def _assemble(raw, title, cta, has_cta, locale, n):
    out = []
    for i in range(n):
        item = raw[i] if i < len(raw) else {}
        c = {
            "title": title,
            "locale": locale,
            "hook_phrase": (item.get("hook_phrase") or "").strip(),
            "creative_brief": (item.get("creative_brief") or "").strip(),
        }
        if has_cta:
            c["cta"] = cta
            pair = _BG_TO_PAIR.get((item.get("button_bg") or "").upper())
            if pair:
                c["button_combo"] = list(pair)
        out.append(c)
    return out


def _repair(concepts, title, has_cta):
    """Fix the cheap, deterministic slips without another LLM call."""
    title_l = title.lower()
    words = title.split()
    fallback_hook = " ".join(words[:3]) if words else title
    default_bg, default_text = engine.BUTTON_COMBOS[0]
    for c in concepts:
        hook = c.get("hook_phrase", "")
        if not hook or hook.lower() not in title_l:
            c["hook_phrase"] = fallback_hook
        if not c.get("creative_brief"):
            c["creative_brief"] = (
                "Type-hero poster: the hook in bold display letters against a clean thematic "
                "gradient, confident and editorial, generous breathing room."
            )
        if has_cta and not c.get("button_combo"):
            c["button_combo"] = [default_bg, default_text]
    return concepts


def _validate(concepts) -> List[str]:
    manifest = {"concepts": {f"c{i+1}": c for i, c in enumerate(concepts)}}
    urls = [
        {"concept": f"c{i+1}", "size": engine.MASTER_SIZE,
         "openaiSize": engine.OPENAI_SIZE_MAP[engine.MASTER_SIZE]}
        for i in range(len(concepts))
    ]
    errors = list(engine.validate_manifest(manifest, urls, require_submit_url=False))
    for i, c in enumerate(concepts):
        ok, reason = engine.check_moderation(c)
        if not ok:
            errors.append(f"c{i+1}: {reason}")
    return errors


def suggest_concepts(req: SuggestRequest):
    api_key = get_secret("ANTHROPIC_API_KEY")
    if not api_key:
        raise BriefError(["ANTHROPIC_API_KEY not set — AI-assist unavailable."])

    client = anthropic.Anthropic(api_key=api_key)
    title = req.banner_text.strip()
    cta = (req.cta or "").strip()
    has_cta = bool(cta)
    n = max(1, min(5, req.concept_count or 1))
    locale = (req.locale or "en").strip()
    system = _system_prompt(has_cta)
    user = (
        f'Banner text (verbatim title): "{title}"\n'
        f"{('CTA: ' + cta) if has_cta else 'No CTA.'}\n"
        f"Locale: {locale}\n"
        f"Produce exactly {n} distinct concept(s) with rotated hooks."
    )

    try:
        raw = _call(client, settings.BRIEF_MODEL, system, user)
        concepts = _repair(_assemble(raw, title, cta, has_cta, locale, n), title, has_cta)
        errors = _validate(concepts)
        if errors:
            raw = _call(client, settings.BRIEF_MODEL, system, user,
                        extra_user="The previous concepts failed validation:\n- "
                                   + "\n- ".join(errors) + "\nFix and re-emit all concepts.")
            concepts = _repair(_assemble(raw, title, cta, has_cta, locale, n), title, has_cta)
            errors = _validate(concepts)
            if errors:
                raise BriefError(errors)
    except anthropic.AuthenticationError:
        raise BriefError(["ANTHROPIC_API_KEY was rejected by Anthropic."])
    except anthropic.APIStatusError as e:
        raise BriefError([f"Claude API error ({e.status_code})."])

    return [{"key": f"c{i+1}", **c} for i, c in enumerate(concepts)]
