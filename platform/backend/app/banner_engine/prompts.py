"""Prompt assembly + moderation pre-flight for /banner-openai v2.0.

Pure functions. No I/O, no side effects. Imported by run.py.

v2.0 model: the Python layer carries only the *system guardrails* (premise,
hard negatives, aspect-locked layout + button placement, verbatim title,
typography rule, RTL rule). The *creative direction* is composed by Claude
in Phase 2 as a free prose paragraph per concept and arrives in the manifest
as `creative_brief`. No archetype enums, no per-archetype surface table, no
palette-weight allocation, no auto-injected locale atmosphere — those are
Claude's job to write into the brief when the concept calls for them.

Concept dict shape (manifest.json `concepts.<key>`):
    {
        "title":          "<verbatim banner_text block, never paraphrased>",
        "locale":         "en" | "sv" | "pt-BR" | "ar" | ...,
        "hook_phrase":    "<2-4 word fragment pulled verbatim from title>",
        "creative_brief": "<~250-400c prose: visual direction, treatment, "
                          " palette, atmosphere, surface, mood>",
        "cta":            "<verbatim CTA text>",        # optional
        "button_combo":   ["#BG_HEX", "#TEXT_HEX"],     # required iff cta present
    }
"""

from typing import Optional

# ---------------------------------------------------------------------------
# Approved CTA button color pairs (bg_hex, text_hex). Claude must pick one
# of these per concept that has a CTA, contrast-first against the banner
# background, concept-fit as tiebreaker.
# ---------------------------------------------------------------------------
BUTTON_COMBOS = [
    ("#2563EB", "#FFFFFF"),  # blue
    ("#F97316", "#FFFFFF"),  # orange
    ("#16A34A", "#FFFFFF"),  # green
    ("#DC2626", "#FFFFFF"),  # red
    ("#7C3AED", "#FFFFFF"),  # violet
    ("#FACC15", "#111111"),  # yellow (dark text)
    ("#14B8A6", "#FFFFFF"),  # teal
    ("#BE123C", "#FFFFFF"),  # rose
]
# Black (#111827) and white (#FFFFFF) backgrounds removed — buttons must read
# as colored action elements, not chromatic neutrals that blend into the design.
_APPROVED_BG_HEXES = {bg.upper() for bg, _ in BUTTON_COMBOS}

# ---------------------------------------------------------------------------
# Aspect-locked layout (base) + button placement (only when CTA present)
# ---------------------------------------------------------------------------
LAYOUT_BASE = {
    "1200x1200": "Layout 1:1: hook type-hero anchored upper-left (top 35-45% of canvas); body title at center-left directly below the hook; thematic visual atmosphere fills the right half. Breathing room between text and visual.",
    "1080x1080": "Layout 1:1: hook type-hero anchored upper-left (top 35-45% of canvas); body title at center-left directly below the hook; thematic visual atmosphere fills the right half. Breathing room between text and visual.",
    "1200x628":  "Layout 1200x628 wide: hook + body title block left 45%; thematic visual right 55%; horizontal composition; 12% safe top+bottom.",
    "1080x1920": "Layout 9:16 tall: hook top 22-32%; body title directly below hook; thematic visual center-to-lower 40-55%; mobile safe top 8% + bottom 12%; 10% safe left+right.",
    "1080x1350": "Layout 4:5 portrait: hook upper third; body title directly below hook; thematic visual center-to-lower; editorial poster composition; 10% safe left+right.",
    "960x1200":  "Layout 4:5 portrait: hook upper third; body title directly below hook; thematic visual center-to-lower; editorial poster composition; 10% safe left+right.",
    "1920x1080": "Layout 16:9 landscape: hook + body title block left 40%; thematic visual right 60%; cinematic wide composition.",
    "1200x960":  "Layout 5:4 mild-wide: hook + body title block left 45%; thematic visual right 55%; horizontal composition.",
}

BUTTON_PLACEMENT = {
    "1200x1200": "bottom-left, aligned with the copy block left edge",
    "1080x1080": "bottom-left, aligned with the copy block left edge",
    "1200x628":  "bottom-left next to the copy block",
    "1080x1920": "bottom-center inside the mobile bottom safe zone",
    "1080x1350": "bottom-left, aligned with the copy block left edge",
    "960x1200":  "bottom-left, aligned with the copy block left edge",
    "1920x1080": "left third, vertically below the copy block",
    "1200x960":  "bottom-left next to the copy block",
}

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

# ---------------------------------------------------------------------------
# System layer — fixed across every prompt
# ---------------------------------------------------------------------------
SYSTEM_HEADER = (
    "Designed graphic ad — a finished paid-social poster. "
    "NOT a photograph of an office, NOT an illustration of furniture, NOT a slide."
)

HARD_NEGATIVES = (
    "Forbidden: dark office scene, desk with laptop, hands on keyboard, classroom, "
    "headshot, split-panel composition, real-person likeness, fake UI text or "
    "invented numbers inside screens or charts, flags, partisan colors, "
    "real company logos, real brand wordmarks, branded product packaging or signage "
    "(e.g. branded oil drums, branded fuel pumps, branded buildings), "
    "recognizable real-world architecture (e.g. Petronas Towers, Burj Khalifa, "
    "Eiffel Tower, Empire State, Sydney Opera House) — use abstract silhouettes only, "
    "invented decorative icon rows, infographic icon sets, or feature-grid icons."
)

BRAND_DEFENCE_LINE = (
    "Brand-asset hygiene: if a brand name appears in the Title text, render it as plain "
    "typography only. DO NOT render the brand's logo, wordmark, droplet/glyph, "
    "branded packaging, branded oil drum, branded fuel pump, branded signage, or any "
    "other branded visual mark. The brand name lives in the text, not as a graphic."
)

TYPOGRAPHY_RULE = (
    "Render every word fully and legibly with all characters intact — no accents "
    "stripped, no letters substituted, no truncation. Punctuation sits clearly "
    "AFTER the final letter, never overlapping it."
)

RTL_RULE = (
    "RTL composition: mirror visual hierarchy; hook and copy block enter from the right. "
    "Numerals stay LTR even inside an RTL block. Question mark is U+061F when applicable."
)


def hierarchy_rule(has_cta: bool) -> str:
    """Per-canvas hierarchy weights. Diverges by CTA presence."""
    if has_cta:
        return (
            "Visual hierarchy: hook prominent at ~30-40% canvas height (confident, "
            "not consuming the canvas). Body title legible at ~6-8% canvas height "
            "(readable support, not crowding). CTA button LARGE at ~14-18% canvas "
            "height with very generous internal padding (button text never cramped — "
            "vertical breathing room ~30-40% of label height on each side). "
            "Command-presence sized. The action anchor — impossible to miss. "
            "Breathing room between all elements."
        )
    return (
        "Visual hierarchy: hook is the primary visual anchor at ~40-50% canvas height "
        "(prominent, not consuming). Body title legible at ~6-8% canvas height "
        "(readable support). Thematic visual atmosphere supports — together with the hook, "
        "the two most important elements. Breathing room around all elements."
    )


def normalize_cta(cta: str) -> str:
    """Strip a single trailing period from CTA text. Buttons rarely carry
    sentence-end punctuation; a trailing dot reads as a typo on a CTA pill.
    """
    cta = cta.strip()
    if cta.endswith("."):
        cta = cta[:-1].rstrip()
    return cta

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


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------
def is_rtl(locale: str) -> bool:
    """True if the locale renders RTL (Arabic, Hebrew, Urdu, Farsi, Pashto)."""
    return locale.lower().split("-")[0] in _RTL_LOCALES


def layout_lock(size: str, has_cta: bool) -> str:
    """Return the per-aspect layout lock, including button placement when CTA present."""
    if size not in LAYOUT_BASE:
        raise ValueError(
            f"Unsupported size: {size}. Supported: {sorted(LAYOUT_BASE.keys())}"
        )
    base = LAYOUT_BASE[size]
    if has_cta:
        return f"{base} CTA button placed {BUTTON_PLACEMENT[size]}."
    return base


def _validate_button_combo(combo) -> Optional[str]:
    """Return an error string if combo is not in the approved set, else None."""
    if not isinstance(combo, (list, tuple)) or len(combo) != 2:
        return "button_combo must be a 2-element list [bg_hex, text_hex]"
    bg, _text = combo[0], combo[1]
    if not isinstance(bg, str) or bg.upper() not in _APPROVED_BG_HEXES:
        return f"button_combo bg '{bg}' is not in approved BUTTON_COMBOS"
    return None


def build_prompt(concept: dict, size: str) -> str:
    """Compose the OpenAI generation prompt for one (concept, size).

    System layer first (premise + hard negatives + layout + verbatim title +
    hook directive), then Claude's creative_brief paragraph, then optional
    CTA button line, then conditional typography/RTL rules.

    Required concept fields: title, hook_phrase, creative_brief.
    Optional: locale (default 'en'), cta + button_combo (paired).
    """
    title = concept.get("title")
    if not title:
        raise ValueError("concept.title is required")
    hook = concept.get("hook_phrase")
    if not hook:
        raise ValueError("concept.hook_phrase is required")
    brief = concept.get("creative_brief")
    if not brief:
        raise ValueError("concept.creative_brief is required")
    locale = (concept.get("locale") or "en").strip()
    cta = (concept.get("cta") or "").strip()
    button_combo = concept.get("button_combo") or []

    has_cta = bool(cta)
    if has_cta:
        err = _validate_button_combo(button_combo)
        if err:
            raise ValueError(err)

    sections = [
        SYSTEM_HEADER,
        HARD_NEGATIVES,
        layout_lock(size, has_cta=has_cta),
        hierarchy_rule(has_cta=has_cta),
        f'Title (verbatim, render exactly as written): "{title}"',
        f'Hook: "{hook}" — pulled verbatim from the Title above. This fragment is '
        "the visual hero of the composition. Claude has chosen the treatment in "
        "the creative direction below.",
        BRAND_DEFENCE_LINE,
        "Creative direction: " + brief.strip(),
    ]

    if has_cta:
        bg_hex, text_hex = button_combo[0], button_combo[1]
        placement = BUTTON_PLACEMENT[size]
        cta_label = normalize_cta(cta)
        sections.append(
            f'CTA button: "{cta_label}" — LARGE, command-presence pill button, '
            f"{bg_hex} fill with {text_hex} text, placed {placement}. "
            "Button height ~14-18% of canvas with very generous internal padding "
            "(button text never cramped — vertical breathing room ~30-40% of label "
            "height on each side, horizontal padding ~60-80% of cap-height each side). "
            "High visual weight, the action anchor — impossible to miss. "
            "Render the button text verbatim, no paraphrase. "
            "No trailing punctuation on the button label."
        )

    if locale.lower() != "en":
        sections.append(TYPOGRAPHY_RULE)
    if is_rtl(locale):
        sections.append(RTL_RULE)

    return "\n\n".join(sections)


def build_recomp_prompt(concept: dict, master_size: str, target_size: str) -> str:
    """Compose a recomposition prompt for /v1/images/edits.

    Sent with the MVP master image attached. Preserves the title, hook, button,
    palette, and visual direction from the master — only the layout and button
    placement change for the new aspect.
    """
    if target_size == master_size:
        raise ValueError(
            f"recomp target {target_size} == master {master_size}; recomp must change aspect"
        )
    if target_size not in LAYOUT_BASE:
        raise ValueError(f"recomp target {target_size} not in LAYOUT_BASE")

    title = concept.get("title")
    if not title:
        raise ValueError("concept.title is required")
    hook = concept.get("hook_phrase")
    if not hook:
        raise ValueError("concept.hook_phrase is required")
    locale = (concept.get("locale") or "en").strip()
    cta = (concept.get("cta") or "").strip()
    button_combo = concept.get("button_combo") or []
    has_cta = bool(cta)
    if has_cta:
        err = _validate_button_combo(button_combo)
        if err:
            raise ValueError(err)

    family = LAYOUT_FAMILY.get(target_size, "TARGET")

    preserve = [
        f'- Title (verbatim from master): "{title}"',
        f'- Hook fragment as the type-hero: "{hook}" (same color, weight, and treatment as the master)',
    ]
    if has_cta:
        bg_hex, text_hex = button_combo[0], button_combo[1]
        placement = BUTTON_PLACEMENT[target_size]
        cta_label = normalize_cta(cta)
        preserve.append(
            f'- CTA button: "{cta_label}" — {bg_hex} fill with {text_hex} text, '
            f"repositioned to {placement}. Button stays LARGE, ~14-18% of canvas height, "
            f"with very generous internal padding. Command-presence sized. "
            f"The action anchor — impossible to miss. No trailing punctuation on the label."
        )
    preserve.append("- Thematic background and visual elements from the master, repositioned for the new aspect")
    preserve.append("- Palette from the master (no new colors introduced)")

    sections = [
        f"RECOMPOSE the attached master ({master_size}) into {target_size}. "
        "Same campaign, same text, same hook, same colors, same visual direction. "
        "NOT a stretch, NOT a crop, NOT a fresh generation. "
        "Layout is REDESIGNED for this aspect — never split-panel.",

        f"NEW LAYOUT ({family}): {layout_lock(target_size, has_cta=has_cta)}",

        hierarchy_rule(has_cta=has_cta),

        "PRESERVE (reposition, do not remove):\n" + "\n".join(preserve),

        BRAND_DEFENCE_LINE,

        f"Constraints: exactly {target_size} px. No new content. No watermarks. "
        "NO HARD SPLIT-PANEL. NO regression into dark office, desk, laptop, fake UI, "
        "real person, flag, real company logo, real brand wordmark, branded packaging, "
        "recognizable real-world architecture, invented icon rows.",
    ]
    if is_rtl(locale):
        sections.append("RTL composition: keep mirrored direction; hook + copy block on the right.")
    if locale.lower() != "en":
        sections.append(TYPOGRAPHY_RULE)

    return "\n\n".join(sections)


def check_moderation(concept: dict) -> tuple[bool, Optional[str]]:
    """Pre-flight: scan user-authored fields for forbidden keywords.

    Scans: title, hook_phrase, creative_brief, cta. Case-insensitive substring.
    Returns (allowed, reason_if_blocked).
    """
    user_fields = [
        concept.get("title", ""),
        concept.get("hook_phrase", ""),
        concept.get("creative_brief", ""),
        concept.get("cta", ""),
    ]
    haystack = "\n".join(s for s in user_fields if s).lower()
    for kw in FORBIDDEN_KEYWORDS:
        if kw in haystack:
            return False, f"user input contains forbidden keyword: '{kw}'"
    return True, None


def validate_manifest(manifest: dict, urls: list, *, require_submit_url: bool = True) -> list:
    """Cross-check the manifest + urls before kicking off a run.

    Catches:
    - missing required concept fields (title, hook_phrase, creative_brief)
    - hook_phrase not a substring of title
    - cta present without a valid button_combo
    - urls referencing a concept or size that doesn't exist

    `require_submit_url` (default True) keeps the CLI/paint contract: every urls
    row must carry a Figma submitUrl. The web platform (generate-only, no Figma
    paint) calls with require_submit_url=False so it can reuse the concept/hook/
    button validation without fabricating a Figma URL.
    """
    errors = []
    if "concepts" not in manifest or not isinstance(manifest["concepts"], dict):
        errors.append("manifest missing 'concepts' dict")
        return errors

    concepts = manifest["concepts"]

    for key, c in concepts.items():
        if not isinstance(c, dict):
            errors.append(f"concept '{key}' is not an object")
            continue
        for f in ("title", "hook_phrase", "creative_brief"):
            if not c.get(f):
                errors.append(f"concept '{key}' missing required field '{f}'")
        title = c.get("title") or ""
        hook = c.get("hook_phrase") or ""
        if title and hook and hook.lower() not in title.lower():
            errors.append(
                f"concept '{key}' hook_phrase {hook!r} is not a substring of title "
                f"(case-insensitive). Hook must be pulled verbatim from the title."
            )
        cta = (c.get("cta") or "").strip()
        if cta:
            err = _validate_button_combo(c.get("button_combo"))
            if err:
                errors.append(f"concept '{key}' cta present but {err}")

    required_fields = ("concept", "size", "openaiSize", "submitUrl") if require_submit_url \
        else ("concept", "size", "openaiSize")
    for i, u in enumerate(urls):
        for field in required_fields:
            if field not in u:
                errors.append(f"urls[{i}] missing field '{field}'")
        if "concept" in u and u["concept"] not in concepts:
            errors.append(f"urls[{i}] concept '{u['concept']}' not in manifest.concepts")
        if "size" in u and u["size"] not in LAYOUT_BASE:
            errors.append(f"urls[{i}] size '{u['size']}' not in supported LAYOUT_BASE")

    return errors


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    sample_concept = {
        "title": "Oil prices fell. The ringgit moved. PETRONAS earnings shifted.",
        "locale": "en",
        "hook_phrase": "OIL PRICES FELL",
        "creative_brief": (
            "Type-hero poster. Hook in saturated #F97316 filled letters, "
            "condensed display weight, anchored upper-left against a deep "
            "charcoal matte gradient. Faint refinery silhouette in navy at "
            "the lower edge as thematic anchor. Editorial confident, not loud."
        ),
        "cta": "Learn to connect those dots",
        "button_combo": ["#F97316", "#FFFFFF"],
    }
    print("=" * 70)
    print("GEN PROMPTS")
    print("=" * 70)
    for size in ("1200x1200", "1200x628", "1080x1920"):
        p = build_prompt(sample_concept, size)
        print(f"\n--- {size} ({len(p)} chars) ---")
        print(p)

    print("\n" + "=" * 70)
    print("RECOMP PROMPTS")
    print("=" * 70)
    for size in ("1200x628", "1080x1920"):
        p = build_recomp_prompt(sample_concept, "1200x1200", size)
        print(f"\n--- recomp 1200x1200 -> {size} ({len(p)} chars) ---")
        print(p)

    print("\n" + "=" * 70)
    print("NO-CTA VARIANT")
    print("=" * 70)
    no_cta = {**sample_concept}
    no_cta.pop("cta")
    no_cta.pop("button_combo")
    p = build_prompt(no_cta, "1200x1200")
    print(f"\n--- 1200x1200 no-cta ({len(p)} chars) ---")
    print(p)

    print("\n" + "=" * 70)
    print("VALIDATION TESTS")
    print("=" * 70)
    cases = [
        ("ok", {"concepts": {"c1": sample_concept}}, [{"concept": "c1", "size": "1200x1200", "openaiSize": "1024x1024", "submitUrl": "https://x"}]),
        ("hook not in title", {"concepts": {"c1": {**sample_concept, "hook_phrase": "RIGGED MARKETS"}}}, []),
        ("missing brief", {"concepts": {"c1": {**sample_concept, "creative_brief": ""}}}, []),
        ("bad button combo", {"concepts": {"c1": {**sample_concept, "button_combo": ["#000000", "#FFFFFF"]}}}, []),
        ("unknown size in urls", {"concepts": {"c1": sample_concept}}, [{"concept": "c1", "size": "1234x5678", "openaiSize": "1024x1024", "submitUrl": "x"}]),
    ]
    for label, mani, urls in cases:
        errs = validate_manifest(mani, urls)
        print(f"\n[{label}] {len(errs)} error(s)")
        for e in errs:
            print(f"  - {e}")

    print("\n" + "=" * 70)
    print("MODERATION TESTS")
    print("=" * 70)
    mcases = [
        ({"title": "Oil prices fell", "hook_phrase": "OIL PRICES", "creative_brief": "poster"}, True),
        ({"title": "Trump's plan", "hook_phrase": "TRUMP", "creative_brief": "poster"}, False),
        ({"title": "Premium fund", "hook_phrase": "PREMIUM", "creative_brief": "elon musk silhouette"}, False),
        ({"title": "Stockholm", "hook_phrase": "real person", "creative_brief": "poster"}, False),
    ]
    for c, expected in mcases:
        ok, reason = check_moderation(c)
        status = "PASS" if ok == expected else "FAIL"
        print(f"  [{status}] expected={expected} got={ok} title={c.get('title')!r} reason={reason}")
