---
description: Render banner concepts with Higgsfield GPT Image 2 and paint them into a Figma file. Claude controls the brief (campaign understanding, layout lock, copy hierarchy, market, what to avoid). Higgsfield controls the picture (visual energy, atmosphere, subject interpretation, lighting, decorative style). Prompts are short creative briefs, not photoshoot directions. Never dark editorial office scenes. User-controlled setup (sizes first, then customize vs auto). Multi-concept ready. The user provides one-or-more Title lines + a Figma URL with the hero node pre-selected.
---

# /banner — Designer flow (Higgsfield GPT Image 2 → Figma) v2.7

## What changed in v2.7 (from v2.6)

v2.6 fixed the visual direction (campaign poster, not editorial photo) but **the prompt-writing logic was still wrong**: Claude was acting like a photoshoot director — over-describing scenes, naming exact props, micro-managing the picture. That over-specification was steering Higgsfield back toward "realistic photo + text overlay" output.

**v2.7 splits responsibility cleanly:**

- **Claude controls the BRIEF.** Campaign understanding · size/layout rules · copy hierarchy · text + CTA placement · market / localization · LP consistency · what to avoid.
- **Higgsfield controls the PICTURE.** Visual creativity · atmosphere · subject interpretation · lighting · decorative energy · poster feel · final image style.

Claude stops writing prompts like a photoshoot director. Higgsfield is allowed to be creative.

### The behavioral change

**Old (v2.6 and earlier):**

```
Analyze LP → invent detailed scene → describe too many props → Higgsfield generates a realistic photo → text placed on top
```

**New (v2.7):**

```
Analyze LP → extract campaign intent → lock the layout by aspect ratio → send a short creative direction → let Higgsfield create the visual energy
```

### Prompt-writing rules — REWRITTEN

- **Length:** 450–750 chars preferred, **900 max** (was 700–1,000 / 1,300 in v2.6).
- **Tone:** sounds like a creative brief, not a technical document.
- **Do NOT over-describe:** exact person details · exact office props · desk objects · furniture · lamps · notebooks · coffee cups · hair length · clothing details · overly specific room interiors. Only include those if the user or LP explicitly requires them.
- **Structure:** 6 sections (Format + market + mood → Campaign-poster direction → Layout lock for aspect ratio → Visual atmosphere → Copy / CTA placement → Constraints).
- **No long prop lists.** No full office scene. No detailed photo composition unless the user asks for it.

### New Phase 1.0 — Creative Card extraction (REPLACES the 8-step scene reasoning)

Before prompting Higgsfield, Claude extracts a short Creative Card per concept:

```
Campaign purpose:        <one line>
Market / language:       <e.g. Swedish / Sweden>
Emotional register:      <aspiration / urgency / trust / curiosity / empowerment / provocation / identity>
Primary hook:            <the number / phrase / claim that should dominate>
Main visual hierarchy:   <what is hero, what is support>
LP visual style:         <one-line distilled from Phase 0.3>
Required aspect ratios:  <list from Phase 0.4>
Layout lock:             <one-line position rules>
Avoid:                   <specific cliché this concept could regress into>
```

The Creative Card is the ONLY pre-prompt artifact. No more 8-step scene reasoning, no more 5-layer depth formula on paper, no more master prop manifest with desk/lamp/notebook fields. The card stays tight and campaign-first.

### Higgsfield prompt template — REWRITTEN (6 sections, short)

```
{W}x{H} premium localized campaign poster for {MARKET}, {REGISTER} mood. Finished paid-social creative, not an editorial office photo.

Main hook: "{highlight phrase}" is the visual hero. Use bold graphic ad layout, oversized typography, premium {palette} color system, clean copy zone, and visible design layer.

Layout: {aspect-ratio layout lock}. Title reads exactly: "{Title}". CTA "{CTA}" {CTA placement if present}.

Visual atmosphere: {local market cue}, subtle {campaign theme} energy, soft gradients, curved panels, polished campaign lighting. Optional photo-real subject only as support, integrated into the design.

Readable text only: Title and CTA. No logos, no fake UI, no invented text. Avoid {forbidden defaults}.
```

That's enough. Do NOT add 20 extra micro-details.

### Aspect-ratio layout locks — REWRITTEN (one-line per format)

These are the ONLY layout rules that go into the Higgsfield prompt. Claude enforces them; Higgsfield is free everywhere else.

- **1:1 (Square — master):** Large title block on left / top-left or center-left. Visual / atmosphere on right or background. CTA below title if present. Key hook can become oversized and dominant.
- **1200×628 (Wide):** Copy + CTA on left 40–45%. Visual / atmosphere on right 55–60%. No tall stacked text. Strong horizontal campaign composition.
- **9:16 (Story / Reel):** Title top 20–30%. Visual center 40–50%. CTA bottom-center if present. All content inside mobile safe zones.
- **3:4 (Portrait):** Title upper. Visual center. CTA lower. Premium editorial/poster feel, but still campaign-designed.
- **16:9 (Landscape / Hero):** Title + CTA in left third or left 40%. Large visual atmosphere on right. Wide cinematic campaign layout, not a photo with text.

### Campaign element manifest — KEPT, scope clarified

Recomps preserve **design assets**, NOT physical props:

- title hierarchy
- highlight treatment
- CTA treatment
- main visual metaphor
- market atmosphere
- color system
- graphic panel style
- hero subject type (only if a subject was the actual concept)

Recomps do NOT force preservation of desk · lamp · notebook · coffee cup · chip · laptop · monitor — unless those were the actual selected concept.

### Auto mode — KEPT, restated

In **"Claude decides automatically"** (Phase 0.45), Claude internally generates **3** candidate campaign directions per concept:

1. Typography-led poster
2. Local hero campaign
3. Cultural / environment campaign

Then picks the strongest for title + LP. **Only** falls back to office / analyst / finance-desk if it is explicitly the strongest answer, never as the default.

### Phase 2.5 — MVP cliché QA + auto-redo — KEPT, simplified questions

After MVP generation, before designer review, Claude internally answers:

1. Does this look like a campaign poster or a photoshoot?
2. Is the title / offer the hero?
3. Is the graphic design layer visible?
4. Is the palette too dark / corporate?
5. Did it create office / desk / lamp / analyst cliché?
6. Does it feel close to the user's regional-campaign reference style?

If any answer is "wrong," auto-redo **once** with this correction:

> *Previous result looked too much like a dark editorial / finance photo. Regenerate as a bold localized campaign poster with oversized typography, visible graphic panels, brighter premium palette, local atmosphere, and no office / desk / lamp / analyst props.*

### Carried over from v2.6 (still in effect)

- Campaign-poster-first creative ceiling (no dark editorial office scenes)
- Forbidden default style drivers (editorial portrait, walnut desk, brass lamp, notebook, coffee cup, AI chip on desk, dark prestige finance)
- 5 Creative Archetypes campaign-first (Local Hero / Premium Offer Poster / Editorial Lifestyle Campaign / Cultural Prestige / Minimal Typographic)
- Typography Hero Rule (numbers / % / strong claims → typography is hero)
- "Continuous full-canvas promotional campaign composition" background rule (no split panel, no office scene)
- Nordic / Swedish campaign cues (Stockholm waterfront, blue + ivory + gold + neon, NEVER desk + lamp)
- Phase 0.4 size selection poll (BLOCKING unless sizes in input)
- Phase 0.45 creative control mode (BLOCKING — Customize vs Auto)
- Phase 0.5 polls run ONLY in Customize mode
- Stacked vs Inline highlight mode (formula-based)
- CTA color tier rule (Tier 1 highlight ≠ Tier 2 CTA hex)
- Title block height = `clamp(canvas_h × 0.22, 180, 480) px`
- CTA height = `clamp(canvas_h × 0.08, 80, 160) px`
- Subject vertical fill 45–55% for TALL / PORTRAIT *when* a subject is used
- Phase 6.5 silent visual QA before paint
- Multi-concept support, market exclusion lists, safe-area-from-fill-math
- Hard ban on readable invented text in screens / charts / UI
- Hard ban on hard split-panel layout
- Verbatim Title + CTA
- Queue-aware polling (extends past t+5min, hard cap t+30min)
- Cross-check `show_generations` if `job_display` returns empty (new tip from v2.6 problem-list)

---

## Architecture

| Layer | Audience | What it is | Length |
|---|---|---|---|
| **§ Design Framework** | Claude only | Principle-driven brief system — campaign understanding, layout locks, hard guardrails | No cap |
| **Creative Card** | Claude only | 9-line per-concept brief extracted in Phase 1.0 | ~ 9 lines |
| **§ Visual Prompt** | GPT Image 2 | Short creative brief — Format + market + mood → Campaign-poster direction → Layout lock → Visual atmosphere → Copy / CTA → Constraints | **450–750 chars preferred, ≤900 hard** |
| **§ Recomposition Prompt** | GPT Image 2 | Layout redesign per format — same campaign, new spatial structure | **≤1,200 chars** |

Workflow:

1. **Parse + pre-flight.** Validate Figma URL has `node-id`, parse Title(s) + CTA + (optional) sizes, run egress + MCP connectivity checks. Fail-fast on missing required input.
2. **LP hero read.** Direct `get_screenshot` call on the user-provided node-id. Retry-on-session-expired.
3. **Phase 0.4 — Size selection poll** (BLOCKING). Skip if sizes were passed in input.
4. **Phase 0.45 — Creative control mode poll** (BLOCKING). Customize vs Auto.
5. **Phase 0.5 — Creative polls** (per concept). RUN ONLY in Customize mode. In Auto mode, internally generate 3 campaign directions and pick silently.
6. **Phase 1.0 — Creative Card.** Extract a tight 9-line card per concept. No more 8-step scene reasoning.
7. **Phase 1 — Compose short Higgsfield prompt.** 6 sections, ≤900 chars hard.
8. **Phase 2 — Render MVP at 1200×1200** per concept (parallel).
9. **Phase 2.5 — MVP cliché QA + auto-redo.** 6-question check; 1 corrective retry max.
10. **Phase 3 + 4 — Figma frames + MVP paint.**
11. **Phase 5 — 🛑 Designer review pause.** Per-concept Redo / Continue / Stop.
12. **Phase 6 + 6.5 + 7 — Recomp + silent QA + paint.**
13. **Phase 8 — Summary + problem list.**

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
- **`Title:` line(s).** The full headline copy verbatim. Accept the typo `Tittle:` and the alias `Headline:`. Use the WHOLE title text on the banner — never split into "headline + sub-line". **Multiple `Title:` lines = multiple concepts** rendered in parallel. **Cap at 10 concepts per run.** Customize mode beyond 5 concepts gets click-heavy (each concept = 3 polls, batched into AskUserQuestion calls of max 4 questions each) — recommend Auto mode for N > 5 unless the designer wants per-concept control.
- **`CTA:` line(s)** — OPTIONAL. If a single `CTA:` is given, it applies to every concept. If a per-concept CTA is needed, the caller can repeat `CTA:` lines in the same order as the titles. If absent, Phase 0.5 asks via poll per concept. In Auto mode, Claude picks silently or omits the CTA if the title is self-contained.

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
3. **Egress allowlist check.** Test both hosts in parallel:
   - `https://d8j0ntlcm91z4.cloudfront.net/`
   - `https://mcp.figma.com/`
   Look for `host_not_allowed` in the body (not just any 403 — CDN roots return 403 normally). On allow-list failure, surface and ask Continue (no paint) / Stop.

All checks finish in under 2 seconds. Silent on success.

---

## Phase 0 — silent setup

Language, register, and LP context are derived silently.

### Phase 0.1 — language (silent)

Detect from Title + CTA. Labels: `pt-BR`, `pt-PT`, `es-LATAM`, `es-ES`, `English`, `Arabic`, `Hebrew`, `Urdu`, `Farsi`, `Pashto`, `th-TH`, `tr-TR`, `sv-SE`, `de-DE`, otherwise closest. Default `English`.

### Phase 0.2 — register (silent)

Classify from Title + CTA per **§ Register cues**: `aspiration / urgency / provocation / trust / curiosity / empowerment / identity`. Default `curiosity`.

### Phase 0.3 — LP hero (silent, with retry)

1. Call `get_screenshot(fileKey, nodeId, maxDimension=1200)`.
2. **On `session expired`:** retry with 2s then 4s. After 2 retries → fall back to no-LP-context (silent).
3. **On success:** extract a one-line `LP visual style` (palette + tone + setting + LP CTA color if visible + LP purpose). That single line is what the Creative Card consumes. **Do NOT enumerate exact props.**
4. **On any other error:** fall back, record in Phase 8 problem-list.

---

## Phase 0.4 — size selection (BLOCKING)

Skip if sizes were passed in input. Otherwise multi-select poll with the 10 standard options (1200×1200 / 1200×628 / 1080×1920 / 960×1200 / 1920×1080 / 300×250 / 728×90 / 300×600 / All-standard / Custom). 1200×1200 always included as MVP/master unless explicitly excluded.

---

## Phase 0.45 — creative control mode (BLOCKING)

Single-select: Customize direction vs Claude decides automatically.

- **Auto:** skip Phase 0.5. Claude internally generates 3 candidate campaign directions per concept (Typography-led / Local hero / Cultural-environment) and picks the strongest. Office / analyst is NEVER the default.
- **Customize:** run Phase 0.5 polls.

---

## Phase 0.5 — creative polls (CUSTOMIZE MODE ONLY)

Up to 4 polls per concept. Each is short. Multi-concept handling: shared polls (local cues) run once; title-specific polls run per concept.

### Poll 1 — Title highlight

3–4 candidates from the title, ranked by money-element strength (numbers/% > national/identity > intensity verb > else first 1–3 words). Last option always "No highlight".

### Poll 2 — CTA suggestion (only if CTA missing)

3 short CTA candidates ≤ 30 chars, register-appropriate. Last option "No button".

### Poll 3 — Campaign direction (campaign-first)

3 candidate directions from the 3 lanes:

1. **Typography-led poster** — oversized number/phrase dominates, minimal photoreal support.
2. **Local hero campaign** — native subject or local environment, bold title overlay.
3. **Cultural / environment campaign** — local architecture/skyline/cultural identity frames the message.

Plus "Creative AI decides". Each option is specific, distinct, culturally native, connected to LP purpose, and **never a person-in-office cliché**.

### Poll 4 — Local cultural cues (non-English only)

Subtle / Strong / None. Default Subtle.

---

## Phase 1.0 — Creative Card (REPLACES v2.6 8-step reasoning)

Build one Creative Card per concept. Keep each line short. This is the ONLY pre-prompt artifact.

```
Campaign purpose:        <what is being sold + why now>
Market / language:       <e.g. Swedish / Sweden (sv-SE)>
Emotional register:      <register from Phase 0.2>
Primary hook:            <number / phrase / claim that dominates>
Main visual hierarchy:   <hero element + role of any support>
LP visual style:         <one-line from Phase 0.3 — palette + tone, NO prop enumeration>
Required aspect ratios:  <list from Phase 0.4>
Layout lock:             <one-line position rules from § Aspect-Ratio Layout Locks>
Avoid:                   <specific cliché this concept could regress into>
```

**Example:**

```
Campaign purpose:        Swedish investing opportunity around NVIDIA / AI infrastructure.
Market / language:       Swedish / Sweden (sv-SE).
Emotional register:      aspirational, confident.
Primary hook:            "43".
Main visual hierarchy:   "43" is the hero; the title supports it.
LP visual style:         premium, modern, clean, dark-navy + neon-green + ivory.
Required aspect ratios:  1:1, 1200×628, 9:16.
Layout lock:             title prominent, CTA below title if present, hero visual supporting.
Avoid:                   office, analyst portrait, desk, lamp, coffee cup, AI chip still life, fake UI text.
```

**Derived computed values** (kept silent, computed but not enumerated in the prompt):

- Highlight structure mode (Inline / Stacked) — `(highlight_chars × base_size × 1.12) / column_width` → > 0.40 Inline, ≤ 0.40 Stacked.
- CTA color tier — Tier 1 (highlight) = LP accent or register default · Tier 2 (CTA) ≠ Tier 1 · Tier 3 (body) = white on dark, near-black on light.
- Title block height — `clamp(canvas_h × 0.22, 180, 480) px`.

These computed values influence Claude's QA pass but are NOT spelled out in the Higgsfield prompt unless they're load-bearing for layout.

---

## Phase 1 — compose the visual prompt (silent)

Use **§ Visual Prompt Template v2.7** below. **450–750 chars preferred, ≤900 hard.**

Sounds like a creative brief, not a technical document. No prop enumeration. No detailed photo composition. The 6-section structure is enough.

**Render verbatim** every character of Title and CTA. Spell every accent, diacritic, digit exactly. Title visual rows chosen here are pinned for recomps — but Higgsfield is allowed to interpret line breaks naturally; we only enforce the verbatim text.

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
    prompt: <Visual Prompt Template v2.7, filled>
```

**Polling cadence:**

1. First check at **t+60s**.
2. Then every **30s** to t+5min.
3. At **t+180s**, emit `⚠️ MVP still rendering after 180s — continuing.`
4. **Queue-aware extension:** beyond t+5min, keep polling with a `⚠️ Queue is slow — still rendering, continuing.` surface every 2 min. Hard cap **t+30min**.
5. **If `job_display` returns empty `{results: []}` for a known-good job ID, cross-check `show_generations` and look for the ID in the items list** — `job_display` is occasionally flaky. Treat empty responses as transient, not failed.

---

## Phase 2.5 — MVP cliché QA + auto-redo

After every MVP completes (and before Phase 3 / 4 paint), Claude reads the rendered PNG and silently answers:

1. Does this look like a **campaign poster** or a photoshoot?
2. Is the **title / offer the hero**?
3. Is the **graphic design layer visible**?
4. Is the **palette too dark or corporate**?
5. Did it create **office / desk / lamp / analyst cliché**?
6. Does it feel close to a **strong regional-campaign reference**?

If any answer is wrong → auto-redo **once** with this corrective prefix:

> *Previous result looked too much like a dark editorial / finance photo. Regenerate as a bold localized campaign poster with oversized typography, visible graphic panels, brighter premium palette, local atmosphere, and no office / desk / lamp / analyst props.*

Cap: 1 auto-redo per concept. After 1 retry, surface to Phase 5 designer pause regardless.

---

## Phase 3 — create Figma frames

Grid: one row per concept, one column per size. Idempotent placement.

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

```
Single concept:
  Looks good / Redo it (different campaign archetype) / Stop here (skip other sizes).

Multiple concepts:
  All look good / Redo C1 / Redo C2 / Stop here.
```

For 3+ concepts, cap top-level options at 4: `All look good` / `Redo any` / `Stop here` / one most-likely-to-redo Cn. On `Redo any`, a follow-up `AskUserQuestion` lists the specific concepts to choose from (paginated to max 4 per call for ≥ 8 concepts). On "Redo Cn": re-compose with a **different campaign archetype** (not just different props), re-run Phase 2.5 cliché QA, return to Phase 5.

---

## Phase 6 — recompose to non-1:1 sizes

For each non-1:1 size, compose a recomp prompt using **§ Recomposition Prompt Template** (≤ 1,200 chars). Pass the MVP `mvp_job_id` as `medias[].role: "image"`.

**Recomp is layout REDESIGN per format, not resize.** Apply the aspect-ratio layout lock from § Aspect-Ratio Layout Locks.

**Aspect map** (unchanged from v2.6):

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
| 728×90 | 8.089 | 1.778 (16:9) | EXTREME WIDE | ~78% crop — suggest manual design instead |
| 300×600 | 0.500 | 0.5625 (9:16) | TALL | horizontal-axis crop ~11% — heavy |

**Safe-area axis derivation** is unchanged: when `frame_aspect > render_aspect`, crops vertical axis; when `frame_aspect < render_aspect`, crops horizontal axis. If `crop_pct > 5%`, instruct the recomp to leave 8% safe area on the cropping axis. If `crop_pct > 25%`, flag in Phase 8 problem-list.

**Campaign element manifest** from Phase 1.0 is passed verbatim into the recomp prompt. Recomps must preserve design assets (title hierarchy, highlight treatment, CTA treatment, main visual metaphor, market atmosphere, color system, graphic panel style, hero subject type if used) — NOT physical props.

Fire all recomps in parallel. Polling cadence same as Phase 2.

---

## Phase 6.5 — silent visual QA

After all recomps render but before painting:

| Check | If FAIL |
|---|---|
| No hard split-panel layout | auto-retry (critical) |
| Design layer present | auto-retry (critical) |
| Campaign element manifest preserved | flag |
| Title dominance (~22% block height ±5pp) | flag |
| Edge clipping | auto-retry (critical) |
| Alignment per-aspect | flag |
| Highlight treatment | flag |
| Integrated copy zone | flag |
| CTA hex ≠ highlight hex | flag |
| Readable text only = Title + CTA | flag |
| No dark-office regression | auto-retry (critical) |

Critical failures trigger ONE auto-retry with a corrective prompt that names the specific failure. Cap auto-retries at 1 per concept × size.

---

## Phase 7 — paint recomps

Same three-turn parallel pattern as Phase 4.

---

## Phase 8 — summary + problem list

Short success message + Figma file URL. With encountered problems: a separate `⚠️ Problems during this run` block listing concrete issues for the team to upgrade /banner.

---

# § Visual Prompt Template (v2.7 — short creative brief)

**450–750 chars preferred, hard ≤900.** Sounds like a brief, not a photoshoot direction.

```
{W}x{H} premium localized campaign poster for {MARKET}, {REGISTER} mood. Finished paid-social creative, not an editorial office photo.

Main hook: "{highlight phrase}" is the visual hero. Use bold graphic ad layout, oversized typography, premium {palette} color system, clean copy zone, and visible design layer.

Layout: {aspect-ratio layout lock — one sentence}. Title reads exactly: "{Title}". CTA "{CTA}" {CTA placement if present}.

Visual atmosphere: {local market cue, one phrase}, subtle {campaign theme} energy, soft gradients, curved panels, polished campaign lighting. Optional photo-real subject only as support, integrated into the design.

Readable text only: Title and CTA. No logos, no fake UI, no invented text. Avoid {forbidden defaults — short list}.
```

**Filled example — Swedish "43" banner, 1:1:**

```
1200x1200 premium Swedish campaign poster for Sweden, aspirational confident mood. Finished paid-social creative, not an editorial office photo.

Main hook: "43" is the visual hero. Use oversized gold typography, bold blue/gold Scandinavian graphic panels, clean campaign hierarchy, polished premium layout, and subtle AI/market energy.

Layout: title dominates upper-left/center-left, supporting line below, no CTA. Visual support on right/background with Stockholm/Nordic atmosphere, soft skyline depth, gradients, curved panels, and warm campaign lighting.

Readable text only: "43 analytiker säger Stark Köp. AI-handeln är inte över." No logos, no fake UI, no invented text. Avoid office, desk, lamp, notebook, coffee, analyst portrait, trading floor, AI chip still life.
```

(That's ~720 chars — right in the sweet spot.)

**What to NOT include in the Higgsfield prompt:**

- exact person details (age, hair, wardrobe, expression)
- specific room interiors
- detailed prop lists (desk, lamp, notebook, cup)
- 5-layer depth breakdown
- 8-step reasoning narrative
- multiple sub-clauses describing materials, textures, light angles
- enumerated design-layer-rule items (≥3 of 12) — let Higgsfield interpret "visible design layer"
- highlight treatment in 4 dimensions (color + weight + underline + size) — say "oversized [color] typography" and let Higgsfield handle the rest

---

# § Recomposition Prompt Template

≤ 1,200 chars. MVP image provided as `medias[].role: "image"`.

```
RECOMPOSE the attached master (1200×1200) into {W}×{H}. Same campaign, same text, same colors, same typography. NOT a stretch, NOT a crop, NOT a fresh generation. Layout is REDESIGNED for this aspect — never split-panel.

NEW LAYOUT ({WIDE | TALL | LANDSCAPE | PORTRAIT}): {one-sentence per-aspect placement rule from § Aspect-Ratio Layout Locks}.

CAMPAIGN ELEMENT MANIFEST (preserve, reposition, do not remove):
- title hierarchy: <from master>
- highlight treatment: <from master>
- CTA treatment: <from master if any>
- main visual metaphor: <from master>
- market atmosphere: <from master>
- color system: <hex1 + hex2>
- graphic panel style: <from master>
- hero subject type (if used): <from master>

TITLE (verbatim): "{full Title}". CTA "{CTA}" if present. {If TALL or PORTRAIT and a subject is used: subject occupies 45–55% of canvas height.}

SAFE AREA: {only if crop_pct > 5% — "Leave 8% safe area on <vertical | horizontal> axis."}

Constraints: exactly {W}×{H} px. No new content. No watermarks. NO HARD SPLIT-PANEL. NO regression into office / desk / lamp / notebook / coffee / analyst portrait / AI chip still life. Any screen/chart/UI blurred or abstract. {If RTL: keep mirrored direction.}
```

---

# § Design Framework (Claude only)

Never sent to the model. The principles Claude reasons from when composing the brief.

### Six decision principles (campaign-first, v2.7-clarified)

For each banner:

**1. Hook visual** — which element of the Title (number / phrase / claim) is the campaign hero. Drives everything else. Numbers ≥ 2 digits or % or strong single-word claims auto-trigger typography-hero mode.

**2. Layout lock** — the per-aspect-ratio placement rule. Claude enforces; Higgsfield obeys. No improvisation here.

**3. Subject role** — optional support, not hero (unless the brief is explicitly a portrait campaign). Native to market, campaign-style pose. **Claude does not enumerate exact features.** Higgsfield decides the look.

**4. Background atmosphere** — described in 1–2 short phrases ("Stockholm waterfront atmosphere," "São Paulo daylight"). Not a multi-paragraph scene.

**5. Palette** — 2 hex (dominant + accent) + body color. LP-continuity bias. ≥ 4.5:1 button contrast. Tier 1 ≠ Tier 2. Bright enough for paid-social — avoid black + gold by default.

**6. Button (CTA)** — if used: Tier 2 hex, polished campaign button, height = `clamp(canvas_h × 0.08, 80, 160) px`, text 60–80% width, no wrap/clip.

### § Aspect-Ratio Layout Locks (v2.7 — ONE LINE EACH)

These are what go into the Higgsfield prompt under "Layout:".

- **1:1 — SQUARE (master):** *Large title block on left / top-left or center-left. Visual / atmosphere on right or background. CTA below title if present. Key hook can become oversized and dominant.*
- **1200×628 — WIDE:** *Copy + CTA on left 40–45%. Visual / atmosphere on right 55–60%. No tall stacked text. Strong horizontal campaign composition.*
- **9:16 — TALL (Story / Reel):** *Title top 20–30%. Visual center 40–50%. CTA bottom-center if present. Mobile safe zones (top 8%, bottom 12%).*
- **3:4 — PORTRAIT:** *Title upper. Visual center. CTA lower. Premium editorial poster feel, still campaign-designed.*
- **16:9 — LANDSCAPE (Hero):** *Title + CTA in left third or left 40%. Large visual atmosphere on right. Wide cinematic campaign layout, not a photo with text.*

DISPLAY (300×250 / 728×90 / 300×600): heavy crop, Phase 6.5 may flag as unusable. For 728×90 leaderboard, surface in problem-list — manual HTML5 banner is usually better.

### § Creative Archetypes (5 — pick ONE per concept)

All campaign-first. Pick fresh per task. Driven by title content + LP purpose + market.

- **A. Local Hero Campaign** — native subject OR local environment + large campaign title. Local paid-social campaign, not a portrait photo.
- **B. Premium Offer Poster** — huge number / %, bonus, key phrase dominates. Typography is the hero. Best for `+171%`, `100% bonus`, `FREE`, `95%`, `43`.
- **C. Editorial Lifestyle Campaign** — believable person in local lifestyle context, **designed as a poster with visible graphic layer**. Not office portrait.
- **D. Cultural Prestige Campaign** — local architecture / skyline / regional identity frames the message. Modern campaign-grade.
- **E. Minimal Premium Typographic Campaign** — title carries the ad. Strong type, color, subtle local atmosphere, clean graphic structure.

### § What Claude controls vs what Higgsfield controls (v2.7 — the core rule)

**Claude controls (in the prompt):**

- Format + market + mood line
- Which phrase is the hook ("Main hook: '{phrase}' is the visual hero")
- Layout lock (one sentence per aspect ratio)
- Verbatim Title + CTA text
- CTA placement
- Palette names (or hex if LP-derived)
- Local market cue (1–2 words)
- Forbidden defaults (short list, e.g. "Avoid office, desk, lamp, notebook, coffee, analyst portrait, AI chip still life")

**Higgsfield controls (Claude does NOT prescribe):**

- Exact subject features (age, hair, wardrobe, expression)
- Specific room interior, props
- Lighting angle / color temperature
- Decorative ornament style
- How the design layer renders
- Atmospheric depth treatment
- Font choice (Higgsfield will pick something poster-appropriate)

When Claude tries to control Higgsfield's domain, output regresses toward "photoshoot with text overlay." **Stay in your lane.**

### § Background Logic (kept, simplified)

**Use (1–2 short phrases is enough):**
continuous campaign background · graphic panels · soft gradients · local atmosphere · decorative energy · clean copy zone · visual flow between text and hero.

**Avoid:** continuous office scene · realistic desk environment · corporate room · dark luxury interior · flat split panel.

Background should feel **designed**, not just photographed. Do NOT enumerate 5 depth layers in the prompt.

### § Highlight phrase treatment (Claude's internal computation, NOT prompt copy)

Compute and use silently. Output in the prompt as `"oversized [color] typography"` — Higgsfield handles the rest.

Default treatment by register:
- Aspiration / Identity / Empowerment → gold-gradient on letterforms (#D4A017 → #F5C842) + 3px gold underline, weight 900.
- Urgency → solid saturated red (#E54B2C), weight 900.
- Provocation → accent color + 2px outline box at 60% opacity, slightly off-axis.
- Trust → brand color, weight 900, no ornament.
- Curiosity → bold accent + 2px underline at 80% opacity.

**Color-collision fallback:** if highlight color collides with LP palette, force secondary vectors (weight bump, 3px underline, 1.10–1.15× size escalation in Stacked mode). Keep LP-native color; differentiate via type treatment.

**Inline vs Stacked mode (formula):** `(highlight_chars × base_size × 1.12) / column_width` → > 0.40 Inline · ≤ 0.40 Stacked.

### CTA Color Tier rule

- Tier 1 (Highlight) = LP accent OR register default.
- Tier 2 (CTA) = ≠ Tier 1 in hex. If Tier 1 = LP accent (collision), Tier 2 = ~70% lightness of Tier 1 OR sampled from LP's actual CTA button.
- Tier 3 (Body text) = white on dark, near-black on light.

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

### Localization (v2.7 — atmosphere-first allowlists)

These are **one-line** atmosphere cues for the prompt, not prop lists.

- **Nordic / Swedish:** "Stockholm waterfront / Nordic skyline atmosphere, deep navy + ivory + gold / neon-green palette, golden-hour or cool daylight, soft curved panels, minimal-but-bold typographic hierarchy." Swedish market ≠ dark office.
- **DACH:** "Berlin / Zurich / Vienna skyline silhouette, engineering-precision graphic structure, neutral grey + accent palette."
- **LATAM:** "São Paulo / Mexico City warm daylight, terracotta + sun-saturated colors, natural textures."
- **MENA Gulf:** "Gulf skyline silhouette, marble-texture gradient + restrained gold-line ornament framing."
- **East Asia (urban):** "Dense city neon abstracted into color flow, glass-tower silhouette, sleek tech-surface gradient."
- **Thailand:** "Bangkok temple gold-tone + soft warm light, saturated jewel-tone palette, subtle ornamental framing."
- **JP:** "Tokyo / Kyoto refined minimalism, ink-and-gold or refined neon palette, soft architectural silhouette."

**Market exclusion lists** (do-not-invent props/symbols outside their home market):

- Outside the US: no Wall Street bull, no NYSE / NASDAQ, no S&P 500 ticker, no Statue of Liberty, no US flag.
- Outside the UK: no Big Ben, Tower Bridge, Union Jack.
- Outside Japan: no Mt. Fuji, Tokyo Tower, sakura (unless explicit subject).
- Non-target EU markets: no country-flag colors unless the title names the country.

### RTL composition

RTL languages: Arabic (all dialects), Hebrew, Urdu, Farsi, Pashto, Sindhi, Kurdish (Sorani).

- Mirror layout. Hero element / subject LEFT, title stacked right-aligned on RIGHT. Button bottom-LEFT.
- Native typeface (NEVER Latin + RTL fallback). Arabic: Tajawal / Cairo. Hebrew: Heebo / Rubik. Urdu / Farsi: Vazirmatn / Noto Naskh Arabic.
- Slightly looser leading. No kashida-stretching.

### Typography

- LTR headline: Inter (default), Söhne, Helvetica Now.
- Max 2 typefaces. Weights 700–900. No drop shadows, no outlining, no distortion.

### Hard guardrails (non-negotiable)

- **Copy verbatim.** Title and CTA pass unchanged.
- No invented brands, logos, badges.
- No fake mockup chrome (browser bars, mockup phone frames AROUND the banner, "Sponsored" / "Ad" labels).
- No text inside subject (no words on shirts/signs).
- No watermarks, AI marks.
- No mirrored text / mirrored Arabic / Hebrew.
- No Latin fonts forced onto RTL copy.
- No offensive gestures.
- No mixed visual styles within one banner.
- **No dark office / desk / lamp / notebook / coffee / chip-on-desk** as default scene.
- **No black + gold luxury-finance mood** unless the brief explicitly asks.
- **No photograph-with-text-overlay** when a campaign poster is required.
- **Claude does NOT enumerate exact subject features, exact props, or 5-layer depth descriptions in the Higgsfield prompt.**

---

## Final Internal Check (v2.7 — 6 questions before MVP and after)

Before sending the prompt to GPT Image 2, Claude must mentally answer:

1. Does this **sound like a brief** or a photoshoot direction?
2. Is the **title / offer the hero**?
3. Is the **layout lock present** for the aspect ratio?
4. Did I **avoid enumerating** exact features, exact props, exact lighting angles?
5. Did I **name the forbidden defaults** to avoid?
6. Is the prompt **≤ 900 chars** (preferably 450–750)?

If any answer is weak, tighten the prompt before generation.

After MVP renders, the Phase 2.5 cliché QA asks the same set against the rendered image.

The final output should feel like:

> *a localized performance-ad poster*

Not:

> *a premium finance photograph with text overlay*

---

## Constraints

- Visual Prompt 450–750 chars preferred, ≤900 hard.
- Recomp Prompt ≤1,200 hard.
- GPT Image 2 only (`gpt_image_2`). Never substitute.
- Resolution always `1k`.
- MVP always 1200×1200 (1:1).
- MVP is the source of truth for recomps via `medias[].role: "image"`.
- Verbatim Title + CTA.
- **Phase 0.4 size selection BLOCKING** (unless sizes in input).
- **Phase 0.45 creative mode BLOCKING** (Customize vs Auto).
- **Phase 0.5 polls run ONLY in Customize mode.**
- **Auto mode internally generates 3 candidate campaign directions** before picking.
- **Phase 1.0 — Creative Card extraction** (9 lines per concept) replaces v2.6 8-step scene reasoning.
- **Pick ONE of 5 creative archetypes per concept** — no archetype default.
- **Typography Hero Rule:** when title has number / % / strong claim, type is the hero.
- **Background = continuous promotional campaign composition** — NEVER hard split-panel, NEVER dark office scene.
- **Per-aspect layout lock** = one sentence per format (§ Aspect-Ratio Layout Locks).
- **Title visual rows pinned across recomps.**
- **Title block height = clamp(canvas_h × 0.22, 180, 480) px.**
- **CTA height = clamp(canvas_h × 0.08, 80, 160) px.**
- **Subject vertical fill in TALL/PORTRAIT:** 45–55% of canvas height (only when a subject is used).
- **CTA color tier rule:** Tier 1 (highlight) ≠ Tier 2 (CTA) in hex.
- **Highlight structure mode:** Inline vs Stacked from formula.
- **Highlight color-collision fallback** required.
- **Campaign element manifest** (design assets, not physical props) carried into every recomp.
- **Phase 2.5 MVP cliché QA + auto-redo** — 1 corrective retry max before designer pause.
- **Phase 6.5 silent visual QA** before painting recomps.
- **Queue-aware polling:** extend past t+5min, hard cap t+30min. Cross-check `show_generations` if `job_display` returns empty for a known-good job ID.
- **Claude does NOT enumerate exact subject features, exact props, lighting angles, or 5-layer depth** in the Higgsfield prompt.
- Exact pixel sizes.
- Figma is read+write.
- Egress allowlist required: `d8j0ntlcm91z4.cloudfront.net` + `mcp.figma.com`.
- No autonomous commits.
