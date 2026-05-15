---
name: Banner design framework (shared by /banner-higgsfield and /banner-openai)
description: Design principles, aspect-ratio layout locks, archetypes, localization allowlists, RTL rules, typography, hard guardrails, and prompt templates. Loaded when composing a banner brief — not on every turn.
type: reference
---

# Banner Design Framework

Shared reference for `/banner-higgsfield` (Higgsfield) and `/banner-openai` (OpenAI gpt-image-2). The command files stay thin; this file carries the design intelligence.

---

## Six decision principles (per concept)

1. **Hook visual** — which element of the Title (number / phrase / claim) is the campaign hero. Numbers ≥ 2 digits, % signs, or strong single-word claims auto-trigger typography-hero mode.
2. **Layout lock** — the per-aspect-ratio placement rule. Claude enforces; the image model obeys.
3. **Subject role** — optional support, not hero (unless brief is explicitly a portrait campaign). Don't enumerate exact features.
4. **Background atmosphere** — 1–2 short phrases.
5. **Palette** — 2 hex + body color. LP-continuity bias. ≥ 4.5:1 button contrast.
6. **Button (CTA)** — Tier 2 hex, polished campaign button, height = `clamp(canvas_h × 0.08, 80, 160) px`.

---

## Aspect-Ratio Layout Locks (one line each)

- **1:1 SQUARE (master):** Large title block on left / top-left or center-left. Visual / atmosphere on right or background. CTA below title if present. Key hook can become oversized and dominant.
- **1200×628 WIDE:** Copy + CTA on left 40–45%. Visual / atmosphere on right 55–60%. No tall stacked text. Strong horizontal campaign composition.
- **9:16 TALL (Story / Reel):** Title top 20–30%. Visual center 40–50%. CTA bottom-center if present. Mobile safe zones (top 8%, bottom 12%).
- **3:4 PORTRAIT:** Title upper. Visual center. CTA lower. Premium editorial poster feel, still campaign-designed.
- **16:9 LANDSCAPE (Hero):** Title + CTA in left third or left 40%. Large visual atmosphere on right. Wide cinematic campaign layout, not a photo with text.

DISPLAY (300×250 / 728×90 / 300×600): heavy crop; recomp may flag as unusable.

---

## Aspect map — gpt-image-2 fixed sizes

gpt-image-2 supports exactly three sizes: `1024x1024`, `1024x1536`, `1536x1024`. Figma frame = exact target W×H; `scaleMode=FILL` handles the residual crop.

| Frame size | OpenAI `size` | Layout | Crop % | Safe area |
|---|---|---|---|---|
| any 1:1 | 1024×1024 | SQUARE | 0% | — (reuse MVP) |
| 1200×628 | 1536×1024 | WIDE | ~21% vertical | 12% top + bottom |
| 1080×1920 | 1024×1536 | TALL | ~16% horizontal | 10% left + right |
| 960×1200 / 1080×1350 | 1024×1536 | PORTRAIT | ~17% horizontal | 10% left + right |
| 1200×960 | 1536×1024 | MILD WIDE | ~17% horizontal | 10% left + right |
| 1920×1080 | 1536×1024 | LANDSCAPE | ~16% vertical | 10% top + bottom |
| 300×250 | 1536×1024 | MILD WIDE | ~20% horizontal | flag if >20% |
| 728×90 | 1536×1024 | EXTREME | ~81% vertical | unusable — recommend manual HTML5 |
| 300×600 | 1024×1536 | TALL | ~25% horizontal | flag if >20% |

Safe-area rule: when `frame_aspect > render_aspect` → crops vertical axis; when `<` → crops horizontal. Recomp prompts must include the safe-area instruction when `crop_pct > 10%`.

---

## 5 Creative Archetypes (pick one per concept)

- **A. Local Hero Campaign** — native subject OR local environment + large campaign title.
- **B. Premium Offer Poster** — huge number / %, bonus, key phrase dominates. Typography is the hero.
- **C. Editorial Lifestyle Campaign** — believable person in local lifestyle context, designed as a poster.
- **D. Cultural Prestige Campaign** — local architecture / skyline / regional identity frames the message.
- **E. Minimal Premium Typographic Campaign** — title carries the ad.

Default for question-led headlines or strong claims: **E**. Default for offers with a number: **B**.

---

## Claude vs image-model responsibility split

**Claude controls (in the prompt):**
- Format + market + mood
- Hook (`Main hook: "{phrase}" is the visual hero`)
- Layout lock (one sentence per aspect ratio)
- Verbatim Title + CTA text
- CTA placement
- Palette names (or hex if LP-derived)
- Local market cue (1–2 words)
- Forbidden defaults (short list)

**Image model controls (Claude does NOT prescribe):**
- Exact subject features (age, hair, wardrobe, expression)
- Specific room interior, props
- Lighting angle / color temperature
- Decorative ornament style
- How the design layer renders
- Atmospheric depth treatment
- Font choice

Stay in your lane.

---

## Background logic

**Use:** continuous campaign background · graphic panels · soft gradients · local atmosphere · decorative energy · clean copy zone · visual flow between text and hero.

**Avoid:** continuous office scene · realistic desk environment · corporate room · dark luxury interior · flat split panel.

---

## Highlight phrase + CTA Color Tier rule

- Highlight phrase output as `"oversized [color] typography"`. Number / % / strong claim auto-elevates to type-hero.
- Tier 1 (highlight) hex ≠ Tier 2 (CTA) hex.

---

## Register cues (Title → register)

| Trigger | Register | Visual cue |
|---|---|---|
| achievement, status, premium | aspiration | gold + ivory, marble texture |
| now, last, limited, expires | urgency | red accent, motion blur, ticking |
| really? / are you sure? / why? | provocation | question-mark hero, contrast |
| 43 analysts, verified, certified | trust | navy + gold seal, badge |
| how / what / discover | curiosity | open-ended composition |
| your, you, take control | empowerment | strong typography, direct gaze |
| we, our, made for | identity | warm community palette |

Default when unclear: `curiosity`.

---

## Localization atmosphere allowlists

- **English / generic:** clean editorial premium, navy + ivory + accent.
- **pt-BR:** premium pt-BR campaign poster, vibrant but composed, deep navy + accent (warm gold, signal green, or amber).
- **pt-PT:** restrained European editorial, navy + ivory + muted accent.
- **Nordic / Swedish:** Stockholm waterfront / Nordic skyline atmosphere, deep navy + ivory + gold / neon-green palette, golden-hour or cool daylight, soft curved panels, minimal-but-bold typographic hierarchy.
- **DACH:** Berlin / Zurich / Vienna skyline silhouette, engineering-precision graphic structure, neutral grey + accent palette.
- **LATAM:** São Paulo / Mexico City warm daylight, terracotta + sun-saturated colors, natural textures.
- **MENA Gulf:** Gulf skyline silhouette, marble-texture gradient + restrained gold-line ornament framing.
- **East Asia (urban):** Dense city neon abstracted into color flow, glass-tower silhouette, sleek tech-surface gradient.
- **Thailand:** Bangkok temple gold-tone + soft warm light, saturated jewel-tone palette, subtle ornamental framing.
- **JP:** Tokyo / Kyoto refined minimalism, ink-and-gold or refined neon palette, soft architectural silhouette.
- **Malaysia:** Kuala Lumpur skyline silhouette, warm tropical light, deep black + rich gold + ivory palette, subtle Malay batik or arabesque ornament — no dark office.
- **Indonesia:** Jakarta skyline silhouette, warm tropical daylight, terracotta + saffron + ivory palette.
- **Arabic / Hebrew / Urdu / Farsi / Pashto:** RTL composition — mirror visual hierarchy; title block enters from the right.

Market exclusion lists (avoid forcing local clichés that don't apply): never put a Western analyst portrait in a JP / MENA / Thailand brief; never put gold ornament in a Nordic brief.

---

## RTL composition

Mirror everything horizontally. Title enters from the right. CTA still bottom-anchored. Numerals stay LTR even within an RTL block. Do not flip the question mark — Arabic uses `؟` (U+061F).

---

## Typography

- LTR headline: Inter (default), Söhne, Helvetica Now.
- RTL Arabic: IBM Plex Sans Arabic, Cairo.
- CJK: Source Han Sans / Noto Sans CJK.
- Max 2 typefaces. Weights 700–900. No drop shadows, no outlining, no distortion.
- **Text rendering rule:** When a title contains accented chars (ã, ç, ô, etc.) or long words near a `?`, instruct the model: *"Render every word fully and legibly. The question mark must sit clearly AFTER the final letter — never overlap."* gpt-image-2 has known glitches truncating final letters when adjacent to punctuation.

---

## Hard guardrails

- **Never** include API keys (`OPENAI_API_KEY`, `FIGMA_TOKEN`, etc.) in any prompt, comment, or echoed shell command.
- **Never** commit a file containing a key. `.env` is gitignored — confirm before any commit.
- **Never** dark editorial office scene · realistic desk environment · corporate room · dark luxury interior.
- **Never** hard split-panel composition.
- **Never** invented readable text in screens / UI / charts — any UI must be blurred or abstract.
- **Never** politicians, partisan colors, US flag, Capitol, or any specific real person without explicit user authorization.
- **Verbatim Title + CTA** — never paraphrase, never split a title across panels.

---

## § Visual Prompt Template (6 sections — 450–750 chars preferred, ≤900 hard)

```
{W}x{H} premium {LOCALE} campaign poster for {PRODUCT_CATEGORY}, {REGISTER} mood. Finished paid-social creative, not an editorial office photo.

Main hook: "{highlight phrase}" is the visual hero. Use bold graphic ad layout, oversized typography, premium {palette} color system, clean copy zone, and visible design layer.

Layout: {aspect-ratio layout lock — one sentence}. Title reads exactly: "{Title}". CTA "{CTA}" {CTA placement if present}.

Visual atmosphere: {local market cue, one phrase}, subtle {campaign theme} energy, soft gradients, curved panels, polished campaign lighting. Optional photo-real subject only as support, integrated into the design.

Readable text only: Title and CTA. No logos, no fake UI, no invented text. Avoid {forbidden defaults — short list}.
```

---

## § Recomposition Prompt Template (≤1,200 chars)

```
RECOMPOSE the attached master (1200×1200) into {W}×{H}. Same campaign, same text, same colors, same typography. NOT a stretch, NOT a crop, NOT a fresh generation. Layout is REDESIGNED for this aspect — never split-panel.

NEW LAYOUT ({WIDE | TALL | LANDSCAPE | PORTRAIT}): {one-sentence per-aspect placement rule from § Aspect-Ratio Layout Locks}.

CAMPAIGN ELEMENT MANIFEST (preserve, reposition, do not remove):
- title hierarchy: {from master}
- highlight treatment: {from master}
- CTA treatment: {from master if any}
- main visual metaphor: {from master}
- market atmosphere: {from master}
- color system: {hex1 + hex2}
- graphic panel style: {from master}
- hero subject type (if used): {from master}

TITLE (verbatim): "{full Title}". CTA "{CTA}" if present. {If TALL or PORTRAIT and a subject is used: subject occupies 45–55% of canvas height.}

SAFE AREA: {if crop_pct > 10% — "Leave 10–12% safe area on {vertical | horizontal} axis."}

Constraints: exactly {W}×{H} px. No new content. No watermarks. NO HARD SPLIT-PANEL. NO regression into office / desk / lamp / notebook / coffee / analyst portrait / AI chip still life. Any screen/chart/UI blurred or abstract. {If RTL: keep mirrored direction.}
```

---

## Final Internal Check (6 questions before MVP send, and after render)

1. Does this sound like a **brief**, not a photoshoot direction?
2. Is the **title / offer the hero**?
3. Is the **layout lock present** for the aspect ratio?
4. Did I **avoid enumerating** exact features, exact props, exact lighting angles?
5. Did I **name the forbidden defaults** to avoid?
6. Is the prompt **≤ 900 chars** (preferably 450–750)?
