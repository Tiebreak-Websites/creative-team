---
description: Read the LP context from Figma, let the user pick visual approaches via clickable polls, render one MVP per chosen approach, pause for designer review in Figma, then recompose every approved MVP into every requested size.
---

# /banner — Designer flow (Higgsfield GPT Image 2 → Figma) v2.0

## What changed in v2.0

- **LP context is auto-read from Figma.** No more "drag the screenshot in." Claude calls `get_screenshot` on the same Figma file the banners get painted into and pulls subject archetype + 3 dominant hex + tone. The Figma file is now read AND write.
- **Multi-MVP, no winner pick.** The user picks 1–7 visual approaches in Phase 0.5; every picked approach ships as its own MVP and gets recomposed to every requested size. No "render N, pick 1" — all picked concepts survive.
- **Two clickable polls, no chat typing.** Phase 0.5 uses `AskUserQuestion` (multi-select styles + single-select for extras). Phase 5 uses `AskUserQuestion` to pause between MVP render and recomposition — designer reviews in Figma, clicks Continue / Regenerate / Stop.
- **Adaptive framework.** Register-lookup tables for color / CTA finishing / lighting are gone. Claude decides per banner from LP palette + register + copy. Visual prompt template compressed to ~500 chars soft target (≤800 hard cap).
- **CTR-anxiety rules pruned.** The v1.7/v1.8 "NO highlighter / NO 2-cramped-lines / NO neutral lighting" hard bans are gone — they were producing stiff, blank-feeling banners. Cultural / RTL / brand-safety guardrails stay.

---

## Architecture

| Layer | Audience | What it is | Length |
|---|---|---|---|
| **§ Design Framework** | Claude only | Principle-driven design system — five decision principles, hard guardrails (copy verbatim, RTL, localization), no register lookup tables | No cap — never sent to the model |
| **§ Visual Prompt** | GPT Image 2 | A short scene-level brief Claude composes fresh per concept. Names subject, scene, copy verbatim, CTA verbatim, palette mood. Trusts the model on execution. | **~500 chars soft target, ≤800 hard cap** sent to the model |
| **§ Recomposition Prompt** | GPT Image 2 | Spatial translation only — how the master rebuilds for a new aspect. Detail stays high here because consistency lives here. | **≤1,500 chars** sent to the model |

**Claude is the art director, GPT Image 2 is the renderer.** Claude decides the principles per banner; the renderer makes the photograph. The master image (Phase 2) — not the prompt — carries visual identity through to the recompositions.

Workflow:

1. **Pre-flight (Phases 0–0.5).** Detect language → cost preview → register → **auto-screenshot LP hero** → 2 clickable polls (styles + extras) → user has picked N visual approaches.
2. **MVP pass.** Compose N short prompts → render N masters at 1200×1200 in parallel.
3. **Figma scaffold + MVP paint.** Create all N × M frames upfront in a single grouped row → paint MVPs into the 1:1 frames.
4. **🛑 Designer review pause.** AskUserQuestion: Continue / Regenerate one / Stop. User clicks.
5. **Recomp pass.** For each surviving MVP, compose recomp prompts → render every non-1:1 size in parallel (with master as `medias[].role: "image"`).
6. **Final paint + summary.** Paint recomps into their frames → emit summary table.

Figma is both **read** (Phase 0.4 hero screenshot) and **write** (Phase 3 frames + Phase 4/7 image paints).

---

## Input parsing

Arguments: `$ARGUMENTS`

Pull these from the message (free-form, no rigid syntax):

- **Figma URL** — REQUIRED. Any `https://figma.com/design/<fileKey>/...` link. Extract `fileKey`. Ignore `node-id` / `p` / `t` query params. **This same file is read for the LP hero and written for the banner frames.**
- **Sizes** — REQUIRED. One or more `WxH` pixel tokens (`1200x1200`, `1200x628`, `960x1200`, ...). Both `x` and `×` accepted. Always pixels.
- **Title** — REQUIRED. The full banner copy verbatim. Accept `Title:`, `Tittle:` (common typo), `Headline:`, or an unlabeled line. This becomes the `HERO` slot. Never split, never "improve," never translate.
- **CTA** — REQUIRED. Accept `cta:` / `CTA:` / `button:`. Goes verbatim into the `CTA` slot.

### Hard fail-fast — STOP and error out

- No Figma URL → `❌ /banner needs a Figma file URL.`
- No sizes → `❌ /banner needs at least one size in pixels, e.g. 1200x1200.`
- No title → `❌ /banner needs the title copy verbatim.`
- No CTA → `❌ /banner needs the CTA copy verbatim.`

---

## Pre-flight

1. **Resolve GPT Image 2 model id.** Call `models_explore` once with `action=search`, `query="gpt image 2"`, `type=image`, `limit=5`. Pick the model whose id contains `gpt_image_2`. Fall back to literal `gpt_image_2`.
2. **Confirm Figma MCP is connected.** The flow needs `get_screenshot` (Phase 0.4), `use_figma` (Phase 3), and `upload_assets` (Phases 4 + 7). If any are missing, abort early with `❌ /banner needs Figma MCP read+write access.`

---

## Phase 0 — auto-detect LANGUAGE

Detect from HERO + CTA text. Labels (same as v1.8):

`pt-BR` · `pt-PT` · `es-LATAM` · `es-ES` · `English` · `Arabic` · `Hebrew` · `Urdu` · `Farsi` · `Pashto` · `th-TH` · `tr-TR` · otherwise pick closest from the localization tree; default `English` if unclear.

This label drives subject demographics, typography script, and LTR/RTL flag.

### Phase 0.1 — confirm language (one line, non-blocking)

```
🌐 Detected: <LANGUAGE> (cues: "<cue1>", "<cue2>"). Continuing…
```

Fire and continue. User interrupts if wrong.

### Phase 0.2 — cost preview (one line, non-blocking)

Cost preview now scales with N (chosen approaches) × M (sizes). Compute conservatively assuming all 4 style options + 3 extras = 7 MVPs:

```
🧾 Plan: up to <N_max> approach(es) × <M> size(s) = up to <N_max + N_max × (M-1_for_non_1x1)> Higgsfield generations. Press Esc to abort.
```

Recompute and re-surface after Phase 0.5 with the actual N:

```
🧾 Confirmed: <N> approach(es) × <M> size(s) = <N + N × non_1x1_count> generation(s). Generating…
```

### Phase 0.3 — classify emotional register (silent, then one-line surface)

Read HERO + CTA + LANGUAGE together. Pick exactly ONE primary register from **§ Register cues**. The register is **derived fresh per banner** — never carried over, never preset per vertical.

Surface one line:

```
🎭 Register: <register> (cues: "<cue1>", "<cue2>").
```

The register informs mood, lighting feel, palette family — but no longer dictates exact hex or CTA shape. Those are decided on the spot in Phase 1 from LP + copy.

### Phase 0.4 — AUTO LP hero context (NEW — mandatory, replaces v1.8's optional drag-drop)

Claude reads the LP hero directly from the Figma file. No user attachment needed.

**Tool sequence:**

1. **Locate the hero node.** Call `get_metadata` on the file with `fileKey`. From the returned tree, pick the first frame whose name matches (case-insensitive): `hero`, `Hero`, `Hero Section`, `Above the fold`, `Top`, or `Header`. Prefer the largest-width such frame (desktop breakpoint). If none match, fall back to the FIRST top-level frame on the page.
2. **Screenshot it.** Call `get_screenshot` with `fileKey` + the located `nodeId`. Capture the returned image.
3. **Analyze silently.** Extract:
   - **Subject archetype.** Human (and which demographic — Western / LATAM / MENA / SEA / mixed) / AI or robot / product-only / abstract-illustration / no hero visual.
   - **Palette.** Top 3 dominant hex codes visible in the screenshot. Read off the pixels — don't guess.
   - **Tone.** Aspirational / urgent / contrarian / trustworthy / curious / empowering / identity-led.
   - **Setting.** Office / outdoors / studio / abstract / domestic.

**Surface one line:**

```
🖼️ LP hero: <subject archetype>, palette <hex1> + <hex2> + <hex3>, <tone>.
```

Examples:
- `🖼️ LP hero: human subject (LATAM, 30s), palette #0E3B2E + #D4A017 + #F5EFE3, aspirational.`
- `🖼️ LP hero: AI robot, palette #1A1A2E + #6B5BFF + #F4F6F8, curious.`

**Fail-soft.** If the hero node can't be found or `get_screenshot` errors, surface `⚠️ LP hero auto-read failed — proceeding without LP continuity.` and continue. Don't block.

**Cache the result** keyed by `fileKey + nodeId` so re-running /banner on the same LP doesn't re-screenshot.

### Phase 0.5 — interactive style + variation polls (TWO clickable polls, BLOCKING)

This phase blocks for two `AskUserQuestion` calls back-to-back. No chat typing.

**Poll #1 — style selection (multi-select).**

```
AskUserQuestion {
  question: "Which visual approaches should ship? Each picked approach becomes one banner concept, recomposed to every requested size.",
  header: "Visual approaches",
  multiSelect: true,
  options: [
    {
      label: "Human — matching LP demographic",
      description: "Photoreal human subject. Demographics match the LP hero's demographic (or the LANGUAGE market if no LP human). Mirror-the-customer approach."
    },
    {
      label: "AI / Robot — culturally adapted",
      description: "Photoreal humanoid AI / robot. Aesthetic register adapted to the market (sleek for Western, ornate for MENA, expressive for LATAM, etc)."
    },
    {
      label: "Mirror LP hero exactly",
      description: "Whatever the LP hero shows — same archetype, same palette, same energy. Maximum visual continuity."
    },
    {
      label: "Wild card — Claude's bold take",
      description: "Claude breaks from defaults. Editorial metaphor, product-as-hero, abstract typography-led, or another unexpected direction that fits the copy + register."
    }
  ]
}
```

Order tweak: if Phase 0.4 succeeded AND the LP archetype clearly matches one option (e.g. LP shows an AI robot), append `"(Recommended)"` to that option's label and surface it FIRST. If LP failed, leave default order.

**Capture:** the user's checked options. Call this set `picked_styles` (1–4 items).

**Poll #2 — extras count (single-select).**

```
AskUserQuestion {
  question: "Add extra Claude-picked variations on top? Each adds one more banner concept that ships alongside your picks.",
  header: "Extras",
  multiSelect: false,
  options: [
    { label: "0 — only my picks (Recommended)", description: "Ship exactly what I selected above. Faster, cheaper." },
    { label: "1 extra Claude variation", description: "Claude picks one additional approach (different subject, different setting, same register and copy)." },
    { label: "2 extra Claude variations", description: "Claude picks two additional approaches. Different from each other and from your picks." },
    { label: "3 extra Claude variations", description: "Claude picks three additional approaches. Maximum variety in one run." }
  ]
}
```

**Capture:** `extras_count` (0–3).

**Total concepts** `N = len(picked_styles) + extras_count` (clamp to 1–7).

**Build the concept list** internally:

- Each picked style → one concept with its archetype.
- Each extra → Claude picks a fresh archetype + setting + lighting that's distinct from every already-chosen concept (no duplicate subjects).

**Re-emit cost preview** with the final N (see Phase 0.2).

**Other-answer handling.** If the user picks "Other" on either poll and types free-form, treat it as a `style:` hint. Add it as one additional concept with the user's description biasing decisions in Phase 1.

**No timeout / no skip.** The polls always block. Headless/scheduled runs that can't show a poll abort: `❌ /banner needs interactive style picks — re-run when available.`

---

## Phase 1 — compose N visual prompts (silent)

For each concept in the concept list, compose ONE visual prompt using **§ Visual Prompt Template**. Soft target ~500 characters; hard cap 800.

**Decide per concept on the spot** (no register lookup tables):

1. **Subject.** Concrete one-line subject — nationality, age, expression, wardrobe color, pose. Driven by the concept's archetype + LANGUAGE + LP demographic.
2. **Scene.** One-line setting with one or two named props. Bias toward the LP setting category for continuity.
3. **Lighting.** One word + direction — "golden-hour side-key," "dramatic low-key," "soft studio." Match the register's mood; if LP has a dominant lighting feel, lean toward it.
4. **Palette.** TWO hex codes max in the prompt — one for the dominant background, one for the accent / CTA. Prefer hex from the LP palette (Phase 0.4) for continuity; pick the second hex to maximize contrast with the first. If LP failed, pick two hex that fit the register mood.
5. **CTA.** Color = highest-contrast hex in the chosen palette. Shape (pill or rectangular) = decided per concept based on mood (pill for warm/aspirational, rectangular for urgent/institutional). Height 110–140px on the 1200 canvas. Critical: CTA text must occupy 60–80% of button width — never wrap, never clip.

**Render in the prompt** (verbatim, no edits): every word of HERO and CTA. Spell every accent, every diacritic, every digit exactly.

**Length check after composing.** If filled prompt > 800 chars, tighten by dropping adjectives and merging sentences. Never drop: language, register cue, subject one-liner, scene one-liner, every word of copy, CTA spec one-liner, palette hex pair.

For the **wild card** concept (if picked): drop the register mood constraint. Keep cultural safety + copy-verbatim + RTL. Otherwise let Claude go strange.

---

## Phase 2 — render N MVPs in parallel

Fire all N `generate_image` calls in a single assistant turn. Each at 1200×1200 / 1:1.

```
mcp__7e69985f-4eb5-4034-a063-d465c056f301__generate_image
  params:
    model: gpt_image_2
    aspect_ratio: "1:1"
    quality: "high"
    resolution: "1k"
    count: 1
    prompt: <the filled visual prompt for concept K>
```

Capture each returned `id` as `mvp_job_id[K]` keyed by concept index.

**Wait for the slowest.** Polling cadence:

1. **First batch check at t+25s** — call `job_display` on every pending `id` in parallel. Collect `rawUrl` for any already-completed.
2. **Then every 8s,** re-check only pending ids in parallel.
3. **At t+120s,** emit `⚠️ <K> MVP(s) still rendering after 120s — continuing.` Drop cadence to every 15s.
4. **Hard cap at t+5min per MVP.** Any still pending after 5min: mark as failed, proceed with the completed set, surface the failed concepts in the Phase 8 summary so the user can retry.

A single MVP failure does NOT abort the run — paint the successes, skip the failures.

---

## Phase 3 — create ALL Figma frames upfront (WRITE)

Create N × M frames in one `use_figma` call. Layout: **single horizontal row, grouped per concept.**

- Within a concept: sizes side-by-side with 100px gap, in user-input order (1:1 first, then non-1:1 in their requested order).
- Between concepts: 200px gap.

**Idempotent placement.** Re-running on the same Figma file MUST NOT overlap prior runs. Scan the page for any existing frame whose name starts with `Banner` and start the new run **below** the lowest existing one with a 200px gap. First-ever run starts at `y=0`.

Frame naming: `Banner — <concept_index>/<approach_label> — <W>x<H>`.

```js
const concepts = [/* injected: [{idx: 1, label: "Human"}, {idx: 2, label: "AI"}, ...] */];
const sizes = [/* injected: [[1200,1200],[1200,628],[960,1200]] */];
const conceptGap = 200;
const sizeGap = 100;
const runStamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

let runY = 0;
for (const node of figma.currentPage.children) {
  if (node.name && node.name.startsWith("Banner") && "y" in node && "height" in node) {
    runY = Math.max(runY, node.y + node.height + 200);
  }
}

let x = 0;
const ids = [];
for (const c of concepts) {
  for (const [w, h] of sizes) {
    const f = figma.createFrame();
    f.name = `Banner — ${c.idx}/${c.label} — ${w}x${h}`;
    f.resize(w, h);
    f.x = x; f.y = runY;
    f.fills = [];
    f.clipsContent = true;
    f.cornerRadius = 0;
    figma.currentPage.appendChild(f);
    ids.push({ concept: c.idx, size: `${w}x${h}`, id: f.id, runStamp });
    x += w + sizeGap;
  }
  x += conceptGap; // gap between concept groups
}
return ids;
```

Capture `runStamp` for the summary so the user can `Cmd+F` later.

---

## Phase 4 — paint N MVPs into their 1:1 frames

For each successful MVP, paint into the concept's 1200×1200 frame using the standard upload flow:

1. `curl -sL -o /tmp/banner/mvp_<K>.png "<rawUrl>"` for every K **in parallel** in one turn.
2. `upload_assets` for every MVP frameNodeId **in parallel** in one turn (`scaleMode: FILL`).
3. `curl -sS -X POST ... --data-binary @...` for every (submitUrl, bytes) pair **in parallel** in one turn.

Three turns total regardless of N. Sequential per-MVP uploads are the most common cause of slow runs — never sequence them.

After paint completes, surface one line:

```
✅ <N> MVP(s) painted into Figma. Run stamp: <runStamp>. File: https://figma.com/design/<fileKey>
```

---

## Phase 5 — 🛑 designer review pause (BLOCKING, clickable)

This pause is the v2.0 contract. Designer reviews the N MVPs in Figma, then clicks.

```
AskUserQuestion {
  question: "Check the <N> MVP(s) in Figma. Continue to recompose every approved MVP into the remaining size(s)?",
  header: "Continue?",
  multiSelect: false,
  options: [
    {
      label: "Continue — recompose all (Recommended)",
      description: "Recompose every MVP to every requested non-1:1 size. <N × non_1x1_count> Higgsfield generation(s)."
    },
    {
      label: "Regenerate one MVP",
      description: "Pick which MVP to regenerate (follow-up poll). The new MVP replaces the current one in its frame, then this pause repeats."
    },
    {
      label: "Stop — MVPs only, no resize",
      description: "Don't recompose. Keep the N MVPs at 1200×1200 only. Delete the empty non-1:1 frames before exiting."
    }
  ]
}
```

**On "Continue":** proceed to Phase 6.

**On "Regenerate one":** fire a follow-up `AskUserQuestion` listing concepts 1–N (up to 4; if N > 4, split into 4-option chunks):

```
AskUserQuestion {
  question: "Which MVP to regenerate?",
  header: "MVP",
  multiSelect: false,
  options: [
    { label: "MVP 1 — <approach label>", description: "Concept 1: <subject one-liner>." },
    { label: "MVP 2 — <approach label>", description: "Concept 2: <subject one-liner>." },
    { label: "MVP 3 — <approach label>", description: "Concept 3: <subject one-liner>." },
    { label: "MVP 4 — <approach label>", description: "Concept 4: <subject one-liner>." }
  ]
}
```

Re-compose that concept's prompt fresh (Claude varies the subject specifics so the regen isn't identical to the first attempt), render at 1200×1200, paint into the existing frame (overwrite the fill), then **return to Phase 5 — the review pause repeats.** The user can regenerate again or finally Continue.

**On "Stop":** clean up empty non-1:1 frames for this run (single `use_figma` call iterating over the run's frame ids, removing the ones with empty `fills`), emit a Phase 8 summary with only the MVP rows, exit.

---

## Phase 6 — compose recomp prompts + render

For every MVP that survived Phase 5, and every non-1:1 size in the user's input, compose ONE recomposition prompt using **§ Recomposition Prompt Template**. Hard cap 1,500 chars per recomp prompt — this is unchanged from v1.8 because consistency is enforced here.

Each recomp passes the corresponding `mvp_job_id` as a `medias[]` entry:

```
mcp__7e69985f-4eb5-4034-a063-d465c056f301__generate_image
  params:
    model: gpt_image_2
    aspect_ratio: <closest supported aspect for this WxH>
    quality: "high"
    resolution: "1k"
    count: 1
    medias:
      - value: <mvp_job_id for this concept>
        role: "image"
    prompt: <the filled recomp prompt for this size>
```

**Aspect mapping** (GPT Image 2 supports `1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3`):

| Requested size | Aspect to request | FILL crop | Recompose? |
|---|---|---|---|
| `1200×1200` (or any square) | `1:1` | none | No — reuse MVP image directly |
| `1200×628`  | `16:9` | ~7% top/bottom | Yes — WIDE |
| `960×1200`  | `3:4`  | ~7% top/bottom | Yes — TALL |
| `1200×960`  | `4:3`  | ~7% left/right | Yes — mild WIDE |
| `1080×1350` | `3:4`  | ~7% top/bottom | Yes — TALL |
| `1080×1920` | `9:16` | none | Yes — TALL |
| `1920×1080` | `16:9` | none | Yes — WIDE |

For sizes not in the table, pick the closest aspect by ratio distance.

**Aspect-mismatch crop rule.** If `abs(frame_aspect - render_aspect) / max(...) * 100 > 5%`, add a line to the recomp prompt: `Leave 8% safe area on <axis> — frame will crop ~7% off those edges.` And tag the row in Phase 8 with `⚠️ ~7% <axis> crop`.

**Fire all recomps for all concepts in parallel** in a single assistant turn. Polling cadence is the same as Phase 2 (first check at t+25s, then every 8s, warn at t+120s, hard cap at t+5min per recomp).

Any single recomp failure does NOT abort the run — paint the successes, report the failures in Phase 8.

---

## Phase 7 — paint recomps into their frames

Same three-step parallel upload pattern as Phase 4:

1. `curl -sL -o /tmp/banner/<concept>_<size>.png "<rawUrl>"` for every recomp **in parallel** in one turn.
2. `upload_assets` for every recomp frameNodeId **in parallel** in one turn.
3. `curl -sS -X POST ... --data-binary @...` for every (submitUrl, bytes) pair **in parallel** in one turn.

Three turns regardless of total recomp count.

For 1:1 sizes other than the MVP itself (user requested multiple squares): reuse the MVP local file — no re-download.

---

## Phase 8 — summary

```
/banner done — <N> concept(s) × <M> size(s) = <N×M> banner(s) painted (<F> failed) · run: <runStamp> · file: https://figma.com/design/<fileKey> · model: gpt_image_2

| Concept | Size      | Source     | Frame node | Job          | Notes                  |
|---      |---        |---         |---         |---           |---                     |
| 1 Human | 1200x1200 | MVP        | 12:345     | <job_id>     | —                      |
| 1 Human | 1200x628  | recomposed | 12:346     | <job_id>     | ⚠️ ~7% top/bottom crop  |
| 1 Human | 960x1200  | recomposed | 12:347     | <job_id>     | ⚠️ ~7% top/bottom crop  |
| 2 AI    | 1200x1200 | MVP        | 12:348     | <job_id>     | —                      |
| 2 AI    | 1200x628  | recomposed | 12:349     | <job_id>     | ❌ timed out — retry    |
| ...     | ...       | ...        | ...        | ...          | ...                    |
```

Notes column rules (one or none per row):
- `⚠️ ~X% <axis> crop` — populated from the aspect-mismatch rule
- `❌ timed out` — recomp didn't complete within Phase 6's 5-min cap; frame exists but is unpainted
- `❌ failed: <reason>` — generation returned `status: failed`
- `—` — clean

End with: `Open the file in Figma to review (search "<runStamp>" to jump to this run). Regenerate any concept by re-running /banner with just that approach picked.`

---

# § Visual Prompt Template

This is the skeleton Claude fills per concept. Replace every `[...]` with the concrete decision. **Total filled length ~500 chars soft target, ≤800 hard cap.** This text — and ONLY this text — gets sent to GPT Image 2.

```
1200×1200 banner, [photoreal | illustrated]. {LANGUAGE} ({market}). [register] mood.

Subject: [one line — nationality, age, expression, wardrobe color, pose. Or "AI robot, [aesthetic descriptor]" for AI concept. Or "[product object] in [framing]" for product concept.]

Scene: [one line — setting + 1-2 named props. Match LP setting if available.]

Lighting: [one phrase — direction + warmth + mood, e.g. "golden-hour warm side-key, soft rim, shallow DoF".]

Layout ({LTR|RTL}): subject on [left|right] half; headline stacked on the [opposite] half, [left|right]-aligned.

Headline copy (render verbatim, all characters exact):
"[HERO line 1]"
"[HERO line 2]"
"[HERO line 3 if applicable]"

CTA: [pill | rectangular] button, 110–140px tall, fill [hex] (highest contrast in palette), text "[CTA verbatim]" in [contrast hex]. Text fills 60–80% of button width — no wrap, no clip.

Palette: dominant [hex1], accent [hex2]. Background = clean 2-stop gradient between these or a thematically coherent variation.

Render every character of headline and CTA exactly as written. No invented words, no logos, no watermarks, no "Ad"/"Sponsored" labels, no mockup chrome around the banner.
[If non-English: subject and setting must feel native to {market}. No Western stock-photo defaults.]
[If RTL: hero subject LEFT half, headline RIGHT-aligned on right half, CTA bottom-LEFT.]
```

After filling, the prompt reads like a **short photoshoot brief** — enough to disambiguate the subject and copy, loose enough that the model brings creative execution.

If the filled prompt exceeds 800 chars, tighten by:
1. Dropping adjectives ("warm side-key" not "soft warm side-key with golden bokeh")
2. Merging Scene + Lighting into one line
3. Dropping the second palette hex if the first carries enough mood

Never drop: language, register, copy verbatim, CTA verbatim, CTA color, no-invent constraints, cultural-native flag (non-English), RTL flag (when applicable).

---

# § Recomposition Prompt Template

This is the skeleton Claude fills per non-1:1 size. The MVP image is provided as `medias[].role: "image"`. **Total filled length ≤ 1,500 chars.** Detail stays high here because consistency lives here.

```
RECOMPOSE the attached master (1200×1200) into {TARGET_WIDTH}×{TARGET_HEIGHT}. Master = single source of truth. Same subject, same text, same colors, same typography, same CTA. Not a stretch, not a crop, not a fresh generation.

NEW LAYOUT ([WIDE | TALL | SQUARE-ISH]):
- Subject: [specific repositioning + framing rule. For TALL, KEEP the MVP's framing — do NOT crop to head-and-shoulders if MVP shows a product in hand. For WIDE, may tighten only if product element relocates as a floating inset. Same wardrobe, same expression, same lighting.].
- Product proof (if MVP had one — phone, laptop, watch): MUST remain visible and legible in the new aspect. Do not remove. Reposition or relocate as floating inset if no in-scene room remains — never delete.
- Headline: [reflow rule — e.g. "stacks on RIGHT 50%, left-aligned, vertically centered, same line-break structure as MVP, sizes scale proportionally to new canvas height". Never cut copy.].
- CTA: [position in new aspect — e.g. "moves to LOWER-RIGHT at thirds intersection. Same color, shape, height-to-canvas ratio. Text fills 60–80% of button width — no wrap, no clip."].
- Background: [base extends along the new long axis — same direction, no seam, no color shift, same palette hex].

SAFE AREA: [if frame_aspect differs from render_aspect by > 5%, add: "Leave 8% safe area on <axis> — frame will crop ~7% off those edges."].

CONSTRAINTS: exactly {TARGET_WIDTH}×{TARGET_HEIGHT} px. No new content, no stretching, no warping, no invented graphics filling new space. No watermarks, no AI marks, no mockup chrome. [If RTL master: keep mirrored direction — subject LEFT, headline RIGHT-aligned, CTA bottom-LEFT.]
```

After filling, this reads as **spatial choreography** — "the master moves here in the new canvas" — not as creative direction.

---

# § Design Framework (Claude only)

The principles Claude reasons from when composing Phase 1 prompts. **Never sent to the model.**

### Five decision principles (replace the old register lookup tables)

For each concept, decide on the spot:

**1. Subject** = (concept archetype) + (LANGUAGE → market demographics) + (LP demographic if Phase 0.4 succeeded). Make it specific: nationality, age range, expression, one wardrobe garment + color. Authentic to the market — never Western stock defaults for non-English banners.

**2. Scene** = a real place + 1–2 named props that fit the copy's narrative. Bias toward matching the LP setting category for continuity. Don't over-describe — one line.

**3. Lighting** = matches register mood. Aspirational → warm/golden. Urgent → harder side / neon edge. Provocation → dramatic low-key. Trust → soft studio. Curiosity → soft directional + slight haze. Empowerment → cinematic mid-key. Identity → warm regional. **No lookup table — pick the descriptor that fits.** Avoid "neutral / balanced studio" unless the register is Trust.

**4. Palette** = TWO hex codes max in the prompt. Pick one dominant + one accent.
- **Continuity bias:** if Phase 0.4 succeeded, pull one or both hex from the LP palette.
- **Contrast rule:** the second hex must contrast strongly with the first (≥ 4.5:1 luminance ratio for the CTA pair).
- **Register flavor:** lean the palette family toward the register's mood, but don't over-prescribe. Aspirational tends warm + deep. Urgent tends dark + saturated accent. Trust tends cool + restrained. Curiosity tends muted + one bold accent.
- Pure `#FFFFFF` is fine if the design calls for it — the old "banned for premium copy" rule is gone. Use what works.

**5. CTA** = highest-contrast hex in the palette. Shape decided per concept:
- Pill (16–24px radius) for warm / aspirational / curious / empowerment moods.
- Rectangular (4–12px radius) for urgent / trust / institutional moods.
- Height 110–140px on the 1200 canvas.
- Text fills 60–80% of button width. **Hard rule:** no wrap, no clip.
- For RTL: bottom-LEFT at thirds. For LTR: bottom-right or bottom-left at thirds, sharing an x-anchor with the headline text block (right-edge align is the default).

### Register cues (classification only — no longer drives exact hex/shape)

| Register | Copy cues |
|---|---|
| **Aspiration / wealth** | Acquisition verbs (buy / invest / earn / comprando / ganar), asset words (stocks / ações / crypto / real estate), growth framing |
| **Urgency / scarcity** | Time pressure (now / agora / ahora / today / last / ends / limited), countdowns |
| **Provocation / contrarian** | Anti-establishment (they don't want you to know / a escola te ensinou / wake up / the truth about) |
| **Trust / institutional** | Authority (official / trusted / regulated / certified / since X / bank names), conservative framing |
| **Curiosity / discovery** | Question-led (Did you know? / What if? / E você? / ¿Y tú? / هل تعلم؟) |
| **Empowerment / transformation** | Self-mastery (take control / unlock / master / your way) |
| **Identity / tribal** | Collective hooks (O Brasil / México / Tu país / Nosotros / للعرب) |

Pick the first register whose cues appear, reading copy left-to-right. Identity layers on top of whichever primary register also applies. Default to **curiosity** if no cue is present (its muted-mood palette is the safest non-flat fallback).

### Slots & verbatim render rules

- `HERO` ← user's Title verbatim. The single dominant phrase.
- `CTA` ← user's CTA verbatim. If empty, no button anywhere on the canvas.
- `LANGUAGE` ← auto-detected per Phase 0.

Every character of HERO and CTA must render with perfect spelling, spacing, punctuation, and accent marks. Never add words, badges, prices, URLs, dates, percentages, disclaimers, or logos not in the slots. Never translate or paraphrase.

### Localization (LANGUAGE drives all imagery, not just script)

1. **Identify the market.** LANGUAGE → primary geographic market. Use copy cues (currency, city names, tickers, dialect markers) to narrow regional variants.
2. **Compose locally.** Every imagery decision (subject ethnicity, age, wardrobe, setting, architecture, lighting, props, color mood, gesture, expression) must feel authentic to that market.
3. **Vary across concepts.** Don't repeat the same subject archetype, setting, or visual treatment across two concepts in the same run.

### Cultural safety checks

- Match subject features, wardrobe, and setting to the actual market — never use Western defaults on non-English banners, never cross-region cues (no Mexican tropes on Brazilian, no Gulf attire on Levantine, no East-Asian features on LATAM).
- Respect regional sensibilities around dress, modesty, religious symbolism, alcohol, gambling, gender representation, and physical contact. Default to neutral professional or aspirational framing when uncertain.
- Avoid gestures flagged in the target market: thumbs-up in parts of MENA + W.Africa; OK sign in Brazil, Turkey, parts of MENA; index-finger pointing across much of Asia and MENA; prominent left-hand display in MENA + S.Asia.
- Apply color meaning to the market: red = loss in Western finance, luck in CN; green positive in West, political/religious in MENA; white premium in West, mourning in EA; gold premium in Gulf + EA + LATAM.

### RTL composition & typography

RTL languages: Arabic (all dialects), Hebrew, Urdu, Farsi/Persian, Pashto, Sindhi, Kurdish (Sorani).

When LANGUAGE is RTL:
- Mirror the layout. Subject on LEFT half. Headline stacked, right-aligned, on RIGHT half.
- CTA placement: bottom-LEFT at thirds intersection.
- Visual flow: HERO (top-right) → CTA (bottom-left).
- If a human subject is present, direct gaze / body angle toward the LEFT.
- All punctuation in correct RTL form. Numbers, percentages, tickers, Latin-script brand names render LTR even inside an RTL line.
- Line breaks at Arabic word boundaries — never mid-character or mid-ligature.

RTL typography:
- Use Arabic-native typefaces, NEVER Latin fonts with Arabic fallbacks.
- Arabic: Tajawal (default) or Cairo.
- Hebrew: Heebo or Rubik.
- Urdu/Farsi: Vazirmatn or Noto Naskh Arabic.
- Headline weight 700–800. Slightly looser leading than Latin equivalent. Never condense. No kashida-stretching, no decorative effects on letterforms.

### LTR composition

- Subject on one half (left or right). Headline stacked on the opposite half, left-aligned.
- CTA at a strong third intersection, sharing an x-anchor with the headline text block (right-edge align is the LTR default).
- If no CTA: visual flow ends on the headline. Use breathing room — don't fill the space.
- ~60px safe area from the canvas edges for critical text and CTA.

### Typography

- LTR headline: Inter (default), Söhne, or Helvetica Now.
- RTL headline: per the RTL typography rules above.
- Maximum 2 typefaces total on a banner.
- Weights: headline 700–900. No drop shadows on text. No outlining, distortion, kashida-justification.

### Hard guardrails (these stay non-negotiable)

- **Copy verbatim.** HERO and CTA pass unchanged into the prompt. No edits, no translations, no improvements.
- **No invented brands.** No logos, app icons, brand marks, or badges not in the content slots.
- **No fake UI chrome.** No browser bars, mockup phone frames around the entire banner, "Sponsored"/"Ad" labels, mock notifications. (Exception: a phone HELD BY the subject in the scene is allowed and counts as the product proof, not chrome.)
- **No text inside the subject.** No words on shirts, signs, posters — unless that exact text is in the content slots.
- **No watermarks, signatures, AI artifact marks.**
- **No duplicated or mirrored text** anywhere on the canvas.
- **No mirrored or reversed Arabic/Hebrew letterforms.** RTL renders in its native direction.
- **No Latin fonts forced onto Arabic/Hebrew copy.**
- **No cross-region cultural mismatches.**
- **No gestures flagged as offensive in the target market.**
- **No repeated subject across concepts** in the same run. Each concept must be visually distinct from the others (different archetype OR different setting OR different lighting).
- **No mixed visual styles** (photo + vector together) within one concept.

### What's no longer banned (pruned in v2.0 — these were producing flat output)

- Yellow / highlighter accent treatments (use whatever fits the palette)
- 2-line cramped headlines (Claude decides line breaks per concept)
- Pure white neutral (`#FFFFFF` is fine if the design calls for it)
- Flat single-tone CTAs (gradient OR solid — Claude decides)
- Flat backgrounds without an ornament (add depth only if the concept needs it)
- "Neutral / balanced studio" lighting (fine for trust-register concepts)
- Symmetric / geometric / abstract backgrounds (let the model decide)
- Pixel-prescribed typography ladder (let the model handle line sizes within the canvas)

The principle: **specify intent, not execution.** Tell the model the scene + mood + copy + CTA color; trust it on the rest.

---

## Constraints — do not violate

- **Prompt length.** Visual Prompt (Phase 1) ~500 chars soft, ≤800 hard. Recomp Prompt (Phase 6) ≤1,500 chars.
- **Framework and guide stay internal.** Never paste any framework text into a `generate_image` prompt.
- **GPT Image 2 only.** Never substitute `soul_2`, `nano_banana_2`, `marketing_studio_image`, etc.
- **Resolution always `1k`.** Both MVP and every recomp.
- **MVP is always 1200×1200 (1:1).** Canvas size locked.
- **MVP is the single source of truth for recompositions.** Every recomp must pass the MVP's `job_id` as `medias[].role: "image"`.
- **Verbatim copy.** HERO and CTA pass through unchanged.
- **Exact pixel sizes.** Frame is W×H to the pixel.
- **Figma is read+write.** Reads: `get_metadata` + `get_screenshot` for LP hero (Phase 0.4). Writes: frames + image fills (Phases 3, 4, 7).
- **No autonomous commits.** Per CLAUDE.md.
