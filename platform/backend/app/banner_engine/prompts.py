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
# Aspect + safe zones + legibility only — the COMPOSITION (where the subject sits,
# full-bleed vs paneled) is the creative direction's choice, so concepts vary
# instead of all converging on one "headline-left / subject-right" template.
# Aspect + safe zones + an INTEGRATED-composition default (one campaign visual with
# shared lighting/palette/depth, the headline/ticker dominant), plus a per-format
# adaptation note. Hard vertical split-panels only happen if the direction asks.
LAYOUT_BASE = {
    "1200x1200": "Aspect 1:1 square. ONE integrated premium ad composition — subject, typography, background and graphics share lighting, palette and depth as a single campaign visual, NOT pasted blocks. The headline/ticker is the dominant, fully legible element; the subject may overlap the background graphics. Balanced integrated layout with real subject + background depth. Avoid hard vertical split-panels unless explicitly requested. Generous breathing room; keep text ~6% clear of every edge.",
    "1080x1080": "Aspect 1:1 square. ONE integrated premium ad composition — subject, typography, background and graphics share lighting, palette and depth as a single campaign visual, NOT pasted blocks. The headline/ticker is the dominant, fully legible element; the subject may overlap the background graphics. Balanced integrated layout with real subject + background depth. Avoid hard vertical split-panels unless explicitly requested. Generous breathing room; keep text ~6% clear of every edge.",
    "1200x628":  "Aspect 1.91:1 wide banner. ONE integrated composition (subject, type and background share lighting and depth — not pasted blocks): compressed but readable, fewer elements, a strong left-to-right reading flow. Headline/ticker dominant and legible. Avoid hard split-panels unless requested; 12% safe top+bottom.",
    "1080x1920": "Aspect 9:16 tall. ONE integrated, STACKED composition: the headline/hook sits in the UPPER area (top, fully legible); the hero subject (person/product) is anchored at the BOTTOM, filling the lower portion; the CTA button is bottom-center, IN FRONT OF / overlapping the subject, inside the bottom safe band. Subject, type and background share one lighting and palette (not pasted blocks). Mobile safe top 8% + bottom 12%; 10% safe left+right.",
    "1080x1350": "Aspect 4:5 portrait. ONE integrated, editorial-premium STACKED composition: the headline/hook is dominant in the UPPER part of the SURVIVING central band — NOT pushed to the cropped top edge; the hero subject (person/product) is anchored at the BOTTOM; the CTA button is bottom-center, IN FRONT OF / overlapping the subject, inside the bottom safe band. Shared lighting, palette and depth (not pasted blocks). 10% safe left+right; the exact-size-crop clearances below own the top/bottom margins (every headline line sits fully inside the central band).",
    "960x1200":  "Aspect 4:5 portrait. ONE integrated, editorial-premium STACKED composition: the headline/hook is dominant in the UPPER part of the SURVIVING central band — NOT pushed to the cropped top edge; the hero subject (person/product) is anchored at the BOTTOM; the CTA button is bottom-center, IN FRONT OF / overlapping the subject, inside the bottom safe band. Shared lighting, palette and depth (not pasted blocks). 10% safe left+right; the exact-size-crop clearances below own the top/bottom margins (every headline line sits fully inside the central band).",
    "1920x1080": "Aspect 16:9 landscape. ONE integrated cinematic composition — compressed, fewer elements, strong left-to-right flow; subject and background share lighting and depth (not pasted blocks). Headline/ticker dominant and legible. Avoid hard split-panels unless requested.",
    "1200x960":  "Aspect 5:4 mild-wide. ONE integrated composition — headline/ticker dominant and legible, subject and background sharing lighting and depth (not pasted blocks). Avoid hard split-panels unless requested.",
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

# Additional platform export sizes. The engine renders by aspect ratio, so each
# new size reuses the layout / button / family of the existing size with the
# same shape — the label is just the export target. (See OPENAI_SIZE_MAP in
# engine_core.py for the matching OpenAI generation resolution.)
_SIZE_ALIASES = {
    "800x800":   "1080x1080",   # 1:1 square
    "600x600":   "1080x1080",   # 1:1 square
    "1200x800":  "1200x628",    # ~3:2 wide
    "1200x674":  "1920x1080",   # 16:9 landscape
    "1280x720":  "1920x1080",   # 16:9 landscape
    "1440x1800": "1080x1350",   # 4:5 portrait
    "1200x1500": "1080x1350",   # 4:5 portrait
    "720x1280":  "1080x1920",   # 9:16 tall
}
for _new, _base in _SIZE_ALIASES.items():
    LAYOUT_BASE.setdefault(_new, LAYOUT_BASE[_base])
    BUTTON_PLACEMENT.setdefault(_new, BUTTON_PLACEMENT[_base])
    LAYOUT_FAMILY.setdefault(_new, LAYOUT_FAMILY[_base])

# Display-ad slots (extreme ratios). Generated at the nearest aspect, then
# cover-cropped to exact pixels by reshape.fit_cover (see runner). They reuse a
# centered layout family so the crop keeps the focal content.
DISPLAY_SIZES = {
    "300x250", "728x90", "160x600", "300x600", "970x250",
    "320x50", "1200x300", "512x128", "300x60", "600x315", "600x500",
}
# Tiny slots where body / secondary copy is unreadable — show only the key line.
_TINY_SLOTS = {"320x50", "300x60", "728x90", "512x128"}
_DISPLAY_ALIASES = {
    "300x250":  "1080x1080",   # ~square (medium rectangle)
    "728x90":   "1920x1080",   # extreme wide (leaderboard)
    "970x250":  "1920x1080",   # billboard
    "320x50":   "1920x1080",   # mobile leaderboard
    "1200x300": "1920x1080",
    "512x128":  "1920x1080",
    "300x60":   "1920x1080",
    "160x600":  "1080x1920",   # extreme tall (skyscraper)
    "300x600":  "1080x1920",   # half-page
    "600x315":  "1920x1080",   # ~1.91:1 native (Criteo)
    "600x500":  "1080x1080",   # ~6:5 native (Criteo)
}
for _new, _base in _DISPLAY_ALIASES.items():
    LAYOUT_BASE.setdefault(_new, LAYOUT_BASE[_base])
    BUTTON_PLACEMENT.setdefault(_new, BUTTON_PLACEMENT[_base])
    LAYOUT_FAMILY.setdefault(_new, LAYOUT_FAMILY[_base])

# ---------------------------------------------------------------------------
# System layer — fixed across every prompt
# ---------------------------------------------------------------------------
SYSTEM_HEADER = (
    "A finished, high-converting paid-social ad creative, art-directed to stop the "
    "scroll and drive clicks. The medium is whatever the creative direction below "
    "calls for — advertising photography (a real-looking, generic non-celebrity human "
    "subject and/or the actual product is encouraged when it fits the offer), bold "
    "graphic/typographic, or 3D. It is a real ad, not a slide, not a wireframe, not a "
    "generic stock template."
)

# Always-on negatives (every intent). The invented-numbers / fake-logos invariant
# lives HERE so the finance unlock below can never leak fabricated data.
HARD_NEGATIVES_BASE = (
    "Avoid the tells of cheap AI/stock creative unless the direction explicitly calls "
    "for them: watercolor or ink-wash gradient backgrounds; glowing bokeh particle "
    "dust; abstract swooshes or wave lines; and the generic corporate stock-photo "
    "trope — a suited person seated at a desk, hand on chin, frowning at paperwork or "
    "a laptop. Commit to ONE dominant idea — do not stack competing metaphors or props "
    "(no symbol soup). A human subject should FACE THE VIEWER with confident, "
    "aspirational posture and eye contact, never look down at props. Never include: "
    "real or identifiable individuals or celebrities (a generic, fictional model is "
    "fine and encouraged), real company logos, brand wordmarks or trademarked "
    "packaging, INVENTED numbers, fake performance data, percentages, prices, fake "
    "tickers with real symbols, or fabricated claims unless the user provided that "
    "exact text, garbled UI text, recognizable real-world landmarks or architecture "
    "(use generic), watermarks, or AI artifacts (warped or asymmetric faces and eyes, "
    "malformed hands/fingers/teeth, melted or duplicated text, misspelled words, "
    "stripped or wrong diacritics)."
)

# Non-finance intents: market/trading graphics are off-concept and stay banned.
NON_FINANCE_MARKET_BAN = (
    " Do NOT add stock-market charts, candlestick or line tickers, trading dashboards "
    "or financial UI ANYWHERE (including as props on papers, screens, tablets or "
    "walls) — they are off-concept here."
)

# Finance/investment intents: premium financial visual language is unlocked, but kept
# ABSTRACT and non-readable so the invented-numbers invariant (in BASE) still holds.
FINANCE_ALLOW = (
    " This is a finance/investment ad — premium financial visual language is "
    "ENCOURAGED: subtle abstract market graphics, non-specific candlestick or line "
    "motifs as background texture (never a readable real chart), clean upward growth "
    "arrows and growth-direction cues, percentage-style UI accents, fintech dashboard "
    "atmosphere, data-grid depth, deep premium fintech backgrounds — always as "
    "atmosphere supporting the hero, never the hero itself. Palette: dark navy / deep "
    "blue / emerald / black, strong contrast, cinematic commercial lighting, bold "
    "dominant title or ticker. NEVER render readable invented numbers, performance "
    "figures, prices, fake tickers' data, fake logos or implied claims — keep all "
    "market graphics abstract and non-readable. NO gambling or luck symbolism (dice, "
    "casino chips, roulette, slot machines, lottery or scratch cards) and NO "
    "get-rich-quick imagery (cash rain, money piles, luxury-car flexing). Avoid "
    "literal supermarket/store/shelf scenes, flat corporate brochure looks, and cheap "
    "trading-signal aesthetics."
)

# Intent groups that unlock the finance visual language (mirrors intent.FINANCE_INTENTS).
_FINANCE_INTENTS = frozenset({"investment_ad", "finance_ad", "trading_education_ad"})


def hard_negatives_for(intent: str = "general_ad") -> str:
    """Negatives tuned to campaign intent: finance/investment intents unlock premium
    market visuals; every other intent keeps the strict market-graphics ban. The
    invented-numbers / fake-logos invariant (BASE) applies regardless of intent."""
    tail = FINANCE_ALLOW if intent in _FINANCE_INTENTS else NON_FINANCE_MARKET_BAN
    return HARD_NEGATIVES_BASE + tail


# Back-compat: existing importers of HARD_NEGATIVES keep today's strict behavior.
HARD_NEGATIVES = HARD_NEGATIVES_BASE + NON_FINANCE_MARKET_BAN

# Copy contract — render only the user's provided copy, invent nothing.
COPY_CONTRACT = (
    "Copy contract: render ONLY the provided copy, exactly as written — no paraphrase, "
    "no translation unless requested. Add NO other words, labels, captions, taglines, "
    "fake buttons, fake logos, disclaimers, price tags, percentages, ticker tapes with "
    "invented symbols, or UI text. No invented numbers anywhere unless they appear in "
    "the copy above."
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

# Single authority for HORIZONTAL placement. The engine never names an absolute
# corner for the button — alignment is a compositional choice owned by the
# creative direction; the engine only enforces that the three text elements stay
# COHERENT (one shared alignment). This kills "centered copy + left-pinned button".
COPY_STACK_ALIGNMENT = (
    "ALIGNMENT (one rule — governs HORIZONTAL placement and OVERRIDES any side named "
    "elsewhere): the headline/hook, the supporting subheadline, and the CTA button are "
    "ONE vertical copy stack that shares a SINGLE horizontal alignment and axis — never "
    "mixed. Pick that alignment from the composition: if the hero subject is centered, or "
    "there is no single subject (type-led / symmetric), CENTER all three on the canvas "
    "centerline; if the subject clearly occupies one side, align all three to the OPPOSITE "
    "side and share that side's edge. The CTA button INHERITS the headline's alignment "
    "exactly — centered under centered copy, left-aligned under left copy. NEVER a centered "
    "headline with a corner- or side-pinned button, and never the copy on one alignment and "
    "the button on another."
)

RTL_RULE = (
    "RTL composition: mirror visual hierarchy; hook and copy block enter from the right. "
    "Numerals stay LTR even inside an RTL block. Question mark is U+061F when applicable."
)


def hierarchy_rule(has_cta: bool, size: str = "") -> str:
    """Per-canvas hierarchy weights. Crop-aware: extreme letterbox slots can't fit the
    full-canvas % heights below into their thin surviving strip, so they get a
    band-relative single-line spec instead (avoids the impossible-stack contradiction)."""
    if size and _is_strip(size):
        _, axis = _crop_info(size)
        if axis == "vertical":  # thin WIDE strip — leaderboard / billboard
            line = ("Render the headline as ONE short horizontal line, vertically centered "
                    "in the surviving strip, sized to ~55-70% of the strip height. ")
            cta = ("Put a COMPACT CTA pill on the SAME baseline, beside the headline (inline, "
                   "never stacked) — scale it to the strip, IGNORE the 14-18%-of-canvas rule. "
                   ) if has_cta else ""
        else:  # thin TALL strip — skyscraper
            line = ("Set the headline as a tight NARROW column within the surviving central "
                    "width (few characters per line), sized to fit. ")
            cta = ("Use a COMPACT CTA whose width fits that central column, scaled to the band "
                   "— IGNORE the 14-18%-of-canvas rule. ") if has_cta else ""
        return ("Visual hierarchy (EXTREME strip — only a thin central band survives the crop; "
                "treat THAT band as the whole canvas): " + line + cta +
                "No subtitle, no stacked extra lines.")
    if has_cta:
        pct, _ = _crop_info(size) if size else (0, "")
        cta_cap = "~10-13%" if (size and pct >= 4) else "~14-18%"
        return (
            "Visual hierarchy: hook prominent at ~30-40% canvas height (confident, "
            "not consuming the canvas). Body title legible at ~6-8% canvas height "
            f"(readable support, not crowding). CTA button at {cta_cap} canvas height "
            "with very generous internal padding (button text never cramped — vertical "
            "breathing room ~30-40% of label height on each side). Command-presence — but "
            "its FULL body MUST stay inside the safe area: if the size would reach a cropped "
            "edge, SHRINK it (clearance beats size). Clear breathing-room gap between the "
            "subheadline and the button, and between all elements."
        )
    return (
        "Visual hierarchy: hook is the primary visual anchor at ~40-50% canvas height "
        "(prominent, not consuming). Body title legible at ~6-8% canvas height "
        "(readable support). The hero subject or product supports — together with the hook, "
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
    "partisan colors",
}


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------
def is_rtl(locale: str) -> bool:
    """True if the locale renders RTL (Arabic, Hebrew, Urdu, Farsi, Pashto)."""
    return locale.lower().split("-")[0] in _RTL_LOCALES


# The 3 aspect ratios the image API can emit. Every size is generated at the
# NEAREST of these and then center-crop "cover"ed to exact pixels
# (reshape.fit_cover) — so for sizes whose aspect is far from the generated one a
# big band of the frame is cropped away. Anything (esp. a bottom-anchored button)
# in that band gets sliced. The helpers below make the prompt crop-aware.
_GEN_ASPECTS = (1.0, 1536 / 1024, 1024 / 1536)  # 1:1, 3:2 wide, 2:3 tall


def _crop_info(size: str) -> tuple:
    """(crop_pct, axis) for a size: how much EACH cropped edge loses and on which
    axis — 'vertical' (top+bottom cropped, target wider than generated) or
    'horizontal' (left+right cropped, target taller). (0, '') when the target's
    aspect ~matches a generated aspect (negligible crop)."""
    try:
        w, h = (int(x) for x in size.lower().split("x"))
        r = w / h
    except Exception:  # noqa: BLE001
        return 0, ""
    g = min(_GEN_ASPECTS, key=lambda a: abs(a - r))
    if r > g + 0.04:
        return round((1 - g / r) / 2 * 100), "vertical"
    if r < g - 0.04:
        return round((1 - r / g) / 2 * 100), "horizontal"
    return 0, ""


def _surviving_band(size: str) -> int:
    """% of the cropped axis that survives the exact-size crop (100 = no crop)."""
    pct, _ = _crop_info(size)
    return 100 - 2 * (pct + 6) if pct >= 4 else 100


def _is_micro(size: str) -> bool:
    """Absolute-pixel floor. At or under ~200x120 px there is no room for a stacked
    headline+subtitle+CTA hierarchy no matter the aspect — the aspect-derived band
    check below misses these (e.g. 100x60 has a generous band but 60 real pixels),
    so they shipped a full layout crammed into noise. Mirrors the same threshold
    in reshape.needs_outpaint (micro slots skip the outpaint API call)."""
    try:
        w, h = (int(x) for x in size.lower().split("x"))
    except Exception:  # noqa: BLE001
        return False
    return w <= 200 or h <= 120


def _is_strip(size: str) -> bool:
    """True when the slot can only carry a single line: the crop leaves a thin strip
    (extreme letterbox — leaderboards, billboards, skyscrapers) OR the absolute pixel
    box is micro (see _is_micro). Such slots get a single-line, no-subtitle, compact-
    inline-button treatment instead of full-canvas hierarchy. Derived from the size
    itself so every present + future extreme/custom size is caught automatically."""
    return _surviving_band(size) <= 34 or _is_micro(size)


def _crop_safe_note(size: str) -> str:
    """A forceful instruction: how much of each edge the exact-size crop removes,
    and that the WHOLE headline + button must be sized/placed inside the surviving
    band — text touching a cropped edge gets sliced (the #1 recomp defect)."""
    pct, axis = _crop_info(size)
    # Micro slots: tiny absolute pixels, whatever the aspect/crop. Dense scenes and
    # partial faces turn to noise at this scale (the cluttered-mosaic / half-face
    # defect on 320x50-class and 100x60-class exports).
    micro_rule = (
        "MICRO SLOT (tiny absolute pixels): ONE short headline line and (if any) a "
        "compact inline button ONLY. Big simple shapes, one clean focal element, "
        "generous negative space — NO dense collage, NO mosaic of photos or panels, "
        "no fine detail (it turns to unreadable noise at this size). "
    ) if _is_micro(size) else ""
    face_rule = (
        "Never show a partially cut face or head at any edge: any person is either "
        "fully inside the surviving area or omitted entirely."
    )
    if pct < 4:
        return ("⚠ " + micro_rule + face_rule) if micro_rule else ""
    m = pct + 6  # clearance — generous, because the model places text imprecisely
    band = 100 - 2 * m
    if _is_strip(size):
        # Extreme letterbox: only a thin central strip survives — full stacked copy
        # can never fit, so collapse to a single line + compact inline button.
        if axis == "vertical":
            return (
                f"⚠ EXTREME LETTERBOX CROP: the export slices off the top {pct}% and bottom "
                f"{pct}% — only a thin central HORIZONTAL strip (~{band}% of the height) "
                f"survives. Put the WHOLE ad in that strip: ONE short headline line and (if "
                f"any) a compact inline button on the SAME baseline beside it. NO stacked "
                f"lines, NO subtitle, nothing taller than the strip. Top and bottom are "
                f"background only. {micro_rule}{face_rule}"
            )
        return (
            f"⚠ EXTREME LETTERBOX CROP: the export slices off the left {pct}% and right "
            f"{pct}% — only a thin central VERTICAL strip (~{band}% of the width) survives. "
            f"Set the copy as a tight NARROW column inside that strip, sized to fit, with a "
            f"compact button; NO content reaches a side edge, NO subtitle. "
            f"{micro_rule}{face_rule}"
        )
    if axis == "vertical":
        return (
            f"⚠ EXACT-SIZE CROP (do not ignore): the export is center-cropped to this "
            f"aspect, which SLICES OFF the top ~{pct}% and bottom ~{pct}% of whatever you "
            f"draw. So EVERY line of the headline, the subheadline, and the ENTIRE CTA "
            f"button must sit fully inside the central ~{band}% of the height — at least "
            f"{m}% clear of the TOP edge and {m}% clear of the BOTTOM edge. SIZE the headline "
            f"so its top line starts BELOW the top {m}% and its baseline ends ABOVE the "
            f"bottom {m}%; if it won't fit, make it smaller — never let a single letter reach "
            f"the top or bottom edge. Keep the top and bottom margins as clean background."
        )
    return (
        f"⚠ EXACT-SIZE CROP (do not ignore): the export is center-cropped to this aspect, "
        f"which SLICES OFF the left ~{pct}% and right ~{pct}% of whatever you draw. So the "
        f"whole headline, the subheadline, and the ENTIRE CTA button must sit fully inside "
        f"the central ~{band}% of the width — at least {m}% clear of the LEFT and RIGHT "
        f"edges. If the headline is wider than this band, REDUCE its size or break it onto "
        f"more lines; never let a letter or the button reach a side edge."
    )


def button_placement(size: str) -> str:
    """CTA band + crop-safety. Portrait/tall formats get a bottom-CENTER button IN
    FRONT OF the hero subject; other formats inherit the copy stack's horizontal
    alignment (see COPY_STACK_ALIGNMENT)."""
    align = ("on the SAME horizontal alignment and axis as the headline + subheadline "
             "(centered under centered copy, left under left copy) — never a fixed corner")
    pct, axis = _crop_info(size)
    if _is_strip(size):
        return (f"as a COMPACT inline pill on the headline's baseline, {align}, scaled to "
                "the surviving strip (NOT 14-18% of the full canvas)")
    # Portrait / tall formats: bottom-CENTER, in front of (overlapping) the hero subject,
    # inside the bottom safe band — the high-converting vertical layout.
    try:
        w, h = (int(x) for x in size.lower().split("x"))
    except Exception:  # noqa: BLE001
        w, h = 1, 1
    if h > w * 1.05:
        m = (pct + 6) if pct >= 4 else 8
        return (f"BOTTOM-CENTER, horizontally centered, sitting IN FRONT OF / overlapping the "
                f"hero subject (person/product), inside the bottom safe band — its ENTIRE body "
                f"at least {m}% clear of the bottom edge (which is cropped), never touching it")
    if pct < 4:
        return f"in the lower third, directly beneath the copy, {align}"
    m = pct + 6
    if axis == "vertical":
        return (f"beneath the copy, {align}, fully {m}% clear of the TOP and BOTTOM edges — "
                "never touching the bottom edge, which gets cropped")
    return (f"beneath the copy, {align}, with the ENTIRE button pulled fully {m}% clear of "
            "the LEFT and RIGHT edges (they get cropped)")


def layout_lock(size: str, has_cta: bool) -> str:
    """Return the per-aspect layout lock, including button placement when CTA present."""
    if size not in LAYOUT_BASE:
        raise ValueError(
            f"Unsupported size: {size}. Supported: {sorted(LAYOUT_BASE.keys())}"
        )
    base = LAYOUT_BASE[size]
    if _is_strip(size):
        base += (
            " Strip slot — render ONLY the most important line (the ticker or headline); "
            "omit body and secondary copy (intentionally — do not add them back); ensure it "
            "reads in 1-2 seconds."
        )
    note = _crop_safe_note(size)
    if note:
        base += " " + note
    if has_cta:
        return f"{base} CTA button placed {button_placement(size)}."
    return base


def _validate_button_combo(combo) -> Optional[str]:
    """Return an error string if combo is not in the approved set, else None."""
    if not isinstance(combo, (list, tuple)) or len(combo) != 2:
        return "button_combo must be a 2-element list [bg_hex, text_hex]"
    bg, _text = combo[0], combo[1]
    if not isinstance(bg, str) or bg.upper() not in _APPROVED_BG_HEXES:
        return f"button_combo bg '{bg}' is not in approved BUTTON_COMBOS"
    return None


# How the scene must resolve at the canvas borders and around the subject.
# Without this, exports ship charts/panels chopped flat at the frame line,
# split perspective (two vanishing points), and background structures that
# fail to reconnect behind the subject — the recompose stage's most common
# visible defects after seams.
EDGE_INTEGRITY_RULE = (
    "EDGE INTEGRITY: nothing may terminate exactly at the canvas edge. Every "
    "graphic element (chart, candlestick cluster, panel, screen, light row, "
    "prop) is either fully inside the frame with clear margin, or bleeds off "
    "naturally as if it continues beyond the canvas — never chopped flat at "
    "the border. One consistent perspective and one consistent horizon and "
    "lighting direction across the ENTIRE canvas, including areas behind and "
    "beside the subject. Background lines and structures that pass behind the "
    "subject must re-emerge on the other side at the same height, angle and "
    "thickness. Never show a partially cut face or head at any edge: a person "
    "is either meaningfully inside the frame or absent."
)


# The recompose stage's other signature defect: the attached master survives as
# a half-painted layer, ghosting giant cropped letters, subtitle fragments and
# a second CTA button at the edge where the square source sat (a double
# exposure — most often the LEFT edge of wide targets). "Preserve" means
# preserve the CONTENT, never the master's pixels in place; without this rule
# the model can satisfy every PRESERVE line and still ship ghosts.
CLEAN_REPAINT_RULE = (
    "CLEAN REPAINT: the attached master is REFERENCE ONLY — repaint the ENTIRE "
    "canvas from scratch in the master's style. Every text string and the CTA "
    "button appear EXACTLY ONCE, at their NEW positions only; the master's "
    "text and button at their ORIGINAL positions must be completely gone, "
    "fully painted over by clean background. Zero double exposure: no "
    "leftover, faded, partial or cropped letters, no fragments of another "
    "layout, no second CTA button — inspect the canvas edges especially."
)


# Derives the reusable TEXT-FREE scene plate from an approved master. Every
# recompose then typesets onto a canvas with nothing to ghost — the erase job
# (the recompose stage's most failure-prone subtask) is removed from the
# pipeline entirely instead of being caught and re-rolled after the fact.
PLATE_PROMPT = (
    "Remove ALL text from this image: every headline, subheadline, word, "
    "letter, number, and the CTA button (its entire pill/rectangle shape "
    "included). Keep EVERYTHING else exactly as it is — same scene, same "
    "person/subject at the same size and position, same colors, same lighting, "
    "same composition. Where text or the button sat, the background simply "
    "continues naturally, as if they never existed. The result must contain "
    "ZERO typography of any kind."
)


def build_prompt(concept: dict, size: str, intent: str = "general_ad") -> str:
    """Compose the OpenAI generation prompt for one (concept, size).

    System layer first (premise + intent-tuned hard negatives + layout + verbatim
    title + hook directive + copy contract), then the creative_brief paragraph,
    then optional CTA button line, then conditional typography/RTL rules.

    `intent` is the campaign intent (see banner_engine.intent.INTENTS); it selects
    the negatives ruleset (finance intents unlock premium market visuals). Defaults
    to the strict 'general_ad' so callers that don't pass it keep today's behavior.

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
    subtitle = (concept.get("subtitle") or "").strip()
    cta = (concept.get("cta") or "").strip()
    button_combo = concept.get("button_combo") or []

    has_cta = bool(cta)
    if has_cta:
        err = _validate_button_combo(button_combo)
        if err:
            raise ValueError(err)

    sections = [
        SYSTEM_HEADER,
        hard_negatives_for(intent),
        layout_lock(size, has_cta=has_cta),
        hierarchy_rule(has_cta=has_cta, size=size),
        f'Title (verbatim, render exactly as written): "{title}"',
        f'Hook: "{hook}" — pulled verbatim from the Title above. This fragment is '
        "the type-hero of the composition; its treatment is specified in the "
        "creative direction below.",
    ]
    # The subtitle is REQUIRED on-image copy — render it verbatim as a legible
    # supporting line, the same as the title. (Skipped only on tiny slots where
    # secondary copy is unreadable.) Without this the model treats it as mere
    # context and drops it from the banner.
    if subtitle and not _is_strip(size):
        sections.append(
            f'Subheadline / supporting copy (render verbatim, exactly as written — do '
            f'NOT paraphrase, shorten, omit, or invent around it; place it as a clearly '
            f'legible secondary line directly under the headline, on the SAME alignment, '
            f'inside the safe band): "{subtitle}"'
        )
    sections += [
        BRAND_DEFENCE_LINE,
        COPY_CONTRACT,
        "Creative direction: " + brief.strip(),
    ]

    if has_cta:
        bg_hex, text_hex = button_combo[0], button_combo[1]
        placement = button_placement(size)
        cta_label = normalize_cta(cta)
        sections.append(
            f'CTA button: "{cta_label}" — command-presence pill button, '
            f"{bg_hex} fill with {text_hex} text, placed {placement}. "
            "Sized per the visual-hierarchy spec above (compact inline on cropped strips, "
            "otherwise large ~14-18% of canvas height) with very generous internal padding "
            "(button text never cramped — vertical breathing room ~30-40% of label height "
            "on each side, horizontal padding ~60-80% of cap-height each side). "
            "High visual weight, the action anchor. Render the button text verbatim, no "
            "paraphrase. No trailing punctuation on the button label."
        )
        sections.append(COPY_STACK_ALIGNMENT)

    sections.append(EDGE_INTEGRITY_RULE)
    sections.append(TYPOGRAPHY_RULE)
    if is_rtl(locale):
        sections.append(RTL_RULE)

    return "\n\n".join(sections)


def build_recomp_prompt(concept: dict, master_size: str, target_size: str,
                        art_direction: Optional[str] = None,
                        intent: str = "general_ad",
                        from_plate: bool = False) -> str:
    """Compose a recomposition prompt for /v1/images/edits.

    Sent with the MVP master image attached. Preserves the title, hook, button,
    palette, and visual direction from the master — only the layout and button
    placement change for the new aspect.

    `art_direction` (optional) is a per-aspect creative brief (e.g. authored by
    the GPT-5.5 creative director). When present it is layered in as guidance for
    HOW to re-lay-out this format, on top of "preserve the master's identity".
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
    subtitle = (concept.get("subtitle") or "").strip()
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
    if subtitle and not _is_strip(target_size):
        preserve.append(
            f'- Subheadline / supporting copy (verbatim, exactly as written — a legible '
            f'secondary line directly under the headline, on the SAME alignment, inside the '
            f'safe band): "{subtitle}"'
        )
    if has_cta:
        bg_hex, text_hex = button_combo[0], button_combo[1]
        placement = button_placement(target_size)
        cta_label = normalize_cta(cta)
        preserve.append(
            f'- CTA button: "{cta_label}" — {bg_hex} fill with {text_hex} text, '
            f"repositioned {placement}. Sized per the hierarchy spec above (compact inline "
            f"on cropped strips, otherwise ~14-18% of canvas height) with generous internal "
            f"padding. Command-presence. No trailing punctuation on the label."
        )
    preserve.append(
        "- The hero subject (person/product) from the master — keep it a REAL, prominent "
        "presence at similar visual weight; reposition for the new aspect but NEVER shrink it "
        "into a corner badge, tiny circular crop, or sticker. For tall/portrait formats, "
        "anchor the subject at the BOTTOM with the CTA button in front of it."
    )
    preserve.append("- Background and supporting visual elements from the master, repositioned for the new aspect")
    preserve.append("- Palette from the master (no new colors introduced)")

    if from_plate:
        # Plate mode: image 1 is the TEXT-FREE scene, image 2 the typeset master
        # (style reference only). The erase job is gone — the model only stages
        # the scene for the new aspect and typesets fresh copy.
        opening = (
            f"RECOMPOSE: the FIRST attached image is the approved master's TEXT-FREE "
            f"scene plate ({master_size}). Re-stage that scene as a {target_size} "
            "layout and TYPESET the campaign copy specified below onto it, fresh. "
            "The SECOND attached image is the approved master WITH its typography — "
            "use it ONLY as the style reference for the type and button treatment "
            "(font feel, weights, colors, button shape); every scene pixel comes "
            "from the FIRST image, and NOTHING is copied from the second image's "
            "positions. Same campaign, same colors, same visual direction. "
            "NOT a stretch, NOT a crop, NOT a collage or double exposure. "
            "Layout is REDESIGNED for this aspect — never split-panel."
        )
    else:
        opening = (
            f"RECOMPOSE the attached master ({master_size}) into {target_size}. "
            "Same campaign, same text, same hook, same colors, same visual direction. "
            "NOT a stretch, NOT a crop, NOT a fresh generation, NOT a collage or "
            "double exposure with the source image. "
            "Layout is REDESIGNED for this aspect — never split-panel."
        )
    sections = [
        opening,

        f"NEW LAYOUT ({family}): {layout_lock(target_size, has_cta=has_cta)}",

        hierarchy_rule(has_cta=has_cta, size=target_size),
    ]

    if art_direction and art_direction.strip():
        sections.append(
            "Art direction for this format (this governs composition and the alignment of "
            "the copy + button; the NEW LAYOUT note above only sets aspect, safe zones and "
            "crop): " + art_direction.strip()
        )

    # Finance intents may keep abstract market texture from the master; non-finance
    # recomps must not drift into a generic candlestick-chart template.
    chart_clause = "" if intent in _FINANCE_INTENTS else " or generic candlestick-chart template"
    sections += [
        "PRESERVE (reposition, do not remove):\n" + "\n".join(preserve),

        # Directly counters the PRESERVE block's main misreading (ghost layers).
        CLEAN_REPAINT_RULE,

        BRAND_DEFENCE_LINE,
        COPY_CONTRACT,

        f"Constraints: exactly {target_size} px. No new content. No watermarks. "
        "NO HARD SPLIT-PANEL. Keep it a real ad: no fake UI text or invented numbers, "
        "no real brand logos or wordmarks, no recognizable real landmarks, no AI "
        f"artifacts; do not drift into the watercolor/bokeh/abstract-swoosh{chart_clause}.",

        EDGE_INTEGRITY_RULE,
    ]
    if has_cta:
        sections.append(COPY_STACK_ALIGNMENT)
    if is_rtl(locale):
        sections.append("RTL composition: keep mirrored direction; hook + copy block on the right.")
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
