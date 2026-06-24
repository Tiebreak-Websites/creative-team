"""Campaign-intent taxonomy + heuristic classifier for the banner engine.

Pure functions. No I/O, no side effects, stdlib only — this module imports
nothing from the rest of the app so it can never participate in an import cycle.

Given the raw copy of a banner campaign (a list of card dicts with the keys
``title`` / ``subtitle`` / ``button``, plus an optional style string), it
classifies the campaign into one of a small taxonomy of advertising intents.
The intent then steers two downstream things:

1. The image director — ``INTENT_DIRECTION`` provides one concise
   art-direction sentence per intent.
2. Finance-safety boundaries — finance intents (``investment_ad``,
   ``finance_ad``, ``trading_education_ad``) tighten copy-role mapping and
   creative guardrails. When in doubt the classifier degrades to the safe,
   non-finance ``general_ad`` default.

The central rule: a campaign with ANY finance signal is treated as a finance
intent regardless of competing product nouns (e.g. "Invierte en el líder de
*bebidas*" is investing, not a beverage product ad).
"""

from __future__ import annotations

import re

# ---------------------------------------------------------------------------
# Taxonomy
# ---------------------------------------------------------------------------
INTENTS: tuple[str, ...] = (
    "investment_ad",
    "finance_ad",
    "trading_education_ad",
    "product_ad",
    "corporate_trust_ad",
    "local_market_story",
    "high_ctr_hook_ad",
    "emotional_human_led_ad",
    "educational_ad",
    "SaaS_or_tech_ad",
    "general_ad",
)

# Degrades to STRICT / non-finance boundaries -> safe by default.
DEFAULT_INTENT = "general_ad"

# The three intents that trigger finance-specific copy roles and guardrails.
FINANCE_INTENTS: frozenset = frozenset(
    {"investment_ad", "finance_ad", "trading_education_ad"}
)


def is_finance_intent(intent: str) -> bool:
    """True if ``intent`` is one of the finance intents."""
    return intent in FINANCE_INTENTS


# ---------------------------------------------------------------------------
# Per-intent keyword lexicons (lowercase). Multiword phrases are matched as
# substrings; single tokens are matched word-boundary-ish (see _count_hits).
# ---------------------------------------------------------------------------
# The investment/finance lexicon is intentionally broad and MUST beat product
# nouns: a card that mentions "invest" + "beverages" is an investment ad.
_INVESTMENT_FINANCE_LEXICON: tuple[str, ...] = (
    "invest", "investing", "investor", "invierte", "invertir", "investir",
    "trading", "trade", "trader", "stock", "stocks", "share", "shares",
    "share price", "acciones", "ações", "market", "markets", "mercado",
    "bolsa", "valuation", "valuations", "ticker", "portfolio", "growth",
    "crescimento", "leader", "leading", "líder", "opportunity", "returns",
    "yield", "dividend", "equity", "equities", "fund", "etf", "broker",
    "bull", "bullish", "ipo", "earnings", "asset", "company performance",
    "outperform", "price movement",
)

# Trading-education keywords. These are the "learn how to trade" signals; on
# their own they do NOT make a campaign finance — they must co-occur with a
# finance keyword (see classify_heuristic).
_TRADING_EDUCATION_LEXICON: tuple[str, ...] = (
    "learn", "course", "curso", "how to", "aprende", "tutorial",
    "masterclass", "academy", "webinar",
)

_LEXICONS: dict[str, tuple[str, ...]] = {
    # All three finance intents share the broad finance lexicon for scoring;
    # the finer investment-vs-finance split is decided in classify_heuristic.
    "investment_ad": _INVESTMENT_FINANCE_LEXICON,
    "finance_ad": _INVESTMENT_FINANCE_LEXICON,
    "trading_education_ad": _TRADING_EDUCATION_LEXICON,
    "product_ad": (
        "buy", "sale", "discount", "new", "shop", "store", "flavor",
        "flavour", "taste", "refreshing", "deal", "offer", "price",
    ),
    "corporate_trust_ad": (
        "trusted", "since", "leading company", "enterprise", "reliable",
        "partner", "established", "award", "certified", "decades",
    ),
    "local_market_story": (
        "community", "local", "neighborhood", "neighbourhood", "region",
        "regional", "hometown", "near you", "in your city",
    ),
    "high_ctr_hook_ad": (
        "shocking", "secret", "you won't believe", "you wont believe",
        "limited", "hurry", "last chance", "only today", "act now",
    ),
    "emotional_human_led_ad": (
        "family", "dream", "future", "life", "together", "believe",
        "love", "hope", "journey",
    ),
    "educational_ad": (
        "learn", "guide", "explained", "tips", "understand", "how to",
        "step by step", "discover", "find out",
    ),
    "SaaS_or_tech_ad": (
        "app", "platform", "software", "ai", "cloud", "dashboard",
        "automation", "api", "integration", "saas", "workflow", "analytics",
    ),
}

# Investment-specific signals (a subset of the finance lexicon) that, when
# present, tip a finance campaign toward investment_ad over plain finance_ad.
_INVESTMENT_SIGNALS: tuple[str, ...] = (
    "invest", "investing", "investor", "invierte", "invertir", "investir",
    "shares", "share", "valuation", "valuations", "leader", "leading",
    "líder", "opportunity", "company performance", "ticker", "equity",
    "equities", "portfolio",
)


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------
def _count_hits(text_lower: str, keywords: tuple[str, ...]) -> int:
    """Count keyword hits in already-lowercased ``text_lower``.

    Multiword phrases (containing a space) match as plain substrings.
    Single tokens match word-boundary-ish so "share" does not fire on
    "shareholder"-style accidental substrings while still tolerating
    accented characters.
    """
    total = 0
    for kw in keywords:
        if " " in kw:
            total += text_lower.count(kw)
        else:
            # Word-boundary-ish: keyword not flanked by another word char.
            total += len(re.findall(r"(?<!\w)" + re.escape(kw) + r"(?!\w)", text_lower))
    return total


def score_intents(text: str) -> dict[str, float]:
    """Lowercase ``text`` and count keyword hits per intent.

    Returns ``{intent: score}`` for every non-default intent that has a
    lexicon. Intents without a lexicon (``general_ad``) are omitted; callers
    treat a missing/zero score as "no signal".
    """
    text_lower = (text or "").lower()
    return {
        intent: float(_count_hits(text_lower, keywords))
        for intent, keywords in _LEXICONS.items()
    }


def _card_text(card: dict) -> str:
    """Concatenate a card's title/subtitle/button, tolerating missing keys."""
    parts = [card.get("title"), card.get("subtitle"), card.get("button")]
    return " ".join(str(p) for p in parts if p)


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------
def classify_heuristic(
    cards: list[dict], style: str = ""
) -> tuple[str, float, bool]:
    """Classify a campaign's copy into one intent.

    Concatenates each card's ``title`` / ``subtitle`` / ``button`` plus
    ``style``, scores against every lexicon, and applies the finance-first
    rule.

    Returns ``(intent, confidence, ambiguous)`` where:
      * ``intent`` is one of ``INTENTS``.
      * ``confidence`` is in ``[0, 1]`` (top_score / sum_of_scores; a finance
        hit guarantees >= 0.6).
      * ``ambiguous`` is True when the top two non-finance scores are within a
        small margin OR confidence is below ~0.6.

    RULE: any finance lexicon hit -> a finance intent, regardless of product
    nouns. Among finance: ``investment_ad`` if an investment signal is present;
    ``trading_education_ad`` if a trading-education keyword co-occurs with a
    finance keyword; otherwise ``finance_ad``.
    """
    text = " ".join(_card_text(c) for c in (cards or []) if isinstance(c, dict))
    if style:
        text = f"{text} {style}"
    text_lower = text.lower()

    scores = score_intents(text)

    finance_hits = _count_hits(text_lower, _INVESTMENT_FINANCE_LEXICON)

    if finance_hits > 0:
        # Finance wins outright. Decide which finance intent.
        education_hits = _count_hits(text_lower, _TRADING_EDUCATION_LEXICON)
        investment_hits = _count_hits(text_lower, _INVESTMENT_SIGNALS)

        if investment_hits > 0:
            intent = "investment_ad"
        elif education_hits > 0:
            # trading-education keyword co-occurring with a finance keyword
            intent = "trading_education_ad"
        else:
            intent = "finance_ad"

        # Confidence from the finance signal's share of all signal, floored at
        # 0.6 so a guaranteed finance hit is never treated as low-confidence.
        total = sum(scores.values()) or 1.0
        confidence = max(0.6, finance_hits / total)
        confidence = min(1.0, confidence)
        # Ambiguous only if confidence somehow lands right at the floor and a
        # near-tie non-finance signal competes; finance hits are decisive, so
        # this is rarely flagged.
        ambiguous = confidence < 0.6
        return intent, confidence, ambiguous

    # No finance signal: pick the highest-scoring non-finance intent.
    nonfinance = {
        intent: sc
        for intent, sc in scores.items()
        if intent not in FINANCE_INTENTS
    }
    if not nonfinance or all(sc == 0 for sc in nonfinance.values()):
        # Zero signal -> safe default, low confidence, ambiguous.
        return DEFAULT_INTENT, 0.0, True

    ranked = sorted(nonfinance.items(), key=lambda kv: kv[1], reverse=True)
    top_intent, top_score = ranked[0]
    second_score = ranked[1][1] if len(ranked) > 1 else 0.0

    if top_score <= 0:
        return DEFAULT_INTENT, 0.0, True

    total = sum(nonfinance.values()) or 1.0
    confidence = top_score / total

    # Ambiguous when the runner-up is within a small margin of the top, or the
    # overall confidence is weak.
    margin = top_score - second_score
    ambiguous = (margin <= 1.0 and second_score > 0) or confidence < 0.6

    # A tie on the top score is genuinely ambiguous -> degrade to the default.
    if margin == 0 and second_score > 0:
        return DEFAULT_INTENT, confidence, True

    return top_intent, confidence, ambiguous


# ---------------------------------------------------------------------------
# Art direction — one concise sentence per intent, used to steer the director.
# Every key in INTENTS is present.
# ---------------------------------------------------------------------------
INTENT_DIRECTION: dict[str, str] = {
    "investment_ad": (
        "Premium fintech advertising: dark navy/deep-blue/emerald/black "
        "palette, strong contrast, bold dominant title or ticker, subtle "
        "abstract market graphics and growth cues as atmosphere, confident "
        "trustworthy cinematic mood, readable in 1-2 seconds."
    ),
    "finance_ad": (
        "Premium fintech advertising: dark navy/deep-blue/emerald/black "
        "palette, strong contrast, bold dominant title or ticker, subtle "
        "abstract market graphics and growth cues as atmosphere, confident "
        "trustworthy cinematic mood, readable in 1-2 seconds."
    ),
    "trading_education_ad": (
        "Premium fintech-education advertising: dark navy/deep-blue/emerald "
        "palette, strong contrast, a bold dominant title, subtle abstract "
        "market and growth cues as atmosphere, but an approachable, "
        "educational mentor tone — confident yet welcoming, readable fast."
    ),
    "product_ad": (
        "Premium product advertising: the product/benefit is hero, "
        "appetizing/aspirational lighting, lifestyle context, vibrant "
        "on-brand palette."
    ),
    "corporate_trust_ad": (
        "Polished corporate brand ad: trustworthy, established, clean "
        "modern, human warmth, premium not brochure-flat."
    ),
    "local_market_story": (
        "Authentic local-market storytelling: real community feel, "
        "regionally authentic styling and setting."
    ),
    "high_ctr_hook_ad": (
        "Scroll-stopping high-CTR hook: bold contrast, one punchy focal "
        "idea, strong curiosity, thumb-stopping energy."
    ),
    "emotional_human_led_ad": (
        "Emotional, human-led: a relatable aspirational person, warm "
        "cinematic light, genuine feeling, story-driven."
    ),
    "educational_ad": (
        "Clear educational ad: clean informative layout, friendly "
        "approachable, the key idea obvious and uncluttered."
    ),
    "SaaS_or_tech_ad": (
        "Modern SaaS/tech ad: sleek product-UI atmosphere, clean gradients, "
        "confident innovative mood, crisp typography."
    ),
    "general_ad": (
        "Premium, modern advertising composition with clear hierarchy and a "
        "single dominant idea."
    ),
}

# Invariant: every taxonomy intent must have an art-direction sentence.
assert set(INTENT_DIRECTION) == set(INTENTS), (
    "INTENT_DIRECTION must cover every intent in INTENTS"
)


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    examples = [
        (
            "investment (beats product noun)",
            [{"title": "CCU", "subtitle": "Invierte en el líder de bebidas de América Latina", "button": ""}],
            "",
        ),
        (
            "plain finance",
            [{"title": "Markets moved", "subtitle": "Track the bolsa and yields", "button": "See markets"}],
            "",
        ),
        (
            "trading education",
            [{"title": "Learn to trade", "subtitle": "A masterclass on the stock market", "button": "Enroll"}],
            "",
        ),
        (
            "product",
            [{"title": "New flavor", "subtitle": "Refreshing taste, on sale now", "button": "Shop"}],
            "",
        ),
        (
            "saas",
            [{"title": "Automate everything", "subtitle": "AI platform with API integration", "button": "Try the app"}],
            "",
        ),
        (
            "empty -> default",
            [{"title": "", "subtitle": "", "button": ""}],
            "",
        ),
    ]
    for label, cards, style in examples:
        intent, conf, amb = classify_heuristic(cards, style)
        print(f"[{label}] -> {intent}  conf={conf:.2f}  ambiguous={amb}")
