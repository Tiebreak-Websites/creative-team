---
description: Read the design framework, reason through the creative decisions for this specific banner, write a tight scene-level prompt, and ship it to Higgsfield GPT Image 2 — then recompose into every requested size and paste each into a Figma frame
---

# /banner — Designer flow (Higgsfield GPT Image 2 → Figma) v1.6

## Architecture

Three layers, three audiences:

| Layer | Audience | What it is | Length |
|---|---|---|---|
| **§ Design Framework** | Claude only | The full design system — slot rules, money-element priority, localization decision tree, RTL handling, hierarchy, typography, color, CTA spec, imagery rules, DO NOT RENDER list | No cap — never sent to the model |
| **§ Composition Guide** | Claude only | The recipe — a 9-decision checklist Claude completes in its head per banner before writing any prompt | ~3K chars — never sent to the model |
| **§ Visual Prompt** | GPT Image 2 | A concrete scene description Claude composes fresh per banner. Names a specific subject, specific setting, specific lighting, specific colors with hex, specific positions, every word of copy with its typography | **≤ 2,000 chars** sent to the model |

**Claude is the designer. GPT Image 2 is the renderer.** The framework and the guide are Claude's textbook. The visual prompt is the brief Claude hands the renderer. The model never sees the textbook — only the brief.

Workflow:

1. **MVP pass.** Claude reads the framework → applies the guide → composes a concrete visual prompt for this specific banner → generates the master at 1200×1200 / 1:1.
2. **Recomposition pass.** For every non-1:1 size, Claude composes a spatial-translation prompt (same scene, new aspect) → generates with the master as reference (`medias[].role: "image"`).
3. **Figma pass (write-only).** Create frames at exact pixel sizes → paint each finished image as a fill.

Banner structure is always **Title + CTA**. The visual direction is *not* an input — Claude derives it from the copy + LANGUAGE using the framework.

Figma is **write-only**: create frames + paint fills. Never call `get_metadata`, never call `get_design_context`, never read the file tree.

---

## Input parsing

Arguments: `$ARGUMENTS`

Pull these out of the message (free-form, no rigid syntax):

- **Figma URL** — REQUIRED. Any `https://figma.com/design/<fileKey>/...` link. Extract `fileKey`. Ignore `node-id` / `p` / `t` query params.
- **Sizes** — REQUIRED. One or more `WxH` pixel tokens (`1200x1200`, `1200x628`, `960x1200`, ...). Both `x` and `×` accepted. Always pixels.
- **Title** — REQUIRED. The full banner copy verbatim. Accept `Title:`, `Tittle:` (common typo), `Headline:`, or an unlabeled line. This becomes the `HERO` slot. Never split, never "improve," never translate.
- **CTA** — REQUIRED. Accept `cta:` / `CTA:` / `button:`. Goes verbatim into the `CTA` slot.

### Hard fail-fast — STOP and error out

- No Figma URL → `❌ /banner needs a Figma file URL.`
- No sizes → `❌ /banner needs at least one size in pixels, e.g. 1200x1200.`
- No title → `❌ /banner needs the title copy verbatim.`
- No CTA → `❌ /banner needs the CTA copy verbatim.`

---

## Pre-flight (minimal)

1. **Resolve GPT Image 2 model id.** Call `models_explore` once with `action=search`, `query="gpt image 2"`, `type=image`, `limit=5`. Pick the model whose id contains `gpt_image_2`. Fall back to the literal id `gpt_image_2` if search returns nothing. Do not stall — only stop if `generate_image` later rejects the id.
2. **No Figma reads.** Skip `get_metadata` / `get_design_context` entirely.

---

## Phase 0 — auto-detect LANGUAGE

Detect from the HERO + CTA text. Write the detected label as one of:

- `pt-BR` — Portuguese with Brazilian cues (`você`, `Brasil`, BRL, R$, "te ensinou", "consultoria")
- `pt-PT` — Portuguese with Portugal cues (€, "tu", "Portugal", "consultadoria")
- `es-LATAM` — Spanish with LATAM cues (Mexican, Colombian, Argentine spellings, MXN/COP/ARS)
- `es-ES` — Spanish with Spain cues (EUR, "vosotros", "estáis")
- `English` — Latin script, English vocabulary
- `Arabic` — Arabic script (any dialect — Gulf / Levantine / Egyptian / MSA; the framework's RTL section decides the dialect from copy cues)
- `Hebrew` — Hebrew script
- `Urdu` / `Farsi` / `Pashto` — non-Arabic RTL scripts
- `th-TH` — Thai script
- `tr-TR` — Turkish (Latin script, Turkish vocabulary)
- Otherwise → pick the closest from the framework's localization decision tree; if unclear default to `English`.

This label drives every imagery decision in Phase 1 and the RTL/LTR composition flag.

### Phase 0.1 — confirm detected language to the user (one line)

After detection, surface a single line so the user can catch a misread in <2s before any credit is spent. Format:

```
🌐 Detected: <LANGUAGE> (cues: "<cue1>", "<cue2>"). Generating…
```

Examples:
- `🌐 Detected: pt-BR (cues: "você", "R$"). Generating…`
- `🌐 Detected: Arabic (cues: Arabic script, "تداول"). Generating…`
- `🌐 Detected: English (no non-Latin cues). Generating…`

Do not block waiting for confirmation — fire and continue. The user will interrupt if it's wrong.

### Phase 0.2 — cost preview (one line)

Immediately after the language line, surface the credit cost so the user can abort cheaply before any generation fires. Format:

```
🧾 Plan: <N> sizes → 1 MVP + <M> recomposition(s) = <1+M> generation(s). Press Esc to abort.
```

Where:
- `N` = total requested sizes
- `M` = count of requested sizes whose aspect is **not** 1:1 (every 1:1 size after the MVP reuses it for free in Phase 5)

Example for sizes `[1200x1200, 1200x628, 960x1200, 1200x1200]`:
```
🧾 Plan: 4 sizes → 1 MVP + 2 recomposition(s) = 3 generation(s). Press Esc to abort.
```

Do not block — emit and continue immediately.

---

## Phase 1 — compose the MVP visual prompt (silent)

The MVP is **always 1200×1200, 1:1**. The framework's pixel measurements (90px x-height minimum, 60px edge safe area, 90px button height) only work at 1200×1200.

This phase is **silent** — Claude reasons internally, never surfaces a creative brief in chat, just composes the prompt and ships it.

### Step 1.1 — Internally answer the 9-decision checklist

Before composing any prompt text, fully answer all 9. Each answer must be **concrete**, not abstract. If any answer is still vague after thinking, replace it with a concrete pick using the framework's defaults. Never send a prompt containing "a person" or "warm tones" or "a modern setting" — those are placeholders, not decisions.

1. **Realistic customer.** One sentence: *who* is going to click this. Age range, profession or life stage, market. Derived from HERO + CTA + LANGUAGE.
2. **Hero subject.** A specific human or product. For a human: nationality/ethnicity (driven by LANGUAGE + market), age, gender, build, skin tone, hair, facial hair, expression, wardrobe (specific garment + color), pose. For a product: specific object + framing.
3. **Setting.** A specific environment with named props. "Modern home office with a laptop, notebook, coffee cup, window with blinds" — not "an office."
4. **Lighting.** Direction (left/right/top), color temperature (warm/cool), mood (golden hour, late afternoon, studio, neon, overcast), depth of field (shallow with bokeh / deep / motion blur).
5. **Composition direction.** LTR or RTL — driven by LANGUAGE. Use the framework's RTL list (Arabic, Hebrew, Urdu, Farsi, Pashto, Sindhi, Kurdish).
6. **Money element.** The specific phrase from HERO + ACCENTS that wins the framework's priority list (number/%/$ /ticker → intensity verb → named brand → urgency phrase → else hero). Name it exactly: which words, where they fall in the headline.
7. **Color palette.** Exactly 3 concrete colors + a neutral, with hex codes where possible. Apply the framework's market-aware color reasoning (red/green/white/gold meanings shift by region). The CTA color must be the highest-contrast in the palette.
8. **Typography.** Concrete typefaces by LANGUAGE. LTR → Inter (default), Söhne, or Helvetica Now. Arabic → Tajawal (default) or Cairo. Hebrew → Heebo or Rubik. Urdu/Farsi → Vazirmatn or Noto Naskh Arabic. Pick one for headline, max one second face for accents. NEVER mix Latin and RTL typefaces on the same script.
9. **CTA treatment.** Color, shape (rectangular or pill), corner radius, position (LTR → bottom-right or bottom-left at thirds; RTL → bottom-LEFT at thirds), exact button height.

If any decision is missing after step 1.1, the prompt cannot be sent. Either pick a framework default or stop and ask.

### Step 1.2 — Fill the Visual Prompt Template

Use the template in **§ Visual Prompt Template** below. Fill every bracketed placeholder with the concrete decisions from step 1.1. Render every word of HERO and CTA verbatim, with exact typography per line. Total prompt length must be **≤ 2,000 chars** after filling.

If the filled prompt exceeds 2,000 chars, tighten it — drop redundant adjectives, merge sentences. Do not drop content that names a specific subject, position, color, or line of copy.

### Step 1.3 — Send to GPT Image 2

```
mcp__7e69985f-4eb5-4034-a063-d465c056f301__generate_image
  params:
    model: gpt_image_2
    aspect_ratio: "1:1"
    quality: "high"
    resolution: "1k"
    count: 1
    prompt: <the filled visual prompt from step 1.2>
```

Capture the returned `id` (MVP job_id).

---

## Phase 2 — wait for the MVP

Block until MVP is `status: completed`. Recomposition is gated on this — finish polling as fast as the job actually completes, not on a fixed timer.

**Polling cadence:**
1. **First check at t+25s.** Typical MVP completion is 25–60s; checking earlier wastes a tool call.
2. **Then every 8s** until status flips to `completed` or `failed`.
3. **At t+120s (12 checks),** if still pending, emit one warning line: `⚠️ MVP still rendering after 120s — continuing to wait.` Then drop cadence to every 15s.
4. **Hard cap at t+5min.** Abort with `❌ MVP timed out after 5min — re-run /banner or check Higgsfield workspace.`

Capture `rawUrl` and `id` on completion. On `status: failed`, abort with the failure reason — do not auto-retry (creative decisions may need a rethink).

---

## Phase 3 — compose each recomposition prompt (silent)

For each requested size whose aspect is **not 1:1**, compose a separate spatial-translation prompt using the **§ Recomposition Prompt Template** below.

These prompts are not "fresh creative thinking." The MVP already made every creative decision — Claude's job here is to describe **how the master scene rebuilds for the new aspect**: where the subject moves, how the text reflows, how the gradient extends, where the CTA repositions. Same subject, same text, same colors, same typography, same style — new geometry.

For 1:1 sizes the user requested (other than the MVP itself), **skip the recomposition** — they reuse the MVP image directly. Paint the MVP into those frames in Phase 6.

### Aspect mapping (GPT Image 2 supports `1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3`)

| Requested size | Aspect to request | FILL crop | Recompose? |
|---|---|---|---|
| `1200×1200` (or any square) | `1:1` | none (exact) | No — reuse MVP |
| `1200×628`  | `16:9` | ~7% top/bottom | Yes — WIDE |
| `960×1200`  | `3:4`  | ~7% top/bottom | Yes — TALL |
| `1200×960`  | `4:3`  | ~7% left/right | Yes — mild WIDE |
| `1080×1350` | `3:4` (closest) | ~7% top/bottom | Yes — TALL |
| `1080×1920` | `9:16` | none (exact) | Yes — TALL |
| `1920×1080` | `16:9` | none (exact) | Yes — WIDE |

For sizes not in the table, pick the closest aspect from the supported set by ratio distance.

### Aspect-mismatch crop rule

For each requested size, compute the crop:

```
frame_aspect  = WIDTH / HEIGHT
render_aspect = chosen_aspect numerator / denominator   (e.g. 16/9 = 1.778)
crop_pct      = abs(frame_aspect - render_aspect) / max(...) * 100
```

If `crop_pct > 5%`, the FILL scale-mode in Figma will silently crop the rendered image to fit the frame. To prevent the subject's head, hands, or money element from being lopped off:

1. **Tell the model in the recomposition prompt** to leave extra safe area on the cropped axis (top/bottom for taller-than-render frames; left/right for wider-than-render frames). One line: `Leave 8% safe area on top and bottom — frame will crop ~7% off those edges.`
2. **Flag it in the Phase 6 summary table** with a `⚠️ ~7% crop` note in the source column so the designer knows to spot-check.

### Send each recomposition

Fire all recompositions **in parallel** in a single assistant turn:

```
mcp__7e69985f-4eb5-4034-a063-d465c056f301__generate_image
  params:
    model: gpt_image_2
    aspect_ratio: <closest supported aspect for this WxH>
    quality: "high"
    resolution: "1k"
    count: 1
    medias:
      - value: <MVP job_id from Phase 2>
        role: "image"
    prompt: <the filled recomposition prompt for this size>
```

**Wait for the slowest, not a fixed timer.** Polling cadence (same as Phase 2 but applied to the batch):

1. **First batch check at t+25s** — call `job_display` for every recomposition `id` in a single parallel turn. Already-completed jobs short-circuit; collect `rawUrl` for each.
2. **Then every 8s,** re-check only the still-pending ids in parallel.
3. **At t+120s,** warn `⚠️ {N} recomposition(s) still rendering after 120s — continuing.` Drop cadence to every 15s.
4. **Hard cap at t+5min per recomposition.** If any are still pending, proceed with the completed set and report the timeouts in the summary table — do not block Phase 4 indefinitely.

A single recomposition failure does not abort the run — paint the successful ones and report the failed sizes in Phase 6 with their job ids so the user can retry.

---

## Phase 4 — create Figma frames at exact pixel sizes (WRITE-ONLY)

One `use_figma` call creates every requested frame. Side-by-side at the run's `y` baseline, 100px gap. Names: `Banner — {WIDTH}x{HEIGHT}`. `fills: []` initially.

**Idempotent placement.** Re-running /banner on the same Figma file MUST NOT overlap prior runs. The script scans the page for any existing frame whose name starts with `Banner` and starts the new run **below** the lowest existing one with a 200px gap. First-ever run starts at `y=0`.

```js
const sizes = [/* injected, e.g. [[1200,1200],[1200,628],[960,1200]] */];
const runStamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

// Find the bottom edge of any existing banner frames on this page
let runY = 0;
for (const node of figma.currentPage.children) {
  if (node.name && node.name.startsWith("Banner") && "y" in node && "height" in node) {
    runY = Math.max(runY, node.y + node.height + 200);
  }
}

let x = 0;
const ids = [];
for (const [w, h] of sizes) {
  const f = figma.createFrame();
  f.name = `Banner — ${w}x${h}`;
  f.resize(w, h);
  f.x = x; f.y = runY;
  f.fills = [];
  f.clipsContent = true;
  f.cornerRadius = 0;
  figma.currentPage.appendChild(f);
  ids.push({ size: `${w}x${h}`, id: f.id, runStamp });
  x += w + 100;
}
return ids;
```

Capture `runStamp` for the Phase 6 summary so the user can find this specific run later (`Cmd+F` in Figma for the timestamp).

---

## Phase 5 — paste each generated image into its frame (Path B)

Use `upload_assets` + `curl` POST. The Figma plugin sandbox has no `fetch`, so `figma.createImage` is not viable.

For each `{size, frameNodeId, imageUrl}`:

1. Download bytes locally:
   ```
   mkdir -p /tmp/banner
   curl -sL -o /tmp/banner/<size>.png "<imageUrl>"
   ```
2. Request an upload URL:
   ```
   upload_assets:
     fileKey: <fileKey>
     count: 1
     nodeId: <frameNodeId>
     scaleMode: FILL
   ```
3. POST the bytes to the returned `submitUrl`:
   ```
   curl -sS -X POST -H "Content-Type: image/png" --data-binary @/tmp/banner/<size>.png "<submitUrl>"
   ```

**Parallelism contract (do this — it's the biggest wall-clock win in the whole flow):**

- **Step 1 (download):** issue every `curl -sL -o` for every size as parallel `Bash` tool calls in a SINGLE assistant turn. Do not download them sequentially.
- **Step 2 (upload-url request):** issue every `upload_assets` call as parallel tool calls in a SINGLE assistant turn. One call per frame.
- **Step 3 (POST bytes):** issue every `curl -sS -X POST` as parallel `Bash` tool calls in a SINGLE assistant turn.

Three turns total for N banners, regardless of N. Sequential per-banner uploads multiply N×3 round-trips and is the most common cause of slow runs.

For 1:1 sizes that reuse the MVP: save the MVP bytes once to `/tmp/banner/mvp.png` and reuse that same local file in the parallel POST batch — do not re-download per frame.

---

## Phase 6 — summarize

One-line summary + a table that surfaces every signal the user needs to spot-check:

```
/banner done — N banners (1 MVP, M recomposed, F failed) · run: <runStamp> · file: https://figma.com/design/<fileKey> · model: gpt_image_2

| Size      | Source       | Frame node | Job           | Notes                |
|---        |---           |---         |---            |---                   |
| 1200x1200 | MVP          | 12:345     | <mvp_job_id>  | —                    |
| 1200x628  | recomposed   | 12:346     | <job_id>      | ⚠️ ~7% top/bottom crop |
| 960x1200  | recomposed   | 12:347     | <job_id>      | ⚠️ ~7% top/bottom crop |
| 1080x1920 | recomposed   | —          | <job_id>      | ❌ timed out — retry  |
```

Notes column rules (one or none per row):
- `⚠️ ~X% <axis> crop` — populated from the aspect-mismatch rule in Phase 3
- `❌ timed out` — recomposition didn't complete within Phase 3's 5-min cap; frame exists but is unpainted
- `❌ failed: <reason>` — generation returned `status: failed`
- `—` — clean

End with: `Open the file in Figma to review (search "<runStamp>" to jump to this run). Regenerate any size by re-running /banner with just that size.`

---

# § Visual Prompt Template

This is the skeleton Claude fills per banner. Replace every `[...]` with the concrete decisions from the 9-decision checklist. **Total filled length ≤ 2,000 chars.** This text — and ONLY this text — gets sent to GPT Image 2.

```
1200×1200 square banner ad. [photorealistic | clean vector illustration]. [{LANGUAGE} ({market})] audience.

SUBJECT: [concrete description in 1–2 sentences — nationality, age, build, skin tone, hair, facial hair, expression, exact wardrobe garment + color, pose, framing (mid-shot / portrait / full body)].

SCENE: [specific setting + named props — e.g. "modern home-office with laptop showing out-of-focus candlestick chart, notebook, coffee cup, window with blinds in background"].

LIGHTING: [direction, color temp, mood, time of day, depth of field — e.g. "cinematic side lighting, warm key from left, cool rim from right, late-afternoon, shallow depth of field, soft warm bokeh top-right"].

COMPOSITION ([LTR | RTL]): [subject placement — e.g. "subject occupies LEFT third"; text placement — "text block on RIGHT two-thirds, left-aligned" (LTR) or "text block on RIGHT, right-aligned" (RTL)].

COPY — render every character verbatim, perfect spelling and accents:
- L1 ([typeface] [weight], [size], [color hex]): "[exact line 1]"
- L2 ([typeface] [weight], [size], [color hex]): "[exact line 2]"
- ... (one bullet per visible line)

MONEY ELEMENT: the phrase "[exact words]" in [accent color hex], weight [800–900], size ≥ hero. [optional ONE treatment: colored underline beneath only those words / highlight bar behind / tight box outline]. Position: [upper-right third intersection | upper-left for RTL].

CTA: [position — "bottom-right at lower-third intersection" (LTR) or "bottom-LEFT at lower-third intersection" (RTL)]. Solid [shape — rectangular | pill] button, [color hex], [height ~110px], horizontal padding ~1.5× text x-height. [typeface] [weight], [text color] text: "[exact CTA text]".

PALETTE: [3 named colors with hex + neutral, e.g. "navy #0A1A3D dominant, orange #FF7532 accent + CTA, charcoal #1C1F26 secondary, white #FFFFFF neutral"].

MARGINS: 60px safe area on all edges. 8% padding around the text block. Strong negative space around the headline.

CONSTRAINTS: flat finished banner. No mockup frame, no device bezel, no "Ad" or "Sponsored" label, no browser UI, no phone frame, no watermarks, no signatures, no AI marks. No text anywhere except in the lines above. No glowing tech orbs, no upward arrows over cities, no stock-photo plastic smiles, no lightbulb metaphors, no symmetrical abstract blobs, no hexagon grids, no generic "digital network" lines. No drop shadows or glows on text. [If LANGUAGE is non-English: + "Subject features, wardrobe, setting must feel native to {market} — no generic Western stock-photo defaults, no cross-region cultural cues. Avoid gesture taboos for {market}."]
```

After filling, the prompt should read like a **specific photoshoot brief** to a photographer + retoucher — concrete enough to render without interpretation.

---

# § Recomposition Prompt Template

This is the skeleton Claude fills per non-1:1 size. The MVP image is provided as `medias[].role: "image"` — the renderer sees it. The prompt only needs to describe **how the scene rebuilds** for the new canvas. **Total filled length ≤ 1,200 chars.**

```
RECOMPOSE the attached master (1200×1200) into {TARGET_WIDTH}×{TARGET_HEIGHT}. Master = single source of truth. Same subject, same text, same logo, same colors, same typography, same style. Not a stretch, not a crop, not a fresh generation.

NEW LAYOUT ([WIDE | TALL | SQUARE-ISH]):
- Subject: [specific repositioning, e.g. "shifts to LEFT third, reframe to a tighter head-and-shoulders crop, keep same lighting and wardrobe"].
- Text block: [specific reflow rules, e.g. "reflows to RIGHT two-thirds, left-aligned, vertically centered. Lines 1–3 may collapse from 3 lines to 2 only if the same exact words still fit; never cut copy"].
- Money element ("[exact words]"): [position in new aspect, e.g. "stays at upper-right third intersection with the orange underline beneath only those words"].
- CTA: [position in new aspect, e.g. "moves to LOWER-RIGHT at thirds intersection — same orange pill, same text, same corner radius"].
- Background: [extension rule, e.g. "navy-to-charcoal gradient extends horizontally — same direction, no seam, no color shift, same warm bokeh top-right"].

CONSTRAINTS: exactly {TARGET_WIDTH}×{TARGET_HEIGHT} px. No new content, no stretching or warping, no invented graphics filling the new space. Flat finished banner. No watermarks, no AI marks, no mockup chrome. [If master is RTL: + "Keep mirrored direction — hero LEFT, headline RIGHT-aligned, CTA bottom-LEFT."]
```

After filling, this reads as **spatial choreography** — "the master moves here in the new canvas" — not as a creative manual.

---

# § Composition Guide (Claude only)

This is the recipe Claude follows in step 1.1. It converts the framework rules + the user's inputs into the 9 concrete decisions that the Visual Prompt Template needs.

### How to think through each decision

**1. Realistic customer.** Read HERO + CTA + LANGUAGE together. Ask: who *specifically* would click this, *not* who's the broadest possible audience. A Brazilian trading-education banner with copy implying "school taught you nothing" is not aimed at retirees — it's aimed at adults 25–40 in pt-BR who feel financially under-equipped. Write one sentence. This sentence drives every other decision.

**2. Hero subject.** Reverse-engineer from the customer. The subject is *who the customer wants to be* (aspirational) or *who the customer is* (mirror) — pick one per banner. Pin every visible attribute: nationality/ethnicity (drives features), age (drives styling), gender, build, skin tone, hair, facial hair, expression, wardrobe (one specific garment + color, not a generic category), pose, framing. Apply the framework's localization rules — never default to Western stock-photo defaults for non-English markets, never apply cross-region cues.

**3. Setting.** A real place with named props that reinforce the copy's message without explaining it. A trading banner can use a home office with a laptop + chart on screen + coffee. A retirement banner uses a different setting even with the same language. Name the props specifically.

**4. Lighting.** Lighting carries the emotional register more than any other variable. Match it to the copy's mood: aspirational → warm golden hour with shallow bokeh; urgent → neon-edged or harder side light; trustworthy → soft studio key with subtle rim; intriguing → low-key with one strong source. Always specify direction, color temperature, and depth of field.

**5. Composition direction.** Mechanical from LANGUAGE. LTR for English, Spanish, Portuguese, French, German, Italian, Turkish, Thai, most others. RTL for Arabic, Hebrew, Urdu, Farsi, Pashto, Sindhi, Kurdish (Sorani). The direction flips subject placement, text alignment, scan path, and CTA position.

**6. Money element.** Walk the priority list against HERO + ACCENTS:
   1. Specific number / % / $ / ticker → wins for finance/trading creative
   2. High-intensity verb ("double," "unlock," "win," "free," "today")
   3. Named brand or entity with recognition value
   4. Loss-aversion or urgency phrase ("last chance," "ends today," "before it's gone")
   5. Else the hero phrase itself
Once chosen, write down the *exact words* and *which line they fall on*.

**7. Color palette.** Build 3 colors + 1 neutral. Start with a dominant brand color that fits the market and emotional register. Pick an accent color with high saturation, reserved for the money element. Pick a CTA color that is the highest contrast against the background — this is the click target. Add a neutral for body copy. Use hex codes when picking — vague "blue" or "orange" produces inconsistent renders. Apply market-aware color reasoning: red = loss in Western finance / luck in CN; green positive Western / political MENA; white premium West / mourning EA; gold premium Gulf+EA.

**8. Typography.** Pick by LANGUAGE script. Latin → Inter (default), Söhne, or Helvetica Now. Arabic → Tajawal (default) or Cairo. Hebrew → Heebo or Rubik. Urdu/Farsi → Vazirmatn or Noto Naskh Arabic. Pick one face for the headline. If you want a second face for an accent line, the framework allows max 2 typefaces total — never more. Headline weight 700–900. Money element weight 800–900. NEVER mix Latin and RTL typefaces on the same script line.

**9. CTA treatment.** Shape: rectangular or pill — pick one per campaign feel. Position: bottom-right or bottom-left at thirds for LTR; **always** bottom-LEFT at thirds for RTL. Height: 90–120px on the 1200px canvas. Color: highest contrast in palette. Text: exact CTA copy verbatim, no rewording.

### Gut-check before composing

After step 1.1, before writing any prompt text, sanity-check:
- Is the subject **specific enough** that two designers reading the brief would render the same person? If no, tighten.
- Could a generic AI-stock image accidentally match the description? If yes, add specifics (named wardrobe, named setting, named lighting).
- Does the palette have **hex codes**? Vague colors regress to AI-soup gradients.
- Is the money element a **specific word or number**, not a category? "Render the strongest word" is not a decision — "Render '12 anos' in orange" is.

If any check fails, return to step 1.1 and tighten before writing the prompt.

---

# § Design Framework (Claude only)

The full design system. This is the long-form rationale Claude reasons from when applying the Composition Guide. **Never sent to the model.**

### Slots & verbatim render rules

- `HERO` ← the user's Title verbatim. The single dominant phrase on the banner.
- `SUPPORT` ← optional. Empty by default. Only fill if the user explicitly provided a separate supporting line. Never split the Title.
- `ACCENTS` ← optional. Empty by default. Only fill if the user explicitly provided tickers, numbers, percentages, dollar figures, or brand names as a separate field. Never extract them from the Title.
- `CTA` ← the user's CTA verbatim. If empty, no button anywhere on the canvas — flow ends on hero or money element.
- `LANGUAGE` ← auto-detected per Phase 0.

Every character of HERO/SUPPORT/ACCENTS/CTA must render in the final image with perfect spelling, spacing, punctuation, and accent marks. Never add words, badges, prices, URLs, dates, percentages, disclaimers, or logos not in the slots. Never translate or paraphrase.

### Money element

The single most CTR-driving phrase in the copy. Priority:

1. Specific number, percentage, dollar figure, or ticker (almost always wins for finance/trading creative)
2. High-intensity benefit verb or transformation phrase ("double," "unlock," "win," "free," "today")
3. Named entity with strong recognition value (brand, ticker, product name)
4. Loss-aversion or urgency phrase ("last chance," "ends today," "before it's gone")
5. If none of the above exist, the hero phrase itself

The money element is the SECOND-most visible element on the canvas (or first if no CTA). It gets dedicated high-CTR styling: accent color, weight 800–900, size ≥ hero, at a rule-of-thirds intersection, optionally ONE of {colored underline, highlight bar, tight box outline} — never combine. No competing emphasis elsewhere.

Visibility rank, high → low: **CTA > money element > hero > support > accents.** If no CTA, money element wins.

### Localization (LANGUAGE drives all imagery, not just script)

Step 1 — Identify the target market. Read LANGUAGE → primary geographic market. Use copy cues (currency, city names, tickers, brand names, dialect markers) to narrow regional variants.

Step 2 — Read the copy context. HERO + SUPPORT + ACCENTS together → what this specific banner is selling, the emotional tone, the realistic customer, the setting that feels native.

Step 3 — Compose locally. Every imagery decision (subject ethnicity & features, age, wardrobe, setting, architecture, lighting, props, color mood, gesture, expression) must feel authentic to that market viewing this exact ad on their phone.

Step 4 — Vary across banners. Do NOT repeat the same subject archetype, setting, or visual treatment across banners in the same campaign.

### Cultural safety checks

- Match subject features, wardrobe, and setting to the actual market — never use placeholder Western defaults on non-English banners, never apply cross-region cues (no Mexican tropes on Brazilian, no Gulf attire on Levantine, no East-Asian features on LATAM).
- Respect regional sensibilities around dress, modesty, religious symbolism, alcohol, gambling, gender representation, and physical contact. When uncertain, default to neutral professional or aspirational framing.
- Avoid gestures flagged in the target market: thumbs-up in parts of MENA + W.Africa; OK sign (fingertip circle) in Brazil, Turkey, and parts of MENA; pointing with the index finger across much of Asia and MENA; prominent left-hand display in MENA + S.Asia.
- Apply color meaning to the market: red signals loss in Western finance but luck and prosperity in Chinese-market creative; green is positive in most Western markets but carries political and religious associations in parts of the Arab world; white reads premium in the West but mourning in parts of East Asia; gold reads premium in Gulf and East Asian markets, less so in Western ones.

### RTL composition & typography

RTL languages: Arabic (all dialects), Hebrew, Urdu, Farsi/Persian, Pashto, Sindhi, Kurdish (Sorani).

When LANGUAGE is RTL:
- Mirror the entire layout. Hero subject occupies the LEFT half of the canvas. Headline copy stacked and right-aligned on the RIGHT half.
- CTA placement: bottom-LEFT at a strong third intersection.
- Visual flow: HERO (top-right) → money element (upper-right) → CTA (bottom-left).
- Money element placement: top-right or upper-right third intersection.
- If a human subject is present, direct their gaze, body angle, or visual energy toward the LEFT.
- All punctuation must render in correct RTL form and position. No reversed or broken punctuation.
- Numbers, percentages, tickers, and Latin-script brand names render in their original LTR form even inside an RTL line — do not mirror digits or English brand names.
- Line breaks must respect Arabic word boundaries — never break a word mid-character or mid-ligature.

RTL typography:
- Use Arabic-native typefaces, NEVER Latin fonts with Arabic fallbacks (which produce broken or stylistically mismatched letterforms).
- Arabic: Tajawal (default) or Cairo. Default to Tajawal for headline-heavy banners, Cairo for copy-heavy banners.
- Hebrew: Heebo or Rubik.
- Urdu/Farsi: Vazirmatn or Noto Naskh Arabic.
- Headline weight 700–800 (Tajawal Bold or Cairo Bold/Black). Money element 800–900 (Tajawal Black or Cairo Black).
- Arabic typography requires slightly LOOSER leading than Latin — do not over-tighten or letterforms collide on diacritics and ligatures.
- Tracking: neutral. Never condense Arabic — it destroys ligature integrity.
- No stretching, distortion, kashida-stretching for justification, or decorative effects on letterforms.

### LTR composition

- Hero subject occupies one half of the canvas (left or right).
- Headline copy stacked, left-aligned, in the opposite half.
- Money element placed at a strong third intersection, visually anchored to either the hero phrase or the CTA.
- If a CTA is present: place it bottom-left or bottom-right at a strong third intersection. Visual flow: HERO → money element → CTA.
- If no CTA: visual flow ends on the money element. Use breathing room at the bottom rather than filling the space.
- Strong negative space around the headline and money element.
- If the background is busy, place headline over a subtle dark scrim or directional gradient for legibility.
- At least 8% padding around every text block.
- Critical text and CTA stay ~60px inside the canvas edges.

### Hierarchy (3 tiers, 3 sizes max)

- **Tier 1 — HERO + MONEY ELEMENT:** largest text on canvas. Weight 800–900. Highest contrast. Headline x-height minimum 90px. The money element sits at or above hero size.
- **Tier 2 — SUPPORT:** smaller than Hero. Weight 500–600. Softer color from the same family as Hero.
- **Tier 3 — CTA (only if CTA slot is filled):** rendered inside a solid-fill button. Does not need to be the largest text — earns clicks through contrast, shape, and placement.

Maximum 3 distinct font sizes across the entire banner.

### Typography

- Maximum 2 typefaces total across the entire banner.
- LTR headline: Inter, Söhne, Helvetica Now, or similar geometric/grotesque sans-serif. Default to Inter.
- RTL headline: per the RTL Typography section above.
- Headline weight: 700–800. Money element weight: 800–900.
- LTR: tight leading on the headline, neutral to slightly tight tracking — do not over-condense.
- RTL: slightly looser leading than LTR equivalent, neutral tracking — never condense.
- No stretching, distortion, warping, outlining, kashida-justification, or heavy effects on letterforms.
- No drop shadows on text by default. If a subtle shadow is required for legibility over a busy background, keep it minimal: low opacity, tight offset, soft blur.

### Color (3 roles + neutral)

- 1 dominant brand color (background or hero field)
- 1 accent color — reserved primarily for the money element. Must be the second-highest-contrast color in the composition (after CTA color).
- 1 CTA color — must be the highest-contrast color in the composition (omit if no CTA).
- 1 neutral base (for body copy).
- Apply market-aware color reasoning. Avoid muddy gradients. Clean directional gradients only.

### CTA button spec

- Solid fill only. No outline-only, no ghost buttons, no skeuomorphic 3D.
- Shape: rectangular or pill. Sharp or softly rounded corners only.
- Minimum button height: 90px on the 1200px canvas.
- Horizontal padding inside button: ~1.5× the text x-height.
- CTA color contrast against background must be the strongest in the layout.
- For RTL languages, CTA button text renders in the RTL script using the same typeface as the headline.
- If the CTA slot is empty, do not render any button-shaped element anywhere.

### Imagery

- Commit to ONE style: either photorealistic OR clean vector illustration. Never mix.
- Localization reasoning is the primary source of truth for who appears on the canvas and where they appear.
- If a human is present: one authentic candid subject, natural expression, sharply lit, clearly separated from background. Direct their gaze or body angle toward the money element or CTA.
- Avoid gestures flagged in the Cultural Safety Checks for the target market.
- Emotional trigger: pick ONE that fits the supplied copy AND the credible emotional register for the target market — curiosity, aspiration, urgency, confidence, or relief.
- Use a benefit-forward visual metaphor. Show the outcome or transformation, not the product feature.

### DO NOT RENDER (negative constraints — Claude enforces these while composing the visual prompt)

- No invented words, logos, app icons, brand marks, or badges not present in the content slots.
- No fake UI chrome: browser bars, phone frames, "Sponsored" or "Ad" labels, mock notifications.
- No text inside the hero subject (no words on shirts, screens, signs, posters) unless that exact text is in the content slots.
- No watermarks, signatures, "Generated by," or AI artifact marks.
- No duplicated, mirrored, or repeated text anywhere on the canvas.
- No mirrored or reversed Arabic/Hebrew letterforms — RTL text must render in its native direction.
- No Latin fonts forced onto Arabic or Hebrew copy.
- No generic Western stock-photo defaults on non-English banners.
- No cross-region cultural mismatches.
- No repeated subject archetypes, settings, or visual treatments across banners in the same campaign.
- No gestures flagged as offensive in the target market.
- No generic AI stock aesthetics: fake-smiling stock people, glowing tech orbs, oversaturated gradient soup, cliché upward arrows over cityscapes, stock handshakes, lightbulb metaphors.
- No drop shadows, glows, or outlines on text by default.
- No mixed visual styles (photo + vector together).
- No button, button shape, or button placeholder if the CTA slot is empty.
- No competing emphasis treatments — only the money element gets the highlight/underline/box treatment.

Most of these become **filters Claude applies while composing the visual prompt** ("don't describe a glowing blue tech orb"). A few hard ones must also appear in the visual prompt itself as output-format constraints (no mockup chrome, no "Ad" label, no watermarks) — those are about the output, not creative judgment.

---

## Constraints — do not violate

- **Visual prompt length.** The filled Visual Prompt Template (Phase 1) must be **≤ 2,000 chars**. The filled Recomposition Prompt Template (Phase 3) must be **≤ 1,200 chars**. GPT Image 2 silently auto-summarizes longer prompts before generation — prompts ≥ ~5,000 chars get cut to ~1,500 chars of content. The Design Framework and Composition Guide have NO length cap because they are never sent to the model. Verify after composing: `python -c "print(len(prompt))"`.
- **Framework and guide stay internal.** Never paste the Design Framework or Composition Guide into a `generate_image` prompt. Only the filled Visual Prompt Template (Phase 1) or filled Recomposition Prompt Template (Phase 3) goes to the model.
- **Silent designer.** Phase 1's reasoning happens internally — never surface a creative brief in chat before generation. The user sees the final summary table at Phase 6, not the thinking.
- **GPT Image 2 only.** Never substitute `soul_2`, `nano_banana_2`, `marketing_studio_image`, etc.
- **Resolution is always `1k`.** Both the MVP and every recomposition must be generated with `resolution: "1k"`. The Figma frame is the source of truth for pixel dimensions; higher resolutions waste credit without improving the deliverable.
- **MVP is always 1200×1200 (1:1).** Canvas size is locked — the framework's pixel measurements (90px x-height minimum, 60px edge safe area, 90px button height) only work at 1200×1200. Recomposition is the only way to produce non-1:1 banners.
- **MVP is the single source of truth for recompositions.** Every recomposition must pass the MVP's `job_id` as a `medias[]` entry with `role: "image"`. Never run a recomposition without the master reference.
- **Verbatim copy.** HERO and CTA pass through unchanged into the visual prompt — no edits, no translations, no improvements.
- **Exact pixel sizes.** Frame is W×H to the pixel.
- **Figma is write-only.** No `get_metadata`, no `get_design_context`. Only allowed Figma operations: create frames + paint image fills via `upload_assets`.
- **No autonomous commits.** Per CLAUDE.md.
