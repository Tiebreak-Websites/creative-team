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


# ---- content -> hero-image brief -------------------------------------------
# The approved copy is the best context for the hero image: the image should
# show what the email is ABOUT. This turns the written content into a short,
# concrete visual brief that drops straight into the hero generator.

_IMG_BRIEF_SYSTEM = (
    "You turn a marketing email's copy into a SHORT visual brief for its ONE "
    "hero image. Read the subject, headline, body and offer, then describe — in "
    "1-2 sentences, 35-70 words — what the hero image should SHOW: a concrete, "
    "photographable subject/scene, the mood, and how it ties to the message. "
    "Specific, never abstract adjectives alone. The image carries NO text (the "
    "email supplies the words). Stay on-brand for a financial-education / "
    "trading brand: credible, optimistic, no hype, no logos, no real people's "
    "likenesses, no charts-with-fake-numbers."
)

_IMG_BRIEF_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["brief"],
    "properties": {
        "brief": {"type": "string",
                  "description": "35-70 words, one concrete hero-image visual "
                                 "brief derived from the email content."},
    },
}

# Which field each block contributes to the content digest the image brief is
# built from.
_DIGEST_KEYS = {
    "em-headline": ("headline", ("headline",)),
    "em-body": ("body", ("body",)),
    "em-highlight": ("offer", ("highlight_title", "highlight_items")),
}


def content_digest(sections: List[dict]) -> Dict[str, str]:
    """Pull the readable content out of a campaign's blocks: the headline, the
    body (all body blocks joined in order) and the offer. What the image should
    be about."""
    headline, offer = "", ""
    bodies: List[str] = []
    for s in sections or []:
        spec = _DIGEST_KEYS.get(s.get("block_key"))
        if not spec:
            continue
        texts = s.get("texts") or {}
        bucket, keys = spec
        val = "\n".join(str(texts.get(k) or "").strip() for k in keys if texts.get(k)).strip()
        if not val:
            continue
        if bucket == "headline" and not headline:
            headline = val
        elif bucket == "body":
            bodies.append(val)
        elif bucket == "offer" and not offer:
            offer = val
    return {"headline": headline, "body": "\n\n".join(bodies).strip(), "offer": offer}


def _fallback_brief(headline: str) -> str:
    base = headline.strip() or "A confident, welcoming financial-education moment"
    return (f"{base}. A clean, optimistic on-brand scene that conveys the "
            "message at a glance — professional and credible, no text.")


def image_brief(*, entity: Optional[dict], subject: str, headline: str,
                body: str, offer: str) -> str:
    """The approved email content -> a concrete hero-image brief, via the LLM.
    Validate-and-degrade: any failure returns a deterministic brief so the hero
    generator always gets something usable."""
    api_key = get_secret("OPENAI_API_KEY")
    if not api_key:
        raise LookupError("OPENAI_API_KEY")
    if not (headline or body or offer or subject):
        raise ValueError("There is no email content to build an image brief from yet.")

    brand = str((entity or {}).get("name") or "").strip()
    parts = []
    if brand:
        parts.append(f"Brand: {brand}")
    if subject:
        parts.append(f"Subject: {subject}")
    if headline:
        parts.append(f"Headline: {headline}")
    if body:
        parts.append(f"Body:\n{body[:1200]}")
    if offer:
        parts.append(f"Offer:\n{offer[:400]}")
    user = ("Write the hero-image brief for this email.\n\n" + "\n\n".join(parts))

    from .. import lp_materials
    try:
        out = lp_materials._llm_json(
            api_key, system=_IMG_BRIEF_SYSTEM, user_text=user,
            schema_name="email_image_brief", schema=_IMG_BRIEF_SCHEMA,
            effort="low", timeout=60)
        got = str(out.get("brief") or "").strip()
        if 30 <= len(got) <= 700:
            return got
    except Exception:
        log.exception("email-copy: image-brief generation failed, using fallback")
    return _fallback_brief(headline)


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
                     brief: str, spec: List[dict], greeting: bool = True) -> str:
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
            guide = f["guide"]
            if not greeting:
                # Neutralise the body block's built-in greeting instruction so it
                # does not fight the "no greeting" rule appended below.
                guide = guide.replace(
                    "opens with the greeting 'Hi {{firstName}},' then the hook",
                    "opens directly with the hook (NO greeting line)")
            lines.append(
                f'{n}. iid="{blk["iid"]}" key="{f["key"]}" ({blk["block_key"]})'
                f' — {guide}'
                + (f'  [replacing placeholder: "{cur}"]' if cur else ""))
    lines.append("")
    lines.append("Write real copy for every field. No lorem ipsum, no editorial "
                 "notes in parentheses, no invented legal text.")
    if not greeting:
        lines.append(
            "GREETING: do NOT include one. The first body block starts DIRECTLY "
            "with the hook — no 'Hi {{firstName}},', no 'Dear …', no salutation "
            "of any kind. (This overrides the per-field greeting note above.)")
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
                  tier: str, language: str, spec: List[dict],
                  greeting: bool = True) -> dict:
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
                            language=language or "EN", brief=brief, spec=spec,
                            greeting=greeting)
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

    # Derive the hero-image brief from the copy we just wrote, so the image
    # generator starts from the approved content, not a blank field. A failure
    # here must not fail the copy — fall back to a deterministic brief.
    by_key: Dict[str, List[str]] = {}
    for it in items:
        by_key.setdefault(it["key"], []).append(it["value"])
    headline = (by_key.get("headline") or [""])[0]
    body = "\n\n".join(by_key.get("body") or [])
    offer = "\n".join((by_key.get("highlight_title") or [])
                      + (by_key.get("highlight_items") or []))
    try:
        img_brief = image_brief(entity=entity, subject=(subjects[0] if subjects else ""),
                                headline=headline, body=body, offer=offer)
    except Exception:
        log.exception("email-copy: image brief step failed")
        img_brief = _fallback_brief(headline)

    return {"subjects": subjects, "preheader": preheader, "items": items,
            "segment": seg, "tier": tr, "image_brief": img_brief}
