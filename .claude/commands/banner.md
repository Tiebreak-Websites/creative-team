---
description: Render banner concepts with Higgsfield GPT Image 2 and paint them into a Figma file. User-controlled setup (sizes first, then customize vs auto). Premium localized performance-ad style — never flat split layouts, always integrated full-canvas scenes. Multi-concept ready. Reasoning-first art direction. The user provides one-or-more Title lines + a Figma URL with the hero node pre-selected.
---

# /banner — Designer flow (Higgsfield GPT Image 2 → Figma) v2.5

## What changed in v2.5 (from v2.4)

v2.5 puts the designer back in control of the early decisions and locks the creative ceiling to **premium localized performance ads** — not generic AI/finance images, not flat split-panel templates.

**Flow changes (user-controlled setup):**

- **Phase 0.4 — Size selection poll (NEW, BLOCKING).** Multi-select clickable poll with the most common ad formats (1:1, wide, story, portrait, landscape, display, leaderboard, half-page, all standard, custom). 1200×1200 always included as MVP/master unless explicitly excluded. Skipped if sizes were passed in input.
- **Phase 0.45 — Creative control mode poll (NEW, BLOCKING).** Customize direction vs Claude decides automatically. In auto mode, Phase 0.5 polls are skipped entirely and Claude infers silently.
- **Phase 0.5 polls run only in Customize mode.** Original v2.4 highlight + CTA + visual direction + local cues. Skipped in auto mode.

**Visual style direction (premium localized performance ads):**

- **5 preferred creative archetypes.** Local hero campaign / Premium offer poster / Editorial lifestyle ad / Cultural prestige layout / Minimal premium typographic ad. Claude picks fresh per task, no archetype default.
- **No hard split-panel layouts.** The biggest visual-pattern fix in v2.5: banners must be ONE continuous cinematic scene with the copy zone integrated into the background through lighting, depth, blur, and decorative bridges — not a dark rectangle pasted next to a photo.
- **Integrated copy zone rule.** Soft gradient + blur + vignette + atmospheric haze creates the readability zone. No hard panels, no flat dark boxes behind text.
- **5-layer background depth formula.** Foreground / Midground / Background atmosphere / Readability zone / Visual bridge — every prompt declares all five.
- **Target creative standard.** Bold localized advertising, large confident typography, one clear hero subject, polished CTA, cinematic lighting, local-market atmosphere, art-directed (not just realistic).

**Higgsfield prompt restructure:**

- **Prompt length 900–1,200 chars preferred, 1,400 max.** Compact, visual, production-oriented — describe the AD COMPOSITION, not a long system explanation.
- **7-section prompt structure:** Format + market + mood → Concept → Hero → Integrated background → Text + CTA layout → Style + palette → Constraints.
- **Hard ban on readable invented text** inside screens / charts / UI / documents. Only the provided Title and CTA may be readable text on the banner.
- **Hard ban on hard split-panel layout.** Restated in every prompt's constraints block.

**Carried over from v2.4 (still in effect):**

- Phase 1.0 visual reasoning (8-step) — fresh metaphor per task, no theme reuse
- Campaign-meaning → visual logic catalog (10 archetypes)
- Three-Zone composition (Text/Visual/CTA, planned before render)
- Per-aspect layout rules with diagrams
- Banner quality standard + 14 anti-patterns
- On-screen data localization (market-native bank labels — but always blurred/abstract per the new readable-text rule)
- Stacked vs Inline highlight mode
- CTA color tier rule (Tier 1 highlight ≠ Tier 2 CTA hex)
- Title block height = clamp(canvas_h × 0.22, 180, 480) px
- Phase 6.5 silent visual QA before paint
- Master prop manifest enforced in recomps
- Subject vertical fill 45–55% for TALL/PORTRAIT
- Multi-concept support, market exclusion lists, safe-area-from-fill-math, landmark do-not-invent

## Architecture

| Layer | Audience | What it is | Length |
|---|---|---|---|
| **§ Design Framework** | Claude only | Principle-driven design system — adaptive decisions, hard guardrails, references | No cap |
| **§ Visual Prompt** | GPT Image 2 | 7-section advertising-composition brief — Format → Concept → Hero → Background → Layout → Style → Constraints | **900–1,200 chars preferred, ≤1,400 hard** |
| **§ Recomposition Prompt** | GPT Image 2 | Layout redesign per format — same concept, new spatial structure. | **≤1,800 chars** |

Workflow:

1. **Parse + pre-flight.** Validate Figma URL has `node-id`, parse Title(s) + CTA + (optional) sizes, run egress + MCP connectivity checks. Fail-fast on missing required input.
2. **LP hero read.** Direct `get_screenshot` call on the user-provided node-id. Retry-on-session-expired.
3. **Phase 0.4 — Size selection poll** (BLOCKING). Skip if sizes were passed in input.
4. **Phase 0.45 — Creative control mode poll** (BLOCKING). Customize vs Auto.
5. **Phase 0.5 — Creative polls** (per concept). RUN ONLY in Customize mode. In Auto mode, skip and infer silently.
6. **Phase 1.0 + 1 + 2 — Visual reasoning → compose prompt → render MVP at 1200×1200** per concept (parallel).
7. **Phase 3 + 4 — Figma frames + MVP paint.**
8. **Phase 5 — 🛑 Designer review pause.** Per-concept Redo / Continue / Stop.
9. **Phase 6 + 6.5 + 7 — Recomp + silent QA + paint.**
10. **Phase 8 — Summary + problem list.**

---

## Input parsing — strict

The user pastes:

```
/banner <figma-url-with-node-id>
Title: <full title text verbatim>           ← one or more lines (multi-concept)
Title: <second concept's title>             ← optional additional concepts
CTA: <button text verbatim>                 ← optional; applies to all concepts unless per-concept supplied
[<WxH> ...]                                  ← optional; if present, skips Phase 0.4 size poll
```

### Required

- **Figma URL with `node-id`.** Must be `https://figma.com/design/<fileKey>/...?node-id=<X-Y>...`. The user has to pre-select the hero frame in Figma so the URL carries the node-id. Extract both `fileKey` and `nodeId` (convert `X-Y` → `X:Y`).
- **`Title:` line(s).** The full headline copy verbatim. Accept the typo `Tittle:` and the alias `Headline:`. Use the WHOLE title text on the banner — never split into "headline + sub-line". **Multiple `Title:` lines = multiple concepts** rendered in parallel. Cap at 4 concepts per run.
- **`CTA:` line(s)** — OPTIONAL. If a single `CTA:` is given, it applies to every concept. If a per-concept CTA is needed, the caller can repeat `CTA:` lines in the same order as the titles. If absent, Phase 0.5 asks via poll per concept (Claude suggests 3 short candidates + "no button"). In Auto mode, Claude picks silently.

### Optional

- **Sizes.** Zero or more `WxH` tokens in input. If present → use them, **skip Phase 0.4 size poll**. If missing → ask via Phase 0.4 poll. Always include `1200×1200` as MVP/master unless explicitly excluded.

### Fail-fast (clear errors)

- No `node-id` in Figma URL → **`❌ Select the hero frame in Figma first, then copy the URL with the node selected and re-paste. /banner needs node-id=X-Y in the URL to read the LP context.`**
- No Figma URL at all → **`❌ /banner needs a Figma file URL with the hero node selected.`**
- No `Title:` → **`❌ /banner needs Title: <headline text> on its own line.`**
- Any other missing piece (sizes, CTA, etc.) → resolved by Phase 0.4 / 0.5 polls, never a fail.

---

## Pre-flight (silent unless something breaks)

Run in parallel, fail-fast on hard requirements:

1. **Resolve `gpt_image_2` model id** via `models_explore`. Fallback to literal `gpt_image_2`.
2. **Figma MCP connected?** Need `get_screenshot`, `use_figma`, `upload_assets`. Missing → `❌ /banner needs Figma MCP read+write access.`
3. **Egress allowlist check.** Test both hosts in parallel with `curl -sS -o /dev/null -w "%{http_code}" --max-time 5`:
   - `https://d8j0ntlcm91z4.cloudfront.net/`
   - `https://mcp.figma.com/`
   If either returns `403 host_not_allowed`, surface:
   ```
   ❌ Your Claude Code workspace blocks egress to <host(s)>. Add to allowlist:
     d8j0ntlcm91z4.cloudfront.net
     mcp.figma.com
   Or run /banner from local Claude Code.
   ```
   Then `AskUserQuestion`: **Continue (no paint)** / **Stop**.

All three checks finish in under 2 seconds. Output is silent on success — only failures surface.

---

## Phase 0 — silent setup

Language, register, and LP context are derived silently. Nothing surfaces unless something breaks.

### Phase 0.1 — language (silent)

Detect from Title + CTA. Labels: `pt-BR`, `pt-PT`, `es-LATAM`, `es-ES`, `English`, `Arabic`, `Hebrew`, `Urdu`, `Farsi`, `Pashto`, `th-TH`, `tr-TR`, `sv-SE`, `de-DE`, otherwise closest from the localization tree; default `English`.

### Phase 0.2 — register (silent)

Classify from Title + CTA per **§ Register cues**. One of: `aspiration / urgency / provocation / trust / curiosity / empowerment / identity`. Default `curiosity` if no cues match.

### Phase 0.3 — LP hero (direct screenshot, with retry)

The user already pre-selected the hero — `nodeId` came in via the URL.

1. Call `get_screenshot(fileKey, nodeId, maxDimension=1200)`.
2. **On `session expired`:** retry with 2s wait, then 4s wait. After 2 retries → fall back to no-LP-context (silent).
3. **On success:** analyze silently for `subject archetype`, `top 3 hex`, `tone`, `setting`, `LP CTA button color (if visible)`, and a one-line `LP purpose`. Cache by `fileKey + nodeId`.
4. **On any other error:** fall back to no-LP-context. Record in the problem-list for Phase 8.

---

## Phase 0.4 — size selection (NEW in v2.5, BLOCKING)

**Skip this phase if sizes were passed in input.** Otherwise ask:

```
AskUserQuestion {
  question: "Which banner sizes do you want?",
  header: "Sizes",
  multiSelect: true,
  options: [
    { label: "1:1 — 1200×1200",          description: "Square feed ad. Also used as MVP/master." },
    { label: "Wide social — 1200×628",   description: "Facebook, LinkedIn, Google Display format." },
    { label: "Story/Reel — 1080×1920",   description: "Vertical mobile story format." },
    { label: "Portrait feed — 960×1200", description: "Premium vertical feed format." },
    { label: "Landscape/Hero — 1920×1080", description: "Website hero / cinematic landscape." },
    { label: "Display — 300×250",        description: "Medium rectangle display ad." },
    { label: "Leaderboard — 728×90",     description: "Horizontal display banner." },
    { label: "Half page — 300×600",      description: "Tall display ad." },
    { label: "All standard sizes",       description: "Generate the full standard set (top 5 feed + display)." },
    { label: "Custom sizes",             description: "I will provide exact WxH sizes." }
  ]
}
```

**Rules:**

- Multi-select MUST be enabled.
- **"All standard sizes"** → expand to `[1200×1200, 1200×628, 1080×1920, 960×1200, 1920×1080]` (display formats omitted by default — pick them explicitly if needed).
- **"Custom sizes"** → follow up with a free-text `AskUserQuestion` asking for `WxH` tokens. Validate every token matches `^\d+x\d+$`.
- **Always include `1200×1200`** as the MVP/master unless the user explicitly deselects it AND picks at least one other size. If user picks zero sizes, default to `[1200×1200]`.
- Do not continue to visual generation until size selection is resolved.

---

## Phase 0.45 — creative control mode (NEW in v2.5, BLOCKING)

After sizes are resolved, ask:

```
AskUserQuestion {
  question: "Do you want to customize the banner direction or let Claude decide automatically?",
  header: "Creative mode",
  multiSelect: false,
  options: [
    { label: "Customize direction",         description: "Ask me short creative questions before rendering." },
    { label: "Claude decides automatically", description: "Infer the best direction from the brief and proceed silently." }
  ]
}
```

### If "Claude decides automatically"

**Skip Phase 0.5 entirely.** Claude infers silently per concept:

- highlight phrase (from § Register cues + money-element ranking)
- CTA logic if CTA is missing (best register-appropriate verb)
- visual direction (pick one § Creative Archetype, then specify it for the brief — do not default to AI/finance unless the title clearly calls for it)
- local cultural cue level (Subtle default for non-English; None for English)
- subject type, style, layout, color mood, CTA placement (from § Design Framework)

Proceed directly to Phase 1.0 visual reasoning.

### If "Customize direction"

Run Phase 0.5 polls per concept (next section).

---

## Phase 0.5 — creative polls (CUSTOMIZE MODE ONLY)

Up to 4 polls **per concept**. Each one is short. Skip any poll whose answer is already in input.

**Multi-concept handling.** With multiple `Title:` lines:

- **Shared polls run once** across concepts: local cultural cues (Poll 4).
- **Title-specific polls run per concept:** highlight pick (Poll 1), CTA suggestion (Poll 2 if missing), visual direction (Poll 3).
- Batch into sequential `AskUserQuestion` calls, max 4 questions per call. Typical pattern for 2 concepts: Batch 1 = T1 highlight + T1 CTA + T1 visual + shared local cues. Batch 2 = T2 highlight + T2 CTA + T2 visual.
- Each option label prefixes the concept ("T1 — …", "T2 — …") so the designer can scan quickly.

### Poll 1 — Title highlight (ALWAYS shown in Customize)

Compose 3–4 candidate phrases from the title. Rank by money-element strength (numbers/% > national/identity hook > intensity verb > else first 1–3 words). Last option is always "No highlight".

```
AskUserQuestion {
  question: "Which part of the title pops?",
  header: "Highlight",
  multiSelect: false,
  options: [
    { label: "<phrase 1>",        description: "<60-char preview of the phrase>" },
    { label: "<phrase 2>",        description: "<60-char preview>" },
    { label: "<phrase 3>",        description: "<60-char preview>" },
    { label: "No highlight",      description: "Render the title uniformly. No accent treatment." }
  ]
}
```

### Poll 2 — CTA suggestion (only if `CTA:` missing)

Compose 3 short CTA candidates derived from title's promise + register + market. ≤ 30 chars each. Last option is "No button".

```
AskUserQuestion {
  question: "What goes on the button?",
  header: "Button",
  multiSelect: false,
  options: [
    { label: "<CTA suggestion 1>", description: "<one-line meaning>" },
    { label: "<CTA suggestion 2>", description: "<one-line meaning>" },
    { label: "<CTA suggestion 3>", description: "<one-line meaning>" },
    { label: "No button",          description: "Banner has no CTA button." }
  ]
}
```

### Poll 3 — Visual direction (ALWAYS shown in Customize, content-driven)

Claude composes 3–4 specific directions for this banner — grounded in LP purpose + title + register + market + the 5 preferred creative archetypes. The campaign-meaning catalog (§ Design Framework) seeds ideation but does not dictate.

Each option must be:

- specific (concrete subject + setting + lighting, not category labels)
- distinct from the others (different visual world per option)
- culturally native to the LANGUAGE market
- connected to the LP's promise, not just its aesthetic
- a fresh choice for THIS task — do NOT reuse AI-chip / fintech-chart / trading-floor / person-with-phone as default

```
AskUserQuestion {
  question: "What should the banner show?",
  header: "Visual",
  multiSelect: false,
  options: [
    { label: "<specific direction 1>", description: "<concrete subject + setting + lighting>" },
    { label: "<specific direction 2>", description: "<concrete subject + setting + lighting>" },
    { label: "<specific direction 3>", description: "<concrete subject + setting + lighting>" },
    { label: "Creative AI decides",    description: "Claude picks freely from § Creative Archetypes, biased to the brief." }
  ]
}
```

### Poll 4 — Local cultural cues (non-English markets only)

```
AskUserQuestion {
  question: "Want local cultural cues?",
  header: "Local cues",
  multiSelect: false,
  options: [
    { label: "Subtle",  description: "Native subject + one ambient cue. Recommended." },
    { label: "Strong",  description: "Architecture, regional skyline, decorative motifs. Bold." },
    { label: "None",    description: "Just match the language. No props." }
  ]
}
```

Skip entirely for `English` UNLESS the title contains an identity hook (e.g. "America," "Britain," "Australia"). Default = Subtle.

---

## Phase 1.0 — Visual reasoning (silent)

**Before composing the visual prompt, reason internally for each concept.** Fresh per task — no template reuse.

### Step 1 — Understand the ad

- What is this banner selling?
- What emotion should it create?
- What visual metaphor best supports the copy?
- What would a real performance-ad designer choose for this brief?

### Step 2 — Pick the creative archetype

Pick ONE of the 5 archetypes (§ Creative Archetypes) that best fits the brief. Do NOT default to the same archetype across runs. Decision is driven by:

- title content
- LP purpose
- market identity strength
- whether the title is a number/% (Premium offer poster), a country/identity hook (Local hero / Cultural prestige), a relatable scenario (Editorial lifestyle), a strong claim (Minimal typographic).

### Step 3 — Plan the three zones

- **Text Zone:** position + shape of the title-and-button area. Clean, low-contrast, integrated into the scene (NOT a hard panel).
- **Main Visual Zone:** position of the hero subject / scene / metaphor.
- **CTA Zone:** position of the button — separated from the title but visually connected to the scene.

### Step 4 — Plan the background (5-layer depth formula)

Declare BEFORE writing the prompt:

1. **Foreground element** — subject, object, hand, device, product, person, or decorative shape.
2. **Midground environment** — desk, street, skyline, interior, local architecture, lifestyle setting.
3. **Background atmosphere** — soft blur, skyline, gradient light, cultural pattern, glow, depth, haze, cinematic falloff.
4. **Readability zone** — calm area where title + CTA sit, created by blur / shadow / vignette / low-detail background (NOT a hard rectangle).
5. **Visual bridge** — element connecting subject and copy area: light streak, curved gradient, ornament, shadow, architectural line, color flow.

### Step 5 — Apply per-aspect layout

Pick from § Per-Aspect Layout Rules. 1:1 master uses SQUARE; recomps use their per-aspect layouts.

### Step 6 — Decide highlight structure mode

Compute `(highlight_chars × base_size × 1.12) / text_column_width`.
- **> 0.40 → Inline mode.** Highlight stays in-line. Drop size escalation, use weight + underline + color.
- **≤ 0.40 → Stacked mode.** Highlight gets its own visual row at 1.12× size; rest of logical line below at base.

### Step 7 — Decide CTA color tier

- **Tier 1 (Highlight)** = LP accent OR register default.
- **Tier 2 (CTA)** = if Tier 1 collides with LP palette, use a darker shade at ~70% L of Tier 1, OR sampled from LP's actual CTA button. **Tier 1 ≠ Tier 2 in hex.**
- **Tier 3 (Body text)** = white on dark, near-black on light.

### Step 8 — Title block height target

`title_block_h = clamp(canvas_h × 0.22, 180, 480) px`.

### Step 9 — Master prop manifest

Choose 2–4 named props from the scene. Write them down — this becomes the prop manifest carried verbatim into recomps.

---

## Phase 1 — compose the visual prompt (silent)

Compose ONE prompt per concept using **§ Visual Prompt Template** (v2.5 — 7-section structure). Soft 900–1,200 chars, hard ≤1,400.

The prompt describes an **advertising composition** with an integrated full-canvas scene — never a flat split panel. Encode:

1. **Format + market + mood.** Size, language, market, register.
2. **Concept.** One-sentence campaign idea tied to the Title and LP purpose.
3. **Hero.** Specific subject/object/environment with native/local details + pose/expression/materials.
4. **Integrated background.** Continuous full-canvas scene (NOT split layout); 5-layer depth (foreground / midground / background atmosphere / readability zone / visual bridge); copy zone is naturally created by lighting and depth.
5. **Text + CTA layout.** Large bold title in clean zone with pinned visual rows; highlight phrase treatment; CTA position + style.
6. **Style + palette.** Premium editorial lighting, warm highlights, rich shadows, tasteful overlays, two-hex palette.
7. **Constraints.** Only Title + CTA are readable text; no logos / no invented text / no fake UI labels / no watermarks / **NO HARD SPLIT PANEL LAYOUT**; any screen/chart/UI must be blurred or abstract.

**Render verbatim** every character of Title and CTA. Spell every accent, diacritic, digit exactly. Title visual rows chosen here are pinned for recomps.

---

## Phase 2 — render MVP

```
generate_image
  params:
    model: gpt_image_2
    aspect_ratio: "1:1"
    quality: "high"
    resolution: "1k"
    count: 1
    prompt: <filled prompt>
```

Capture `mvp_job_id` per concept.

**Polling cadence (silent unless slow):**

1. First check at **t+60s**.
2. Then every **30s**.
3. At **t+180s**, emit `⚠️ MVP still rendering after 180s — continuing.`
4. Hard cap **t+5min** — mark failed, proceed if possible.

---

## Phase 3 — create Figma frames

Grid: **one row per concept, one column per size**. Idempotent placement.

```js
const sizes = [/* injected from Phase 0.4 or input */];
const conceptLabels = [/* injected — one short label per Title */];
const sizeGap = 100;
const rowGap = 200;
const runStamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

let runY = 0;
for (const node of figma.currentPage.children) {
  if (node.name && node.name.startsWith("Banner") && "y" in node && "height" in node) {
    runY = Math.max(runY, node.y + node.height + 200);
  }
}

const result = { runStamp, frames: [] };
const maxH = Math.max(...sizes.map(([, h]) => h));

for (let i = 0; i < conceptLabels.length; i++) {
  const concept = conceptLabels[i];
  let x = 0;
  const rowY = runY + i * (maxH + rowGap);
  const conceptFrames = [];
  for (const [w, h] of sizes) {
    const f = figma.createFrame();
    f.name = `Banner — ${concept} — ${w}x${h} — ${runStamp}`;
    f.resize(w, h);
    f.x = x; f.y = rowY;
    f.fills = [];
    f.clipsContent = true;
    f.cornerRadius = 0;
    figma.currentPage.appendChild(f);
    conceptFrames.push({ size: `${w}x${h}`, id: f.id });
    x += w + sizeGap;
  }
  result.frames.push({ concept, rows: conceptFrames });
}
return result;
```

---

## Phase 4 — paint MVP into 1:1 frame

Three parallel turns:

1. `curl -sL -o /tmp/banner/mvp.png "<rawUrl>"`
2. `upload_assets(fileKey, nodeId=<mvp_frame_id>, scaleMode=FILL, count=1)`
3. `curl -sS -X POST -H "Content-Type: image/png" --data-binary @/tmp/banner/mvp.png "<submitUrl>"`

**If Phase 4 fails due to egress block:** record `paint_failed` in problem-list; surface `⚠️ Paint blocked — MVP available at <rawUrl>. Drag into the 1200×1200 frame manually.` Skip to Phase 8.

---

## Phase 5 — 🛑 designer review pause

**Single concept:**

```
AskUserQuestion {
  question: "Banner ready in Figma. What next?",
  header: "Next",
  multiSelect: false,
  options: [
    { label: "Looks good",    description: "Make the other sizes." },
    { label: "Redo it",       description: "Re-render with fresh subject specifics." },
    { label: "Stop here",     description: "Keep 1200×1200 only. Skip other sizes." }
  ]
}
```

**Multiple concepts** — dynamically build options. Example with 2 concepts:

```
AskUserQuestion {
  question: "Both MVPs painted at 1200×1200 in Figma. What next?",
  header: "Next",
  multiSelect: false,
  options: [
    { label: "All look good",         description: "Make recomps for every concept." },
    { label: "Redo C1 (<label>)",     description: "Re-render only concept 1." },
    { label: "Redo C2 (<label>)",     description: "Re-render only concept 2." },
    { label: "Stop here",             description: "Keep 1200×1200 only. Delete empty non-1:1 frames." }
  ]
}
```

For 3+ concepts, cap options at 4 (collapse extras into "Redo any" → followup poll). Keep one CTA action and at least one "Stop here" option.

**On "Redo it" / "Redo Cn":** re-compose with varied specifics — different archetype / different prop / different bridge / different palette mood — regenerate at 1200×1200, overwrite the frame fill, return to Phase 5.

**On "Stop here":** delete the empty non-1:1 frames, skip to Phase 8.

---

## Phase 6 — recompose to non-1:1 sizes

For each non-1:1 size (and for every approved concept), compose a recomp prompt using **§ Recomposition Prompt Template** (≤ 1,800 chars). Pass that concept's `mvp_job_id` as `medias[].role: "image"`.

**Recomp is layout REDESIGN per format, not resize.** Apply per-aspect layout rules from § Design Framework.

**Aspect map:**

| Size | Frame aspect | Render aspect | Per-aspect layout | Notes |
|---|---|---|---|---|
| any 1:1 | 1.000 | 1.000 | SQUARE | reuse MVP |
| 1200×628 | 1.911 | 1.778 (16:9) | WIDE | vertical-axis crop ~7% |
| 960×1200 | 0.800 | 0.750 (3:4) | PORTRAIT | horizontal-axis crop ~6% |
| 1080×1350 | 0.800 | 0.750 (3:4) | PORTRAIT | horizontal-axis crop ~6% |
| 1200×960 | 1.250 | 1.333 (4:3) | MILD WIDE | vertical-axis crop ~6% |
| 1080×1920 | 0.5625 | 0.5625 (9:16) | TALL | exact aspect, no crop |
| 1920×1080 | 1.778 | 1.778 (16:9) | LANDSCAPE | exact aspect, no crop |
| 300×250 | 1.200 | 1.333 (4:3) | MILD WIDE | vertical-axis crop ~10% — heavy |
| 728×90 | 8.089 | 1.778 (16:9) | EXTREME WIDE | horizontal-axis crop ~78% — VERY heavy. Suggest manual design instead. |
| 300×600 | 0.500 | 0.5625 (9:16) | TALL | horizontal-axis crop ~11% — heavy |

**Safe-area axis derivation — REQUIRED fill-math computation.**

When the render is placed into the frame with `scaleMode=FILL`, the image scales to fully cover the frame on the constraining axis and crops the other axis:

- If `frame_aspect > render_aspect` (frame is wider/squatter than render): image scales to match WIDTH → crops **TOP + BOTTOM (vertical axis)**.
- If `frame_aspect < render_aspect` (frame is narrower/taller than render): image scales to match HEIGHT → crops **LEFT + RIGHT (horizontal axis)**.

Compute `crop_pct = |frame_aspect − render_aspect| / max(frame_aspect, render_aspect)`. If `crop_pct > 5%`, emit:

```
Leave 8% safe area on <vertical | horizontal> axis — frame will crop ~{crop_pct}% off those edges. Keep all critical subject features, manifest props, title, and button at least 8% inset from the cropping edges.
```

For `crop_pct > 25%` (e.g. 728×90 leaderboard), surface in Phase 8 problem-list: `⚠️ <size> has ~<crop>% crop — image-based recomp is unreliable at this aspect. Consider manual HTML5 banner design instead.`

**Master prop manifest** from Phase 1.0 Step 9 is passed verbatim into the recomp prompt: every prop named in master MUST remain visible.

Fire all recomps in parallel. Polling cadence same as Phase 2.

---

## Phase 6.5 — silent visual QA

After all recomps render but **before** painting, Claude reads each recomp PNG and scores composition fidelity:

| Check | What to verify | If FAIL |
|---|---|---|
| **No hard split-panel layout** | Background is one continuous scene, not flat-panel-next-to-image | auto-retry (critical) |
| **Line structure** | Visual rows match master's pinned visual rows | flag in problem-list |
| **Prop manifest** | Every named prop from Phase 1.0 Step 9 visible | flag in problem-list |
| **Edge clipping** | No subject / button / title clipped at any edge | auto-retry (critical) |
| **Alignment per-aspect** | TALL/PORTRAIT = center, WIDE/LANDSCAPE = match master, SQUARE = match master | flag in problem-list |
| **Highlight treatment** | Highlight phrase has correct color + weight + underline + size | flag in problem-list |
| **Integrated copy zone** | Title sits in a naturally calm zone (blur/vignette/gradient), NOT on a hard rectangle | flag in problem-list |
| **Title block height** | Title block fills ~22% of canvas height (within ±5pp) | flag in problem-list |
| **CTA tier** | Button hex ≠ highlight hex (Tier 1 ≠ Tier 2) | flag in problem-list |
| **Readable text guard** | Only Title + CTA are readable text — no invented labels, no readable chart data, no fake UI strings | flag in problem-list |

**Critical failures (edge clipping, hard split panel, missing manifest props, wrong alignment) trigger ONE auto-retry** with a corrective prompt that names the specific failure. Cap auto-retries at 1 per concept × size.

---

## Phase 7 — paint recomps

Same three-turn parallel pattern as Phase 4.

---

## Phase 8 — summary + problem list

**Success case (short):**

```
✅ /banner done — N sizes painted into Figma. Run: <runStamp>
   <figma file URL>
```

**With encountered problems (short, separate block):**

```
⚠️ Problems during this run (for the team to upgrade /banner):
  - <problem 1>
  - <problem 2>
```

---

# § Visual Prompt Template (v2.5 — 7-section advertising composition)

900–1,200 chars preferred, hard ≤1,400. Compact, visual, production-oriented. Describes an AD COMPOSITION, not a long system explanation. The image model is GPT Image 2 — it needs visual specifics, not project rules.

```
{W}×{H} premium localized performance-ad banner for {LANGUAGE}/{MARKET}. Mood: {register}. Concept: {one-sentence campaign idea tied to the Title and LP purpose}.

Hero: {specific subject/object/environment from chosen archetype}, {native/local details}, {pose/expression/materials}, cinematic editorial realism.

Background: ONE continuous full-canvas scene — NOT a hard split layout. Layered foreground/midground/background depth, soft atmospheric blur, premium {palette} color wash, subtle {regional/campaign} accents, and a calm low-contrast copy zone on the {side/top/bottom} created naturally with light falloff / vignette / blur — NOT a flat rectangle. Visual bridge between hero and copy zone: {light streak / curved gradient / ornament / shadow / architecture line / color flow}.

Layout: large bold campaign title in the clean zone, strong line breaks. Title visual rows (EXACT — pinned for recomps):
"<row 1>"
"<row 2>"
["<row 3>" if needed]
Highlight "<phrase>": {treatment from register table + collision-fallback if active — color #{Tier 1 hex} weight 900 + 3px underline + 1.10–1.15× size in {Stacked / Inline} mode}.
CTA "<CTA verbatim>" as polished {pill / rectangular} button, height = clamp(canvas_h × 0.08, 80, 160) px, fill #{Tier 2 hex DIFFERENT from Tier 1}, text in #{Tier 3 hex}, position {below title / bottom-right / bottom-center per aspect}.

Style: premium editorial lighting, warm highlights, rich shadows, tasteful gradient overlays, subtle decorative accents, art-directed paid-ad finish.

Palette: dominant {hex1}, accent {hex2}. Real scene with depth, not flat gradient.

Readable text only: "<full Title>" and "<full CTA>". No logos, no invented text, no fake UI labels, no chart numbers, no watermarks, no "Ad"/"Sponsored" tags, NO HARD SPLIT-PANEL LAYOUT.
[If subject includes screens/charts/UI: "Any screen/chart/UI must be abstract or blurred with no readable invented text/numbers/tickers/recommendations."]
[If non-English: "Native to {market}, no Western defaults. Premium campaign style, not tourist-poster cliché."]
[If RTL: "Subject LEFT, title RIGHT-aligned, button bottom-LEFT, mirrored composition."]
[Market exclusions: <from § Localization — e.g. "no Wall Street bull, no NYSE/NASDAQ ticker, no US flag motifs">.]
```

---

# § Recomposition Prompt Template

≤ 1,800 chars. The MVP image is provided as `medias[].role: "image"`. Title visual rows from the master are passed verbatim — recomps MUST NOT re-flow them.

Recomp is **layout REDESIGN per format**, not resize. Same concept, new spatial structure. Background stays a continuous scene — no hard split panel.

```
RECOMPOSE the attached master (1200×1200) into {W}×{H}. Master = source of truth. Same subject, same text, same colors, same typography, same button. Not a stretch, not a crop, not a fresh generation. LAYOUT IS REDESIGNED for this aspect — never split-panel.

NEW LAYOUT (<WIDE | TALL | LANDSCAPE | PORTRAIT | MILD-WIDE | EXTREME-WIDE>) — apply § Per-Aspect Layout Rules:
- <Insert per-aspect placement recipe — e.g. for WIDE: "Title + CTA on left 40–45%, main visual right 55–60%, no tall stacked text">.

CONTINUOUS BACKGROUND: One full-canvas cinematic scene with the SAME palette + mood as master. Layered foreground/midground/background depth, soft atmospheric blur, light falloff, vignette. Copy zone is naturally created by lighting/depth, NOT a hard rectangle. Visual bridge connects hero and copy zone.

ZONES:
- Text Zone: <new position for this aspect>. Integrated into scene, not a panel.
- Main Visual Zone: <new position>. Subject fully inside frame, NOT clipped.
- CTA Zone: <new position>. Below title or bottom-center per aspect rule.

SUBJECT: <repositioning + framing rule>. Same wardrobe, expression, lighting as master.
[If TALL or PORTRAIT: subject occupies 45–55% of canvas height — do NOT shrink below this floor.]
Product proof if MVP had one (phone/laptop/watch/monitor/chip): MUST remain visible and legible, fully inside the new canvas.

MASTER PROP MANIFEST: every prop from the master MUST be visible in this recomp, repositioned, not removed. Manifest: <inject the prop list, e.g. "walnut desk, brass lamp, ceramic cup, notebook stack">.

TITLE alignment: <derived rule — WIDE/LANDSCAPE keeps master horizontal; TALL/PORTRAIT center-aligns; SQUARE matches master>.
TITLE (verbatim, EXACT visual rows from master — do NOT re-flow):
  R1: "<master row 1>"
  R2: "<master row 2>"
  [R3: "<master row 3>" if present]
Highlight phrase "<phrase>" keeps full treatment (color + weight + underline + size — same multiplier as master).

TITLE block height: ~{title_block_h}px ({title_block_h / new_canvas_h * 100:.0f}% of new canvas).

BUTTON if present: <new position>. height = clamp(new_canvas_h × 0.08, 80, 160) px. Same Tier 2 color (NOT same as Tier 1 highlight hex), same shape.

SAFE AREA: [if crop_pct > 5%: "Leave 8% safe area on <vertical | horizontal — DERIVED FROM FILL MATH> axis — frame will crop ~{crop_pct}%. Keep subject, manifest props, title, and button at least 8% inset from the cropping edges."].

CONSTRAINTS: exactly {W}×{H} px. No new content. No watermarks, AI marks, mockup chrome. NO HARD SPLIT-PANEL LAYOUT. Any screen/chart/UI must be blurred/abstract with no readable invented text. [If RTL: keep mirrored direction.]
```

---

# § Design Framework (Claude only)

Never sent to the model. The principles Claude reasons from when composing Phase 1.

### Six decision principles

For each banner, decide on the spot:

**1. Subject** = chosen archetype + LANGUAGE + LP demographic. Specific. Authentic. Fresh per task.

**2. Scene** = real place + 2–4 named props (prop manifest) that fit the title's narrative. Bias toward LP setting.

**3. Lighting** = register mood. Aspirational → warm/golden. Urgent → harder side / neon edge. Provocation → dramatic low-key. Trust → soft studio. Curiosity → soft directional + slight haze. Empowerment → cinematic mid-key. Identity → warm regional.

**4. Background depth** = scene-driven with atmospheric layering. **Readability rule:** every prompt declares an integrated copy zone (NOT a hard rectangle), created by blur / shadow / vignette / low-detail backdrop. Flat 2-stop gradient is banned. Hard split-panel layouts are banned.

**5. Palette** = 2 hex (dominant + accent). LP-continuity bias if Phase 0.3 succeeded. ≥ 4.5:1 contrast for the button pair. Tier 1 ≠ Tier 2.

**6. Button (CTA).** If picked: Tier 2 hex, pill (warm) or rect (institutional), **height = clamp(canvas_h × 0.08, 80, 160) px**, text 60–80% width, no wrap/clip.

### § Creative Archetypes (v2.5 — pick ONE per concept)

Pick fresh per task. Do not default to the same archetype across runs. Driven by title content + LP purpose + market.

#### A. Local Hero Campaign
Native subject + local background + large campaign title. Best for country/language-specific identity hooks (e.g. "O Brasil…", "للعرب…", "Sverige…").

#### B. Premium Offer Poster
Huge offer or key phrase dominates the design, supported by ornament + CTA. Best for bonuses, percentages, promos, strong claims (e.g. "+171%", "100% bonus", "FREE").

#### C. Editorial Lifestyle Ad
Believable person in a premium everyday setting, clean copy area. Best for education, investing, personal finance, lifestyle apps. NOT corporate-stock smile — natural campaign realism.

#### D. Cultural Prestige Layout
Local architecture or regional visual identity frames the message. Best for Thailand, Brazil, Arabic, LATAM, Japan, Nordic and similar localized campaigns.

#### E. Minimal Premium Typographic Ad
The text carries the ad with subtle scene depth and premium color. Best when the title is already very strong on its own.

### § Background Design Rules (v2.5 — INTEGRATED SCENE, NEVER SPLIT-PANEL)

**The biggest visual fix in v2.5.** The background must be one integrated advertising scene, not "dark rectangle with text + separate photo."

**Use:**

- ✅ Full-scene background across the whole canvas
- ✅ Layered depth: foreground / midground / background
- ✅ Cinematic lighting connecting visual + copy area
- ✅ Subtle gradients, vignettes, shadows, atmospheric blur
- ✅ Premium color wash across the entire banner
- ✅ Soft overlays behind text (not hard rectangles)
- ✅ Visual elements that slightly overlap between subject zone and copy zone
- ✅ Decorative accents guiding eye toward headline + CTA
- ✅ Clean low-contrast readability area created naturally through lighting / depth / blur

**Avoid:**

- ❌ Hard vertical split (unless explicitly requested)
- ❌ Flat dark copy box
- ❌ Empty gradient background
- ❌ Obvious template panel
- ❌ Isolated stock image pasted beside text
- ❌ Subject floating separately from the text
- ❌ Copy area disconnected from the visual
- ❌ Boring two-column layout with no depth

**Good background logic:**
> One continuous cinematic scene with a calmer low-detail area for text, connected by lighting, color, shadows, and subtle decorative elements.

**Bad background logic:**
> Dark rectangle on left, unrelated image on right.

### § Integrated Copy Zone Rule (v2.5)

The title area must be readable, but it should not look like a pasted block.

**Prefer:**

- soft dark-to-transparent gradient behind text
- blurred environmental depth behind text
- subtle glass / premium overlay
- controlled vignette
- shadow falloff
- atmospheric haze
- low-detail architecture / sky / interior wall
- decorative motif at low opacity
- diagonal light separation
- color wash that connects both sides

The user should feel that the copy is **part of the scene**, not added after the image.

### § Background Depth Formula (v2.5)

Every prompt must declare all 5 layers:

1. **Foreground element** — subject, object, hand, device, product, person, decorative shape
2. **Midground environment** — desk, street, skyline, interior, local architecture, lifestyle setting, abstract campaign scene
3. **Background atmosphere** — soft blur, skyline, gradient light, cultural pattern, glow, depth, haze, cinematic falloff
4. **Readability zone** — calm area where title + CTA sit, created by blur / shadow / vignette / low-detail background
5. **Visual bridge** — element connecting subject and copy area (light streak, curved gradient, ornament, shadow, architectural line, color flow)

If a prompt cannot answer all 5, it's incomplete — revise before sending to GPT Image 2.

### § Campaign-meaning → visual logic catalog

Seed for ideation when picking the visual world. Don't reuse one row across runs.

| Campaign Meaning | Better Visual Logic |
|---|---|
| **AI / technology** | Digital systems, data depth, futuristic product metaphor, chip macros, neural-net wireframes — ONLY when copy is about AI itself. |
| **Investing / trading** | Market movement, financial confidence, charts only if directly relevant, analyst desks, terminal closeups, money-element typography. |
| **Education** | Learning path metaphor, mentor/student framing, structured progress, calm trust, books, notebooks, classroom light, certificate close-ups. |
| **Luxury** | Minimal objects, premium materials (marble, brass, leather), elegant lighting, single hero product, generous negative space. |
| **Local market identity** | Native people, subtle cultural context, regional setting, regional architecture in soft focus. |
| **Urgency** | High contrast, compressed energy, sharper composition, motion blur, countdown elements. |
| **Trust** | Clean studio, institutional clarity, grounded realism, soft daylight, professional but not corporate-stock. |
| **Lifestyle** | Real people, aspirational but believable environment, candid posture. |
| **SaaS / app** | Interface-inspired layout, clean UI geometry, product-space, device-in-hand, app screen as hero (BLURRED — no readable invented UI text). |
| **Problem / solution** | Visual contrast, before/after metaphor, simplified story, two-state composition. |

### § Three-Zone Composition

Every banner is composed of three intentional zones, planned in Phase 1.0:

**1. Text Zone** — clean, high-contrast, integrated into scene (NOT a hard panel). ≥ 8% inset.

**2. Main Visual Zone** — hero subject from chosen archetype. Atmospheric depth. Leaves room for title and CTA.

**3. CTA Zone** — clear, clickable, separated from title (12–24px gap) but visually connected. Tier 2 hex. No icon inside button unless requested. No wrap/clip. ≥ 8% padding from edges.

### § Per-Aspect Layout Rules

Adapt the same CONCEPT across formats. Each format gets its own redesigned layout. **Background remains one continuous scene in every format.**

#### SQUARE — 1:1 (1200×1200)
MVP master. Strongest overall balance.

```
┌────────────────────────────────┐
│ [Title area]   [Main visual]   │
│                                │
│ [CTA area]     [Supporting     │
│                 depth]         │
└────────────────────────────────┘
```

- Title: upper-left or center-left
- Main visual: right side or background-right
- CTA: bottom-left, below title
- ≥ 8–10% inset from edges

#### WIDE — 1.91:1 (1200×628)
Facebook, LinkedIn, Google Display. Limited height → short title, horizontally efficient.

```
┌──────────────────────────────────────┐
│ [Title + CTA]      [Main visual]     │
└──────────────────────────────────────┘
```

- Title left 40–45%, CTA directly below
- Main visual right 55–60%
- No tall stacked text
- Key content NOT at extreme edges

#### LANDSCAPE — 16:9 (1920×1080)
Website hero, YouTube, large display. Cinematic, not poster.

```
┌──────────────────────────────────────────────┐
│ [Title + CTA]         [Large cinematic visual]│
└──────────────────────────────────────────────┘
```

- Title left third or left 40%
- CTA below title
- Main visual right side
- Background extends full canvas

#### PORTRAIT — 3:4 (960×1200 / 1080×1350)
Mobile feed, premium vertical. Editorial ad feel.

```
┌──────────────────┐
│ [Title]          │
│ [Main visual]    │
│ [CTA]            │
└──────────────────┘
```

- Title upper-left or top-center
- Main visual center / middle 50%+
- CTA bottom-left or bottom-center
- Text inside middle 80–85% width

#### TALL — 9:16 (1080×1920)
Stories, reels, TikTok. Mobile-first. **Subject occupies 45–55% of canvas height — never less.**

```
┌────────────┐
│ [Title]    │
│ [Main      │
│  visual]   │
│ [CTA]      │
└────────────┘
```

- Title top 20–30%
- Main visual center 45–55%
- CTA bottom-center, ≥ 8–12% padding from bottom
- Title and CTA away from platform UI zones (top 8%, bottom 12%)
- Fewer words, stronger line breaks

#### DISPLAY (300×250 / 728×90 / 300×600)
Heavy crop when recomposing from 1:1 master. Phase 6.5 will flag if the result is unusable. For 728×90 leaderboard the result is rarely good — surface in problem-list and suggest manual HTML5 banner.

### § Banner Quality Standard

Each banner should feel:
- ✅ professionally designed
- ✅ readable at small sizes
- ✅ visually intentional (every element earns its place)
- ✅ conversion-focused
- ✅ adapted to the market
- ✅ adapted to the message
- ✅ clean enough for copy + CTA to breathe
- ✅ premium, not cheap or overloaded
- ✅ **art-directed, not merely realistic**
- ✅ feels like a finished paid ad from a serious regional campaign

### § Anti-patterns (NEVER)

- ❌ generic stock-photo business people
- ❌ random people on laptops
- ❌ forced AI visuals when copy isn't about AI
- ❌ finance-desk default when copy isn't finance
- ❌ trading-floor default
- ❌ person-with-phone default
- ❌ fake logos
- ❌ fake platform screenshots / fake UI labels
- ❌ readable invented chart data, ticker rows, recommendations, dates
- ❌ too many charts (>1 chart usually wrong)
- ❌ too many icons
- ❌ excessive glow / lens flare
- ❌ cluttered backgrounds
- ❌ decorative text effects (chrome, embossed, drop shadows, outlines, distortion)
- ❌ low-quality template aesthetics
- ❌ **HARD SPLIT-PANEL LAYOUT** (dark rectangle pasted next to photo)
- ❌ **flat dark copy box** behind text
- ❌ **isolated subject** disconnected from copy zone
- ❌ background that fights the title for attention
- ❌ Western defaults on non-English banners
- ❌ tourist-poster cliché on localized campaigns

**The visual must support the title. It should never fight against the title.**

### Highlight phrase treatment

The user picks which part of the title pops (Poll 1 in Customize mode, or Claude infers in Auto). Default treatment by register:

- **Aspiration / Identity / Empowerment** → gold-gradient (#D4A017 → #F5C842) on letterforms + 3px gold underline. Weight 900.
- **Urgency** → solid saturated red (#E54B2C). Weight 900. Size escalation carries it.
- **Provocation** → accent color + 2px outline box at 60% opacity around the words. Slightly off-axis (1–2°).
- **Trust** → brand color. Weight 900. No ornament.
- **Curiosity** → bold accent + 2px underline at 80% opacity.

**Color-collision fallback (REQUIRED).** If chosen highlight color collides with LP palette (gold-on-gold, neon-green-on-neon-green), force secondary vectors:

- Weight bump: 900 vs 700 base
- 3px underline
- Size escalation: 1.10–1.15× base (only in Stacked mode)
- Keep LP-native color — differentiate via type treatment

**Inline vs Stacked mode (v2.4 — formula-based).** `(highlight_chars × base_size × 1.12) / column_width`:
- **> 0.40 → Inline.** Drop size escalation. Color + weight + underline carry it.
- **≤ 0.40 → Stacked.** Highlight on its own visual row at 1.12× size, surrounding words on next row at base size.

### CTA Color Tier rule

- **Tier 1 (Highlight)** = LP accent OR register default.
- **Tier 2 (CTA)** = if Tier 1 = LP accent (collision-fallback active), Tier 2 = darker shade at ~70% L of Tier 1 OR sampled from LP's CTA button color. **Tier 1 ≠ Tier 2 in hex.**
- **Tier 3 (Body text)** = white on dark, near-black on light.

### Register cues (classification only)

| Register | Copy cues |
|---|---|
| Aspiration | buy / invest / earn / ganar / comprando / 100% / bonus / stocks / crypto |
| Urgency | now / agora / today / last / ends / limited |
| Provocation | "they don't want," "school taught you," "wake up" |
| Trust | official / trusted / regulated / certified / since X |
| Curiosity | "Did you know," "What if," question-led |
| Empowerment | take control / unlock / master / your way |
| Identity | O Brasil / México / Tu país / Nosotros / للعرب |

Pick the first register whose cues appear left-to-right. Identity layers on top. Default `curiosity`.

### Localization

- Match subject features, wardrobe, setting to the actual market — never Western defaults on non-English banners.
- Apply color meaning to market: red = loss in Western finance / luck in CN; green positive Western / political MENA; white premium West / mourning EA; gold premium Gulf + EA + LATAM.
- Avoid offensive gestures (thumbs-up in MENA/W.Africa, OK sign in Brazil/Turkey/MENA, index-finger pointing in Asia/MENA, prominent left-hand display in MENA/S.Asia).

**Market exclusion lists (do-not-invent props/symbols outside their home market):**

- **Outside the US:** no Wall Street charging-bull statue, no NYSE / NASDAQ bell or logo, no S&P 500 ticker, no Statue of Liberty, no US flag patterns, no American-trader-floor decor.
- **Outside the UK:** no Big Ben, Tower Bridge, Union Jack motifs.
- **Outside Japan:** no Mt. Fuji, Tokyo Tower, sakura — unless they're the focal subject.
- **Non-target EU markets:** no country-flag colors unless the title explicitly names the country.

**Market prop allowlists (bias toward when local cues = Subtle/Strong):**

- **Nordic:** walnut/oak desk, brass desk lamp, ceramic cup, papered notebook, minimalist interior, soft Scandinavian daylight.
- **DACH:** dark wood + leather, brushed steel, neutral palette, engineering precision.
- **LATAM:** warm terracotta, plants, daylight, natural textures.
- **MENA Gulf:** marble + gold accents, soft indoor light, premium retail aesthetic.
- **East Asia (urban):** dense city neon, glass towers, sleek tech surfaces.

**On-screen data labels (when subject is a terminal / dashboard / app UI — ALWAYS blurred or abstract, never readable invented data):**

| Market | Native bank/data labels (for subtle reference only — blurred) |
|---|---|
| Nordic | SEB, Nordea, Handelsbanken, DNB Markets, Carnegie, Swedbank, Danske Bank |
| DACH | Deutsche Bank, Commerzbank, UBS, Credit Suisse, Raiffeisen, KfW |
| LATAM | Banco Itaú, Bradesco, BBVA, Santander Mex, Banco do Brasil |
| MENA Gulf | Emirates NBD, QNB, NCB, Riyad Bank, Al Rajhi |
| JP | Mitsubishi UFJ, Mizuho, Sumitomo Mitsui, Nomura, Daiwa |
| US | JPMorgan, Goldman Sachs, Morgan Stanley, BofA, Citi |

**Important v2.5 rule:** screens, charts, and UI must be **blurred or abstract** — no readable invented numbers, tickers, recommendations, dates, UI menu labels, or fake proof. Only the provided Title and CTA may be readable text on the banner.

### RTL composition

RTL languages: Arabic (all dialects), Hebrew, Urdu, Farsi, Pashto, Sindhi, Kurdish (Sorani).

- Mirror layout. Subject LEFT, title stacked right-aligned on RIGHT. Button bottom-LEFT.
- Native typeface (NEVER Latin + RTL fallback). Arabic: Tajawal or Cairo. Hebrew: Heebo or Rubik. Urdu/Farsi: Vazirmatn or Noto Naskh Arabic.
- Slightly looser leading than Latin. Never condense. No kashida-stretching.

### Typography

- LTR headline: Inter (default), Söhne, or Helvetica Now.
- Max 2 typefaces per banner. Weights 700–900. No drop shadows on text. No outlining / distortion.

### Hard guardrails (non-negotiable)

- **Copy verbatim.** Title and CTA pass unchanged.
- No invented brands, logos, badges.
- No fake mockup chrome (browser bars, mockup phone frames AROUND the banner, "Sponsored"/"Ad" labels). Phone HELD BY subject in scene is allowed.
- No text inside subject (no words on shirts/signs).
- No watermarks, AI marks.
- No duplicated/mirrored text.
- No mirrored Arabic/Hebrew letterforms.
- No Latin fonts forced onto RTL copy.
- No cross-region cultural mismatches.
- No offensive gestures.
- No mixed visual styles within one banner.
- **No reuse of default themes** (AI chip / fintech chart / trading floor / person-with-phone) unless the brief clearly calls for them.
- **No background fighting the title.** Readability zone wins.
- **No hard split-panel layout.** Continuous integrated scene only.
- **No readable invented text** in screens/charts/UI/documents.

---

## Final Guardrail (v2.5)

Before sending the final prompt to GPT Image 2, Claude must internally answer:

> What is the continuous scene?
> Where is the clean copy zone, and how is it integrated into the background?
> What is the hero subject?
> What visual bridge connects subject and text?
> Why does this feel native to the market?
> Why does this look like a premium paid ad, not a flat template?
> Which of the 5 archetypes is this, and why?
> Does the prompt explicitly forbid hard split-panel layout?
> Does the prompt explicitly forbid readable invented text?

If any answer is missing or weak, revise the prompt before sending.

The final output must always feel like a real paid banner designed for a specific campaign — never a template, never a split panel, never a generic AI image.

---

## Constraints

- Visual Prompt 900–1,200 chars preferred, ≤1,400 hard.
- Recomp Prompt ≤1,800.
- GPT Image 2 only. `gpt_image_2`. Never substitute.
- Resolution always `1k`.
- MVP always 1200×1200 (1:1).
- MVP is the source of truth for recomps via `medias[].role: "image"`.
- Verbatim Title + CTA.
- **Phase 0.4 size selection BLOCKING** (unless sizes in input).
- **Phase 0.45 creative mode BLOCKING** (Customize vs Auto).
- **Phase 0.5 polls run ONLY in Customize mode.**
- **Phase 1.0 visual reasoning required** — fresh metaphor per task.
- **Pick ONE of 5 creative archetypes per concept** — no archetype default.
- **Three-zone composition** planned before render.
- **Background = continuous integrated scene with 5-layer depth formula** — NEVER hard split-panel.
- **Integrated copy zone** via blur/vignette/gradient — NEVER hard rectangle behind text.
- **Per-aspect layout** = redesign per format, not resize.
- **Title visual rows pinned across recomps.**
- **Title block height = clamp(canvas_h × 0.22, 180, 480) px.**
- **Alignment per-aspect:** TALL/PORTRAIT → center; WIDE/LANDSCAPE → match master.
- **Subject vertical fill in TALL/PORTRAIT:** 45–55% of canvas height minimum.
- **CTA height = clamp(canvas_h × 0.08, 80, 160) px** — ratio of canvas.
- **CTA color tier rule:** Tier 1 (highlight) ≠ Tier 2 (CTA) in hex.
- **Highlight structure mode:** Inline vs Stacked from formula.
- **Highlight color-collision fallback** required.
- **Master prop manifest** carried into every recomp.
- **Market exclusion lists** applied before composing the prompt.
- **On-screen data BLURRED/ABSTRACT only** — no readable invented data.
- **Readability zone:** zero hard edges / structural lines crossing the title or button overlay.
- **Safe-area axis derived from fill math.**
- **Multi-concept supported:** multiple `Title:` lines → parallel concepts.
- **Landmarks named in prompt** require do-not-invent clause.
- **Phase 6.5 silent visual QA** before painting recomps — includes hard-split-panel check.
- Exact pixel sizes.
- Figma is read+write.
- Egress allowlist required: `d8j0ntlcm91z4.cloudfront.net` + `mcp.figma.com`.
- No autonomous commits.
