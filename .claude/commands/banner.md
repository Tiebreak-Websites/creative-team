---
description: Render banner concepts with Higgsfield GPT Image 2 and paint them into a Figma file. Reasons about visual concept fresh per run — performance-ad designer, not template engine. Strict input. Minimal questions. Silent execution. Multi-concept ready. The user provides one-or-more Title lines + a Figma URL with the hero node pre-selected.
---

# /banner — Designer flow (Higgsfield GPT Image 2 → Figma) v2.4

## What changed in v2.4 (from v2.3)

v2.4 shifts /banner from "competent template engine" to "performance-ad designer." Every banner is reasoned-from-scratch using the actual title + CTA + LP + market + register — no reflexive theming. Plus three concrete fixes from the v2.3 SWE/NVIDIA review.

**Visual intelligence overhaul:**

- **Visual reasoning step (NEW Phase 1.0).** Before composing any prompt, Claude reasons: *what is this ad selling, what emotion should it create, what visual metaphor best supports the copy?* AI/finance/trading visuals are used ONLY when the title, LP context, and visual direction clearly call for them. No theme reuse across runs.
- **Campaign-meaning → visual logic catalog.** Reference catalog mapping meaning archetypes (AI/tech, investing, education, luxury, lifestyle, urgency, trust, SaaS, problem/solution, local-identity) to characteristic visual logics. Used to seed Poll 3 directions, not to dictate them.
- **Three-zone composition planning.** Every prompt is composed of an explicit Text Zone, Main Visual Zone, and CTA Zone — planned before render. Zones go into the prompt as advertising layout, not "describe a scene."
- **Per-aspect layout rules (explicit).** Each aspect ratio (1:1, 1.91:1, 16:9, 3:4, 9:16) has a placement recipe. Recomp is layout redesign per format, never resize.
- **Banner quality standard + anti-patterns.** Hard guardrails against generic stock-photo people, random people-on-laptops, fake logos, fake platform screenshots, excessive glow, decorative text effects, template aesthetics.
- **On-screen data localization.** When subject is a data product (terminal / dashboard / app UI), populate with market-native data labels (SEB, Nordea, Handelsbanken for Nordic; etc.) instead of US/Western defaults.

**P1 fixes from v2.3 visual review:**

- **Stacked vs inline highlight mode.** Size-escalation on the highlight word can push a logical line past column width, forcing a wrap. v2.4 formalizes: compute `(highlight_chars × base_size × 1.12) / column_width`. If > 0.40 → **Inline** (drop size escalation; weight + underline + color carry it). Otherwise → **Stacked** (highlight on its own visual row at 1.12×, rest of logical line below). Recomps pin the visual rows, not the logical lines.
- **CTA color tier rule.** When highlight color = LP accent (collision-fallback active), CTA must use a SECONDARY tier — darker shade at ~70% L of Tier 1, OR sampled from LP's actual CTA button. Highlight + CTA never share the same hex.
- **Title block height as ratio of canvas.** `title_block_h = clamp(canvas_h × 0.22, 180, 480) px`. Forces visual consistency across the campaign set.

**P2 additions:**

- **Phase 6.5: silent recomp visual QA.** After all recomps render but before painting, Claude reads each recomp PNG and scores: line structure matches master, all manifest props present, no edge clipping, alignment per-aspect honored, highlight treatment carried. Failures land in Phase 8 problem-list; auto-retry once on critical fails.
- **Master prop manifest enforced in recomps.** Every prop named in the master prompt becomes a checklist for recomps. Missing notebooks / lamps / etc. flagged in QA.
- **Subject vertical fill rule for TALL.** 9:16 / 3:4 subject occupies 45–55% of canvas height (not less). Title 22–28% top, button 8–12% bottom.

## Architecture

| Layer | Audience | What it is | Length |
|---|---|---|---|
| **§ Design Framework** | Claude only | Principle-driven design system — adaptive decisions, hard guardrails, references | No cap |
| **§ Visual Prompt** | GPT Image 2 | A scene-level brief composed fresh. Names subject, scene, zones, copy verbatim, highlight phrase, CTA verbatim, palette mood. | **~600 chars soft, ≤900 hard** |
| **§ Recomposition Prompt** | GPT Image 2 | Layout redesign per format — same concept, new spatial structure. | **≤1,800 chars** |

Workflow:

1. **Parse + pre-flight.** Validate Figma URL has `node-id`, parse Title(s) + CTA, run egress + MCP connectivity checks. Fail-fast on missing required input.
2. **LP hero read.** Direct `get_screenshot` call on the user-provided node-id. Retry-on-session-expired.
3. **Polls (minimal, per concept).** Up to 4 short clickable polls per concept. Shared polls (local cues) ask once across concepts.
4. **Phase 1.0 — Visual reasoning (silent).** Per concept: understand the ad → pick metaphor → plan three zones → select per-aspect layout → decide highlight mode + CTA tier + title height target.
5. **Phase 1 + 2 — MVP pass.** Compose prompt → render 1 master at 1200×1200 per concept (parallel).
6. **Phase 3 + 4 — Figma frames + MVP paint.** Create frame grid → paint each master into its 1:1 frame.
7. **Phase 5 — 🛑 Designer review pause.** Per-concept Redo / Continue / Stop.
8. **Phase 6 — Recomp pass.** Recompose every approved master to each non-1:1 size in parallel — **layout redesign per format**, not resize.
9. **Phase 6.5 — Silent visual QA.** Claude reads each recomp PNG and scores composition fidelity. Auto-retry up to 1× on critical failures.
10. **Phase 7 + 8 — Paint + summary.** Paint recomps. One-line summary + problem-list.

---

## Input parsing — strict

The user pastes:

```
/banner <figma-url-with-node-id>
Title: <full title text verbatim>           ← one or more lines (multi-concept)
Title: <second concept's title>             ← optional additional concepts
CTA: <button text verbatim>                 ← optional; applies to all concepts unless per-concept supplied
[<WxH> ...]                                  ← optional
```

### Required

- **Figma URL with `node-id`.** Must be `https://figma.com/design/<fileKey>/...?node-id=<X-Y>...`. The user has to pre-select the hero frame in Figma so the URL carries the node-id. Extract both `fileKey` and `nodeId` (convert `X-Y` → `X:Y`).
- **`Title:` line(s).** The full headline copy verbatim. Accept the typo `Tittle:` and the alias `Headline:`. Use the WHOLE title text on the banner — never split into "headline + sub-line". **Multiple `Title:` lines = multiple concepts** rendered in parallel. Each concept gets its own poll set, master render, recomp set, and Figma frame row. Cap at 4 concepts per run to keep polls manageable.
- **`CTA:` line(s)** — OPTIONAL. If a single `CTA:` is given, it applies to every concept. If a per-concept CTA is needed, the caller can repeat `CTA:` lines in the same order as the titles. If absent, Phase 0.5 asks via poll per concept (Claude suggests 3 short candidates + "no button").

### Optional

- **Sizes.** Zero or more `WxH` tokens. If missing → default `[1200×1200, 1200×628, 1080×1920]`. Always include `1200×1200` even if user lists only non-square sizes.

### Fail-fast (clear errors)

- No `node-id` in Figma URL → **`❌ Select the hero frame in Figma first, then copy the URL with the node selected and re-paste. /banner needs node-id=X-Y in the URL to read the LP context.`**
- No Figma URL at all → **`❌ /banner needs a Figma file URL with the hero node selected.`**
- No `Title:` → **`❌ /banner needs Title: <headline text> on its own line.`**
- Any other missing piece (sizes, CTA, etc.) → resolved by a Phase 0.5 poll, never a fail.

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
   Then `AskUserQuestion`: **Continue (no paint)** / **Stop**. If Continue, the run skips Phase 5/7 paint and emits URLs at the end so the user can paste manually.

All three checks finish in under 2 seconds. Output is silent on success — only failures surface.

---

## Phase 0 — silent setup

Language, register, and LP context are derived silently. Nothing surfaces unless something breaks.

### Phase 0.1 — language (silent)

Detect from Title + CTA. Labels: `pt-BR`, `pt-PT`, `es-LATAM`, `es-ES`, `English`, `Arabic`, `Hebrew`, `Urdu`, `Farsi`, `Pashto`, `th-TH`, `tr-TR`, otherwise closest from the localization tree; default `English`.

### Phase 0.2 — register (silent)

Classify from Title + CTA per **§ Register cues**. One of: `aspiration / urgency / provocation / trust / curiosity / empowerment / identity`. Default `curiosity` if no cues match.

### Phase 0.3 — LP hero (direct screenshot, with retry)

The user already pre-selected the hero — `nodeId` came in via the URL.

1. Call `get_screenshot(fileKey, nodeId, maxDimension=1200)`.
2. **On `session expired`:** retry with 2s wait, then 4s wait. After 2 retries → fall back to no-LP-context (silent — don't surface).
3. **On success:** analyze silently for `subject archetype`, `top 3 hex`, `tone`, `setting`, `LP CTA button color (if visible)`, and a one-line `LP purpose`. Cache by `fileKey + nodeId`.
4. **On any other error:** fall back to no-LP-context. Record in the problem-list for Phase 8.

No status line is surfaced. The LP read informs Phase 0.5's visual-direction poll silently and feeds CTA Tier 2 in Phase 1.0.

---

## Phase 0.5 — minimal polls (BLOCKING, clickable, plain language)

Up to 4 polls **per concept**. Each one is short. Skip any poll whose answer is already in input.

**Multi-concept handling.** With multiple `Title:` lines:

- **Shared polls run once** across concepts: local cultural cues (Poll 4).
- **Title-specific polls run per concept:** highlight pick (Poll 1), CTA suggestion (Poll 2 if missing), visual direction (Poll 3).
- Batch into sequential `AskUserQuestion` calls, max 4 questions per call. Typical pattern for 2 concepts: Batch 1 = T1 highlight + T1 CTA + T1 visual + shared local cues. Batch 2 = T2 highlight + T2 CTA + T2 visual.
- Each option label should prefix the concept ("T1 — …", "T2 — …") so the designer can scan quickly.

### Poll 1 — Title highlight (ALWAYS shown)

Compose 3–4 candidate phrases from the title that could carry the highlight. Rank by money-element strength (numbers/% > national/identity hook > intensity verb > else first 1–3 words). Last option is always "No highlight" (uniform, no accent treatment).

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

Compose 3 short CTA candidates derived from the title's promise + register + market. Each ≤ 30 chars. Last option is "no button".

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

### Poll 3 — Visual direction (ALWAYS shown, content-driven)

Claude composes 3–4 specific directions for THIS banner — grounded in the LP purpose + title + register + market. **The campaign-meaning catalog (§ Design Framework) seeds the ideation but does NOT dictate.** Each option must be:

- specific (concrete subject + setting + lighting, not category labels)
- distinct from the others (different visual world per option)
- culturally native to the LANGUAGE market
- connected to the LP's promise, not just its aesthetic
- a fresh choice for THIS task — do NOT reuse AI-chip / fintech-chart / trading-floor as default. If the title is about education, propose education metaphors. If luxury, propose luxury metaphors. If SaaS, propose UI/product-space metaphors.

```
AskUserQuestion {
  question: "What should the banner show?",
  header: "Visual",
  multiSelect: false,
  options: [
    { label: "<specific direction 1>", description: "<concrete subject + setting + lighting>" },
    { label: "<specific direction 2>", description: "<concrete subject + setting + lighting>" },
    { label: "<specific direction 3>", description: "<concrete subject + setting + lighting>" },
    { label: "Creative AI decides",    description: "Claude picks freely from § Design Framework's catalog, biased to the brief." }
  ]
}
```

### Poll 4 — Local cultural cues (skip for English, ask for non-English markets)

```
AskUserQuestion {
  question: "Want local cultural cues?",
  header: "Local cues",
  multiSelect: false,
  options: [
    { label: "Subtle",  description: "Native subject + one ambient cue. Recommended." },
    { label: "Strong",  description: "Architecture, flag colors, regional skyline. Bold." },
    { label: "None",    description: "Just match the language. No props." }
  ]
}
```

Skip entirely for `English` UNLESS the title contains an identity hook (e.g. "America," "Britain"). Default = Subtle.

---

## Phase 1.0 — Visual reasoning (NEW in v2.4, silent)

**Before composing the visual prompt, reason internally for each concept.** The visual concept is derived FRESH from the actual ad context — not from past runs, not from default themes, not from the example banners that came before.

### Step 1 — Understand the ad

Ask, in this order:
- **What is this banner selling?** Product, offer, claim, action.
- **What emotion should it create?** Urgency, trust, aspiration, curiosity, identity, empowerment.
- **What visual metaphor best supports the copy?** Not what's stylish — what's MEANINGFUL.
- **What would a real performance-ad designer choose** for this brief? Not a template, not a stock photo, not a recycled AI visual.

### Step 2 — Pick the visual world

Use the campaign-meaning → visual logic catalog (§ Design Framework) as a SEED. The exact subject, scene, props, and lighting come from the title + LP + market + register, not from the catalog row alone.

**Hard rule: do NOT reflexively pick AI/finance/trading visuals.** They are valid ONLY when the title, LP, and visual direction clearly call for them. An education banner gets education metaphors. A luxury banner gets luxury metaphors. A SaaS banner gets UI/product-space metaphors.

### Step 3 — Plan the three zones (§ Three-Zone Composition)

Declare BEFORE writing the prompt:
- **Text Zone:** position + shape of the title-and-button area. Clean, low-contrast, no busy details behind copy.
- **Main Visual Zone:** position of the hero subject / scene / metaphor.
- **CTA Zone:** position of the button — separated from the title but visually connected.

### Step 4 — Apply per-aspect layout (§ Per-Aspect Layout Rules)

Pick the layout structure for the aspect being rendered. The 1:1 master uses the SQUARE layout; recomps use their respective per-aspect layouts.

### Step 5 — Decide highlight structure mode

Compute `(highlight_chars × base_size × 1.12) / text_column_width`.
- **> 0.40 → Inline mode.** Highlight stays in-line with surrounding words. Use weight + underline + color, DROP size escalation.
- **≤ 0.40 → Stacked mode.** Highlight gets its own visual row at 1.12× size, rest of the logical line below it at base size. Pin THIS visual structure into the recomp manifest.

If unsure, default to Stacked when the highlight is naturally separable (a number, a noun phrase) and Inline when the highlight is inseparable from its surrounding words.

### Step 6 — Decide CTA color tier

- **Tier 1 (Highlight)** = LP accent hex (from Phase 0.3) OR register default (gold for aspiration, red for urgency, etc.).
- **Tier 2 (CTA)** = if Tier 1 collides with LP palette (color-collision fallback active), use a darker shade at ~70% L of Tier 1, OR sample from the LP's actual CTA button if visible in Phase 0.3. **Tier 1 and Tier 2 never share the same hex.**
- **Tier 3 (Body text)** = white #FFFFFF on dark backgrounds, near-black #0A0E1A on light backgrounds.

### Step 7 — Title block height target

`title_block_h = clamp(canvas_h × 0.22, 180, 480) px`. This is the TOTAL height of all title lines + leading. Encode in the prompt so the model sizes the title to match the campaign rhythm:

- 1200 square → 264px title block
- 628 wide → 180px title block (clamp floor)
- 1920 tall → 422px title block
- 1080×1350 portrait → 297px title block

### Step 8 — Master prop manifest

Choose 2–4 named props that will appear in the scene. Write them down — this list becomes the **prop manifest** that recomps must preserve. E.g. `[walnut desk, brass lamp, ceramic cup, notebook stack]`.

---

## Phase 1 — compose the visual prompt (silent)

Compose ONE prompt per concept using **§ Visual Prompt Template**. Soft ~600 chars, hard ≤900.

**Decide on the spot from LP + copy + register + market + Phase 1.0 reasoning:**

1. **Subject.** From the picked visual direction + LANGUAGE + LP demographic. Specific: nationality, age range, expression, wardrobe color. Authentic to the market. "No human" is valid for product/typography/data-led directions.
2. **Scene.** A descriptive setting + 1–2 named props from the prop manifest. Bias toward the LP setting category. **Apply the market exclusion list** from § Design Framework Localization (e.g. no Wall Street bull on Swedish banners).
3. **Lighting.** One phrase matching register + LP feel.
4. **Palette.** Two hex codes — dominant + accent. Pull from LP palette when available; ≥ 4.5:1 contrast for the button pair. **CTA color uses Tier 2 from Step 6, NOT Tier 1.**
5. **Background depth.** Scene-driven, NOT a flat gradient. Atmospheric, layered, light-modeled. **Hard rule:** the prompt must call out a *clean low-contrast zone* where the title + button overlay — **zero hard edges, window mullions, chart traces, or silhouette outlines may intersect this zone.** Empty visual lane.
6. **Highlight phrase.** Apply the mode decided in Step 5 (Inline or Stacked). If LP palette saturates the highlight color (collision-fallback active), force secondary vectors: weight 900, 3px underline, and 1.10–1.15× size escalation. Keep the LP-native color.
7. **CTA.** If a CTA was set: Tier 2 hex (from Step 6), pill (warm registers) or rectangular (institutional), **height = clamp(canvas_h × 0.08, 80, 160) px**, text fills 60–80% button width — no wrap, no clip. If "No button": prompt explicitly states no button, flow ends on title.
8. **Local cues.** From Poll 4 (Subtle / Strong / None). **Landmark naming rule:** prefer descriptive ("Stockholm financial district skyline at dusk") over specific ("Stadshuset, Riddarfjärden") to reduce factual hallucinations. If a specific landmark must be named, append `Render accurately — do not invent additional towers, spires, or features.`
9. **On-screen data localization.** When subject is a data product (monitor / dashboard / app UI / terminal), populate it with market-native data labels (§ Design Framework Localization, "On-screen data" table).
10. **Title block height.** Encode the target from Step 7 in the prompt.
11. **Zone declaration.** State the three zones explicitly: Text Zone at <position>, Main Visual Zone at <position>, CTA Zone at <position>.

**Render verbatim** every character of Title and CTA. Spell every accent, diacritic, digit exactly. **Title visual rows chosen here are pinned** and passed to every recomp prompt in Phase 6 — do not let recomps re-flow them.

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

Grid: **one row per concept, one column per size**. Idempotent placement (scan for existing `Banner` frames, start below them). Frame names encode the concept label so multi-concept runs are scannable in the Layers panel.

```js
const sizes = [/* injected */];
const conceptLabels = [/* injected — one short label per Title, e.g. ["C1-chip", "C2-analyst"] */];
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

Single-concept runs use `conceptLabels = ["C1"]` and produce the same single-row layout as before.

---

## Phase 4 — paint MVP into 1:1 frame

Three parallel turns:

1. `curl -sL -o /tmp/banner/mvp.png "<rawUrl>"` — single bash call.
2. `upload_assets(fileKey, nodeId=<mvp_frame_id>, scaleMode=FILL, count=1)` — returns submit URL on `mcp.figma.com`.
3. `curl -sS -X POST -H "Content-Type: image/png" --data-binary @/tmp/banner/mvp.png "<submitUrl>"` — POST the bytes.

**If Phase 4 fails due to egress block** (caught earlier in pre-flight, but defense-in-depth): record `paint_failed` in the problem-list; surface a one-liner: `⚠️ Paint blocked — MVP available at <rawUrl>. Drag into the 1200×1200 frame manually.` Then skip to Phase 8 (no recomp — pointless without paint).

---

## Phase 5 — 🛑 designer review pause (one short poll)

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

For 3+ concepts, cap the options at 4 (collapse extras into "Redo any" → followup poll with sub-selection). Keep one CTA action ("All look good") and at least one "Stop here" option.

**On "Redo it" / "Redo Cn":** re-compose the prompt for that concept with varied specifics (different prop / different angle / different time of day / **try a different visual metaphor from § Campaign-meaning catalog**), regenerate at 1200×1200, overwrite the frame fill, return to Phase 5.

**On "Stop here":** delete the empty non-1:1 frames for every concept in this run, skip to Phase 8.

---

## Phase 6 — recompose to non-1:1 sizes

For each non-1:1 size (and for every approved concept), compose a recomp prompt using **§ Recomposition Prompt Template** (≤ 1,800 chars). Pass that concept's `mvp_job_id` as `medias[].role: "image"`.

**Recomp is layout REDESIGN per format, not resize.** Use the per-aspect layout rules from § Design Framework. Each format gets its own placement recipe — title position, button position, subject scale, breathing room — derived from the aspect's affordances.

**Aspect map:**

| Size | Frame aspect (W/H) | Render aspect (W/H) | Per-aspect layout | Recompose? |
|---|---|---|---|---|
| any 1:1 | 1.000 | 1.000 | SQUARE | reuse MVP |
| 1200×628 | 1.911 | 1.778 (16:9) | WIDE | yes |
| 960×1200 | 0.800 | 0.750 (3:4) | PORTRAIT | yes |
| 1080×1350 | 0.800 | 0.750 (3:4) | PORTRAIT | yes |
| 1200×960 | 1.250 | 1.333 (4:3) | MILD WIDE | yes |
| 1080×1920 | 0.5625 | 0.5625 (9:16) | TALL | yes — exact aspect, no crop |
| 1920×1080 | 1.778 | 1.778 (16:9) | LANDSCAPE | yes — exact aspect, no crop |

**Safe-area axis derivation — REQUIRED fill-math computation.**

When the render is placed into the frame with `scaleMode=FILL`, the image scales to fully cover the frame on the constraining axis and crops the other axis. The crop axis is derived from the aspect comparison, not guessed:

- If `frame_aspect > render_aspect` (frame is wider/squatter than render): image scales to match WIDTH → crops **TOP + BOTTOM (vertical axis)**.
- If `frame_aspect < render_aspect` (frame is narrower/taller than render): image scales to match HEIGHT → crops **LEFT + RIGHT (horizontal axis)**.
- Exact match: no crop.

Compute `crop_pct = |frame_aspect − render_aspect| / max(frame_aspect, render_aspect)`. If `crop_pct > 5%`, emit in the recomp prompt:

```
Leave 8% safe area on <vertical | horizontal> axis — frame will crop ~{crop_pct}% off those edges. Keep all critical subject features, product proof, title, and button at least 8% inset from the cropping edges.
```

Example: 1200×628 from 1:1 master → frame 1.911 > render 1.778 → vertical-axis crop ~7% → `Leave 8% safe area on vertical axis`.

**Master prop manifest** from Phase 1.0 Step 8 is passed verbatim into the recomp prompt: every prop named in the master MUST remain visible in the new aspect, repositioned but not removed.

Fire all recomps in parallel (concepts × non-1:1 sizes). Polling cadence same as Phase 2.

---

## Phase 6.5 — silent visual QA (NEW in v2.4)

After all recomps render but **before** painting into Figma, Claude reads each recomp PNG and scores composition fidelity. This catches the issues that v2.3 only surfaced after the user complained.

For each recomp, score these dimensions (PASS / FAIL):

| Check | What to verify | If FAIL |
|---|---|---|
| **Line structure** | Visual rows match the master's pinned visual rows | flag in problem-list |
| **Prop manifest** | Every named prop from Phase 1.0 Step 8 is visible | flag in problem-list |
| **Edge clipping** | No subject / button / title clipped at any edge | auto-retry (critical) |
| **Alignment per-aspect** | TALL = center, WIDE = match master, SQUARE = match master | flag in problem-list |
| **Highlight treatment** | Highlight phrase has correct color + weight + underline + size | flag in problem-list |
| **Readability zone** | No hard edges / mullions / chart traces / silhouette outlines crossing title or button | flag in problem-list |
| **Title block height** | Title block fills ~22% of canvas height (within ±5pp) | flag in problem-list |
| **CTA tier** | Button hex ≠ highlight hex (Tier 1 ≠ Tier 2) | flag in problem-list |

**Critical failures (edge clipping, missing manifest props, wrong alignment) trigger ONE auto-retry** with a corrective prompt that names the specific failure. Non-critical failures are logged in the Phase 8 problem-list.

Cap auto-retries at 1 per concept × size to keep the run bounded. If retry also fails, paint the original and surface the issue in Phase 8.

---

## Phase 7 — paint recomps

Same three-turn parallel pattern as Phase 4. One bash batch for downloads, one MCP batch for `upload_assets`, one bash batch for POSTs.

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

The problem list surfaces issues that were silently handled — egress block, MCP retry-on-session-expired count, Phase 6.5 QA flags, recomp auto-retry results, etc. It is the channel for the user to see what the spec needs to improve.

---

# § Visual Prompt Template

≤900 chars hard for the filled prompt. Whole Title goes in verbatim. Highlight phrase gets the accent treatment. No sub-line concept. Title visual rows chosen here are pinned for all recomps.

```
1200×1200 designed marketing banner (NOT a random scene). Photoreal. {LANGUAGE} ({market}). {register} mood. Direction: <one-line from Poll 3>.

Composition: explicit three-zone advertising layout.
- Text Zone: <position — e.g. "upper-left quadrant, 45% of canvas width, clean uniform dark navy, no busy details">.
- Main Visual Zone: <position — e.g. "lower-right, hero subject, atmospheric depth">.
- CTA Zone: <position — e.g. "bottom-left, below title, 24px gap">.

Subject: <one line — nationality, age, expression, wardrobe color, pose. Or "no human; <object> as hero". From Phase 1.0 Step 2, NOT a default theme>.

Scene: <one line — descriptive setting + 2–4 named props from master prop manifest. Atmospheric depth.>
[If local cues = Strong: + named cultural reference. If a landmark is named, add "Render accurately — do not invent additional towers, spires, or features."]
[If local cues = Subtle: + one ambient regional cue, prefer descriptive over named landmarks.]
[Market exclusions: <from § Design Framework Localization — e.g. "no Wall Street bull, no NYSE/NASDAQ ticker, no US flag motifs">.]
[On-screen data (if subject is a data product): <market-native data labels — e.g. "SEB, Nordea, Handelsbanken, DNB Markets rows; NVDA US Equity ticker">.]

Lighting: <one phrase — direction + warmth + DoF, matching register>.

Readability zone: clean low-contrast area on the <side> of the canvas — softer focus, single tonal direction. ZERO hard edges, window mullions, chart traces, or silhouette outlines may cross where title or button overlay. Empty visual lane.

Layout for 1:1 SQUARE ({LTR|RTL}): subject <left|right>; title on opposite half, <alignment from rule>; CTA below title.
Alignment rule (LTR): SQUARE → match master direction; WIDE → match master; TALL → CENTER-align; PORTRAIT → top-aligned or center. (RTL mirrors.)

Title block height target: ~{title_block_h}px ({title_block_h / canvas_h * 100:.0f}% of canvas). Render verbatim, exact characters, EXACT visual rows — these rows are pinned for all recomps:
"<row 1>"
"<row 2>"
["<row 3>" if needed]

Highlight structure: <"Inline" or "Stacked">. Highlight phrase "<phrase from Poll 1>" gets:
- color: <Tier 1 hex>
- weight: 900 (vs 700 base)
- underline: 3px solid in same color
- size: <"1.00× base" if Inline, "1.12× base" if Stacked>
[If "No highlight": render the title uniformly, no accent treatment.]

[If CTA picked:]
Button: <pill | rectangular>, height = clamp(canvas_h × 0.08, 80, 160) px, fill <Tier 2 hex — DIFFERENT from Tier 1>, text "<CTA verbatim>" in <Tier 3 hex>. Text fills 60–80% button width, no wrap, no clip.

[If CTA = no-button:]
No button on the canvas. Flow ends on the title. Breathing room at the bottom.

Palette: dominant <hex1>, accent <hex2>. Real scene with depth, not flat gradient.

Render every character exactly. No invented logos, watermarks, "Ad" labels, mockup chrome, decorative text effects, generic stock-photo people. Premium paid advertising aesthetic, not template.
[If non-English: native to {market}, no Western defaults.]
[If RTL: subject LEFT, title RIGHT-aligned, button bottom-LEFT.]
```

---

# § Recomposition Prompt Template

≤ 1,800 chars. The MVP image is provided as `medias[].role: "image"`. Title visual rows come from the master prompt and are passed verbatim — recomps MUST NOT re-flow them.

Recomp is **layout redesign per format**, not resize. Same concept, new spatial structure.

```
RECOMPOSE the attached master (1200×1200) into {W}×{H}. Master = source of truth. Same subject, same text, same colors, same typography, same button. Not a stretch, not a crop, not a fresh generation. LAYOUT IS REDESIGNED for this aspect — not the same layout shrunk.

NEW LAYOUT (<WIDE | TALL | LANDSCAPE | PORTRAIT | MILD-WIDE>) — apply § Per-Aspect Layout Rules:
- <Insert per-aspect placement recipe — see § Design Framework. E.g. for WIDE: "Title + CTA on left 40–45%, main visual right 55–60%, no tall stacked text">.

ZONES:
- Text Zone: <new position for this aspect>. Clean, low-contrast, no busy details.
- Main Visual Zone: <new position>. Subject fully inside frame, NOT clipped.
- CTA Zone: <new position>. Below title or bottom-center per aspect rule.

SUBJECT: <repositioning + framing rule>. Same wardrobe, expression, lighting as master.
Product proof if MVP had one (phone/laptop/watch/monitor/chip): MUST remain visible and legible, fully inside the new canvas.
[If TALL or PORTRAIT: subject occupies 45–55% of canvas height — do NOT shrink below this floor.]

MASTER PROP MANIFEST: every prop from the master MUST be visible in this recomp, repositioned, not removed. Prop list from Phase 1.0 Step 8: <inject the manifest list, e.g. "walnut desk, brass lamp, ceramic cup, notebook stack">.

TITLE alignment: <derived rule — WIDE keeps master horizontal; TALL/PORTRAIT center-aligns; SQUARE matches master>.

TITLE (verbatim, EXACT visual rows from master — do NOT re-flow, do NOT merge rows, do NOT split rows):
  R1: "<master row 1>"
  R2: "<master row 2>"
  [R3: "<master row 3>" if present in master]
Highlight phrase "<phrase>" keeps its full treatment (color + weight + underline + size — same multiplier as master).

TITLE block height: ~{title_block_h}px ({title_block_h / new_canvas_h * 100:.0f}% of new canvas height).

BUTTON if present: <new position per aspect>. height = clamp(new_canvas_h × 0.08, 80, 160) px. Same Tier 2 color (NOT same as highlight Tier 1), same shape. Text fills 60–80% button width, no wrap, no clip.

BACKGROUND: base extends along the new long axis, same palette hex. Readability zone stays clear of hard edges, window mullions, chart traces, silhouette outlines.

SAFE AREA: [if crop_pct > 5%: "Leave 8% safe area on <vertical | horizontal — DERIVED FROM FILL MATH> axis — frame will crop ~{crop_pct}%. Keep subject, manifest props, title, and button at least 8% inset from the cropping edges."].

CONSTRAINTS: exactly {W}×{H} px. No new content. No watermarks, AI marks, mockup chrome. [If RTL: keep mirrored direction.]
```

---

# § Design Framework (Claude only)

Never sent to the model. The principles Claude reasons from when composing Phase 1.

### Six decision principles

For each banner, decide on the spot:

**1. Subject** = direction (from Poll 3) + LANGUAGE + LP demographic. Specific. Authentic. Fresh per task — do NOT reuse default themes.

**2. Scene** = real place + 2–4 named props (the prop manifest) that fit the title's narrative. Bias toward LP setting.

**3. Lighting** = register mood. Aspirational → warm/golden. Urgent → harder side / neon edge. Provocation → dramatic low-key. Trust → soft studio. Curiosity → soft directional + slight haze. Empowerment → cinematic mid-key. Identity → warm regional.

**4. Background depth** = scene-driven with atmospheric layering. **Readability rule:** every prompt must call out a clean low-contrast zone where text overlays. Flat 2-stop gradient is banned.

**5. Palette** = 2 hex (dominant + accent). LP-continuity bias if Phase 0.3 succeeded. ≥ 4.5:1 contrast for the button pair. Tier 1 (highlight) and Tier 2 (CTA) NEVER share the same hex.

**6. Button (CTA).** If picked: Tier 2 hex, pill (warm) or rect (institutional), **height = clamp(canvas_h × 0.08, 80, 160) px**, text 60–80% of width, no wrap/clip. Worked sizing: 1200 → 96px, 628 → 80px (clamp floor), 1920 → 154px. If "no button": no button-shaped element anywhere on the canvas, flow ends on title.

### Campaign-meaning → visual logic catalog (v2.4)

When composing Poll 3 options OR picking "Creative AI decides," use this as a SEED. Each campaign meaning has its characteristic visual world. **Do not reuse a fixed visual theme across runs** — the actual title + LP + market should determine the metaphor.

| Campaign Meaning | Better Visual Logic |
|---|---|
| **AI / technology** | Digital systems, data depth, futuristic product metaphor, chip macros, neural-net wireframes — only when copy is about AI itself. |
| **Investing / trading** | Market movement, financial confidence, charts ONLY if directly relevant, analyst desks, terminal closeups, money-element typography. |
| **Education** | Learning path metaphor, mentor/student framing, structured progress, calm trust, books, notebooks, classroom light, certificate close-ups. |
| **Luxury** | Minimal objects, premium materials (marble, brass, leather), elegant lighting, single hero product, generous negative space. |
| **Local market identity** | Native people, subtle cultural context, regional setting, regional architecture in soft focus. |
| **Urgency** | High contrast, compressed energy, sharper composition, motion blur, countdown elements. |
| **Trust** | Clean studio, institutional clarity, grounded realism, soft daylight, professional but not corporate-stock. |
| **Lifestyle** | Real people, aspirational but believable environment, candid posture (NOT corporate stock smile). |
| **SaaS / app** | Interface-inspired layout, clean UI geometry, product-space, device-in-hand, app screen as hero. |
| **Problem / solution** | Visual contrast, before/after metaphor, simplified story, two-state composition. |

**Hard rule:** do not reuse AI-chip / fintech-chart / trading-floor / Brazil-colors / business-people-on-laptops unless the specific copy, LP context, and visual direction clearly justify them. Reasoning from the brief beats reaching for a recent winner.

### Three-Zone Composition (v2.4)

Every banner is composed of three intentional zones, planned in Phase 1.0 Step 3:

**1. Text Zone**
The title must be placed in a clean, readable area.
- High contrast against background
- Strong typographic hierarchy
- No busy details behind the text
- No text over faces or complex objects
- Natural line breaks
- Enough breathing room (≥ 8% inset from edges)
- Highlight only the chosen phrase, not everything
- Planned BEFORE generating the visual

**2. Main Visual Zone**
The emotional / conceptual part of the banner.
- Can be a person, product, object, environment, abstract metaphor, chart, cultural scene, or visual symbol — pick from § Campaign-meaning catalog
- Creates attention but LEAVES room for title and CTA
- Has atmospheric depth, not flat
- Has the visual answer to the ad's emotional question

**3. CTA Zone**
The button is clearly visible and clickable.
- Uses CTA text verbatim
- Separated from the title (12–24px gap) but visually connected (same vertical column or aligned start)
- No icon inside the button unless specifically requested
- No wrapping, no clipping
- ≥ 8% padding from edges
- High contrast against background (Tier 2 hex, not Tier 1)

### Per-Aspect Layout Rules (v2.4)

Adapt the same banner CONCEPT intelligently across formats. Do not crop. Do not stretch. **Each format gets its own redesigned layout.**

#### SQUARE — 1:1 (1200×1200)
Use for feed ads and MVP master. Strongest overall balance because it becomes the source of truth.

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
- Clean low-contrast zone for copy

#### WIDE — 1.91:1 (1200×628)
Use for Facebook, LinkedIn, Google Display, preview ads. Limited height → short title, horizontally efficient.

```
┌──────────────────────────────────────┐
│ [Title + CTA]      [Main visual]     │
└──────────────────────────────────────┘
```

- Title: left 40–45%
- CTA: directly below title
- Main visual: right 55–60%
- No tall stacked text
- Composition compact and readable
- Key content NOT at extreme edges

#### LANDSCAPE — 16:9 (1920×1080)
Website hero, YouTube placements, large display. Cinematic, not poster.

```
┌──────────────────────────────────────────────┐
│ [Title + CTA]         [Large cinematic visual]│
│                                              │
└──────────────────────────────────────────────┘
```

- Title: left third or left 40%
- CTA: below title
- Main visual: right side
- Background extends across full canvas
- Copy inside safe left content area
- Do NOT stretch text across the whole banner

#### PORTRAIT — 3:4 (960×1200 / 1080×1350)
Mobile feed, premium vertical placements. Editorial ad feel.

```
┌──────────────────┐
│ [Title]          │
│                  │
│ [Main visual]    │
│                  │
│ [CTA]            │
└──────────────────┘
```

- Title: upper-left or top-center
- Main visual: center / middle 50%+
- CTA: bottom-left or bottom-center
- Text inside middle 80–85% of canvas width
- Vertical storytelling but NOT overcrowded

#### TALL — 9:16 (1080×1920)
Stories, reels, TikTok, vertical mobile ads. Mobile-first. **Subject occupies 45–55% of canvas height — never less.**

```
┌────────────┐
│ [Title]    │
│            │
│ [Main      │
│  visual]   │
│            │
│ [CTA]      │
└────────────┘
```

- Title: top 20–30% (block height ~22% of canvas)
- Main visual: center 45–55% of canvas height (anchored)
- CTA: bottom-center, ≥ 8–12% padding from bottom edge
- Title and CTA away from platform UI zones (top 8%, bottom 12% mobile-safe)
- Important content inside central 80% width
- Fewer words, stronger line breaks
- If copy is dense, prioritize readability over decoration

### Banner Quality Standard (v2.4)

Each banner should feel:

- ✅ professionally designed
- ✅ readable at small sizes
- ✅ visually intentional (every element earns its place)
- ✅ conversion-focused
- ✅ adapted to the market
- ✅ adapted to the message
- ✅ clean enough for copy and CTA to breathe
- ✅ premium, not cheap or overloaded

### Anti-patterns (NEVER) (v2.4)

- ❌ generic stock-photo business people
- ❌ random people on laptops
- ❌ forced AI visuals (chip macros / neural wireframes) when copy isn't about AI
- ❌ fake logos
- ❌ fake platform screenshots (UI mockup chrome AROUND the banner)
- ❌ too many charts (more than 1 chart on a banner is usually wrong)
- ❌ too many icons
- ❌ excessive glow / lens flare
- ❌ cluttered backgrounds
- ❌ invented text (the model adding labels we didn't ask for)
- ❌ decorative text effects (chrome, embossed, drop shadows, outlines, distortion)
- ❌ unreadable copy
- ❌ low-quality template aesthetics
- ❌ background that fights the title for attention

**The visual must support the title. It should never fight against the title.**

### Highlight phrase treatment (v2.3 + v2.4 modes)

The user picks which part of the title pops (Poll 1). Default treatment by register:

- **Aspiration / Identity / Empowerment** → gold-gradient (#D4A017 → #F5C842) on the letterforms + thin 3px gold underline below those words. Weight 900. No box, no highlighter.
- **Urgency** → solid saturated red (#E54B2C) on the letterforms. Weight 900. Size escalation carries it.
- **Provocation** → accent color on letterforms + 2px outline box at 60% opacity around only those words. Slightly off-axis (1–2°).
- **Trust** → brand color on letterforms. Weight 900. No ornament. Contrast carries it.
- **Curiosity** → bold accent on letterforms + thin 2px underline at 80% opacity.

**Color-collision fallback (REQUIRED check before composing the prompt).** If the chosen highlight color is already saturating the LP palette pulled in Phase 0.3 (close ΔE — e.g. gold register on a gold/cream LP, neon-green register on a neon-green LP), color alone won't differentiate. Force secondary vectors:

- **Weight bump:** highlight at 900 vs base 700 (always — applies on top of register default).
- **3px underline:** add even when the register default omits it.
- **Size escalation:** 1.10–1.15× the base title size on the highlight word (when Stacked mode active).
- **Keep the LP-native color** — switching to a clashing color breaks LP continuity worse than the collision did. Differentiate via type treatment instead.

**Inline vs Stacked mode (v2.4).** When size escalation is active, the highlight word can outgrow the column. Decide structure mode:

- **Inline mode** (`(highlight_chars × base_size × 1.12) / column_width > 0.40`): highlight stays in-line with surrounding words. Drop size escalation. Color + weight + underline carry it.
- **Stacked mode** (≤ 0.40): highlight gets its own visual row at 1.12× size, surrounding words on the next visual row at base size. The visual rows are pinned into the recomp manifest.

Worked example (SWE/NVIDIA run, May 2026): LP palette = dark navy + neon green. Register = aspiration (default gold). Framework re-mapped highlight to neon green for LP continuity, applied weight 900 + 3px underline + 1.12× size. The model naturally Stacked the highlight on its own visual row. v2.4 formalizes this so the recomp manifest pins the stacked structure rather than fighting the natural wrap.

If user picked "No highlight" → render the title uniformly with no accent treatment. The visual flow rests on lighting + subject + composition.

### CTA Color Tier rule (v2.4)

- **Tier 1 (Highlight)** = LP accent OR register default. Used on the highlight phrase only.
- **Tier 2 (CTA)** = if Tier 1 = LP accent (collision-fallback active), Tier 2 = darker shade at ~70% L of Tier 1, OR sampled from LP's actual CTA button color (Phase 0.3). **Tier 1 ≠ Tier 2 in hex.**
- **Tier 3 (Body text)** = pure white on dark, near-black on light.

Worked example (SWE/NVIDIA): Tier 1 = #22FF6A (LP neon green) for "43 analytiker" highlight. v2.3 made CTA also #22FF6A — fights the highlight. v2.4 forces Tier 2 = #14B355 (darker green) for the CTA so the highlight reads as primary focal and the CTA reads as institutional secondary.

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

Pick the first register whose cues appear left-to-right. Identity layers on top of the primary register. Default `curiosity` if no cues.

### Localization

- Match subject features, wardrobe, setting to the actual market — never Western defaults on non-English banners.
- Apply color meaning to market: red = loss in Western finance / luck in CN; green positive Western / political MENA; white premium West / mourning EA; gold premium Gulf + EA + LATAM.
- Avoid offensive gestures for the market (thumbs-up in MENA/W.Africa, OK sign in Brazil/Turkey/MENA, index-finger pointing in Asia/MENA, prominent left-hand display in MENA/S.Asia).

**Market exclusion lists (do-not-invent props/symbols outside their home market):**

- **Outside the US:** no Wall Street charging-bull statue, no NYSE / NASDAQ bell or logo, no S&P 500 ticker, no Statue of Liberty, no US flag patterns, no American-trader-floor decor.
- **Outside the UK:** no Big Ben, Tower Bridge, Union Jack motifs.
- **Outside Japan:** no Mt. Fuji, Tokyo Tower, sakura — unless they're the focal subject.
- **Non-target EU markets:** no country-flag colors unless the title explicitly names the country.

**Market prop allowlists (bias toward when local cues = Subtle/Strong):**

- **Nordic (Sweden / Norway / Denmark / Finland):** walnut/oak desk, brass desk lamp, ceramic cup, papered notebook, IKEA-style shelving, muted minimalist interior, soft Scandinavian daylight.
- **DACH (Germany / Austria / Switzerland):** dark wood + leather, brushed steel, neutral palette, engineering-precision feel.
- **LATAM:** warm terracotta, plants, daylight, natural textures.
- **MENA Gulf:** marble + gold accents, soft indoor light, premium retail aesthetic.
- **East Asia (urban):** dense city neon, glass towers, sleek tech surfaces.

**On-screen data labels (when subject is a terminal / dashboard / app UI):**

| Market | Native data labels (use these instead of US defaults) |
|---|---|
| Nordic | SEB, Nordea, Handelsbanken, DNB Markets, Carnegie, Swedbank, Danske Bank |
| DACH | Deutsche Bank, Commerzbank, UBS, Credit Suisse, Raiffeisen, KfW |
| LATAM | Banco Itaú, Bradesco, BBVA, Santander Mex, Banco do Brasil |
| MENA Gulf | Emirates NBD, QNB, NCB, Riyad Bank, Al Rajhi |
| JP | Mitsubishi UFJ, Mizuho, Sumitomo Mitsui, Nomura, Daiwa |
| US | JPMorgan, Goldman Sachs, Morgan Stanley, BofA, Citi |

When subject ≠ data product, this table doesn't apply.

When the visual direction names a subject or scene, check the market allowlist first — bias toward those props instead of US/Western defaults. Worked example (SWE/NVIDIA): the analyst-desk concept generated a Wall Street bull statuette on a Swedish-market banner. Spec violation — Nordic markets allowlist a brass lamp, ceramic cup, and notebook stack; the bull should have been excluded at prompt-composition time.

### RTL composition

RTL languages: Arabic (all dialects), Hebrew, Urdu, Farsi, Pashto, Sindhi, Kurdish (Sorani).

- Mirror layout. Subject LEFT, title stacked right-aligned on RIGHT. Button bottom-LEFT.
- Native typeface (NEVER Latin + RTL fallback). Arabic: Tajawal default or Cairo. Hebrew: Heebo or Rubik. Urdu/Farsi: Vazirmatn or Noto Naskh Arabic.
- Slightly looser leading than Latin. Never condense. No kashida-stretching.

### Typography

- LTR headline: Inter (default), Söhne, or Helvetica Now.
- Max 2 typefaces per banner. Weights 700–900. No drop shadows on text. No outlining / distortion.

### Hard guardrails (non-negotiable)

- **Copy verbatim.** Title and CTA pass unchanged. No edits, translations, improvements.
- No invented brands, logos, badges.
- No fake mockup chrome (browser bars, mockup phone frames AROUND the banner, "Sponsored"/"Ad" labels). Phone HELD BY subject in scene is allowed.
- No text inside subject (no words on shirts/signs) unless that text is in the slots.
- No watermarks, AI marks.
- No duplicated/mirrored text.
- No mirrored Arabic/Hebrew letterforms.
- No Latin fonts forced onto RTL copy.
- No cross-region cultural mismatches.
- No offensive gestures for the target market.
- No mixed visual styles within one banner.
- **No reuse of default themes** (AI chip / fintech chart / trading floor / business-people-on-laptops) unless the brief clearly calls for them.
- **No background that fights the title.** Readability zone wins, always.

---

## Final Guardrail (v2.4)

The system behaves like this:

> First understand the ad.
> Then choose the right visual metaphor.
> Then design the layout around readability and conversion.
> Then render the master.
> Then redesign the layout for each size.
> Then QA before painting.

Do not force a theme. Do not reuse the same banner formula. Do not let the background dominate the copy. Do not generate a beautiful image that fails as an ad.

The final output must always feel like a real paid banner designed for a specific campaign.

---

## Constraints

- Visual Prompt ~600 soft, ≤900 hard.
- Recomp Prompt ≤1,800.
- GPT Image 2 only. `gpt_image_2`. Never substitute.
- Resolution always `1k`.
- MVP always 1200×1200 (1:1).
- MVP is the source of truth for recomps via `medias[].role: "image"`.
- Verbatim Title + CTA.
- **Phase 1.0 visual reasoning required** — no template reuse.
- **Three-zone composition planned before render** (Text Zone / Main Visual Zone / CTA Zone).
- **Per-aspect layout** = redesign per format, not resize.
- **Title visual rows pinned across recomps** (no proportional reflow).
- **Title block height = clamp(canvas_h × 0.22, 180, 480) px.**
- **Alignment per-aspect:** TALL/PORTRAIT → center; WIDE/LANDSCAPE → match master.
- **Subject vertical fill in TALL/PORTRAIT:** 45–55% of canvas height minimum.
- **CTA height = clamp(canvas_h × 0.08, 80, 160) px** — ratio of canvas.
- **CTA color tier rule:** Tier 1 (highlight) ≠ Tier 2 (CTA) in hex.
- **Highlight structure mode:** Inline (drop size escalation) vs Stacked (own visual row at 1.12×), chosen from `(highlight_chars × base_size × 1.12) / column_width`.
- **Highlight color-collision fallback** required (weight + underline + size when LP palette saturates the register color).
- **Master prop manifest** carried into every recomp.
- **Market exclusion lists** applied before composing the prompt.
- **On-screen data localization** when subject is a data product.
- **Readability zone:** zero hard edges / structural lines crossing the title or button overlay.
- **Safe-area axis derived from fill math** (not user-guessed).
- **Multi-concept supported:** multiple `Title:` lines → parallel concepts, one Figma row per concept.
- **Landmarks named in the prompt** require a `do-not-invent` clause.
- **Phase 6.5 silent visual QA** before painting recomps.
- Exact pixel sizes.
- Figma is read+write.
- Egress allowlist required: `d8j0ntlcm91z4.cloudfront.net` + `mcp.figma.com`.
- No autonomous commits.
