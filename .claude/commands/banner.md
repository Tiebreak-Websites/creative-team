---
description: Generate CTR-optimized banners at user-specified pixel sizes using Higgsfield GPT Image 2, then place them as native frames in a Figma file
---

# /banner — Higgsfield GPT Image 2 → Figma

Three steps, nothing else:

1. **Generate** each banner with **Higgsfield GPT Image 2** (mandatory — no other model).
2. **Create** a native **Figma frame at the exact pixel size** the user asked for.
3. **Paste** the generated image inside that frame as a fill.

Banner structure is always **Title + CTA**. The full design direction (composition, typography, color, density, photorealism rules) is already baked into the master brief below — do NOT ask the user for visual direction and do NOT infer it. Just plug in `{TITLE}` + `{CTA}` + the size and generate.

Figma is **write-only** in this command. Never call `get_metadata`, never call `get_design_context`, never read the file tree. The only Figma calls are `use_figma` to create frames and either `use_figma` or `upload_assets` to paint the image fill.

---

## Input parsing

Arguments: `$ARGUMENTS`

Pull these out of the message (free-form, no rigid syntax):

- **Figma URL** — REQUIRED. Any `https://figma.com/design/<fileKey>/...` link. Extract `fileKey`. Ignore `node-id`, `p`, `t` and any other query params.
- **Sizes** — REQUIRED. One or more `WxH` pixel tokens (`1200x1200`, `1200x628`, `960x1200`, ...). Both `x` and `×` accepted. Always pixels.
- **Title** — REQUIRED. The full banner copy verbatim. Accept `Title:`, `Tittle:` (common typo), `Headline:`, or an unlabeled line. Whatever the user wrote goes into `{TITLE}` as-is — do not split it, do not "improve" it, do not translate it.
- **CTA** — REQUIRED. Accept `cta:` / `CTA:` / `button:`. Goes into `{CTA}` verbatim.

### Hard fail-fast — STOP and error out

- No Figma URL → `❌ /banner needs a Figma file URL.`
- No sizes → `❌ /banner needs at least one size in pixels, e.g. 1200x1200.`
- No title → `❌ /banner needs the title copy verbatim.`
- No CTA → `❌ /banner needs the CTA copy verbatim.`

Visual direction is NOT an input. The brief handles it.

---

## Pre-flight (minimal)

1. **GPT Image 2 model id.** Call `models_explore` once with `action=search`, `query="gpt image 2"`, `type=image`, `limit=5`. Pick the model whose id contains `gpt_image_2` or whose display name is "GPT Image 2". If the search returns nothing useful, **fall back to the literal id `gpt_image_2`** and proceed — do not stall. Only stop if `generate_image` later rejects the model id, in which case surface the error and ask the user.
2. **No Figma reads.** Skip `get_metadata` and `get_design_context` entirely. The first `use_figma` write will surface any auth/access error cleanly.

---

## Phase 1 — map each size to the closest supported aspect ratio

GPT Image 2 emits at a fixed set of aspect ratios. The **Figma frame is always the exact requested pixel size** — any aspect mismatch is absorbed by `scaleMode=FILL` (center crop).

Default mapping:

| Size | Orientation | Aspect ratio to request |
|---|---|---|
| 1200×1200 | square | `1:1` |
| 1200×628  | landscape | `16:9` |
| 1200×960  | mild landscape | `4:3` |
| 960×1200  | mild portrait | `3:4` |
| 1080×1350 | portrait (IG feed tall) | `4:5` |
| 1080×1920 | story / reel | `9:16` |

If the user asks for a size not in this table, pick the closest aspect from `{1:1, 16:9, 9:16, 4:3, 3:4, 4:5, 5:4}` by ratio distance — do not stop to ask.

---

## Phase 2 — build the prompt per size

For each size, expand the master brief by substituting only:

- `{WIDTH}` / `{HEIGHT}` — from the size token
- `{ORIENTATION}` — `square` / `landscape` / `portrait` (computed from W:H)
- `{TITLE}` — verbatim
- `{CTA}` — verbatim

Everything else in the brief stays literal — the design direction is fixed by design.

### Master brief (substitute placeholders only)

```
[BANNER BRIEF]
Create a {WIDTH}×{HEIGHT} {ORIENTATION} banner ad designed for maximum click-through rate (CTR),
engineered as if by a senior performance marketing specialist and a UX/UI
designer working together. The output must be a flat finished banner —
no mockup frame, no device bezel, no "ad preview" chrome.

[VERBATIM COPY — RENDER EXACTLY, NO ADDITIONS]
Headline: "{TITLE}"
CTA button label: "{CTA}"

CRITICAL TEXT RULES:
- Render every character of the copy above with perfect spelling and spacing.
- Do NOT add any words, badges, labels, fine print, asterisks, terms, URLs,
  prices, dates, percentages, or disclaimers that are not in the copy above.
- Do NOT translate, summarize, paraphrase, or extend the copy.
- Respect line breaks if present.

[DESIGN SYSTEM — apply all of the following]

VISUAL DENSITY & STOPPING POWER
- This banner needs to STOP a thumb mid-scroll. Plain, minimal, "tasteful editorial"
  layouts lose the auction. Aim for rich, layered, high-energy composition with
  multiple visual elements working together — not empty space and one line of text.
- Build the frame with LAYERS: a photorealistic hero subject in the foreground,
  a textured or environmental background, supporting graphic elements (chart lines,
  product shots, light flares, motion streaks, UI fragments, currency symbols,
  icons — whatever fits the topic), and the copy layer on top.
- Use depth: foreground / midground / background should be visually distinct.
  Shallow depth of field, light bokeh, or motion blur on background elements is
  encouraged when it helps the hierarchy.

VISUAL HIERARCHY (still load-bearing — density is not chaos)
- One dominant focal point grabbing attention within 0.3s (F or Z scan path).
- Two-tier text hierarchy: headline (largest, highest contrast) → CTA button.
  The CTA must remain the highest-contrast interactive element even inside a
  busy composition.
- Keep critical text and the CTA inside safe margins (~60px from edge).
- Minimum WCAG AA contrast between text and whatever's directly behind it —
  add a subtle dark scrim, blur, or solid color block behind text if the
  background is busy. Never sacrifice legibility for density.

IMAGERY — DEFAULT TO PHOTOREALISM
- Default style is photorealistic — sharp, high-detail, professionally lit photography.
  Vector / illustration only if the user explicitly asks for it.
- If a human is present: candid, real-feeling, single subject, sharp eye contact
  or eye-line leading toward the headline/CTA. Authentic styling, not stock-photo-smile.
  Cinematic lighting (rim light, golden hour, hard side light, neon glow — match
  the topic's mood).
- If a product/object is the hero: studio-grade rendering, sharp focus, premium
  finish, dramatic lighting, environmental context (not floating on white).
- Supporting visual elements (charts, graphs, devices, UI screens, currency,
  particles, money, sparks, smoke, light leaks) are encouraged — pile them in
  IF they reinforce the message. A trading ad can have candlestick charts +
  a phone screen + a city skyline + glowing numbers. Don't be afraid of "more."
- BANNED: generic AI-stock-photo aesthetic — fake plastic smiles, cliché glowing
  blue tech orbs, oversaturated "AI gradient soup," symmetrical abstract blobs,
  hexagon grids, generic "digital network" lines. If it looks like a 2019
  Shutterstock thumbnail, regenerate.

COMPOSITION
- Rule of thirds — focal subject and CTA on intersection points.
- One clear direction of visual flow guiding the eye toward the CTA, even
  through a dense layout (use subject gaze, light direction, leading lines,
  motion blur, or a graphic arrow-equivalent).
- Negative space exists around the HEADLINE specifically, so it stays legible.
  The rest of the canvas can be rich.

PERFORMANCE DRIVERS
- Pattern interrupt: unexpected color contrast, an unusual hero element, or
  a striking visual juxtaposition that doesn't look like every other ad in the feed.
- One strong emotional trigger (curiosity, aspiration, urgency, FOMO, relief,
  shock, intrigue — pick what fits the copy).
- Benefit-forward visual metaphor: SHOW the outcome / the world the user gets
  to live in, not the product feature.
- Headline must remain readable at 25% zoom (thumbnail test) even with the
  denser layout.

TYPOGRAPHY
- Max 2 typefaces. Strong geometric or grotesque sans-serif for the headline
  (Inter / Söhne / Helvetica Now feel). Optional contrasting display or serif
  for one accent word if it adds energy.
- Headline weight 700–900. Tight tracking. Tight leading.
- Headline can sit on a subtle scrim, color block, or blurred area to stay
  legible against a rich background — this is encouraged, not avoided.
- No outlined fonts. No stretched or warped letters. No cheesy 3D extrusions
  or chrome effects.
- Highlight the most important words from the provided content using visual
  emphasis only — larger size, bold weight, stronger contrast, or color emphasis.
- Do NOT change the wording in order to create emphasis. Visual treatment only,
  never rewording.
- Fit the full text into no more than 5 lines while keeping it readable,
  balanced, and visually clean.
- Prioritize readability over forcing the text too tightly.

COLOR
- Use whatever palette serves the concept — rich, punchy, saturated, feed-ready.
  Multiple colors are fine and often better; don't artificially limit the palette.
  Bright, vivid, high-energy by default. Pastels and muted tones only if the
  brand or topic truly demands them.
- The CTA must still be the highest-contrast element in the composition — make
  it pop against whatever's behind it, even in a colorful layout.
- Gradients are welcome when they add depth or mood (cinematic sky, neon haze,
  studio backdrop, sunset bokeh) — avoid flat muddy AI-soup gradients.

OUTPUT
- Flat finished banner: dense, layered, photorealistic, high-energy, instantly
  scannable, built to win the auction in a crowded feed. Premium production
  quality — looks like a real brand campaign, not an AI test render.
```

---

## Phase 3 — generate the banners (Higgsfield GPT Image 2 only)

Fire one `generate_image` call per size, **all in parallel** in a single assistant turn:

```
mcp__7e69985f-4eb5-4034-a063-d465c056f301__generate_image
  params:
    model: <gpt_image_2 id resolved in pre-flight>
    prompt: <the fully-expanded brief for this size>
    aspect_ratio: <closest supported aspect ratio from Phase 1>
    count: 1
```

Capture each result's image URL and `job_id` from the widget response. Do not poll — the widget streams completion.

If a single generation fails, surface the error, skip that size's Figma step, and continue with the others.

---

## Phase 4 — create Figma frames at exact pixel sizes (WRITE-ONLY)

One `use_figma` call. Create all frames in a single JS snippet. No reads.

Frame setup:
- Name: `Banner — {WIDTH}x{HEIGHT}`
- Size: **exactly** `{WIDTH} × {HEIGHT}` pixels
- Placed on `figma.currentPage`, arranged left-to-right with a 100px gap, starting at `x=0, y=0` (the user can move them after — we do not read existing content to find empty space)
- `fills: []` initially
- `clipsContent: true`, `cornerRadius: 0`

Return each new frame's `id` from the JS so Phase 5 can target them.

Example skeleton (one round-trip for all sizes):

```js
const sizes = [[1200,1200],[1200,628],[960,1200]]; // injected per call
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

## Phase 5 — paste the generated image into the frame

For each `{frameNodeId, imageUrl}` pair, set the image as the frame's fill at `scaleMode=FILL`.

**Path A — `use_figma` (default):**

```js
const bytes = await (await fetch(imageUrl)).arrayBuffer();
const image = figma.createImage(new Uint8Array(bytes));
const frame = figma.getNodeById(frameNodeId);
frame.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: image.hash }];
```

Batch all frames into one `use_figma` call when possible.

**Path B — `upload_assets` (fallback if `figma.createImage`/`fetch` fails):**

1. Download bytes locally: `curl -L -o <tmp>.png "<imageUrl>"`
2. Call `upload_assets` with `fileKey`, `count=1`, `nodeId=<frameNodeId>`, `scaleMode=FILL`.
3. POST the bytes to the returned upload URL with the correct `Content-Type` (`image/png` or `image/jpeg`).

Use Path A first. Only fall back to Path B on failure.

---

## Phase 6 — summarize

One line + a small table:

```
/banner done — N banners generated · file: https://figma.com/design/<fileKey> · model: gpt_image_2

| Size | Frame node | Job |
|---|---|---|
| 1200x1200 | 12:345 | <job_id> |
| 1200x628  | 12:346 | <job_id> |
| 960x1200  | 12:347 | <job_id> |
```

Mark any failed size `— failed: <reason>`.

End with: `Open the file in Figma to review. Regenerate any size by re-running /banner with just that size.`

---

## Constraints — do not violate

- **GPT Image 2 only.** Never substitute `soul_2`, `nano_banana_2`, `marketing_studio_image`, or any other model.
- **Exact pixel sizes.** The Figma frame is the W×H the user asked for, to the pixel.
- **Verbatim copy.** Pass `{TITLE}` and `{CTA}` exactly as written — no edits, no translations, no "improvements."
- **Figma is write-only.** No `get_metadata`, no `get_design_context`, no tree-walking via `use_figma` JS. The only allowed Figma operations are: create frames + paint image fills.
- **No autonomous commits.** Per CLAUDE.md: never auto-commit.
