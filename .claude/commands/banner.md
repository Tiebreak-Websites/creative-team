---
description: Generate one MVP banner with Higgsfield GPT Image 2 (1:1), then recompose it into every other size the user asked for, and paste each output into a Figma frame at the exact pixel size
---

# /banner — MVP → Recompose → Figma (Higgsfield GPT Image 2)

Two-pass workflow:

1. **MVP pass.** Generate ONE master banner at **1:1 aspect** with **Higgsfield GPT Image 2** using the full CTR brief. This is the single source of truth for the campaign.
2. **Recomposition pass.** For every non-1:1 size the user requested, fire a separate GPT Image 2 call that takes the MVP image as a reference (`medias` with role `image`) and uses the strict "Resize and recompose" prompt to rebuild the layout for the new aspect — without inventing copy, colors, or elements.
3. **Figma pass (write-only).** Create one frame per requested size at the exact pixel dimensions, then paint each finished image into its frame.

Banner structure is always **Title + CTA**. Design direction (composition, typography, color, density) is baked into the brief — caller doesn't supply it.

Figma is **write-only**: create frames + paint fills. Never call `get_metadata`, never call `get_design_context`, never read the file tree.

---

## Input parsing

Arguments: `$ARGUMENTS`

Pull these out of the message (free-form, no rigid syntax):

- **Figma URL** — REQUIRED. Any `https://figma.com/design/<fileKey>/...` link. Extract `fileKey`. Ignore `node-id` / `p` / `t` query params.
- **Sizes** — REQUIRED. One or more `WxH` pixel tokens (`1200x1200`, `1200x628`, `960x1200`, ...). Both `x` and `×` accepted. Always pixels.
- **Title** — REQUIRED. The full banner copy verbatim. Accept `Title:`, `Tittle:` (common typo), `Headline:`, or an unlabeled line. Whatever the user wrote goes into `{TITLE}` as-is — never split, never "improve," never translate.
- **CTA** — REQUIRED. Accept `cta:` / `CTA:` / `button:`. Goes into `{CTA}` verbatim.

### Hard fail-fast — STOP and error out

- No Figma URL → `❌ /banner needs a Figma file URL.`
- No sizes → `❌ /banner needs at least one size in pixels, e.g. 1200x1200.`
- No title → `❌ /banner needs the title copy verbatim.`
- No CTA → `❌ /banner needs the CTA copy verbatim.`

---

## Pre-flight (minimal)

1. **GPT Image 2 model id.** Call `models_explore` once with `action=search`, `query="gpt image 2"`, `type=image`, `limit=5`. Pick the model whose id contains `gpt_image_2`. Fall back to the literal id `gpt_image_2` if search returns nothing. Do not stall — only stop if `generate_image` later rejects the id.
2. **No Figma reads.** Skip `get_metadata` / `get_design_context` entirely.

---

## Phase 0 — fill the brief slots

The MVP is **always rendered at 1200×1200, 1:1**. The new brief is tightly tied to that canvas (90px x-height minimums, 60px edge safe area, 90px button height) — do not change the canvas size.

Before calling `generate_image`, fill these slots from the user's input:

- `HERO` ← the user's Title verbatim. This is the single dominant phrase on the banner.
- `SUPPORT` ← leave blank by default. Only fill if the user explicitly provided a separate supporting line. Do not split the Title to invent one.
- `ACCENTS` ← leave blank by default. Only fill if the user explicitly provided tickers, numbers, percentages, dollar figures, or brand names as a separate field. Do not extract them from the Title.
- `CTA` ← the user's CTA verbatim.
- `LANGUAGE` ← **auto-detect from the HERO + CTA text** and write it in the brief as a concrete label (e.g. `pt-BR`, `es-LATAM`, `English`, `Arabic`, `Hebrew`, `th-TH`). The brief uses LANGUAGE to drive localization reasoning and RTL handling — get this right or the banner ships generic Western imagery on a non-English campaign.

Auto-detect LANGUAGE rules:
- If the copy is in Portuguese with LATAM cues (BRL, Brazilian Portuguese spellings like "você," "Brasil"), use `pt-BR`.
- If Spanish with LATAM cues, use `es-LATAM`. If European Spanish (Spain, EUR), use `es-ES`.
- If the script is Arabic, default to `Arabic` (let the brief's RTL section pick dialect from copy cues).
- If Hebrew, use `Hebrew`. If Thai, use `th-TH`. If Farsi/Persian, use `Farsi`.
- If unclear, default to `English`.

---

## Phase 1 — generate the MVP banner (CTR brief, 1:1)

One `generate_image` call:

```
mcp__7e69985f-4eb5-4034-a063-d465c056f301__generate_image
  params:
    model: gpt_image_2
    aspect_ratio: "1:1"
    quality: "high"
    resolution: "1k"
    count: 1
    prompt: <MVP brief with HERO/SUPPORT/ACCENTS/CTA/LANGUAGE slots filled>
```

Block on this. The recomposition pass cannot start until the MVP completes — wait for `status: completed` and capture the MVP's `job_id` and `rawUrl`. Use a short background timer (60–90s) and re-check via `job_display` until status flips. Do not poll in tight loops.

### MVP brief (fill the slots only — do not edit anything else)

```
Create a 1200×1200 square banner ad designed for maximum click-through rate (CTR), with the combined expertise of a senior performance marketing specialist and a UX/UI designer.

═══════════════════════════════════════
OUTPUT FORMAT (non-negotiable)
═══════════════════════════════════════
- Canvas: exactly 1200×1200 pixels, square 1:1.
- Flat finished banner only. No mockup frame, no device bezel, no ad preview chrome, no "Ad" label, no browser UI.
- Production-ready: sharp, balanced, high contrast, instantly scannable.

═══════════════════════════════════════
CONTENT — render verbatim, nothing else
═══════════════════════════════════════
Use ONLY the text in the slots below. Do not add, invent, paraphrase, translate, summarize, or extend any copy, taglines, disclaimers, badges, labels, URLs, prices, dates, percentages, icons, logos, or extra words. Every character in the final image must come verbatim from these slots, with perfect spelling, spacing, punctuation, and accent marks.

HERO: {HERO}
SUPPORT: {SUPPORT}
ACCENTS: {ACCENTS}
CTA: {CTA}
LANGUAGE: {LANGUAGE}

CTA RULE:
If the CTA slot is empty, do NOT render a button anywhere on the canvas. No empty button, no placeholder text, no decorative button shape. The composition must be designed around hero + support + accents only, with the visual flow ending on the hero phrase or accent number instead.

═══════════════════════════════════════
CONTENT ANALYSIS (perform before composing)
═══════════════════════════════════════
Before generating the layout, analyze the supplied content and identify the SINGLE most conversion-critical element within it — the phrase, number, or word that carries the strongest CTR-driving weight. This is the "money element."

Selection priority for the money element (in order):
1. A specific number, percentage, dollar figure, or ticker (almost always wins for finance/trading creative)
2. A high-intensity benefit verb or transformation phrase ("double," "unlock," "win," "free," "today")
3. A named entity with strong recognition value (brand, ticker, product name)
4. A loss-aversion or urgency phrase ("last chance," "ends today," "before it's gone")
5. If none of the above exist, the hero phrase itself is the money element

After identifying the money element, treat it as the SECOND-most visible element on the canvas — ranked directly after the CTA button in visual prominence. Visibility ranking from most to least visible:

  1. CTA button (if present) — highest contrast, clearest click target
  2. Money element — high-CTR conversion styling (see below)
  3. Hero phrase (if separate from money element)
  4. Support copy
  5. Remaining accents

If there is no CTA, the money element becomes the most visible element on the canvas.

HIGH-CTR CONVERSION STYLING for the money element:
- Render in the accent color (the highest-saturation, most attention-grabbing color in the palette after the CTA color)
- Weight 800–900, heavier than surrounding copy
- Size: equal to or larger than the hero phrase
- Optional subtle treatments allowed (and only here): a colored underline, a highlight bar behind the text, or a tight box outline — pick ONE, never combine
- Must sit at or near a rule-of-thirds intersection
- Must not touch or overlap other text blocks
- If the money element is a number with a unit (%, $, x), keep the unit visually attached but slightly smaller than the figure itself

The money element and the CTA together form the visual anchor pair. Everything else in the composition supports their relationship.

═══════════════════════════════════════
LOCALIZATION (perform before imagery — applies to ALL languages)
═══════════════════════════════════════
The LANGUAGE slot determines the cultural framing of the entire banner — not just the script. A banner shown to an audience in any market must feel native to them: the people, environment, lighting, props, wardrobe, and overall visual mood should read as belonging to that market's contemporary reality. Generic Western imagery defaulted onto a non-English banner is the single most common reason performance creative underperforms in localized markets.

This is NOT a template-matching task. Do not apply a fixed visual style to a language. Instead, perform active localization reasoning for every banner.

LOCALIZATION REASONING (perform before deciding any imagery):

Step 1 — Identify the target market.
Read the LANGUAGE slot and infer the primary geographic market it serves. If the language is regional or has multiple major markets, use context clues in the supplied copy (currency symbols, city names, tickers, brand names, register of speech, dialect markers, cultural references) to narrow it down. If still ambiguous, default to the most populous primary market for that language.

Step 2 — Read the copy context.
Analyze HERO, SUPPORT, and ACCENTS together to understand what this specific banner is selling, what emotional tone it carries, who the realistic target customer is for this exact offer, and what setting or moment would feel native to that customer's daily life. A banner about retirement planning needs a different subject and setting than one about quick day-trading wins, even within the same language.

Step 3 — Compose locally.
Make every imagery decision — subject ethnicity and features, age range, wardrobe, setting, architecture, lighting quality, props, color mood, gesture, expression — based on what would feel authentic to a real person in that market viewing this exact ad on their phone. Choose specifics that match this banner's copy and emotional intent, not generic stand-ins for "the market."

Step 4 — Vary across banners.
If multiple banners are being produced for the same market, do NOT repeat the same subject archetype, setting, or visual treatment across them. Localization is about authenticity to the market, not about reusing a stored look. Each banner should feel locally native AND visually distinct from any other banner in the same campaign.

CULTURAL SAFETY CHECKS (universal, apply during imagery composition):

- Match subject features, wardrobe, and setting to the actual market — never use placeholder Western defaults on non-English banners, and never apply imagery cues from one region to another (no Mexican visual tropes on Brazilian creative, no Gulf attire on Levantine creative, no East Asian features on Latin American creative, etc.).
- Respect regional sensibilities around dress, modesty, religious symbolism, alcohol, gambling, gender representation, and physical contact. When uncertain, default to neutral professional or aspirational framing rather than lifestyle clichés.
- Avoid hand gestures that read negatively in the target market: thumbs-up in parts of the Middle East and West Africa; OK sign (fingertip circle) in Brazil, Turkey, and parts of the Middle East; pointing with the index finger across much of Asia and the Middle East; prominent left-hand display in Middle Eastern and South Asian markets.
- Apply color meaning to the market: red signals loss in Western finance but luck and prosperity in Chinese-market creative; green is positive in most Western markets but carries political and religious associations in parts of the Arab world; white reads premium in the West but mourning in parts of East Asia; gold reads premium in Gulf and East Asian markets, less so in Western ones. Use color choices that reinforce the intended emotional outcome for the specific market.
- The emotional register that converts varies by market. Match the visual mood to what is credible and appealing for the target audience — not what would work for an English-speaking Western audience.

═══════════════════════════════════════
LANGUAGE & RTL HANDLING (evaluate before composing)
═══════════════════════════════════════
Before laying out the canvas, determine whether the LANGUAGE slot specifies a right-to-left (RTL) script. RTL languages include: Arabic (all dialects — Gulf, Levantine, Egyptian, MSA), Hebrew, Urdu, Farsi/Persian, Pashto, Sindhi, Kurdish (Sorani).

If the language is RTL, the ENTIRE composition must be mirrored — this is non-negotiable for CTR in those markets. A left-aligned Latin-style layout in Arabic feels foreign, breaks scanning flow, and visibly tanks engagement. RTL audiences scan right-to-left, so the visual hierarchy must follow that path.

RTL COMPOSITION RULES (apply only when language is RTL):
- Mirror the entire layout: hero subject occupies the LEFT half of the canvas, headline copy stacked and right-aligned on the RIGHT half.
- CTA placement: bottom-LEFT at a strong third intersection (the natural endpoint of an RTL scan).
- Visual flow: HERO (top-right) → money element → CTA (bottom-left). The eye travels right-to-left and top-to-bottom.
- Money element placement: top-right or upper-right third intersection — the first point an RTL viewer fixates on.
- If a human subject is present, direct their gaze, body angle, or visual energy toward the LEFT (toward the headline and CTA), not the right.
- All punctuation (commas, periods, question marks, parentheses, quotation marks) must render in their correct RTL form and position. No reversed or broken punctuation.
- Numbers, percentages, tickers, and Latin-script brand names render in their original Western/Latin form (left-to-right) even inside an RTL line — do not mirror digits or English brand names.
- Line breaks must respect Arabic word boundaries — never break a word mid-character or mid-ligature.

RTL TYPOGRAPHY (apply only when language is RTL):
- Use Arabic-native typefaces, NOT Latin fonts with Arabic fallbacks (which produce broken or stylistically mismatched letterforms).
- Primary headline typeface: **Tajawal** (modern geometric, strong display weights, excellent for Gulf and broader Arabic markets) or **Cairo** (clean, contemporary, very legible at large sizes). Default to Tajawal for headline-heavy banners, Cairo for copy-heavy banners.
- For Hebrew, default to Heebo or Rubik. For Urdu/Farsi, default to Vazirmatn or Noto Naskh Arabic.
- Headline weight: 700–800 (Tajawal Bold or Cairo Bold/Black). Money element: 800–900 (Tajawal Black or Cairo Black).
- Arabic typography requires slightly LOOSER leading than Latin — do not over-tighten or letterforms will collide on diacritics and ligatures.
- Tracking: neutral. Never condense Arabic — it destroys ligature integrity and looks amateur.
- No stretching, distortion, kashida-stretching for justification, or decorative effects on letterforms.

If the language is LTR (English, Spanish, Portuguese, French, German, etc.), apply the standard LTR composition rules in the Composition section below.

═══════════════════════════════════════
HIERARCHY (3 tiers, 3 sizes max)
═══════════════════════════════════════
- Tier 1 — HERO + MONEY ELEMENT: largest text on canvas. Weight 800–900. Highest contrast. Headline x-height minimum 90px. The money element sits at or above hero size.
- Tier 2 — SUPPORT: smaller than Hero. Weight 500–600. Softer color from the same family as Hero.
- Tier 3 — CTA (only if CTA slot is filled): rendered inside a solid-fill button. Does not need to be the largest text — earns clicks through contrast, shape, and placement.

Maximum 3 distinct font sizes across the entire banner.

═══════════════════════════════════════
COMPOSITION — LTR DEFAULT (use only when language is LTR)
═══════════════════════════════════════
- Hero subject occupies one half of the canvas (left or right).
- Headline copy stacked, left-aligned, in the opposite half.
- Money element placed at a strong third intersection, visually anchored to either the hero phrase or the CTA.
- If a CTA is present: place it bottom-left or bottom-right at a strong third intersection. Visual flow: HERO → money element → CTA.
- If no CTA: visual flow ends on the money element. Use breathing room at the bottom rather than filling the space.
- The viewer's eye must land on the money element or HERO first, then travel to CTA. Nothing else competes for first fixation.
- Strong negative space around the headline and money element.
- If the background is busy, place headline over a subtle dark scrim or directional gradient for legibility.
- At least 8% padding around every text block.
- Critical text and CTA stay ~60px inside the canvas edges.

For RTL languages, override this section entirely with the RTL Composition Rules above.

═══════════════════════════════════════
TYPOGRAPHY
═══════════════════════════════════════
- Maximum 2 typefaces total across the entire banner.
- LTR headline: Inter, Söhne, Helvetica Now, or a similar geometric/grotesque sans-serif. Default to Inter if uncertain.
- RTL headline: Tajawal (default) or Cairo for Arabic; Heebo or Rubik for Hebrew; Vazirmatn or Noto Naskh Arabic for Urdu/Farsi.
- Headline weight: 700–800. Money element weight: 800–900.
- LTR: tight leading on the headline, neutral to slightly tight tracking — do not over-condense.
- RTL: slightly looser leading than LTR equivalent, neutral tracking — never condense Arabic or Hebrew.
- No stretching, distortion, warping, outlining, kashida-justification, or heavy effects on letterforms.
- No drop shadows on text by default. If a subtle shadow is required for legibility over a busy background, keep it minimal: low opacity, tight offset, soft blur.

═══════════════════════════════════════
COLOR (3 roles)
═══════════════════════════════════════
- 1 dominant brand color (background or hero field)
- 1 accent color — reserved primarily for the money element. Must be the second-highest-contrast color in the composition (after CTA color)
- 1 CTA color — must be the highest-contrast color in the composition (omit if no CTA)
- 1 neutral base (for body copy)
- Apply market-aware color reasoning from the Localization section — color meanings shift by market and must support the intended emotional outcome for the target audience.
- Avoid muddy gradients. If a gradient is used, make it clean, directional, and purposeful.

═══════════════════════════════════════
CTA BUTTON SPEC (only if CTA slot is filled)
═══════════════════════════════════════
- Solid fill only. No outline-only, no ghost buttons, no skeuomorphic 3D.
- Shape: rectangular or pill. Sharp or softly rounded corners only.
- Minimum button height: 90px on the 1200px canvas.
- Horizontal padding inside button: ~1.5× the text x-height.
- CTA color contrast against background must be the strongest in the layout.
- For RTL languages, CTA button text renders in the RTL script using the same typeface as the headline (Tajawal/Cairo for Arabic).
- If the CTA slot is empty, skip this section entirely. Do not render any button-shaped element.

═══════════════════════════════════════
IMAGERY
═══════════════════════════════════════
- Commit to ONE style: either photorealistic OR clean vector illustration. Never mix.
- Localization reasoning (from the Localization section) is the primary source of truth for who appears on the canvas and where they appear. Subject features, wardrobe, setting, lighting, props, and visual mood must be reasoned from the LANGUAGE slot AND the supplied copy context for this specific banner — not pulled from generic defaults or repeated from previous banners.
- If a human is present: one authentic candid subject, natural expression, sharply lit, clearly separated from background. Direct their gaze or body angle toward the money element or CTA.
- Avoid gestures flagged in the Cultural Safety Checks for the target market.
- Emotional trigger: pick ONE that fits the supplied copy AND the credible emotional register for the target market — curiosity, aspiration, urgency, confidence, or relief.
- Use a benefit-forward visual metaphor. Show the outcome or transformation, not the product feature.

═══════════════════════════════════════
DO NOT RENDER (negative constraints)
═══════════════════════════════════════
- No invented words, logos, app icons, brand marks, or badges not present in the content slots.
- No fake UI chrome: browser bars, phone frames, "Sponsored" or "Ad" labels, mock notifications.
- No text inside the hero subject (no words on shirts, screens, signs, posters) unless that exact text is in the content slots.
- No watermarks, signatures, "Generated by," or AI artifact marks.
- No duplicated, mirrored, or repeated text anywhere on the canvas.
- No mirrored or reversed Arabic/Hebrew letterforms — RTL text must render in its native direction, never flipped.
- No Latin fonts forced onto Arabic or Hebrew copy — always use a native RTL typeface.
- No generic Western stock-photo defaults on non-English banners — localization reasoning must drive imagery decisions.
- No cross-region cultural mismatches: do not apply imagery cues from one region to another even within the same language family.
- No repeated subject archetypes, settings, or visual treatments across banners in the same campaign — each banner must be visually distinct.
- No gestures flagged as offensive in the target market.
- No generic AI stock aesthetics: fake-smiling stock people, glowing tech orbs, oversaturated gradient soup, cliché upward arrows over cityscapes, stock handshakes, lightbulb metaphors.
- No drop shadows, glows, or outlines on text by default.
- No mixed visual styles (photo + vector together).
- No button, button shape, or button placeholder if the CTA slot is empty.
- No competing emphasis treatments — only the money element gets the highlight/underline/box treatment.
```

---

## Phase 2 — recompose the MVP into every non-1:1 size

For each requested size whose aspect is NOT `1:1`, fire **one recomposition call** that uses the MVP as the master source. Fire them all **in parallel** in a single assistant turn.

```
mcp__7e69985f-4eb5-4034-a063-d465c056f301__generate_image
  params:
    model: gpt_image_2
    aspect_ratio: <closest supported aspect for this WxH>
    quality: "high"
    resolution: "1k"
    count: 1
    medias:
      - value: <MVP job_id from Phase 1>
        role: "image"
    prompt: <recomposition prompt with target size substituted>
```

For 1:1 sizes the user requested (other than the MVP itself), **skip the recomposition** — they reuse the MVP image directly.

### Aspect mapping (GPT Image 2 supports `1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3`)

| Requested size | Aspect to request |
|---|---|
| `1200×1200` (or any square) | `1:1` (no recomposition — reuse MVP) |
| `1200×628`  | `16:9` |
| `960×1200`  | `3:4` |
| `1200×960`  | `4:3` |
| `1080×1350` | `4:5` → closest `3:4` |
| `1080×1920` | `9:16` |
| `1920×1080` | `16:9` |

For sizes not in the table, pick the closest aspect from the supported set by ratio distance.

### Recomposition prompt (substitute `{TARGET_WIDTH}×{TARGET_HEIGHT}` only)

```
Resize and recompose the attached master banner (1200×1200) into a new size: {TARGET_WIDTH}×{TARGET_HEIGHT}.

This is a RECOMPOSITION task, not a stretch, crop, or generation task. Treat the master as the single source of truth and rebuild the layout to fit the new aspect ratio without losing any meaning, branding, or message.

ABSOLUTE RULES — DO NOT BREAK ANY OF THESE:

1. NO NEW CONTENT
   - Do NOT add any text, words, characters, numbers, dates, prices, percentages, badges, labels, asterisks, fine print, disclaimers, URLs, logos, icons, or graphic elements that are not already present in the master.
   - Do NOT invent taglines, sub-headlines, or CTA variations.
   - Do NOT translate, paraphrase, summarize, or "improve" any copy.
   - Every word and every visual element in the output must already exist in the master image.

2. PRESERVE EVERY ELEMENT FROM THE MASTER
   - Keep the same headline, supporting line, CTA text, logo, hero subject, and brand colors — exactly as they appear.
   - Keep the same typography (typeface, weight, casing, tracking).
   - Keep the same color palette — no new colors, no shifted hues, no new gradients.
   - Keep the same illustration/photography style.

3. NO STRETCHING, NO DISTORTION
   - Do NOT scale the image non-proportionally.
   - Do NOT warp, squash, or stretch the hero subject, logo, or any text.
   - Do NOT upscale text and re-render it with different letter shapes.

WHAT YOU SHOULD DO — RECOMPOSE INTELLIGENTLY:

A. REBUILD THE LAYOUT FOR THE NEW ASPECT RATIO
   - Treat the canvas as a fresh grid. Reposition existing elements so the composition feels native to the new shape, not a cropped square.
   - For TALL formats (e.g., 960×1200, 300×600, 160×600): stack elements vertically. Headline top, hero/visual middle, CTA bottom. Generous vertical rhythm.
   - For WIDE formats (e.g., 1200×628, 728×90, 970×250): place elements horizontally. Hero subject on one side (usually left or right third), text block on the opposite side, CTA aligned with text. Strong horizontal flow toward the CTA.
   - For SQUARE-ISH formats: rebalance with rule of thirds; do not just center everything.

B. EXTEND THE BACKGROUND, DON'T STRETCH IT
   - If the new format is wider or taller than the master, EXTEND the existing background (color, gradient, texture, or environment) to fill the new space — match tone, lighting, and direction exactly.
   - The extended background must look like it was always part of the original — seamless, no visible seam, no color shift, no repeating pattern artifacts.
   - Do NOT fill empty space with new objects, decorative shapes, or invented graphics.

C. RESCALE ELEMENTS PROPORTIONALLY
   - Hero subject, logo, and text blocks should be resized proportionally to feel balanced in the new canvas — not shrunk into a corner, not blown up past readable proportions.
   - Maintain the original visual hierarchy: headline dominant, supporting line secondary, CTA prominent and high-contrast.
   - Maintain safe margins (~5% of the shortest side) on all four edges. No element touches the canvas edge.

D. KEEP THE CTA STRONG
   - The CTA button must remain the highest-contrast interactive element.
   - Same button color, same button text, same shape and corner radius as the master.
   - Reposition it to the natural endpoint of the new visual flow (bottom for tall, right side for wide, lower-right for landscape).

E. WIDE-FORMAT SPECIFIC GUIDANCE (critical — this is where most resizes fail)
   - Do NOT center everything in a wide banner. That kills hierarchy.
   - Split the canvas into clear left/right zones: visual on one side, text + CTA on the other.
   - Headline can break to fewer lines than the master (e.g., 2 lines in the square may become 1 line in 1200×628) — but only if the exact same words still fit. Never cut or shorten copy.
   - Reduce vertical stacking; embrace horizontal reading order.
   - Hero subject may need to be reframed tighter (e.g., portrait crop instead of full body) — but do not invent new parts of the subject; work only with what's visible in the master.

F. TALL-FORMAT SPECIFIC GUIDANCE
   - Stack vertically with clear breathing room between blocks.
   - Headline at top third, hero in middle, CTA in bottom third.
   - Do not let the hero subject dominate the entire canvas — leave room for copy and CTA to breathe.

OUTPUT
- Final canvas: exactly {TARGET_WIDTH} × {TARGET_HEIGHT} pixels.
- Flat, finished banner — no mockup frame, no device bezel, no "ad preview" chrome, no watermarks.
- Sharp, production-ready, identical brand feel to the master.
- Same message, same elements, new shape.
```

Note: the literal `(1200×1200)` reference in the recomposition prompt is correct. The MVP is always rendered at 1200×1200 — the new slot-based brief is tightly coupled to that canvas size and is not parameterized.

After firing the recomposition calls, wait for all to complete via `job_display` + a short background timer. Capture each result's `rawUrl`.

---

## Phase 3 — create Figma frames at exact pixel sizes (WRITE-ONLY)

One `use_figma` call creates every requested frame. Side-by-side at `y=0`, 100px gap. Names: `Banner — {WIDTH}x{HEIGHT}`. `fills: []` initially.

```js
const sizes = [/* injected, e.g. [[1200,1200],[1200,628],[960,1200]] */];
let x = 0;
const ids = [];
for (const [w, h] of sizes) {
  const f = figma.createFrame();
  f.name = `Banner — ${w}x${h}`;
  f.resize(w, h);
  f.x = x; f.y = 0;
  f.fills = [];
  f.clipsContent = true;
  f.cornerRadius = 0;
  figma.currentPage.appendChild(f);
  ids.push({ size: `${w}x${h}`, id: f.id });
  x += w + 100;
}
return ids;
```

---

## Phase 4 — paste each generated image into its frame (Path B)

Use `upload_assets` + `curl` POST — not `figma.createImage`. The Figma plugin sandbox has no `fetch`, so Path A is not viable.

For each `{size, frameNodeId, imageUrl}`:

1. **Download bytes locally:**
   ```
   curl -sL -o /tmp/banner/<size>.png "<imageUrl>"
   ```
2. **Request an upload URL:**
   ```
   upload_assets:
     fileKey: <fileKey>
     count: 1
     nodeId: <frameNodeId>
     scaleMode: FILL
   ```
3. **POST the bytes** to the returned `submitUrl` with `Content-Type: image/png`:
   ```
   curl -sS -X POST -H "Content-Type: image/png" --data-binary @/tmp/banner/<size>.png "<submitUrl>"
   ```

Run all three uploads in parallel (one assistant turn, three tool calls).

For 1:1 sizes that reuse the MVP image, save it once at `/tmp/banner/mvp.png` and POST that same file for every 1:1 frame.

---

## Phase 5 — summarize

```
/banner done — N banners (1 MVP, M recomposed) · file: https://figma.com/design/<fileKey> · model: gpt_image_2

| Size | Source | Frame node | Job |
|---|---|---|---|
| 1200x1200 | MVP            | 12:345 | <mvp_job_id> |
| 1200x628  | recomposed     | 12:346 | <job_id>     |
| 960x1200  | recomposed     | 12:347 | <job_id>     |
```

End with: `Open the file in Figma to review. Regenerate any size by re-running /banner with just that size.`

---

## Constraints — do not violate

- **GPT Image 2 only.** Never substitute `soul_2`, `nano_banana_2`, `marketing_studio_image`, etc.
- **Resolution is always `1k`.** Both the MVP and every recomposition must be generated with `resolution: "1k"`. Never use `2k` or `4k` — the Figma frame is the source of truth for pixel dimensions; the generated image is fitted via `scaleMode: FILL`, so higher resolutions waste credit without improving the deliverable.
- **MVP is always 1200×1200 (1:1).** Canvas size is locked — the brief's pixel measurements (90px x-height minimum, 60px edge safe area, 90px button height) only work at 1200×1200. Recomposition is the only way to produce non-1:1 banners — never generate non-1:1 banners from scratch.
- **MVP is the single source of truth.** Every recomposition must pass the MVP's `job_id` as a `medias[]` entry with `role: "image"`. Never run a recomposition without the master reference.
- **Verbatim copy.** Title and CTA pass through unchanged — no edits, no translations, no improvements. The recomposition prompt's "NO NEW CONTENT" rules forbid the model from adding or changing copy.
- **Exact pixel sizes.** Frame is W×H to the pixel.
- **Figma is write-only.** No `get_metadata`, no `get_design_context`. Only allowed Figma operations: create frames + paint image fills via `upload_assets`.
- **No autonomous commits.** Per CLAUDE.md.
