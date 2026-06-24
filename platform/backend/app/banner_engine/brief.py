"""Copy-role mapping, brief flattening, and targeted correction.

Pure functions. No I/O, no side effects, stdlib only — this module imports
nothing from the rest of the app so it can never cause an import cycle.

Three responsibilities:

1. ``map_copy_roles`` — turn a raw card (``title`` / ``subtitle`` / ``button``)
   into structured copy roles. For finance intents a short / all-caps title is
   treated as the dominant typographic anchor (brand or ticker) rather than a
   headline.
2. ``flatten_brief`` — deterministically serialize a structured brief object
   back into ONE compact prose string for the image engine. This feeds the live
   prompt, so it is defensive: tolerates a plain string or ``None``.
3. ``build_correction`` — return a NEW brief dict with TARGETED edits driven by
   an evaluator's ``correction_focus`` tags, strengthening (never blanking)
   the relevant fields.
"""

from __future__ import annotations

# Inlined to avoid importing intent.py (keeps this module dependency-free).
_FINANCE_INTENTS = {"investment_ad", "finance_ad", "trading_education_ad"}

# Fields a flattened brief serializes, in deterministic order.
_BRIEF_FIELD_ORDER: tuple[str, ...] = (
    "concept",
    "subject_strategy",
    "background_strategy",
    "composition_strategy",
    "typography_strategy",
    "color_palette",
    "lighting",
    "mood",
    "size_behavior",
)

_FLATTEN_HARD_CAP = 600


# ---------------------------------------------------------------------------
# Copy roles
# ---------------------------------------------------------------------------
def _clean(value) -> str:
    """Coerce a possibly-missing/None field to a stripped string."""
    if value is None:
        return ""
    return str(value).strip()


def _is_anchor_title(title: str) -> bool:
    """True if a finance title reads as a brand/ticker anchor.

    Heuristic: very short (<=6 chars) OR all-caps with no internal spaces
    (e.g. "CCU", "AAPL", "PETRONAS").
    """
    if not title:
        return False
    if len(title) <= 6:
        return True
    if " " not in title and title.upper() == title and any(c.isalpha() for c in title):
        return True
    return False


def map_copy_roles(card: dict, intent: str) -> dict:
    """Map a raw card to structured copy roles for the given intent.

    Output keys (all strings, "" when absent): ``brand_or_ticker``,
    ``main_title``, ``headline``, ``body``, ``cta``, ``disclaimer``,
    ``market``, ``language``.

    For a finance intent, a short / all-caps title becomes ``brand_or_ticker``
    (the dominant typographic anchor) and the subtitle becomes the
    ``headline``; otherwise the title is the ``main_title`` and the subtitle is
    the ``headline``. ``button`` always maps to ``cta``.
    """
    card = card or {}
    title = _clean(card.get("title"))
    subtitle = _clean(card.get("subtitle"))
    button = _clean(card.get("button"))

    roles = {
        "brand_or_ticker": "",
        "main_title": "",
        "headline": "",
        "body": "",
        "cta": button,
        "disclaimer": "",
        "market": "",
        "language": "",
    }

    if intent in _FINANCE_INTENTS and _is_anchor_title(title):
        roles["brand_or_ticker"] = title
        roles["headline"] = subtitle
    else:
        roles["main_title"] = title
        roles["headline"] = subtitle

    return roles


# ---------------------------------------------------------------------------
# Brief flattening
# ---------------------------------------------------------------------------
def flatten_brief(brief_obj) -> str:
    """Serialize a structured brief into ONE compact prose string.

    Includes only non-empty fields, in ``_BRIEF_FIELD_ORDER``, joined into
    readable phrases. Targets ~300-450 chars and hard-caps at ~600.

    Tolerant by design (it feeds the live prompt):
      * ``brief_obj`` is a dict -> serialize per the field order.
      * ``brief_obj`` is a plain string -> return it (capped).
      * ``brief_obj`` is None / falsy -> return "".
    """
    if not brief_obj:
        return ""
    if isinstance(brief_obj, str):
        return brief_obj.strip()[:_FLATTEN_HARD_CAP]
    if not isinstance(brief_obj, dict):
        return str(brief_obj).strip()[:_FLATTEN_HARD_CAP]

    parts: list[str] = []
    for key in _BRIEF_FIELD_ORDER:
        value = brief_obj.get(key, "")
        if value is None:
            continue
        value = str(value).strip()
        if not value:
            continue
        # Ensure each phrase ends cleanly so they read as separate sentences.
        if value[-1] not in ".!?;":
            value += "."
        parts.append(value)

    flat = " ".join(parts).strip()
    if len(flat) > _FLATTEN_HARD_CAP:
        flat = flat[:_FLATTEN_HARD_CAP].rstrip()
    return flat


# ---------------------------------------------------------------------------
# Targeted correction
# ---------------------------------------------------------------------------
def _append(brief: dict, field: str, addition: str) -> None:
    """Append ``addition`` to ``brief[field]`` without blanking existing text."""
    existing = brief.get(field)
    existing = "" if existing is None else str(existing).strip()
    addition = addition.strip()
    if not existing:
        brief[field] = addition
    elif addition.lower() in existing.lower():
        brief[field] = existing  # already present, no double-up
    else:
        sep = "" if existing.endswith((".", "!", "?", ";")) else "."
        brief[field] = f"{existing}{sep} {addition}".strip()


def build_correction(brief_obj: dict, eval_result: dict) -> dict:
    """Return a NEW brief dict with targeted edits per ``correction_focus``.

    ``eval_result.get("correction_focus", [])`` is a list of tag strings. Each
    recognized tag strengthens (never blanks) the relevant brief field.
    Unknown tags are ignored. Never introduces invented numbers.

    Supported tags: ``title_dominant``, ``integrate_not_split``,
    ``more_finance_bg``, ``remove_retail_shelf``, ``improve_hierarchy``,
    ``increase_contrast``, ``integrate_subject``, ``remove_extra_text``,
    ``less_template``.
    """
    # Work on a shallow copy so the caller's object is never mutated.
    if not isinstance(brief_obj, dict):
        brief = {}
    else:
        brief = dict(brief_obj)

    focus = []
    if isinstance(eval_result, dict):
        raw = eval_result.get("correction_focus", [])
        if isinstance(raw, (list, tuple)):
            focus = [str(t).strip() for t in raw if t]
        elif isinstance(raw, str) and raw.strip():
            focus = [raw.strip()]

    for tag in focus:
        if tag == "title_dominant":
            _append(
                brief, "typography_strategy",
                "Make the title/ticker clearly the largest, most dominant "
                "element in the composition — unmistakably the type-hero.",
            )
        elif tag == "integrate_not_split":
            _append(
                brief, "composition_strategy",
                "One integrated composition — NO split-panel / no divided "
                "halves; subject, type and background share a single unified "
                "scene.",
            )
        elif tag == "more_finance_bg":
            _append(
                brief, "background_strategy",
                "Push the background toward a premium finance/market "
                "atmosphere — subtle market-data textures, deep navy/emerald "
                "depth, confident fintech mood.",
            )
        elif tag == "remove_retail_shelf":
            _append(
                brief, "background_strategy",
                "No supermarket, store, shelf, or product-rack scenes — keep "
                "the setting off any retail floor.",
            )
        elif tag == "improve_hierarchy":
            _append(
                brief, "typography_strategy",
                "Establish a clearer visual hierarchy — one obvious dominant "
                "element, supporting copy plainly subordinate.",
            )
        elif tag == "increase_contrast":
            _append(
                brief, "color_palette",
                "Increase contrast for instant readability — stronger "
                "figure/ground separation.",
            )
            _append(
                brief, "lighting",
                "Stronger contrast and directional light to lift the focal "
                "element off the background.",
            )
        elif tag == "integrate_subject":
            _append(
                brief, "subject_strategy",
                "The person is naturally integrated into the scene — shared "
                "lighting and overlap with the background, never a cut-out "
                "pasted on top.",
            )
        elif tag == "remove_extra_text":
            _append(
                brief, "typography_strategy",
                "Render only the provided copy — remove any extra or garbled "
                "text, stray labels, fake buttons, invented logos, or "
                "fabricated numbers.",
            )
        elif tag == "less_template":
            _append(
                brief, "composition_strategy",
                "It should feel like a real, art-directed campaign ad — not a "
                "corporate template, slide, or stock brochure.",
            )
        # Unknown tag: ignore.

    return brief


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print("=" * 70)
    print("COPY ROLES")
    print("=" * 70)
    card = {
        "title": "CCU",
        "subtitle": "Invierte en el líder de bebidas de América Latina",
        "button": "",
    }
    print(map_copy_roles(card, "investment_ad"))
    print(map_copy_roles({"title": "Refresh your day", "subtitle": "New flavor", "button": "Shop"}, "product_ad"))

    print("\n" + "=" * 70)
    print("FLATTEN")
    print("=" * 70)
    bo = {
        "concept": "Type-hero investment poster",
        "subject_strategy": "no human, the ticker is the hero",
        "background_strategy": "deep navy market depth",
        "composition_strategy": "centered, single unified scene",
        "typography_strategy": "condensed display, ticker dominant",
        "color_palette": "navy, emerald, black",
        "lighting": "cinematic rim light",
        "mood": "confident, trustworthy",
        "size_behavior": "reflow per aspect",
    }
    flat = flatten_brief(bo)
    print(f"({len(flat)} chars) {flat}")
    print("string passthrough:", flatten_brief("already prose"))
    print("none ->", repr(flatten_brief(None)))

    print("\n" + "=" * 70)
    print("CORRECTION")
    print("=" * 70)
    corrected = build_correction(
        bo, {"correction_focus": ["title_dominant", "remove_retail_shelf", "unknown_tag"]}
    )
    print("orig typography:", bo["typography_strategy"])
    print("new  typography:", corrected["typography_strategy"])
    print("new  background:", corrected["background_strategy"])
    print("original untouched:", bo["typography_strategy"] != corrected["typography_strategy"])
