"""Prompt assembly + moderation pre-flight for /banner-openai v1.7.

Pure functions. No I/O, no side effects. Imported by run.py.

Moves the 6-section Visual Prompt Template (and the four mandatory
auto-injections - localization atmosphere, typography rule, RTL composition,
forbidden defaults) out of Claude's per-run reasoning and into reproducible
Python. Saves ~$0.30/run in Claude tokens, makes prompt logic unit-testable,
and keeps the same structure as the framework spec at
.claude/memory/banner_design_framework.md.
"""

from typing import Optional

# ---------------------------------------------------------------------------
# Localization atmosphere allowlists (mirrors framework Localization section)
# ---------------------------------------------------------------------------
LOCALIZATION_ATMOS = {
    "en":      "Clean editorial premium, navy + ivory + accent.",
    "pt-BR":   "Vibrant but composed, navy + warm gold or signal green accent.",
    "pt-PT":   "Restrained European editorial, navy + ivory + muted accent.",
    "es-LATAM":"Sao Paulo / Mexico City warm daylight, terracotta + sun-saturated colors.",
    "es-ES":   "Restrained European editorial, navy + ivory + muted accent.",
    "sv":      "Faint Stockholm cool-daylight skyline in deep navy.",
    "de":      "Berlin / Zurich skyline silhouette, engineering-precision structure, neutral grey + accent.",
    "tr":      "Istanbul skyline silhouette, warm daylight, navy + amber accent.",
    "th":      "Bangkok temple gold-tone + soft warm light, saturated jewel-tone palette.",
    "ja":      "Tokyo / Kyoto refined minimalism, ink-and-gold or refined neon palette.",
    "zh":      "Dense city neon abstracted into color flow, glass-tower silhouette, tech gradient.",
    "ms":      "Kuala Lumpur skyline, warm tropical light, deep black + rich gold + ivory.",
    "id":      "Jakarta skyline, warm tropical daylight, terracotta + saffron + ivory.",
    "ar":      "Gulf skyline silhouette, marble-texture gradient + restrained gold-line ornament.",
    "he":      "Levantine warm sandstone + deep blue palette, restrained ornament.",
    "ur":      "South-Asian metropolitan, deep teal + warm amber palette.",
    "fa":      "Persian deep turquoise + warm sand + gold-line ornament.",
    "ps":      "South-Asian metropolitan, deep teal + warm amber palette.",
}

# ---------------------------------------------------------------------------
# Aspect-Ratio Layout Locks (one tight line per supported size)
# ---------------------------------------------------------------------------
_SQUARE  = "Layout 1:1: title block center-left, oversized highlight dominates; visual support lower-right; clean copy zone."
_WIDE    = "Layout 1200x628 wide: title + oversized highlight left 45%; visual right 55%; horizontal composition; 12% safe top+bottom."
_TALL    = "Layout 9:16 tall: title top 25-30% with oversized highlight; visual center 40-50%; mobile safe top 8% + bottom 12%; 10% safe left+right."
_PORTRAIT= "Layout 4:5 portrait: title upper third; visual center; premium editorial poster, campaign-designed; 10% safe left+right."
_LANDSCAPE="Layout 16:9 landscape: title left 40%; large visual atmosphere right; cinematic campaign, not a photo with text."
_MILDWIDE = "Layout 5:4 mild-wide: title + highlight left 45%; visual right 55%; horizontal composition."

LAYOUT_LOCKS = {
    "1200x1200": _SQUARE,
    "1080x1080": _SQUARE,
    "1200x628":  _WIDE,
    "1080x1920": _TALL,
    "1080x1350": _PORTRAIT,
    "960x1200":  _PORTRAIT,
    "1920x1080": _LANDSCAPE,
    "1200x960":  _MILDWIDE,
}

# ---------------------------------------------------------------------------
# Register cues (mirrors framework Register table)
# ---------------------------------------------------------------------------
REGISTER_MOOD_PHRASES = {
    "aspiration":  "aspiration mood",
    "urgency":     "urgency mood",
    "provocation": "provocation mood",
    "trust":       "trust mood",
    "curiosity":   "curiosity mood",
    "empowerment": "empowerment mood",
    "identity":    "identity mood",
}

# Accented chars that have triggered gpt-image-2 letter-truncation glitches
_ACCENTED_CHARS = set("ãçôéíñüäöåøàèùâêîûÿÄÖÅŞĞÇÖÜİŁŻŹĆŃŚŚŁ")
_RTL_LOCALES = {"ar", "he", "ur", "fa", "ps"}

# ---------------------------------------------------------------------------
# Hard guardrails - moderation pre-flight (mirrors framework Hard guardrails)
# ---------------------------------------------------------------------------
# Case-insensitive substring checks against user-supplied input fields only.
# Skips the OpenAI call when a hit is found - saves ~30s + ~$0.04/blocked job.
FORBIDDEN_KEYWORDS = {
    # Politicians (any era, any country) - explicit user authorization required
    "trump", "biden", "obama", "clinton", "bush", "harris",
    "putin", "zelensky", "lavrov", "medvedev",
    "xi jinping", "xi-jinping",
    "modi", "merkel", "macron", "scholz", "sunak", "starmer", "meloni",
    "erdogan", "netanyahu", "khamenei",
    # Specific real persons (often blocked / brand-risky without authorization)
    "elon musk", "jeff bezos", "bill gates", "mark zuckerberg",
    "warren buffett", "michael jordan", "lebron james",
    "taylor swift", "kanye west", "drake",
    # Politically sensitive places + symbols
    "capitol building", "the capitol", "the kremlin",
    "us flag", "american flag", "russian flag", "chinese flag",
    "swastika", "hammer and sickle",
    # Visual concepts banned by framework
    "partisan colors", "real person",
}


def has_accented_chars(text: str) -> bool:
    """True if text contains chars known to glitch gpt-image-2 typography."""
    return any(c in _ACCENTED_CHARS for c in text)


def needs_typography_rule(title: str) -> bool:
    """Title triggers the auto-injected legibility/punctuation hard rule."""
    return has_accented_chars(title) or "?" in title or "!" in title


def is_rtl(locale: str) -> bool:
    """True if the locale renders RTL (Arabic, Hebrew, Urdu, Farsi, Pashto)."""
    return locale.lower() in _RTL_LOCALES


def localization_line(locale: str) -> str:
    """Return the one-line atmosphere allowlist for a locale, or default."""
    return LOCALIZATION_ATMOS.get(locale, LOCALIZATION_ATMOS["en"])


def layout_lock(size: str) -> str:
    """Return the per-aspect-ratio layout lock line."""
    if size not in LAYOUT_LOCKS:
        raise ValueError(
            f"Unsupported size: {size}. "
            f"Supported: {sorted(LAYOUT_LOCKS.keys())}"
        )
    return LAYOUT_LOCKS[size]


def register_mood(register: str) -> str:
    """Map a register key to its mood phrase, default 'curiosity mood'."""
    return REGISTER_MOOD_PHRASES.get(register.lower(), "curiosity mood")


def build_prompt(concept: dict, size: str) -> str:
    """Compose the 6-section Visual Prompt Template for one (concept, size).

    `concept` shape (all optional unless marked required):
      - title           (required, str)            verbatim Title
      - locale          (str, default 'en')        e.g. 'sv', 'pt-BR'
      - register        (str, default 'curiosity') e.g. 'empowerment'
      - hook_phrase     (str, default '')          phrase to oversize as type-hero
      - lp_visual_style (str, default brand-neutral) one-line LP description
      - palette_hex     (list[str], default [])    locked palette
      - concept_visual  (str, default '')          one-line per-concept visual hook
      - avoid           (str, default safe list)   per-concept cliche avoidance

    Returns: a prompt string, ~750-900 chars typical, ready for OpenAI gen.
    Uses ASCII-only punctuation in template glue; user title passed through verbatim.
    """
    title = concept["title"]
    locale = concept.get("locale", "en")
    register = concept.get("register", "curiosity")
    hook = (concept.get("hook_phrase") or "").strip()
    lp_style = (concept.get("lp_visual_style") or "premium on-brand palette").strip()
    palette = concept.get("palette_hex") or []
    visual = (concept.get("concept_visual") or "polished campaign composition with clean copy zone").strip()
    avoid = (concept.get("avoid") or
             "dark office, desk, laptop, hands on keyboard, classroom, hard split-panel, generic stock photo").strip()

    palette_str = " + ".join(palette) if palette else "on-brand"
    locale_atmos = localization_line(locale)
    layout = layout_lock(size)
    mood = register_mood(register)

    sections = [
        f"Premium {locale} paid-social campaign poster, {mood}. NOT an editorial office photo.",
        f"Palette LOCKED: {palette_str}. LP: {lp_style}. {locale_atmos}",
    ]
    if hook:
        sections.append(
            f'Hero: "{hook}" oversized highlight typography. '
            f"Visual: {visual}. Curved gradient panels, polished campaign lighting."
        )
    else:
        sections.append(
            f"Visual: {visual}. Curved gradient panels, polished campaign lighting."
        )
    sections.append(layout)
    sections.append(f'Title verbatim: "{title}"')

    if hook:
        sections.append(
            f'Readable text only: this Title (the "{hook}" oversized). '
            "No CTA, logos, fake UI, invented numbers, flags, faces, real person."
        )
    else:
        sections.append(
            "Readable text only: this Title. "
            "No CTA, logos, fake UI, invented numbers, flags, faces, real person."
        )
    sections.append(f"Avoid: {avoid}.")

    if needs_typography_rule(title):
        sections.append(
            "Render every word fully and legibly with all accents intact. "
            "Punctuation sits clearly AFTER the final letter - never overlap or cut letters."
        )
    if is_rtl(locale):
        sections.append("RTL composition: mirror visual hierarchy, title enters from right.")

    return "\n".join(sections)


# ---------------------------------------------------------------------------
# Layout-family labels for the Recomposition prompt header
# ---------------------------------------------------------------------------
LAYOUT_FAMILY = {
    "1200x1200": "SQUARE",
    "1080x1080": "SQUARE",
    "1200x628":  "WIDE",
    "1920x1080": "LANDSCAPE",
    "1200x960":  "MILD WIDE",
    "1080x1920": "TALL",
    "1080x1350": "PORTRAIT",
    "960x1200":  "PORTRAIT",
}


def build_recomp_prompt(concept: dict, master_size: str, target_size: str) -> str:
    """Compose a recomposition prompt for the /v1/images/edits endpoint.

    Sent with the MVP (master) image as the input image. The model is told to
    REDESIGN the layout for the new aspect, NOT to generate a fresh image. Same
    campaign, same text, same colors, same typography - just repositioned.

    Mirrors framework's § Recomposition Prompt Template (.claude/memory/
    banner_design_framework.md). Target ~800-1100c, hard cap 1200c.
    """
    if target_size == master_size:
        raise ValueError(f"recomp target {target_size} == master {master_size}; recomp must change aspect")
    if target_size not in LAYOUT_LOCKS:
        raise ValueError(f"recomp target {target_size} not in LAYOUT_LOCKS")

    title = concept["title"]
    locale = concept.get("locale", "en")
    hook = (concept.get("hook_phrase") or "").strip()
    palette = concept.get("palette_hex") or []
    visual = (concept.get("concept_visual") or "").strip()

    palette_str = " + ".join(palette) if palette else "from master"
    family = LAYOUT_FAMILY.get(target_size, "TARGET")
    layout = layout_lock(target_size)

    sections = [
        f"RECOMPOSE the attached master ({master_size}) into {target_size}. "
        "Same campaign, same text, same colors, same typography. "
        "NOT a stretch, NOT a crop, NOT a fresh generation. "
        "Layout is REDESIGNED for this aspect - never split-panel.",
        f"NEW LAYOUT ({family}): {layout}",
        "CAMPAIGN ELEMENT MANIFEST (preserve, reposition, do not remove):",
        "- title hierarchy and verbatim text",
        (f'- highlight treatment: "{hook}" stays the oversized type-hero'
         if hook else "- highlight treatment from master"),
        (f"- main visual metaphor: {visual}"
         if visual else "- main visual metaphor from master"),
        f"- color system: {palette_str}",
        "- market atmosphere and graphic panel style from master",
        f'TITLE (verbatim): "{title}".',
        f"Constraints: exactly {target_size} px. No new content. No watermarks. "
        "NO HARD SPLIT-PANEL. NO regression into dark office, desk, lamp, fake UI, real person, flag.",
    ]
    if is_rtl(locale):
        sections.append("RTL composition: keep mirrored direction, title block on right.")
    if needs_typography_rule(title):
        sections.append(
            "Render every word fully and legibly with all accents intact. "
            "Punctuation sits clearly AFTER the final letter - never overlap or cut letters."
        )
    return "\n".join(sections)


def check_moderation(concept: dict) -> tuple[bool, Optional[str]]:
    """Pre-flight: scan ONLY positive-instruction user fields for forbidden keywords.

    Crucially does NOT scan the assembled prompt - the auto-injected
    "no real person" / "no flag" guardrails would always trigger a false
    positive against the FORBIDDEN_KEYWORDS list.

    Scans: title, hook_phrase, concept_visual, lp_visual_style.

    The `avoid` field is intentionally EXCLUDED - it is a negative-instruction
    field ("do NOT show X"). Including it caused false positives where a user
    writing `avoid: "us flag"` to keep flags OUT of the render would block the
    render entirely.

    Returns (allowed, reason_if_blocked). Case-insensitive substring match.
    Saves ~30s + ~$0.04 per blocked job vs letting OpenAI return moderation_blocked.
    """
    user_fields = [
        concept.get("title", ""),
        concept.get("hook_phrase", ""),
        concept.get("concept_visual", ""),
        concept.get("lp_visual_style", ""),
    ]
    haystack = "\n".join(s for s in user_fields if s).lower()
    for kw in FORBIDDEN_KEYWORDS:
        if kw in haystack:
            return False, f"user input contains forbidden keyword: '{kw}'"
    return True, None


def validate_manifest(manifest: dict, urls: list) -> list:
    """Cross-check that every (concept, size) in urls exists in manifest.

    Returns a list of error messages (empty = ok).
    Catches the silent paint-mismatch bug where urls.json and manifest.json drift.
    """
    errors = []
    if "concepts" not in manifest or not isinstance(manifest["concepts"], dict):
        errors.append("manifest missing 'concepts' dict")
        return errors
    concepts = manifest["concepts"]
    for i, u in enumerate(urls):
        for field in ("concept", "size", "openaiSize", "submitUrl"):
            if field not in u:
                errors.append(f"urls[{i}] missing field '{field}'")
        if "concept" in u and u["concept"] not in concepts:
            errors.append(f"urls[{i}] concept '{u['concept']}' not in manifest.concepts")
        if "size" in u and u["size"] not in LAYOUT_LOCKS:
            errors.append(f"urls[{i}] size '{u['size']}' not in supported LAYOUT_LOCKS")
    return errors


# Convenience: quick self-test when run directly.
if __name__ == "__main__":
    sample_concept = {
        "title": "Lär dig handla olja med personlig handledning!",
        "locale": "sv",
        "register": "empowerment",
        "hook_phrase": "personlig handledning",
        "lp_visual_style": "deep charcoal + vivid orange + glossy oil barrel",
        "palette_hex": ["#0E0E10", "#F37021", "#FFFFFF"],
        "concept_visual": "spotlight on glossy orange oil barrel + subtle rising tick-chart wave",
        "avoid": "classroom, instructor portrait, headshot",
    }
    for size in ("1200x1200", "1200x628", "1080x1920"):
        p = build_prompt(sample_concept, size)
        print(f"--- {size} ({len(p)} chars) ---")
        print(p)
        print()
    print(f"--- recomp tests ---")
    for size in ("1200x628", "1080x1920"):
        p = build_recomp_prompt(sample_concept, "1200x1200", size)
        print(f"--- recomp 1200x1200 -> {size} ({len(p)} chars) ---")
        print(p)
        print()

    print(f"--- moderation tests ---")
    cases = [
        ({"title": "Lär dig handla olja"}, True),
        ({"title": "Trump's economic plan"}, False),
        ({"title": "Clean campaign", "concept_visual": "elon musk silhouette"}, False),
        ({"title": "Stockholm investing", "hook_phrase": "real person"}, False),
        ({"title": "Premium fund management", "lp_visual_style": "navy + gold"}, True),
        # avoid is exempt from scan - keywords here must NOT block
        ({"title": "Clean campaign", "avoid": "us flag, swastika, real person"}, True),
    ]
    for c, expected in cases:
        ok, reason = check_moderation(c)
        status = "PASS" if ok == expected else "FAIL"
        print(f"  [{status}] expected={expected} got={ok} title={c.get('title')!r} reason={reason}")
