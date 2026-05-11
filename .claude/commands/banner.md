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

## Phase 0 — pick the MVP size

The MVP is **always 1:1**. Pick the MVP pixel size like this:

- If the user requested a `WxW` size (square), use the **largest** such size as the MVP size. The frame at that size can be painted directly from the MVP image — no recomposition needed.
- Otherwise default the MVP to **`1200x1200`**. (No Figma frame is created for the MVP if the user didn't ask for a square size — it only serves as the reference master for the recompositions.)

Note the MVP size and the MVP aspect (`1:1`) for the next phase.

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
    prompt: <MVP brief with {WIDTH}/{HEIGHT}/{TITLE}/{CTA} substituted>
```

Block on this. The recomposition pass cannot start until the MVP completes — wait for `status: completed` and capture the MVP's `job_id` and `rawUrl`. Use a short background timer (60–90s) and re-check via `job_display` until status flips. Do not poll in tight loops.

### MVP brief (substitute placeholders only)

```
[BANNER BRIEF]
Create a {MVP_WIDTH}×{MVP_HEIGHT} square banner ad designed for maximum click-through rate (CTR),
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
- Minimum WCAG AA contrast between text and whatever's directly behind it.

IMAGERY — DEFAULT TO PHOTOREALISM
- Default style is photorealistic — sharp, high-detail, professionally lit photography.
- If a human is present: candid, real-feeling, single subject, sharp eye contact
  or eye-line leading toward the headline/CTA. Authentic styling, not stock-photo-smile.
  Cinematic lighting (rim light, golden hour, hard side light, neon glow — match
  the topic's mood).
- If a product/object is the hero: studio-grade rendering, sharp focus, premium
  finish, dramatic lighting, environmental context (not floating on white).
- Supporting visual elements (charts, graphs, devices, UI screens, currency,
  particles, money, sparks, smoke, light leaks) are encouraged — pile them in
  IF they reinforce the message.
- BANNED: generic AI-stock-photo aesthetic — fake plastic smiles, cliché glowing
  blue tech orbs, oversaturated "AI gradient soup," symmetrical abstract blobs,
  hexagon grids, generic "digital network" lines.

COMPOSITION
- Rule of thirds — focal subject and CTA on intersection points.
- One clear direction of visual flow guiding the eye toward the CTA.
- Negative space exists around the HEADLINE specifically, so it stays legible.

PERFORMANCE DRIVERS
- Pattern interrupt: unexpected color contrast, an unusual hero element.
- One strong emotional trigger (curiosity, aspiration, urgency, FOMO, relief).
- Benefit-forward visual metaphor: SHOW the outcome.
- Headline readable at 25% zoom (thumbnail test).

TYPOGRAPHY
- Max 2 typefaces. Strong geometric or grotesque sans-serif for the headline
  (Inter / Söhne / Helvetica Now feel).
- Headline weight 700–900. Tight tracking. Tight leading.
- Headline can sit on a subtle scrim, color block, or blurred area.
- No outlined fonts. No warped letters. No 3D extrusions or chrome effects.
- Highlight the most important words from the provided content using visual
  emphasis only — larger size, bold weight, stronger contrast, or color emphasis.
- Do NOT change the wording to create emphasis. Visual treatment only.
- Fit the full text into no more than 5 lines while keeping it readable.

COLOR
- Rich, punchy, saturated, feed-ready palette. Multiple colors fine.
- CTA must be the highest-contrast element in the composition.
- Gradients welcome when they add depth or mood.

OUTPUT
- Flat finished banner: dense, layered, photorealistic, high-energy, instantly
  scannable. Premium production quality — looks like a real brand campaign.
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

Note: the literal `(1200×1200)` reference in the prompt is correct **only when the MVP was generated at 1200×1200** (the default case). If the MVP was generated at a different square size (e.g. the user requested `1500x1500`), substitute that size into the parenthetical too.

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
- **MVP is always 1:1.** Recomposition is the only way to produce non-1:1 banners — never generate non-1:1 banners from scratch.
- **MVP is the single source of truth.** Every recomposition must pass the MVP's `job_id` as a `medias[]` entry with `role: "image"`. Never run a recomposition without the master reference.
- **Verbatim copy.** Title and CTA pass through unchanged — no edits, no translations, no improvements. The recomposition prompt's "NO NEW CONTENT" rules forbid the model from adding or changing copy.
- **Exact pixel sizes.** Frame is W×H to the pixel.
- **Figma is write-only.** No `get_metadata`, no `get_design_context`. Only allowed Figma operations: create frames + paint image fills via `upload_assets`.
- **No autonomous commits.** Per CLAUDE.md.
