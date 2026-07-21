"""AI copy generation for campaign emails.

The house CRM copywriter, wired to the builder. The brain is the brand's own
guidelines — `crm_copywriter.md`, loaded verbatim as the system prompt — the
same document the team hand it to any LLM. This module's job is only to bridge
that brain to OUR concrete artifact: it hands the model the campaign's actual
ordered blocks (headline, each body paragraph, the CTA label, the offer
callout, support, sign-off) and asks for copy that fills each one, plus the
subject A/B variants and the pre-header.

Two things stay load-bearing, exactly as the guidelines demand:

  compliance   the offer NOUN is dictated by the audience's regulatory status.
               REG/EU gets discounts only; NONREG gets bonuses. We derive the
               segment from the brand's `regulation` and pass it in, so a
               percentage bonus can never be written in front of an EU user —
               and when the segment is unknown we ask for NO specific offer at
               all rather than guess (the guidelines' hard rule).
  char limits  subject and pre-header are a hard 50, enforced after the model
               returns, not merely requested.

Same shape as hero_ai: a strict-JSON call to gpt-5.5 via lp_materials._llm_json,
validate-and-degrade, never block. Runs inside the background-job worker so a
generation survives a refresh or a closed page.
"""
from __future__ import annotations

import functools
import logging
from pathlib import Path
from typing import Dict, List, Optional

from ..secrets import get_secret

log = logging.getLogger(__name__)

_PROMPT_PATH = Path(__file__).with_name("crm_copywriter.md")

# Hard house limits from the guidelines — enforced, not just requested.
_SUBJECT_MAX = 50
_PREHEADER_MAX = 50

# Compliance segments. NONE = write benefit/education copy with NO specific
# monetary offer — the safe path when the brand's regulatory status is unset,
# so we never guess an offer (the guidelines forbid guessing).
SEGMENTS = ("REG", "NONREG", "NONE")
TIERS = ("Retail", "Pro")


@functools.lru_cache(maxsize=1)
def _system_prompt() -> str:
    """The guidelines, verbatim, as the system prompt. Cached — it does not
    change between requests."""
    return _PROMPT_PATH.read_text(encoding="utf-8")


def segment_for(entity: Optional[dict], override: str = "") -> str:
    """Resolve the compliance segment. An explicit override wins; otherwise the
    brand's `regulation` decides: eu -> REG (discounts only), international ->
    NONREG (bonuses ok), unset -> NONE (no specific offer — never guessed)."""
    o = (override or "").strip().upper()
    if o in SEGMENTS:
        return o
    reg = str((entity or {}).get("regulation") or "").strip().lower()
    if reg == "eu":
        return "REG"
    if reg == "international":
        return "NONREG"
    return "NONE"


# What each copy-bearing block asks the writer to produce. Keyed by block key;
# value is an ordered list of (field_key, guidance). Blocks not listed here
# (logo, hero image, compliance footer, spacer) are not the copywriter's job.
_FIELD_GUIDE: Dict[str, List[tuple]] = {
    "em-headline": [
        ("headline", "In-body H1. Short and punchy, ~4-7 words, usually no "
                     "tokens. Compress the hook; do not repeat a subject line."),
    ],
    "em-body": [
        ("body", "Body paragraph(s) for THIS position in the email. 1-3 short "
                 "sentences. Keep line breaks with \\n. The FIRST body block "
                 "opens with the greeting 'Hi {{firstName}},' then the hook; "
                 "later body blocks carry explanation/desire. Across ALL body "
                 "blocks combined, keep the whole email body to 120-150 words."),
    ],
    "em-cta": [
        ("cta_label", "Button label. UPPERCASE, 1-2 words, matched to the ask "
                      "(LOGIN default; DEPOSIT for funding; SUBMIT DOCUMENTS "
                      "for KYC). Echo the body's closing imperative."),
    ],
    "em-highlight": [
        ("highlight_title", "One-line heading for the offer/benefit callout."),
        ("highlight_items", "A tick list, one item per line, each prefixed "
                            "'✔ '. This is where the offer lives: for REG "
                            "use DISCOUNTS only (spread/rollover discount, "
                            "commission-free trades); for NONREG use bonuses "
                            "(% trading bonus, insured positions, cash credit); "
                            "for NONE list plain benefits with NO monetary "
                            "offer. A 2-tier deposit ladder is ideal when there "
                            "is an offer."),
    ],
    "em-support": [
        ("support_title", "Short heading, e.g. 'Need assistance?'"),
        ("support_body", "One line inviting contact."),
        ("support_link_label", "Bracketed link label, e.g. '[CONTACT SUPPORT]'."),
        ("support_footer", "One reassuring closing line."),
    ],
    "em-signoff": [
        ("signoff", "Sign-off only, two lines: 'Regards,\\n{{BRAND_NAME}} team'."),
    ],
}


def is_copy_block(block_key: str) -> bool:
    return block_key in _FIELD_GUIDE


def build_spec(sections: List[dict]) -> List[dict]:
    """The ordered list of copy-bearing block instances to fill. Each entry:
    {iid, block_key, fields:[{key, guide, current}]}. Preserves email order so
    the model writes a coherent top-to-bottom message, not disconnected fields."""
    spec: List[dict] = []
    for s in sections or []:
        key = s.get("block_key")
        guide = _FIELD_GUIDE.get(key)
        if not guide:
            continue
        texts = s.get("texts") or {}
        spec.append({
            "iid": s.get("iid"),
            "block_key": key,
            "fields": [{"key": fk, "guide": g, "current": str(texts.get(fk) or "")}
                       for fk, g in guide],
        })
    return spec


_SEGMENT_RULE = {
    "REG": "AUDIENCE IS REGULATED / EU (REG). Offer DISCOUNTS ONLY — spread "
           "discounts, rollover discounts, commission-free or spread-free "
           "trades. NEVER a percentage deposit bonus, insured positions, loss "
           "coverage or cash credit. This is a compliance line, not a "
           "preference.",
    "NONREG": "AUDIENCE IS NON-REGULATED / non-EU (NONREG). Bonuses are allowed "
              "— percentage trading/deposit bonuses, insured positions, cash "
              "credits — alongside a plain risk note.",
    "NONE": "OFFER STATUS UNKNOWN. Do NOT write any specific monetary offer, "
            "bonus, or discount. Write benefit- and education-led copy only; "
            "the highlight list is plain benefits, not an offer.",
}


def _build_user_text(*, brand_name: str, segment: str, tier: str, language: str,
                     brief: str, spec: List[dict]) -> str:
    lines = [
        "TASK: write the copy for ONE marketing email, filling the exact blocks "
        "below. Apply everything in the system guidelines — house voice, "
        "sequencing, tokens, and the character limits — to THIS structure.",
        "",
        f"Brand: {brand_name or '{{BRAND_NAME}} (dynamic — use the token)'}",
        f"Language: {language or 'EN'}",
        f"Audience tier: {tier}",
        f"Compliance: {_SEGMENT_RULE.get(segment, _SEGMENT_RULE['NONE'])}",
        "",
        f"Campaign brief from the author:\n{brief or '(none given — infer a sensible on-brand campaign from the brand and blocks)'}",
        "",
        "Return, via the required JSON schema:",
        f"  - subjects: 2-3 A/B subject variants, EACH ≤ {_SUBJECT_MAX} "
        "characters, no emoji, reframing the same hook (statement / question / "
        "benefit).",
        f"  - preheader: one line ≤ {_PREHEADER_MAX} characters that "
        "EXTENDS the subject (never repeats it).",
        "  - items: one {iid, key, value} per field listed below. Use the iid "
        "and key EXACTLY as given. Fill every field.",
        "",
        "The email's blocks, IN ORDER:",
    ]
    n = 0
    for blk in spec:
        for f in blk["fields"]:
            n += 1
            cur = f["current"].replace("\n", " ")[:80]
            lines.append(
                f'{n}. iid="{blk["iid"]}" key="{f["key"]}" ({blk["block_key"]})'
                f' — {f["guide"]}'
                + (f'  [replacing placeholder: "{cur}"]' if cur else ""))
    lines.append("")
    lines.append("Write real copy for every field. No lorem ipsum, no editorial "
                 "notes in parentheses, no invented legal text.")
    return "\n".join(lines)


def _copy_schema(spec: List[dict]) -> dict:
    # The valid (iid, key) pairs are known — but strict JSON schema cannot bind
    # a value to a key from another field, so we validate the pairing after the
    # call and let the schema enforce only the shape.
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["subjects", "preheader", "items"],
        "properties": {
            "subjects": {
                "type": "array",
                "description": f"2-3 A/B subject variants, each ≤ {_SUBJECT_MAX} chars, no emoji.",
                "items": {"type": "string"},
            },
            "preheader": {
                "type": "string",
                "description": f"≤ {_PREHEADER_MAX} chars; extends the subject.",
            },
            "items": {
                "type": "array",
                "description": "One entry per field to fill.",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["iid", "key", "value"],
                    "properties": {
                        "iid": {"type": "string"},
                        "key": {"type": "string"},
                        "value": {"type": "string"},
                    },
                },
            },
        },
    }


def _clean_subjects(raw) -> List[str]:
    out: List[str] = []
    for s in (raw or []):
        s = " ".join(str(s).split())  # collapse whitespace/newlines
        if not s:
            continue
        # Hard house limit. Trim on a word boundary rather than mid-word.
        if len(s) > _SUBJECT_MAX:
            s = s[:_SUBJECT_MAX].rsplit(" ", 1)[0].rstrip(" ,.;:-") or s[:_SUBJECT_MAX]
        if s not in out:
            out.append(s)
    return out[:3]


def generate_copy(*, entity: Optional[dict], brief: str, segment: str,
                  tier: str, language: str, spec: List[dict]) -> dict:
    """Fill the email's blocks with house copy.

    Raises LookupError when no API key is configured, ValueError when there is
    nothing to write, RuntimeError on a model failure. Returns
    {subjects, preheader, items:[{iid,key,value}]} — items validated to the
    (iid,key) pairs actually in `spec`.
    """
    api_key = get_secret("OPENAI_API_KEY")
    if not api_key:
        raise LookupError("OPENAI_API_KEY")
    if not spec:
        raise ValueError("This layout has no copy blocks to write.")

    seg = segment if segment in SEGMENTS else "NONE"
    tr = tier if tier in TIERS else "Retail"
    brand_name = str((entity or {}).get("name") or "").strip()

    from .. import lp_materials
    user = _build_user_text(brand_name=brand_name, segment=seg, tier=tr,
                            language=language or "EN", brief=brief, spec=spec)
    out = lp_materials._llm_json(
        api_key, system=_system_prompt(), user_text=user,
        schema_name="email_copy", schema=_copy_schema(spec),
        effort="medium", timeout=150)

    # Validate the (iid, key) pairs against what we actually asked for — the
    # model can only write into fields that exist on this campaign.
    allowed = {(b["iid"], f["key"]) for b in spec for f in b["fields"]}
    items = []
    seen = set()
    for it in (out.get("items") or []):
        iid, key = str(it.get("iid") or ""), str(it.get("key") or "")
        val = str(it.get("value") or "").strip()
        if (iid, key) in allowed and (iid, key) not in seen and val:
            items.append({"iid": iid, "key": key, "value": val})
            seen.add((iid, key))

    subjects = _clean_subjects(out.get("subjects"))
    preheader = " ".join(str(out.get("preheader") or "").split())[:_PREHEADER_MAX]

    if not items and not subjects:
        raise RuntimeError("The copywriter returned nothing usable.")

    missing = [k for k in allowed if k not in seen]
    if missing:
        log.info("email-copy: %d field(s) left unfilled by the model", len(missing))

    return {"subjects": subjects, "preheader": preheader, "items": items,
            "segment": seg, "tier": tr}
