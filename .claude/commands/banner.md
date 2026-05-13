---
description: Read the design framework, reason through the creative decisions for this specific banner, write a tight scene-level prompt, and ship it to Higgsfield GPT Image 2 — then recompose into every requested size and paste each into a Figma frame
---

# /banner — Designer flow (Higgsfield GPT Image 2 → Figma) v1.7

## Architecture

Three layers, three audiences:

| Layer | Audience | What it is | Length |
|---|---|---|---|
| **§ Design Framework** | Claude only | The full design system — slot rules, money-element priority, localization decision tree, RTL handling, hierarchy, typography, color, CTA spec, imagery rules, DO NOT RENDER list | No cap — never sent to the model |
| **§ Composition Guide** | Claude only | The recipe — a 12-decision checklist Claude completes in its head per banner before writing any prompt (register classification → 12 concrete decisions) | ~5K chars — never sent to the model |
| **§ Visual Prompt** | GPT Image 2 | A concrete scene description Claude composes fresh per banner. Names a specific subject, specific setting, specific lighting, specific colors with hex, specific positions, every word of copy with its typography, full typography ladder, background depth ornament, premium CTA finishing | **≤ 2,800 chars** sent to the model |

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

### Phase 0.3 — classify emotional register (silent, then surface one line)

Read HERO + CTA + LANGUAGE together. Pick exactly ONE primary emotional register from the table in **§ Emotional Register Library** below. If two registers tie, pick the one whose visual identity is more *distinctive* from a default photo-ad — the goal is creative differentiation, not safest middle.

The register is **derived fresh per banner from the copy**. It is not predefined per vertical, never carried over from a previous run. Identical copy will always classify to the same register; different copy classifies independently.

The register **drives the defaults** for lighting (decision 4), money element treatment (decision 6), color palette (decision 7), typography (decision 8), CTA treatment (decision 9, 12), and background depth (decision 11). Specific picks within those defaults — exact subject, exact setting, exact hex within the register's family — are still made per banner, so two banners in the same register render as visually distinct creative reads, not clones.

Surface a one-line preview to the user immediately after the cost line:

```
🎭 Register: <register name> (cues: "<cue1>", "<cue2>"). Direction: <one-line visual identity>.
```

Examples:
- `🎭 Register: aspiration (cues: "comprando ações", "Brasil"). Direction: editorial golden-hour photo, dark green + gold, gradient gold CTA.`
- `🎭 Register: urgency (cues: "agora", "últimas vagas"). Direction: high-contrast side-lit photo, charcoal + saturated red, sharp red rectangular CTA.`
- `🎭 Register: provocation (cues: "a escola te ensinou", "ninguém te conta"). Direction: dramatic low-key photo, near-monochrome + one saturated accent, raw editorial typography.`

Do not block — fire and continue. The user will interrupt if it's wrong.

---

## Phase 1 — compose the MVP visual prompt (silent)

The MVP is **always 1200×1200, 1:1**. The framework's pixel measurements (90px x-height minimum, 60px edge safe area, 90px button height) only work at 1200×1200.

This phase is **silent** — Claude reasons internally, never surfaces a creative brief in chat, just composes the prompt and ships it.

### Step 1.1 — Internally answer the 12-decision checklist

Before composing any prompt text, fully answer all 12. Each answer must be **concrete**, not abstract. If any answer is still vague after thinking, replace it with a concrete pick using the framework's defaults for the register from Phase 0.3. Never send a prompt containing "a person" or "warm tones" or "a modern setting" — those are placeholders, not decisions.

1. **Realistic customer.** One sentence: *who* is going to click this. Age range, profession or life stage, market. Derived from HERO + CTA + LANGUAGE.
2. **Hero subject.** A specific human or product. For a human: nationality/ethnicity (driven by LANGUAGE + market), age, gender, build, skin tone, hair, facial hair, expression, wardrobe (specific garment + color), pose. For a product: specific object + framing.
3. **Setting.** A specific environment with named props. "Modern home office with a laptop, notebook, coffee cup, window with blinds" — not "an office."
4. **Lighting.** Direction, color temperature, mood, depth of field. **Defaults come from the register** (§ Emotional Register Library). Aspiration → golden hour with warm key from left, soft golden rim from right, shallow DoF. Urgency → harder side light, neon edge, deeper DoF. Provocation → dramatic low-key, single strong source, shallow DoF. Trust → soft studio key, balanced rim, deeper DoF. Curiosity → soft directional light, muted ambient, shallow DoF. Override the default only if the specific copy demands it.
5. **Composition direction.** LTR or RTL — driven by LANGUAGE. Use the framework's RTL list (Arabic, Hebrew, Urdu, Farsi, Pashto, Sindhi, Kurdish).
6. **Money element.** The specific phrase from HERO + ACCENTS that wins the framework's expanded priority list (number/%/$ /ticker → **national/identity hook** → intensity verb → named brand → urgency phrase → else hero). Name it exactly: which words, where they fall in the headline.
7. **Color palette.** Exactly 3 concrete colors + a neutral, with hex codes. **Pull the family from the register**, then pick specific hex per banner: aspiration → dark green/navy dominant + gold accent + warm off-white neutral; urgency → charcoal/black dominant + saturated red/orange accent + cool white; provocation → near-monochrome dark + one saturated accent + warm off-white; trust → navy/charcoal dominant + brand-color accent + cool white; curiosity → muted mid-tone dominant + one bold accent + warm off-white. Apply the framework's market-aware color reasoning on top. The CTA color must be the highest-contrast in the palette. Pure #FFFFFF is banned for premium copy — use warm off-white (e.g. #F5EFE3, #F2EBDD).
8. **Typography.** Concrete typefaces by LANGUAGE. LTR → Inter (default), Söhne, or Helvetica Now. Arabic → Tajawal (default) or Cairo. Hebrew → Heebo or Rubik. Urdu/Farsi → Vazirmatn or Noto Naskh Arabic. Pick one for headline, max one second face for accents. NEVER mix Latin and RTL typefaces on the same script.
9. **CTA treatment.** Color, shape (rectangular or pill), corner radius, position (LTR → bottom-right or bottom-left at thirds; RTL → bottom-LEFT at thirds), exact button height. Shape default by register: aspiration → pill (16–22px radius), urgency → rectangular (8–12px radius), trust → rectangular (4–8px radius), provocation → pill or rectangular (designer's pick), curiosity → pill (20–24px radius).
10. **Typography ladder.** Explicit per-line size + weight ladder for the headline. Default ladder on 1200×1200 canvas: L1 ~150px/weight 900 → L2 ~120px/weight 800 → L3 ~100px/weight 700 → L4 ~100px/weight 700 (money element with its treatment). **If HERO is > 6 words, break into 3–4 lines at natural phrase boundaries** — never 2 cramped lines. Each line break uses the ladder. Max 3 distinct sizes total (one size can repeat across lines L3 + L4). Re-scale the ladder for non-1200 canvases proportionally during recomposition.
11. **Background depth pass.** Required, not optional. Pick EXACTLY ONE subtle ornament from: (a) thin arc/curve in accent color sweeping from one corner at ≤15% opacity; (b) soft radial light overlay from one corner at ≤15% opacity; (c) gentle vignette darkening opposite corners at ≤20% opacity; (d) single directional light streak at ≤15% opacity. The base remains a clean directional gradient between two register-appropriate hex stops. The ornament adds depth without becoming a "blob" or "tech orb" — it is below the headline in visual weight and never competes for attention.
12. **Premium CTA finishing.** On top of the basic CTA color/shape/position from decision 9, specify the finishing layer: (a) fill type — solid hex OR gradient between two hex stops (gradient default for aspiration, solid for everything else); (b) soft outer glow in the CTA color at 18–22% opacity, 12–16px blur (default for aspiration + curiosity; off for trust + urgency unless copy demands attention burst); (c) 1px top inner highlight at 12–18% white for gradient buttons only.

If any decision is missing after step 1.1, the prompt cannot be sent. Either pick a framework default or stop and ask.

### Step 1.2 — Fill the Visual Prompt Template

Use the template in **§ Visual Prompt Template** below. Fill every bracketed placeholder with the concrete decisions from step 1.1. Render every word of HERO and CTA verbatim, with exact typography per line. Total prompt length must be **≤ 2,800 chars** after filling.

If the filled prompt exceeds 2,800 chars, tighten it — drop redundant adjectives, merge sentences. Do not drop content that names a specific subject, position, color, line of copy, the typography ladder, the background depth ornament spec, or the CTA finishing spec — those are the v1.7 deltas that close the quality gap vs vanilla GPT Image 2 output.

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

This is the skeleton Claude fills per banner. Replace every `[...]` with the concrete decisions from the 12-decision checklist. **Total filled length ≤ 2,800 chars.** This text — and ONLY this text — gets sent to GPT Image 2.

```
1200×1200 square banner ad. [photorealistic | clean vector illustration]. [{LANGUAGE} ({market})] audience. Register: [aspiration | urgency | provocation | trust | curiosity | empowerment | identity].

SUBJECT: [concrete description in 1–2 sentences — nationality, age, build, skin tone, hair, facial hair, expression, exact wardrobe garment + color, pose, framing (mid-shot / portrait / full body)].

PRODUCT PROOF (if applicable): [exact named element with readable detail — e.g. "phone in right hand showing a dark-mode trading app: ticker name 'IA Global' at top, price 'R$ 156,42' with '+4,75 (2,96%)' in green, green candlestick chart trending up, time intervals '1D 1S 1M 3M 1A SA' along the bottom, green 'Comprar' button at bottom. Phone is held at chest height, screen tilted slightly toward viewer, screen content sharp and readable."]. If no product proof element applies (no product / no UI), omit this line entirely.

SCENE: [specific setting + named props — e.g. "modern penthouse balcony at golden hour, blurred city skyline of São Paulo in background, monstera plant in left foreground, wooden table edge with espresso cup at lower-left"].

LIGHTING: [direction, color temp, mood, time of day, depth of field — driven by register. e.g. for aspiration: "warm golden-hour key light from camera-right, soft golden rim from camera-left, late afternoon, shallow depth of field, warm bokeh on city skyline behind subject"].

COMPOSITION ([LTR | RTL]): [subject placement — e.g. "subject occupies LEFT 40% of canvas, mid-shot, eyes meeting camera"; text placement — "text block on RIGHT 55%, left-aligned, vertically centered around midline" (LTR) or right-aligned for RTL].

COPY — render every character verbatim, perfect spelling, accents, and punctuation. Use the typography ladder below.

TYPOGRAPHY LADDER (descending size, register-driven weights):
- L1 ([typeface] [weight 800–900], ~[size]px, [color hex] [optional: "with gold-gradient treatment on the named money phrase, plus a thin 3px [hex] underline ornament spanning only those words"]): "[exact line 1]"
- L2 ([typeface] [weight], ~[size]px, [color hex]): "[exact line 2]"
- L3 ([typeface] [weight], ~[size]px, [color hex]): "[exact line 3]"
- L4 ([typeface] [weight], ~[size]px, [color hex]): "[exact line 4]"
(Use exactly the number of lines needed to break the headline at natural phrase boundaries. For headlines > 6 words, 3–4 lines required — never 2 cramped lines. Money element line uses the gold-gradient + ornamental underline treatment for aspiration, or the register-appropriate equivalent.)

MONEY ELEMENT: the phrase "[exact words]" rendered with [register-specific treatment, e.g. "gold gradient from #D4A017 to #F5C842 across the letterforms, weight 900, plus a thin 3px #D4A017 ornamental underline spanning only those words, centered 8px below the baseline"]. Position: [on its line in the ladder above]. No competing treatments anywhere else on the canvas.

BACKGROUND DEPTH (exactly one ornament, opacity capped):
- Base gradient: [direction + 2 hex stops, e.g. "dark green #0E3B2E at top-left to deeper green #082821 at bottom-right, smooth linear"]
- Ornament: [pick ONE — e.g. "thin gold arc, 2px stroke in #D4A017 at 12% opacity, sweeping from upper-right corner inward and downward like a graceful curve framing the headline area" | "soft radial light overlay from upper-right corner in warm #F5C842 at 10% opacity, falloff over 60% of canvas" | "gentle vignette darkening the four corners at 18% opacity" | "single warm directional light streak from upper-right at 14% opacity"]
- NO blobs, NO hexagons, NO tech orbs, NO "digital network" lines, NO generic gradient soup. The ornament is a subtle design element, not a generated artifact.

CTA: [position — "bottom-right at lower-third intersection" (LTR) or "bottom-LEFT at lower-third intersection" (RTL)]. [shape — pill 18px radius | rectangular 8px radius] button, [height ~110px], horizontal padding ~1.5× text x-height. Fill: [solid [hex] | gradient from [hex] at left to [hex] at right]. [optional finishing for aspiration/curiosity: "Soft outer glow in [hex] at 20% opacity, 14px blur. 1px top inner highlight at 15% white."]. Button text: [typeface] [weight 700–800], [text color hex]: "[exact CTA text]".

PALETTE: [3 named colors with hex + neutral. Pull family from register, pick specific hex per banner. e.g. "dark green #0E3B2E dominant, gold #D4A017 accent + CTA gradient stop, warm gold #F5C842 secondary accent + CTA gradient stop, warm off-white #F5EFE3 neutral for L2/L3/L4 body lines". Pure #FFFFFF is banned — use warm off-white. Highlighter yellow is banned for text — use gold gradient instead.].

MARGINS: 60px safe area on all edges. 8% padding around the text block. Strong negative space around the headline. The text block must not crowd the subject — leave breathing room between subject's edge and L1's left edge (LTR) or right edge (RTL).

CONSTRAINTS: flat finished banner. No mockup frame, no device bezel around the banner itself (the in-scene phone IS the product proof, not a mockup chrome), no "Ad" or "Sponsored" label, no browser UI, no watermarks, no signatures, no AI marks. No text anywhere except in the lines above. No glowing tech orbs, no upward arrows over cities, no stock-photo plastic smiles, no lightbulb metaphors, no hexagon grids, no generic "digital network" lines, no highlighter-yellow swipes behind text. No drop shadows on text. [If LANGUAGE is non-English: + "Subject features, wardrobe, setting must feel native to {market} — no generic Western stock-photo defaults, no cross-region cultural cues. Avoid gesture taboos for {market}."]
```

After filling, the prompt should read like a **specific photoshoot brief** to a photographer + retoucher — concrete enough to render without interpretation.

---

# § Recomposition Prompt Template

This is the skeleton Claude fills per non-1:1 size. The MVP image is provided as `medias[].role: "image"` — the renderer sees it. The prompt only needs to describe **how the scene rebuilds** for the new canvas. **Total filled length ≤ 1,500 chars.**

```
RECOMPOSE the attached master (1200×1200) into {TARGET_WIDTH}×{TARGET_HEIGHT}. Master = single source of truth. Same subject, same text, same logo, same colors, same typography ladder, same background depth ornament, same CTA finishing, same style. Not a stretch, not a crop, not a fresh generation.

NEW LAYOUT ([WIDE | TALL | SQUARE-ISH]):
- Subject: [specific repositioning + framing rule. For TALL aspects, KEEP mid-shot framing if MVP was mid-shot — do NOT tighten to head-and-shoulders if the master shows a product-proof element in hand. For WIDE aspects, may tighten to head-and-shoulders ONLY if the product proof element relocates elsewhere on the canvas (e.g. as a floating UI inset). Same lighting, same wardrobe, same expression.].
- Product proof element ("[exact element from MVP, e.g. 'phone showing IA Global ticker R$ 156,42 chart']"): MUST remain visible and readable in the new aspect. Do not remove. Do not shrink below the size where the ticker name, price, and chart trend are legible. [Specify new position, e.g. "stays in subject's right hand, repositioned to lower-left third of new canvas, screen still sharp and angled toward viewer"]. If absolutely no room remains in the cropped axis, relocate the element as a floating UI inset overlapping the background — never delete it.
- Text block: [specific reflow rules using the typography ladder from MVP. e.g. "reflows to RIGHT 50%, left-aligned, vertically centered. Same 4-line ladder L1/L2/L3/L4, same per-line sizes scaled proportionally to new canvas height. Same gold-gradient + ornamental underline on the money element line. Lines may NOT collapse from 4 to 2 — preserve the editorial multi-tier feel". Never cut copy.].
- Money element ("[exact words]"): [position in new aspect with same treatment as MVP — e.g. "stays on L1 with gold-gradient text and 3px gold ornamental underline beneath only those words"].
- CTA: [position in new aspect, e.g. "moves to LOWER-RIGHT at thirds intersection — same gradient fill, same glow, same inner highlight, same corner radius, same text"].
- Background: [base gradient extension rule, e.g. "dark green gradient extends along the new long axis — same direction, no seam, no color shift"] + [ornament rule, e.g. "thin gold arc ornament repositions to upper-right corner of new canvas at same 12% opacity, sweeps inward toward the headline area"].

SAFE AREA: [if frame_aspect differs from render_aspect by > 5%, add: "Leave 8% safe area on [top and bottom | left and right] — frame will crop ~7% off those edges."].

CONSTRAINTS: exactly {TARGET_WIDTH}×{TARGET_HEIGHT} px. No new content, no stretching or warping, no invented graphics filling the new space. Flat finished banner. No watermarks, no AI marks, no mockup chrome. [If master is RTL: + "Keep mirrored direction — hero LEFT, headline RIGHT-aligned, CTA bottom-LEFT."]
```

After filling, this reads as **spatial choreography** — "the master moves here in the new canvas" — not as a creative manual. Product proof persistence and typography ladder preservation are the v1.7 deltas — they are why non-1:1 sizes used to lose the phone and collapse into 2-line headlines.

---

# § Composition Guide (Claude only)

This is the recipe Claude follows in step 1.1. It converts the framework rules + the register classified in Phase 0.3 + the user's inputs into the 12 concrete decisions that the Visual Prompt Template needs.

The register is the **first lens** for every decision below. Within a register, specific picks vary per banner so creative reads differ even on identical registers.

### How to think through each decision

**1. Realistic customer.** Read HERO + CTA + LANGUAGE + register together. Ask: who *specifically* would click this, *not* who's the broadest possible audience. A Brazilian trading-education banner with copy implying "school taught you nothing" is not aimed at retirees — it's aimed at adults 25–40 in pt-BR who feel financially under-equipped. Write one sentence. This sentence drives every other decision.

**2. Hero subject.** Reverse-engineer from the customer. The subject is *who the customer wants to be* (aspirational/mirror) — pick one per banner. Pin every visible attribute: nationality/ethnicity (drives features), age (drives styling), gender, build, skin tone, hair, facial hair, expression, wardrobe (one specific garment + color, not a generic category), pose, framing. **Default framing for finance/trading copy: mid-shot (chest-up) holding a phone with a readable chart** — this preserves product proof across all aspect ratios. Apply the framework's localization rules — never default to Western stock-photo defaults for non-English markets, never apply cross-region cues.

**3. Setting.** A real place with named props that reinforce the copy's message without explaining it. A trading banner can use a balcony view of a city skyline at golden hour with a phone showing a chart, or a home office with a laptop + chart on screen + coffee. A retirement banner uses a different setting even with the same language. Name the props specifically.

**4. Lighting.** Register drives the default; copy specifics can override.
- **Aspiration / wealth** → golden hour, warm key from one side, soft golden rim from opposite side, shallow DoF with warm bokeh.
- **Urgency / scarcity** → harder side light, slight neon edge from background, deeper DoF.
- **Provocation / contrarian** → dramatic low-key, single strong key source, deep shadows, shallow DoF.
- **Trust / institutional** → soft studio key, balanced rim, deeper DoF, even exposure.
- **Curiosity / discovery** → soft directional light, muted ambient, shallow DoF, slight haze.
- **Empowerment / transformation** → cinematic mid-key, warm key + cool fill, medium DoF.
- **Identity / tribal** → warm regional light, golden hour or magic hour with local-cultural ambient cues.

Always specify direction, color temperature, and depth of field. Never pick "neutral" or "balanced studio" for non-trust copy — it produces flat output.

**5. Composition direction.** Mechanical from LANGUAGE. LTR for English, Spanish, Portuguese, French, German, Italian, Turkish, Thai, most others. RTL for Arabic, Hebrew, Urdu, Farsi, Pashto, Sindhi, Kurdish (Sorani). The direction flips subject placement, text alignment, scan path, and CTA position.

**6. Money element.** Walk the expanded priority list against HERO + ACCENTS:
   1. Specific number / % / $ / ticker → wins for finance/trading creative
   2. **National / identity hook** ("O Brasil," "México," "Tu país," "Nosotros," "Vocês" used as a collective hook) → wins for identity-led copy in LATAM, MENA, SEA markets
   3. High-intensity verb ("double," "unlock," "win," "free," "today")
   4. Named brand or entity with recognition value
   5. Loss-aversion or urgency phrase ("last chance," "ends today," "before it's gone")
   6. Else the hero phrase itself
Once chosen, write down the *exact words* and *which line they fall on*. The money element gets the register-appropriate treatment from § Money Element Treatment in the framework — for aspiration this is gold-gradient text + thin gold ornamental underline (NEVER a yellow highlighter swipe).

**7. Color palette.** Build 3 colors + 1 neutral. Start with the **register's color family** (decision 7 in step 1.1 lists each register's family). Pick specific hex within that family per banner so two banners in the same register render distinctly. The accent is reserved for the money element. The CTA color is the highest contrast against the dominant background — this is the click target. Add a neutral for body copy. Use hex codes — vague "blue" or "orange" produces inconsistent renders. Apply market-aware color reasoning on top: red = loss in Western finance / luck in CN; green positive Western / political MENA; white premium West / mourning EA; gold premium Gulf+EA+LATAM aspiration. **Pure #FFFFFF is banned for premium copy** — it reads cheap. Use warm off-whites like #F5EFE3 or #F2EBDD. **Highlighter yellow (#FFFF00, #FFE600) is banned as a text treatment** — use gold gradient (#D4A017 → #F5C842) for accent text instead.

**8. Typography.** Pick by LANGUAGE script. Latin → Inter (default), Söhne, or Helvetica Now. Arabic → Tajawal (default) or Cairo. Hebrew → Heebo or Rubik. Urdu/Farsi → Vazirmatn or Noto Naskh Arabic. Pick one face for the headline. If you want a second face for an accent line, the framework allows max 2 typefaces total — never more. Headline weight 700–900. Money element weight 800–900. NEVER mix Latin and RTL typefaces on the same script line.

**9. CTA treatment.** Shape default by register (see decision 9 in step 1.1). Position: bottom-right or bottom-left at thirds for LTR; **always** bottom-LEFT at thirds for RTL. Height: 90–120px on the 1200px canvas. Color: highest contrast in palette. Text: exact CTA copy verbatim, no rewording.

**10. Typography ladder.** Resist the urge to fit a long headline into 2 cramped lines — that is the v1.6 failure mode. For headlines > 6 words, break into 3 or 4 lines at **natural phrase boundaries** (after a verb, after a comma, between independent clauses). Each line gets its own ladder rank. Example for "O Brasil está comprando ações de IA. E você?" → 4 lines: L1 "O Brasil está" / L2 "comprando" / L3 "ações de IA." / L4 "E você?" with descending sizes 150 / 120 / 100 / 100. The money element ("O Brasil") sits on L1 with the gold-gradient + ornamental underline treatment. Verify two designers reading the ladder would produce the same line breaks.

**11. Background depth pass.** A flat directional gradient alone is the v1.6 failure mode — it reads as "PowerPoint background." Add EXACTLY ONE ornament from the framework's allowed list (arc/curve, radial light overlay, vignette, light streak). Pick the one whose direction supports the scan path: for LTR aspiration, a thin gold arc curving from upper-right corner toward the headline area is the default. For RTL, mirror the curve. Keep opacity at or below the cap (15% for arc/light, 20% for vignette). The ornament must read as *intentional design*, not as a generated artifact — describe it in the prompt with specifics ("thin gold arc, 2px stroke, 12% opacity, sweeping from upper-right corner inward").

**12. Premium CTA finishing.** The basic color + shape + position from decision 9 is the chassis. Decision 12 adds the finish. For aspiration register: gradient fill with two specific hex stops, soft outer glow in the CTA's dominant color, subtle 1px top inner highlight. For urgency: solid fill, sharp edges, no glow — the urgency comes from saturation and placement, not glow. For trust: solid brand-color fill, no glow, slight 1px outer stroke at 30% opacity for definition. Describe the finishing in the prompt with specifics — "gradient from #D4A017 at the left to #F5C842 at the right, 14px outer glow in #D4A017 at 20% opacity, 1px inner top highlight at 15% white."

### Gut-check before composing

After step 1.1, before writing any prompt text, sanity-check:
- Is the subject **specific enough** that two designers reading the brief would render the same person? If no, tighten.
- Could a generic AI-stock image accidentally match the description? If yes, add specifics (named wardrobe, named setting, named lighting).
- Does the palette have **hex codes**? Vague colors regress to AI-soup gradients.
- Is the money element a **specific word or number**, not a category? "Render the strongest word" is not a decision — "Render '12 anos' in orange" is.
- Does the typography ladder have **4 lines for a long headline**, not 2 cramped ones?
- Does the background description have **exactly one ornament** with opacity capped and direction named?
- Does the CTA finishing call out **gradient stops, glow color, glow opacity, glow blur** explicitly?
- For finance/product copy: is the **product proof element** (phone with chart, laptop UI) named with the specific readable detail (ticker name, price, %, time intervals)?

If any check fails, return to step 1.1 and tighten before writing the prompt.

---

# § Design Framework (Claude only)

The full design system. This is the long-form rationale Claude reasons from when applying the Composition Guide. **Never sent to the model.**

### Emotional Register Library

Used by Phase 0.3 to classify the copy and by step 1.1 to drive defaults for decisions 4, 6, 7, 9, 11, 12. Pick exactly one primary register per banner. Within a register, specific picks (subject, setting, exact hex, ornament direction) vary per banner to keep creative reads distinct.

| Register | Copy cues (any language) | Visual identity defaults |
|---|---|---|
| **Aspiration / wealth** | Acquisition verbs ("buy / buying," "invest / investing," "earn," "comprar / comprando," "ganar," "fortune," "wealth"), asset words ("stocks / ações / acciones," "AI / IA," "crypto," "real estate"), growth framing | Golden-hour photo, warm key + warm bokeh, **dark green / navy dominant + gold accent + warm off-white neutral**, editorial multi-tier typography, gradient gold CTA (#D4A017 → #F5C842) with soft glow, money element in gold-gradient text + thin ornamental underline |
| **Urgency / scarcity** | Time pressure ("now / agora / ahora," "today / hoje / hoy," "last," "ends," "limited," "running out," "before it's gone"), countdowns | Harder side light with neon edge from background, **charcoal / black dominant + saturated red or orange accent + cool white neutral**, condensed bold typography, sharp rectangular CTA in saturated red (#E54B2C) with no glow |
| **Provocation / contrarian** | Anti-establishment ("they don't want you to know," "school taught you wrong," "a escola te ensinou nada," "wake up," "the truth about," "ninguém te conta"), reveal language | Dramatic low-key photo, single strong key, deep shadows, **near-monochrome dark + one saturated accent (red / amber) + warm off-white neutral**, raw editorial typography (slightly heavier weights), CTA in saturated accent, no glow |
| **Trust / institutional** | Authority cues ("official," "trusted," "regulated," "certified," "since X year," bank / cert names), conservative framing | Soft studio key, balanced rim, deeper DoF, even exposure, **navy / charcoal dominant + brand-color accent + cool white neutral**, conservative geometric sans typography, rectangular solid-fill CTA in brand color, no glow, 1px outer stroke at 30% opacity for definition |
| **Curiosity / discovery** | Question-led ("Did you know?", "What if?", "E você?", "¿Y tú?", "هل تعلم؟"), reveal framing ("the secret of," "behind the scenes of") | Soft directional light, muted ambient, slight haze, **muted mid-tone dominant (sage / dusty blue / warm taupe) + one bold accent + warm off-white neutral**, lighter headline weights with one bold accent line, pill CTA with soft glow, question mark / punctuation as visual hook |
| **Empowerment / transformation** | Self-mastery ("take control," "build your future," "master," "unlock your potential," "your way"), capability framing | Cinematic mid-key, warm key + cool fill, medium DoF, **earth tones (terracotta / ochre / forest) + warm accent + warm off-white neutral**, strong geometric sans, pill CTA with subtle glow |
| **Identity / tribal** | National / regional / generational hooks used as collective subject ("O Brasil," "México," "Tu país," "Nosotros," "Our generation," "للعرب") | Warm regional light (golden hour or magic hour), local-cultural ambient cues in setting (architecture, props, skyline), **palette tilts toward a culturally-resonant accent for the market** (gold for LATAM aspirational, deep red for MENA prestige, jade for SEA), identity phrase becomes the money element |

**Classification rule:** read the copy left-to-right and check cues in priority order — *acquisition verbs > urgency cues > anti-establishment cues > trust cues > question cues > empowerment cues > identity hooks*. Pick the first register whose cues appear. If two registers both apply (e.g. "O Brasil está comprando ações de IA. E você?" has both aspiration AND identity), pick the register whose defaults are more *distinctive* visually — aspiration here, because its golden-hour + gold-accent direction is more differentiated from default photo-ad than identity alone. Identity then acts as a *modifier* on the aspiration defaults (push the palette warmer, tilt the setting to a regional skyline, make the identity phrase the money element).

**Forbidden default:** never classify into "neutral / balanced / clean studio" when no register cue is present — that produces the v1.6 flat-output failure mode. If genuinely no cue is present, default to **curiosity** (its soft directional light + muted palette is the safest non-flat fallback).

### Money element treatment by register

Decision 6 picks the money element phrase. The treatment is register-driven, applied to that phrase on whichever ladder line it falls:

- **Aspiration:** gold gradient (#D4A017 → #F5C842) applied to the letterforms themselves, plus a thin 3px gold ornamental underline (#D4A017) spanning only those words, centered 8px below the baseline. Weight 900. No highlighter-yellow swipe, no rectangular highlight box, no glow on the text.
- **Urgency:** solid saturated red (#E54B2C) on the letterforms themselves, weight 900. No underline, no box. The size escalation alone carries the emphasis.
- **Provocation:** the accent color (red / amber) on the letterforms, weight 900, plus a tight 2px box outline in the same accent at 60% opacity around only those words. Slightly off-axis (1–2°) for editorial tension.
- **Trust:** brand-color accent on the letterforms, weight 900. No ornament. The contrast against the conservative palette carries the emphasis.
- **Curiosity:** the bold accent color on the letterforms, weight 900, plus a thin 2px underline in the same accent at 80% opacity. Lightweight ornament — must not overwhelm the muted palette.
- **Empowerment:** the warm accent color, weight 900, with a thin 3px underline in the same accent. Similar to aspiration but using earth-tone accent instead of gold.
- **Identity:** same treatment as the primary register the identity hook is layered on top of, but the identity phrase is the one that gets the treatment (not whichever phrase would have won without identity).

Never combine two treatments on the same word (e.g. gradient text + box outline + underline). One treatment per money element, total.

### Slots & verbatim render rules

- `HERO` ← the user's Title verbatim. The single dominant phrase on the banner.
- `SUPPORT` ← optional. Empty by default. Only fill if the user explicitly provided a separate supporting line. Never split the Title.
- `ACCENTS` ← optional. Empty by default. Only fill if the user explicitly provided tickers, numbers, percentages, dollar figures, or brand names as a separate field. Never extract them from the Title.
- `CTA` ← the user's CTA verbatim. If empty, no button anywhere on the canvas — flow ends on hero or money element.
- `LANGUAGE` ← auto-detected per Phase 0.

Every character of HERO/SUPPORT/ACCENTS/CTA must render in the final image with perfect spelling, spacing, punctuation, and accent marks. Never add words, badges, prices, URLs, dates, percentages, disclaimers, or logos not in the slots. Never translate or paraphrase.

### Money element

The single most CTR-driving phrase in the copy. Expanded priority list (v1.7):

1. Specific number, percentage, dollar figure, or ticker (almost always wins for finance/trading creative)
2. **National / identity hook** — "O Brasil," "México," "Tu país," "Nosotros," "Our generation," collective tribal references — wins for identity-led copy especially in LATAM, MENA, SEA markets where tribal hooks drive CTR
3. High-intensity benefit verb or transformation phrase ("double," "unlock," "win," "free," "today")
4. Named entity with strong recognition value (brand, ticker, product name)
5. Loss-aversion or urgency phrase ("last chance," "ends today," "before it's gone")
6. If none of the above exist, the hero phrase itself

The money element is the SECOND-most visible element on the canvas (or first if no CTA). It gets dedicated high-CTR styling per the **§ Money element treatment by register** table above: gold-gradient text + thin ornamental underline for aspiration, solid red letterforms for urgency, accent letterforms + tight box outline for provocation, brand-color letterforms for trust, bold accent + thin underline for curiosity, warm accent + thin underline for empowerment.

Never combine treatments. Never use a highlighter-yellow swipe behind text (that is the v1.6 failure mode — looks like a Word doc). The treatment is applied to the letterforms themselves, with at most ONE thin ornament (underline or outline) adjacent.

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

### Hierarchy (3 tiers, 3 sizes max, typography ladder)

- **Tier 1 — HERO + MONEY ELEMENT:** largest text on canvas. Weight 800–900. Highest contrast. Headline x-height minimum 90px. The money element sits at or above hero size.
- **Tier 2 — SUPPORT:** smaller than Hero. Weight 500–600. Softer color from the same family as Hero.
- **Tier 3 — CTA (only if CTA slot is filled):** rendered inside a solid-fill button. Does not need to be the largest text — earns clicks through contrast, shape, and placement.

Maximum 3 distinct font sizes across the entire banner.

**Typography ladder (v1.7).** A long HERO (> 6 words) is broken into 3–4 lines at natural phrase boundaries, with descending sizes/weights. Default ladder on 1200×1200:
- L1: ~150px, weight 900
- L2: ~120px, weight 800
- L3: ~100px, weight 700
- L4: ~100px, weight 700 (money element line with its register-appropriate treatment)

The ladder produces the *editorial multi-tier feel* that distinguishes premium banners (think New Yorker cover) from generic ad output (think Shopify popup). 2 cramped lines on a 7+ word headline is the v1.6 failure mode. The ladder is **mandatory** for headlines > 6 words; optional for 3–6 words (then a 2-line ladder L1/L2 is acceptable); single-line for ≤ 3 words.

On non-1200 canvases the ladder scales proportionally — preserve relative ratios, not absolute px.

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

**Register-driven color families (v1.7).** Pull the family from the register classified in Phase 0.3, then pick specific hex within the family per banner so two banners in the same register render distinctly:

| Register | Dominant | Accent (money element) | CTA | Neutral |
|---|---|---|---|---|
| Aspiration | Dark green (#0E3B2E–#082821) / Navy (#0A1A3D) | Gold gradient (#D4A017 → #F5C842) | Gradient gold (#D4A017 → #F5C842) | Warm off-white (#F5EFE3) |
| Urgency | Charcoal (#1C1F26) / Black (#0A0A0A) | Saturated red (#E54B2C) | Saturated red (#E54B2C) | Cool white (#F4F6F8) |
| Provocation | Near-black (#0A0A0A) / Deep charcoal (#16161A) | Saturated red (#E54B2C) / Amber (#E89B17) | Accent color, solid | Warm off-white (#F2EBDD) |
| Trust | Navy (#0A1A3D) / Charcoal (#2A2F38) | Brand color (per client) | Brand color, solid | Cool white (#F4F6F8) |
| Curiosity | Sage (#5B7060) / Dusty blue (#5B7280) / Warm taupe (#7A6B5A) | Bold accent (terracotta / electric blue / yellow-orange) | Accent color, gradient | Warm off-white (#F2EBDD) |
| Empowerment | Forest (#1F3D2E) / Terracotta-dark (#5C3326) / Deep ochre (#6E4F1E) | Warm accent (ochre / burnt orange) | Warm accent, solid | Warm off-white (#F5EFE3) |
| Identity | Same as primary register the identity hook layers on | Same | Same | Same |

**Banned for premium copy:**
- **Pure #FFFFFF as neutral.** Reads cheap. Use warm off-white (#F5EFE3, #F2EBDD) for aspiration / empowerment / identity / provocation; cool white (#F4F6F8) for urgency / trust.
- **Highlighter yellow (#FFFF00, #FFE600, #FFEC3D) as a text treatment.** Reads like a Word doc highlighter. Use gold gradient on the letterforms themselves for aspiration / identity. For urgency, use a solid saturated yellow-orange ON the letterforms (not behind them).
- **Muddy gradient soup with > 2 stops.** Only clean 2-stop directional gradients allowed. Radial light overlays at ≤15% are *additive*, not replacements for the base gradient.

### CTA button spec

- Fill: solid OR a clean 2-stop gradient. No outline-only, no ghost buttons, no skeuomorphic 3D.
- Shape: rectangular or pill. Sharp or softly rounded corners only.
- Minimum button height: 90px on the 1200px canvas.
- Horizontal padding inside button: ~1.5× the text x-height.
- CTA color contrast against background must be the strongest in the layout.
- For RTL languages, CTA button text renders in the RTL script using the same typeface as the headline.
- If the CTA slot is empty, do not render any button-shaped element anywhere.

**Premium CTA finishing (v1.7).** Layered on top of the basic chassis, register-driven:

| Register | Fill | Shape | Glow | Inner highlight | Stroke |
|---|---|---|---|---|---|
| Aspiration | Gradient (2 hex stops, e.g. #D4A017 → #F5C842) | Pill, 18–22px radius | Outer glow in CTA color at 18–22% opacity, 12–16px blur | 1px top inner highlight at 12–18% white | None |
| Urgency | Solid saturated | Rectangular, 8–12px radius | None | None | None |
| Provocation | Solid accent | Designer's pick | None | None | None |
| Trust | Solid brand color | Rectangular, 4–8px radius | None | None | 1px outer stroke at 30% opacity in same color |
| Curiosity | Gradient or solid | Pill, 20–24px radius | Outer glow in CTA color at 15–18% opacity, 10–14px blur | Optional 1px top inner highlight (gradient only) | None |
| Empowerment | Solid warm | Pill, 16–20px radius | Subtle outer glow at 12–15% opacity, 10–12px blur | None | None |

Specify exact hex, exact glow opacity, exact glow blur in the visual prompt — these are render-critical and the renderer hallucinates without them.

### Imagery

- Commit to ONE style: either photorealistic OR clean vector illustration. Never mix.
- Localization reasoning is the primary source of truth for who appears on the canvas and where they appear.
- If a human is present: one authentic candid subject, natural expression, sharply lit, clearly separated from background. Direct their gaze or body angle toward the money element or CTA.
- Avoid gestures flagged in the Cultural Safety Checks for the target market.
- Emotional trigger: matches the register from Phase 0.3 — aspiration, urgency, provocation, trust, curiosity, empowerment, or identity.
- Use a benefit-forward visual metaphor. Show the outcome or transformation, not the product feature.

**Product proof element (v1.7).** For verticals where a product UI exists (finance/trading, SaaS, e-commerce, fitness, education), the subject should hold or interact with the product in a way that renders **readable, specific UI detail** on the device screen. The screen content is NOT decorative — it is the credibility anchor.

For trading/finance copy, the default product proof spec:
- Phone in subject's right hand, held at chest height, screen tilted slightly toward viewer.
- Screen content: dark-mode trading app. Top row: ticker name (specific, plausible — "IA Global," "PETR4," "VALE3," "BTC/USD") and exchange tag. Mid row: price with currency (specific, plausible — "R$ 156,42," "$48.7K") and change in green (e.g. "+4,75 (2,96%)"). Main area: green-rising candlestick chart with visible candles and an upward trend line. Bottom row: time intervals ("1D 1S 1M 3M 1A SA") and a primary action button ("Comprar," "Buy," "Investir") in the brand accent color.
- The screen must be sharp and readable. The phone bezel must look modern (rounded corners, no oversized notch).
- The phone is NOT a mockup chrome around the banner — it is an in-scene held device.

For non-finance verticals, adapt: SaaS → laptop with dashboard UI; fitness → smartwatch with metrics; education → tablet with course UI.

**Product proof persistence across aspects.** The product proof element MUST remain visible and readable in every recomposition. The Recomposition Template enforces this via a dedicated bullet. Losing the phone in 16:9 or 3:4 outputs is the v1.6 failure mode — never delete the product proof to save space; relocate it as a floating UI inset if no in-scene room remains.

### DO NOT RENDER (negative constraints — Claude enforces these while composing the visual prompt)

- No invented words, logos, app icons, brand marks, or badges not present in the content slots. (Exception: the in-scene product proof UI may show a plausible ticker name + price + chart — those are *not* a "brand" Claude is inventing, they are the readable product detail per the Imagery section.)
- No fake UI chrome on the banner itself: browser bars, mockup phone frames around the entire banner, "Sponsored" or "Ad" labels, mock notifications. (Exception: a phone *held by the subject in the scene* IS the product proof, not chrome.)
- No text inside the hero subject (no words on shirts, signs, posters) unless that exact text is in the content slots. The product-proof screen UI is the only exception per the rule above.
- No watermarks, signatures, "Generated by," or AI artifact marks.
- No duplicated, mirrored, or repeated text anywhere on the canvas.
- No mirrored or reversed Arabic/Hebrew letterforms — RTL text must render in its native direction.
- No Latin fonts forced onto Arabic or Hebrew copy.
- No generic Western stock-photo defaults on non-English banners.
- No cross-region cultural mismatches.
- No repeated subject archetypes, settings, or visual treatments across banners in the same campaign.
- No gestures flagged as offensive in the target market.
- No generic AI stock aesthetics: fake-smiling stock people, glowing tech orbs, **muddy** oversaturated gradient soup with > 2 stops, cliché upward arrows over cityscapes, stock handshakes, lightbulb metaphors, hexagon grids, generic "digital network" lines.
- No drop shadows on text. (Outer glow on the CTA button is allowed when the register specifies it — see § CTA button spec.)
- No mixed visual styles (photo + vector together).
- No button, button shape, or button placeholder if the CTA slot is empty.
- No competing emphasis treatments — only the money element gets the gradient-text/underline/box treatment. The CTA's glow is the CTA's glow, not a competing emphasis.

**v1.7 additions:**
- **No highlighter-yellow swipe behind text.** Yellow #FFFF00 / #FFE600 as a rectangular highlight bar behind a word reads like a Word doc — banned. Use gold-gradient (#D4A017 → #F5C842) applied to the letterforms themselves for aspiration; use the register-specific treatment from § Money element treatment by register for everything else.
- **No pure #FFFFFF as the body neutral for premium copy.** Use warm off-white (#F5EFE3, #F2EBDD) for aspiration/empowerment/identity/provocation; cool white (#F4F6F8) for urgency/trust.
- **No 2-cramped-line headline when HERO > 6 words.** Break into 3 or 4 lines at natural phrase boundaries using the typography ladder. 2 cramped lines is the v1.6 failure mode and is banned for headlines > 6 words.
- **No flat single-tone CTA for aspiration register.** Use the gradient + glow + inner highlight finishing layer from § CTA button spec.
- **No flat directional gradient as the entire background.** Always add EXACTLY ONE subtle ornament from the allowed list (arc/curve, radial light overlay, vignette, light streak) at the opacity cap. The bare gradient alone is the v1.6 failure mode.
- **No deletion of the product proof element in non-1:1 recompositions.** If the master had a phone with a chart, every recomposition must keep it visible and readable. Relocate to a floating UI inset only if no in-scene room remains — never delete.
- **No "neutral / balanced studio" lighting for non-trust registers.** Cool flat lighting is the v1.6 failure mode and is banned for finance/aspiration/urgency/provocation/empowerment copy.
- **No symmetrical abstract blobs, hexagon grids, or geometric tech-network shapes** as background ornament. The allowed ornaments are: thin arc/curve, soft radial light overlay, gentle vignette, single directional light streak — all at the opacity cap.

Most of these become **filters Claude applies while composing the visual prompt** ("don't describe a highlighter-yellow swipe"). A few hard ones must also appear in the visual prompt itself as output-format constraints (no mockup chrome on the banner, no "Ad" label, no watermarks) — those are about the output, not creative judgment.

---

# § Visual Reference Library (Claude only)

Annotated descriptions of what "premium" vs "generic" looks like for each register. Claude **mentally compares the filled visual prompt against the relevant register's premium anchor** before submitting. If the prompt reads closer to the generic anchor, return to step 1.1 and tighten.

These are written descriptions, not images. They describe what the renderer should produce — the *feel* the prompt is aiming for.

### Aspiration register

**Premium anchor (what v1.7 is aiming for):**
> Square 1:1 banner. Brazilian male, 30s, mid-shot from chest up, holding a phone in his right hand. Phone screen is sharp and readable: ticker "IA Global" top-left, price "R$ 156,42" with "+4,75 (2,96%)" in green, green-rising candlestick chart with visible candles, time intervals "1D 1S 1M 3M 1A SA" along the bottom, green "Comprar" button. He is on a penthouse balcony at golden hour, blurred São Paulo skyline behind him, monstera plant in left foreground, espresso cup on a wooden table edge at lower-left. Warm key light from camera-right, soft golden rim from camera-left, shallow depth of field, warm bokeh on the skyline. Background: dark green gradient from #0E3B2E top-left to #082821 bottom-right. Thin gold arc ornament (2px stroke in #D4A017 at 12% opacity) sweeps from upper-right corner inward and downward, framing the headline area. Text block on right 55% of canvas, left-aligned, 4-line ladder: L1 "O Brasil está" (150px, weight 900, "O Brasil" in gold-gradient #D4A017 → #F5C842 with thin 3px gold underline ornament beneath, "está" in warm off-white #F5EFE3) / L2 "comprando" (120px, weight 800, warm off-white) / L3 "ações de IA." (100px, weight 700, warm off-white) / L4 "E você?" (100px, weight 700, warm off-white). CTA bottom-right at lower-third intersection: pill button, 20px radius, gradient fill from #D4A017 left to #F5C842 right, soft outer glow in #D4A017 at 20% opacity 14px blur, 1px top inner highlight at 15% white, dark navy text "Entre agora" at weight 800.

**Generic anchor (what v1.6 was producing, what to avoid):**
> Square 1:1 banner. Brazilian male, 30s, half-body left side, phone barely visible. Flat green background gradient, no ornament, no depth. Cool flat side-light. Headline "O Brasil está comprando ações de IA. E você?" cramped into 2 lines on the right, "Brasil" with a flat yellow highlighter rectangle behind it (like a Word doc highlight), all other words in pure white #FFFFFF. Red-orange rectangular CTA "Entre agora" bottom-right, no glow, no gradient, generic Shopify "Buy Now" feel.

The delta between these two outputs is everything v1.7 adds: typography ladder, gold-gradient money element, background ornament, golden-hour lighting, readable product proof, pill gradient CTA with glow, warm off-white neutral.

### Urgency register

**Premium anchor:**
> Hard side-lit photo of a young trader, intense expression, looking just past camera. Background charcoal #1C1F26 with a single saturated red light streak from upper-left at 14% opacity. Headline ladder: L1 "Últimas 24h" in #E54B2C weight 900, L2 "para entrar" in cool white, L3 "no IA Global." in cool white. Sharp 10px-radius rectangular CTA bottom-right in #E54B2C, white text, no glow — the saturation is the urgency. Phone with a count-down timer overlay on the chart visible in lower frame.

**Generic anchor:**
> Same headline split into 2 cramped lines, plain charcoal flat background, no light streak, no ornament. Red CTA looks identical to every other red CTA on the internet.

### Provocation register

**Premium anchor:**
> Dramatic low-key photo, single strong key from upper-right, deep shadows on the left side of the subject's face. Near-black background #0A0A0A with a single amber light streak from upper-right at 12% opacity. Headline: L1 "A escola" / L2 "não te ensinou" / L3 "a investir." with "a escola" wrapped in a tight 2px box outline in saturated amber #E89B17 at 60% opacity, slightly off-axis (1.5°) for editorial tension. Body lines in warm off-white #F2EBDD. CTA in solid amber, rectangular, no glow.

**Generic anchor:**
> Same headline 2 cramped lines on a flat dark background, no editorial treatment, generic dark mood with no ornament, CTA looks polite.

### Curiosity register

**Premium anchor:**
> Soft directional light, muted ambient, slight haze. Sage #5B7060 dominant background with a soft radial light overlay from upper-right corner in warm terracotta #C8704A at 10% opacity. Subject: contemplative, looking past camera. Headline ladder: L1 "Did you know" in cool sage-tinted neutral, L2 "AI stocks doubled" in bold terracotta accent (this is the money element), L3 "this quarter?" in cool neutral. The question mark is rendered slightly larger as a visual hook. Pill CTA in terracotta gradient with subtle glow.

**Generic anchor:**
> Same headline in plain white on a muted gray background, no ornament, generic "minimal" look that reads as low-effort rather than refined.

### Trust register

**Premium anchor:**
> Soft studio key, balanced rim, deeper DoF. Navy #0A1A3D dominant with a gentle vignette darkening the four corners at 18% opacity. Subject: well-dressed professional, direct gaze, neutral confident expression. Headline ladder uses conservative geometric sans, money element in client's brand accent color (e.g. corporate blue, deep teal) on the letterforms — no underline, no box, contrast alone. Rectangular CTA in brand color with 1px outer stroke at 30% opacity for definition. No glow.

**Generic anchor:**
> Same composition but with the body neutral in pure #FFFFFF (cheap), no vignette, flat lighting, CTA stroke missing.

### Empowerment register

**Premium anchor:**
> Cinematic mid-key, warm key from one side + cool fill from opposite. Forest green #1F3D2E dominant with a soft directional light streak from upper-left in warm ochre #C9892D at 13% opacity. Subject: mid-action, hands engaged with the product, gaze forward and slightly upward. Headline ladder with money element in warm ochre + thin 3px ochre underline. Pill CTA in solid warm ochre, subtle glow at 12% opacity.

**Generic anchor:**
> Same headline 2 cramped lines, flat green background with no ornament, lighting reads as neutral instead of cinematic.

### Identity register

Identity layers on top of whichever primary register is also active. The **premium anchor inherits from the primary register**, with these additional cues:
- The setting includes a culturally-specific marker (Brazilian skyline silhouette / Mexican plaza architecture / Gulf coastline / Tokyo street).
- The identity phrase ("O Brasil," "México," "Tu país," etc.) becomes the money element and takes the primary register's treatment.
- Subject features and wardrobe specifically read as native to the market (per the Localization section), not a generic Western default.

**Generic anchor for identity:** the identity phrase rendered in a generic yellow highlighter on a flat background, no cultural setting cues, subject features that could be anywhere — i.e. the v1 output you compared against. v1.7 closes this.

---

## Self-check before sending the visual prompt

After step 1.2 fills the template, before sending to GPT Image 2, mentally compare the filled prompt against the **premium anchor** for the classified register:

1. Does my filled SUBJECT + SCENE + LIGHTING read closer to the premium anchor's photo description, or the generic anchor's flat photo? If generic, tighten — golden hour / dramatic low-key / cinematic mid-key are concrete directions, "neutral" is not.
2. Is my TYPOGRAPHY LADDER 3–4 lines for a > 6-word HERO, with descending sizes and the money element on its own line with the register's treatment?
3. Does my BACKGROUND DEPTH name EXACTLY ONE ornament with direction + opacity + hex?
4. Does my CTA spell out the fill type (solid vs gradient with both hex stops), the glow color, glow opacity, glow blur, and inner highlight?
5. Does my PRODUCT PROOF (for finance/SaaS/etc) name the specific readable UI elements (ticker name, price, % change, time intervals, button)?

If any answer is "no" or "partially," return to step 1.1 and concretize the gap before sending. Generic prompts → generic output; specific prompts → premium output.

---

## Constraints — do not violate

- **Visual prompt length.** The filled Visual Prompt Template (Phase 1) must be **≤ 2,800 chars**. The filled Recomposition Prompt Template (Phase 3) must be **≤ 1,500 chars**. GPT Image 2 silently auto-summarizes longer prompts before generation — prompts ≥ ~5,000 chars get cut to ~1,500 chars of content, so 2,800 leaves ample headroom. The Design Framework and Composition Guide have NO length cap because they are never sent to the model. Verify after composing: `python -c "print(len(prompt))"`.
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
