---
description: Read the LP context from Figma, analyze the copy, propose content-driven visual options via simple clickable polls, render one MVP per pick, pause for designer review in Figma, then recompose every approved MVP into every requested size.
---

# /banner — Designer flow (Higgsfield GPT Image 2 → Figma) v2.1

## What changed in v2.1 (from v2.0)

- **Loose input.** Paste the Figma URL + the full ad copy + sizes — no `Title:` / `cta:` labels needed. Claude analyzes the copy, proposes which line is the headline / sub-line / button, and a simple clickable poll confirms each.
- **"No button" is a first-class option.** If you don't want a CTA, click that — Claude renders a button-less banner with the visual flow ending on the headline.
- **Visual options are LP-derived, not a generic menu.** Phase 0.5 no longer lists "Human / AI Robot / Product / Wild Card." Claude analyzes the LP + copy + register and composes 3–4 specific creative directions tailored to **this** banner's purpose. The "wild card" is now "Creative AI decides" so users know it's a free-form pick.
- **Localization poll.** New optional poll asks whether the banner should include explicit local cultural cues (e.g. Thai-temple silhouette, Mexican plaza palette, Gulf coastline texture) — Yes / Subtle / No.
- **Simpler poll language.** Every poll question is one short sentence. Options are 1–4 words. Descriptions are one short sentence. No jargon.
- **Pre-flight CDN check.** Phase pre-flight tests outbound HTTP to the Higgsfield CDN. If blocked by harness egress (common on cloud Claude Code), surface an early warning + a "continue / abort" poll so the user isn't surprised when paint fails.
- **Retry-on-session-expired for Figma MCP.** Phase 0.4 retries the Figma metadata/screenshot calls 2x with exponential backoff (2s, 4s) before falling back to no-LP-context.
- **Polling cadence tuned.** Phase 2 (MVP render) first check at **t+60s**, then **every 30s**. GPT Image 2 typically takes 60–180s — earlier checks waste tool calls.
- **Backgrounds get permission to breathe.** Dropped the prescriptive "clean 2-stop gradient" rule that was flattening the output. Backgrounds are now scene-driven with depth — *but* the prompt must explicitly call out a clean low-contrast area where the headline + CTA overlay so readability stays high.

---

## Architecture

| Layer | Audience | What it is | Length |
|---|---|---|---|
| **§ Design Framework** | Claude only | Principle-driven design system — five decision principles, hard guardrails (copy verbatim, RTL, localization), no register lookup tables | No cap — never sent to the model |
| **§ Visual Prompt** | GPT Image 2 | A short scene-level brief Claude composes fresh per concept. Names subject, scene, copy verbatim, CTA verbatim, palette mood. Trusts the model on execution. | **~500 chars soft target, ≤800 hard cap** sent to the model |
| **§ Recomposition Prompt** | GPT Image 2 | Spatial translation only — how the master rebuilds for a new aspect. Detail stays high here because consistency lives here. | **≤1,500 chars** sent to the model |

**Claude is the art director, GPT Image 2 is the renderer.** Claude decides the principles per banner; the renderer makes the photograph. The master image (Phase 2) — not the prompt — carries visual identity through to the recompositions.

Workflow:

1. **Pre-flight (Phases 0 → 0.5).** Detect language → register → **auto-screenshot LP hero** → CDN connectivity check → series of simple clickable polls:
   - Headline (pick the line that should be biggest)
   - Sub-line (pick the supporting line, or skip)
   - Button (pick the line, or "no button")
   - Visual direction (pick from 3–4 content-derived options or "Creative AI decides")
   - Local cultural cues (Yes / Subtle / No)
   - Extras (0–3 additional Claude variations)
2. **MVP pass.** Compose N short prompts → render N masters at 1200×1200 in parallel.
3. **Figma scaffold + MVP paint.** Create all N × M frames upfront in a single grouped row → paint MVPs into the 1:1 frames.
4. **🛑 Designer review pause.** AskUserQuestion: Continue / Regenerate one / Stop. User clicks.
5. **Recomp pass.** For each surviving MVP, compose recomp prompts → render every non-1:1 size in parallel (with master as `medias[].role: "image"`).
6. **Final paint + summary.** Paint recomps into their frames → emit summary table.

Figma is both **read** (Phase 0.4 hero screenshot) and **write** (Phase 3 frames + Phase 4/7 image paints).

---

## Input parsing — loose, content-aware

Arguments: `$ARGUMENTS`

The user pastes a Figma URL + the full ad copy + (optionally) sizes. Labels like `Title:` / `cta:` are **not required** — Claude analyzes the copy and asks the user to confirm via polls in Phase 0.5.

Extract:

- **Figma URL** — REQUIRED. Any `https://figma.com/design/<fileKey>/...` link. Extract `fileKey`. Ignore `node-id` / `p` / `t` query params. **This same file is read for the LP hero and written for the banner frames.**
- **Sizes** — OPTIONAL. One or more `WxH` pixel tokens (`1200x1200`, `1200x628`, `960x1200`, ...). Both `x` and `×` accepted. If none provided, ask in Phase 0.5 — never fail.
- **Text lines** — REQUIRED. Every remaining non-empty line in the message becomes a candidate text line. Preserve original order. Don't try to guess which is the headline / CTA — that's resolved by polls in Phase 0.5.
- **Optional explicit labels** — if the user *does* write `Title:` / `Headline:` / `cta:` / `button:`, treat those as pre-confirmed picks and skip the corresponding poll. Labels are a shortcut, not a requirement.

### Only one hard fail

- No Figma URL → `❌ /banner needs a Figma file URL.`
- No text lines → `❌ /banner needs at least one line of banner copy.`

Everything else (sizes, which line is headline, which is sub-line, whether to include a CTA) is resolved by the Phase 0.5 polls — **never** fail on missing labels.

---

## Pre-flight

1. **Resolve GPT Image 2 model id.** Call `models_explore` once with `action=search`, `query="gpt image 2"`, `type=image`, `limit=5`. Pick the model whose id contains `gpt_image_2`. Fall back to literal `gpt_image_2`.
2. **Confirm Figma MCP is connected.** The flow needs `get_screenshot` (Phase 0.4), `use_figma` (Phase 3), and `upload_assets` (Phases 4 + 7). If any are missing, abort early with `❌ /banner needs Figma MCP read+write access.`
3. **CDN connectivity check (NEW in v2.1).** Higgsfield serves rendered banners from CloudFront. Some Claude Code environments (cloud / managed) restrict outbound egress to an allowlist. Test once:
   ```bash
   curl -sS -o /dev/null -w "%{http_code} %{header_json}" --max-time 5 "https://d8j0ntlcm91z4.cloudfront.net/" 2>&1
   ```
   - **HTTP 200/403/404 from CloudFront itself** → egress is open, continue.
   - **HTTP 403 with `x-deny-reason: host_not_allowed`** → harness is blocking the host. Surface:
     ```
     ⚠️ Your Claude Code environment blocks outbound HTTP to the Higgsfield CDN (d8j0ntlcm91z4.cloudfront.net). /banner can generate images and create Figma frames, but the final paint step will fail. To fix: add the host to your harness allowlist, or run /banner from a local Claude Code where egress is unrestricted.
     ```
     Then ask via `AskUserQuestion` (single-select, 2 options):
     - **Continue anyway** — you'll get image URLs you can drag into Figma manually
     - **Stop here** — abort before spending Higgsfield credits

   This check fires **before** any Higgsfield call so the user doesn't pay credits for a broken paint.

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

### Phase 0.4 — AUTO LP hero context (mandatory, with retry — v2.1 update)

Claude reads the LP hero directly from the Figma file. No user attachment needed.

**Tool sequence with retry-on-session-expired (NEW in v2.1):**

1. **Locate the hero node.** Call `get_metadata` on the file with `fileKey`. From the returned tree, pick the first frame whose name matches (case-insensitive): `hero`, `Hero`, `Hero Section`, `Above the fold`, `Top`, or `Header`. Prefer the largest-width such frame (desktop breakpoint). If none match, fall back to the FIRST top-level frame on the page.
2. **Screenshot it.** Call `get_screenshot` with `fileKey` + the located `nodeId`. Capture the returned image.
3. **Analyze silently.** Extract:
   - **Subject archetype.** Human (and which demographic — Western / LATAM / MENA / SEA / mixed) / AI or robot / product-only / abstract-illustration / no hero visual.
   - **Palette.** Top 3 dominant hex codes visible in the screenshot. Read off the pixels — don't guess.
   - **Tone.** Aspirational / urgent / contrarian / trustworthy / curious / empowering / identity-led.
   - **Setting.** Office / outdoors / studio / abstract / domestic.
   - **Purpose hint.** A one-line read of *what the LP is selling* (e.g. "first-deposit-double bonus for Thai retail traders + investing academy"). This feeds Phase 0.5's content-driven visual options.

**Retry rules (v2.1).** Both `get_metadata` and `get_screenshot` can return `session expired` mid-run. On that specific error:
- Retry 1: wait 2s, retry the call.
- Retry 2: wait 4s, retry the call.
- After retry 2 fails: fall back to no-LP-context (the fail-soft path below).

Don't retry on any other error type — those usually mean the node doesn't exist or the file is permission-locked, and retrying won't fix it.

**Surface one line:**

```
🖼️ LP: <one-line purpose>. Subject <archetype>. Palette <hex1> · <hex2> · <hex3>. Tone: <tone>.
```

Examples:
- `🖼️ LP: first-deposit bonus + investing academy for Thai retail. Subject: human (Thai, 30s). Palette #0E3B2E · #D4A017 · #F5EFE3. Tone: aspirational.`
- `🖼️ LP: AI-stock-tip subscription for Brazil. Subject: AI robot. Palette #1A1A2E · #6B5BFF · #F4F6F8. Tone: curious.`

**Fail-soft.** If the hero node can't be found or both retries error out, surface `⚠️ LP hero auto-read failed — proceeding without LP continuity. Visual options will derive from copy + register only.` and continue. Don't block.

**Cache the result** keyed by `fileKey + nodeId` so re-running /banner on the same LP doesn't re-screenshot.

### Phase 0.5 — series of simple clickable polls (BLOCKING)

This phase blocks for a sequence of `AskUserQuestion` polls. All clickable. **No jargon.** Each poll question is one short sentence; each option label is 1–4 words; each description is one short sentence.

The polls run in order. Some are skipped automatically if input already provided the answer (e.g. user wrote `Title:` → skip the headline poll; user provided sizes → skip the size poll).

#### Poll A — Sizes (skip if user already provided sizes)

```
AskUserQuestion {
  question: "What sizes do you need?",
  header: "Sizes",
  multiSelect: true,
  options: [
    { label: "1200×1200 square",   description: "Instagram feed. Required as the master." },
    { label: "1200×628 landscape", description: "Facebook / LinkedIn link card." },
    { label: "1080×1350 portrait", description: "Instagram portrait, max feed space." },
    { label: "1080×1920 story",    description: "Story / Reel / TikTok vertical." }
  ]
}
```

If user picks 0 sizes (deselects all), default to `1200×1200` and continue. Always include 1200×1200 even if user didn't tick it — it's the mandatory master.

#### Poll B — Headline (the biggest text on the banner)

Compose options from the parsed text lines. Show **up to 4** options (if more lines, surface the 4 most-likely candidates ranked by length + position). Each option's description includes a one-line English meaning so the user can pick fast even in a non-English script.

```
AskUserQuestion {
  question: "Which line should be the biggest text?",
  header: "Headline",
  multiSelect: false,
  options: [
    { label: "Line 1",  description: "<first 60 chars of the line> — <1-line English meaning>" },
    { label: "Line 2",  description: "<first 60 chars of the line> — <1-line English meaning>" },
    { label: "Line 3",  description: "<first 60 chars of the line> — <1-line English meaning>" },
    { label: "Line 4",  description: "<first 60 chars of the line> — <1-line English meaning>" }
  ]
}
```

Label one option `"<Line N>  (Recommended)"` if Claude's content analysis surfaces a clear winner (shortest punchy line / strongest money-element / matches the LP's call-out).

#### Poll C — Sub-line (the supporting text — optional)

Show the remaining text lines (the ones not picked as Headline). Same format as Poll B.

```
AskUserQuestion {
  question: "Any supporting text under the headline?",
  header: "Sub-line",
  multiSelect: false,
  options: [
    { label: "Line X",  description: "<60 chars> — <meaning>" },
    { label: "Line Y",  description: "<60 chars> — <meaning>" },
    { label: "No sub-line", description: "Headline only — keep it clean." }
  ]
}
```

#### Poll D — Button (CTA)

Show the remaining text lines + a "No button" option. **First-class no-button path.**

```
AskUserQuestion {
  question: "Which line goes on the button?",
  header: "Button",
  multiSelect: false,
  options: [
    { label: "Line X",  description: "<60 chars> — <meaning>" },
    { label: "Line Y",  description: "<60 chars> — <meaning>" },
    { label: "No button", description: "Skip the CTA — visual flow ends on the headline." }
  ]
}
```

If user picks **No button**: set `CTA = null`. Phase 1 prompts will say "No button on the canvas; flow ends on headline." Frames are still created normally; the rendered banner just has no button element.

#### Poll E — Visual direction (content-driven, NEW in v2.1)

**This is where Claude earns its keep.** Claude composes 3–4 *specific* directions for this banner — not a generic category menu. Each direction is grounded in the LP purpose + register + market + copy.

**How to compose options:**

1. Read the LP purpose (from Phase 0.4).
2. Read the headline + sub-line meaning.
3. Read the register (Phase 0.3) and the language (Phase 0).
4. Compose 3 directions that each:
   - Connect to the LP's *promise* (not just its aesthetic)
   - Are *visually distinct* from each other (different subject, setting, lighting, or emotional cue)
   - Are *culturally native* to the LANGUAGE market
5. Add a 4th option: `"Creative AI decides"` — Claude picks freely, no constraints beyond cultural-safety + copy-verbatim.

**Example** (Thai LP, first-deposit-doubling bonus, aspirational register):

```
AskUserQuestion {
  question: "What should the banner show?",
  header: "Visual",
  multiSelect: false,
  options: [
    {
      label: "Thai trader, the moment of doubling",
      description: "Photoreal Thai person, late 20s, looking at a phone where their balance just doubled. Warm urban background. Mirror-the-customer."
    },
    {
      label: "Money transforming — 1 banknote → 2",
      description: "Editorial money-object visual. A Thai baht banknote splits or duplicates with motion. No human."
    },
    {
      label: "Academy classroom + first win",
      description: "Photoreal Thai student in a warm-lit Academy setting, phone showing first-trade success. Emphasizes 'learn + invest'."
    },
    {
      label: "Creative AI decides",
      description: "Claude picks freely. Could be anything fitting the copy + register."
    }
  ]
}
```

**Counter-example — what NOT to do** (the v2.0 failure mode): showing a generic "Human / AI Robot / Product / Wild card" menu that has nothing to do with this specific Thai deposit-doubling LP. Even if AI Robot is technically an option, it has no connection to the banner's purpose, so it should not appear.

**LP-failed fallback.** If Phase 0.4 failed, the 3 directions still must be content-driven — Claude derives them from headline + sub-line + register + language, just without the LP archetype/palette bias.

**Capture:** `picked_direction` (one item, 1–4).

#### Poll F — Localization cues (NEW in v2.1)

Optional poll. Skip entirely for `English` language unless the copy has identity-hook cues (Brazilian, Mexican, Gulf, etc).

```
AskUserQuestion {
  question: "Want explicit local cultural cues?",
  header: "Local cues",
  multiSelect: false,
  options: [
    { label: "Yes — make it visibly local", description: "Architecture, flag colors, traditional dress, regional skyline cues. Bold local signature." },
    { label: "Subtle — hint, don't shout",   description: "Native subject features and a small regional cue (e.g. a city skyline silhouette). Default for non-English markets." },
    { label: "No — just match the language", description: "Native subject features only. No flags, no architecture, no overt local props." }
  ]
}
```

`Subtle` is the recommended default for non-English markets. `Yes` is for identity-led copy ("O Brasil," "ประเทศไทย," "للعرب"). `No` is for clean SaaS / institutional banners.

#### Poll G — Extras count

```
AskUserQuestion {
  question: "Want more banner ideas?",
  header: "More ideas",
  multiSelect: false,
  options: [
    { label: "Just this one",       description: "1 banner concept. Fastest." },
    { label: "Add 1 more",          description: "2 total. A bit more variety." },
    { label: "Add 2 more",          description: "3 total. Good for A/B testing." },
    { label: "Add 3 more (max)",    description: "4 total. Maximum variety in one run." }
  ]
}
```

**Capture:** `extras_count` (0–3).

**Total concepts** `N = 1 + extras_count` (range 1–4). The user's picked direction is concept 1. Each extra is a fresh content-driven direction Claude composes (distinct from concept 1 + every previous extra).

**Re-emit cost preview** with the final N (see Phase 0.2):

```
🧾 Confirmed: <N> banner(s) × <M> size(s) = <N + N×(M-1_non_1x1)> generation(s). Generating…
```

**Other-answer handling.** If the user picks "Other" on any poll and types free-form, treat it as a hint. Phase 1 biases decisions toward the typed description while keeping cultural-safety + copy-verbatim + RTL non-negotiable.

**No timeout / no skip.** All polls block. Headless / scheduled runs abort: `❌ /banner needs interactive picks — re-run when available.`

---

## Phase 1 — compose N visual prompts (silent)

For each concept in the concept list, compose ONE visual prompt using **§ Visual Prompt Template**. Soft target ~500 characters; hard cap 800.

**Decide per concept on the spot** (no register lookup tables):

1. **Subject.** Concrete one-line subject derived from the concept's specific direction (from Poll E) + LANGUAGE + LP demographic. If sub-line exists, the subject can lean into supporting context (e.g. "holding a phone with a doubled balance" for a deposit-doubling banner).
2. **Scene.** One-line setting with one or two named props. Bias toward the LP setting category for continuity.
3. **Lighting.** One word + direction — "golden-hour side-key," "dramatic low-key," "soft studio." Match the register's mood; if LP has a dominant lighting feel, lean toward it.
4. **Palette.** TWO hex codes max in the prompt — one for the dominant background, one for the accent / CTA. Prefer hex from the LP palette (Phase 0.4) for continuity; pick the second hex to maximize contrast with the first. If LP failed, pick two hex that fit the register mood.
5. **Background depth (v2.1 — adaptive).** Drop the old "clean 2-stop gradient" prescription. Backgrounds are **scene-driven with depth** — describe the actual environment with light, atmosphere, depth of field, optional foreground/midground/background separation. *But* the prompt MUST explicitly call out a **clean low-contrast zone** where the headline + button overlay, so readability is preserved. Phrasing the model should see: `"Reserve a low-contrast area in the [side / corner] of the canvas — softer focus, single tonal direction — where the headline and button overlay cleanly without visual competition."`
6. **CTA.** If `CTA = null` (Poll D = No button), state explicitly: `"No button on the canvas; flow ends on the headline. Use breathing room at the bottom — do not fill with random graphics."` Otherwise: color = highest-contrast hex in the palette; shape (pill or rectangular) decided per concept; height 110–140px on the 1200 canvas; text fills 60–80% of button width — no wrap, no clip.
7. **Sub-line.** If a sub-line was picked in Poll C, render it as a smaller text element below the headline, ~50–60% of headline size, lower weight, same color family or one step softer. If `sub-line = null`, headline stands alone.
8. **Local cues (from Poll F).**
   - `Yes` → include one or two named cultural references in the scene (e.g. "Bangkok temple roofline silhouette visible in the bokeh"; "Mexican tile pattern as a subtle backdrop texture"; "Gulf coastline at sunset behind the subject").
   - `Subtle` → native subject features + one ambient cue only (e.g. "Bangkok skyline at golden hour"). Default.
   - `No` → native features only, no overt cultural props.

**Render in the prompt** (verbatim, no edits): every word of HEADLINE, sub-line (if any), CTA (if any). Spell every accent, every diacritic, every digit exactly.

**Length check after composing.** If filled prompt > 800 chars, tighten by dropping adjectives and merging sentences. Never drop: language, register cue, subject one-liner, scene one-liner, every word of copy, palette hex pair, the "clean low-contrast zone for text" line, the "no button" line if applicable.

For the **Creative AI decides** concept (if picked): drop the register mood constraint. Keep cultural safety + copy-verbatim + RTL + the readability-zone requirement. Otherwise let Claude go strange.

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

**Wait for the slowest.** Polling cadence (v2.1 — tuned to actual GPT Image 2 timings):

1. **First batch check at t+60s** — call `job_display` on every pending `id` in parallel. GPT Image 2 typically takes 60–180s; earlier checks waste tool calls.
2. **Then every 30s,** re-check only pending ids in parallel.
3. **At t+180s,** emit `⚠️ <K> MVP(s) still rendering after 180s — continuing.` Cadence stays at 30s.
4. **Hard cap at t+5min per MVP.** Any still pending after 5min: mark as failed, proceed with the completed set, surface the failed concepts in the summary so the user can retry.

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

Designer reviews the N MVPs in Figma, then clicks. Plain-language poll.

```
AskUserQuestion {
  question: "Banners ready in Figma. What next?",
  header: "Next step",
  multiSelect: false,
  options: [
    { label: "Looks good — make the other sizes", description: "Recompose each banner to every other requested size." },
    { label: "Redo one of them",                  description: "Pick which one to redo. Then check again." },
    { label: "Stop here",                         description: "Keep only the 1200×1200 versions. Skip the other sizes." }
  ]
}
```

**On "Looks good":** proceed to Phase 6.

**On "Redo one of them":** fire a follow-up `AskUserQuestion` listing concepts 1–N (up to 4; if N > 4, split into 4-option chunks):

```
AskUserQuestion {
  question: "Which one to redo?",
  header: "Pick",
  multiSelect: false,
  options: [
    { label: "Banner 1 — <short label>", description: "<one-line subject>." },
    { label: "Banner 2 — <short label>", description: "<one-line subject>." },
    { label: "Banner 3 — <short label>", description: "<one-line subject>." },
    { label: "Banner 4 — <short label>", description: "<one-line subject>." }
  ]
}
```

Re-compose that concept's prompt fresh (Claude varies the subject specifics so the regen isn't identical), render at 1200×1200, paint into the existing frame (overwrite the fill), then **return to Phase 5 — the review pause repeats.** The user can regenerate again or finally proceed.

**On "Stop here":** clean up empty non-1:1 frames for this run (single `use_figma` call iterating over the run's frame ids, removing the ones with empty `fills`), emit a Phase 8 summary with only the MVP rows, exit.

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
1200×1200 banner, [photoreal | illustrated]. {LANGUAGE} ({market}). [register] mood. Direction: [concept's one-line direction from Poll E].

Subject: [one line — nationality, age, expression, wardrobe color, pose. Or "no human; [object] as hero" for product/typography concepts.]

Scene: [one line — setting + 1-2 named props. Atmospheric depth (foreground/midground/background separation, light direction, particles or texture if appropriate). Match LP setting if available.]
[If local cues = Yes: + one named cultural reference in the scene.]
[If local cues = Subtle: + one ambient regional cue.]

Lighting: [one phrase — direction + warmth + mood, e.g. "golden-hour warm side-key, soft rim, shallow DoF".]

Readability zone: reserve a clean low-contrast area in the [side / corner where the text and button overlay] — softer focus, single tonal direction — so the headline and button read cleanly without visual competition.

Layout ({LTR|RTL}): subject on [left|right] half; text block on the [opposite] half, [left|right]-aligned.

Headline (render verbatim, all characters exact):
"[Headline line 1]"
"[Headline line 2 if natural break]"

[If sub-line picked:]
Sub-line under the headline (smaller, ~55% of headline size, lighter weight, same color family or one step softer):
"[sub-line verbatim]"

[If CTA picked:]
Button: [pill | rectangular], 110–140px tall, fill [hex] (highest contrast in palette), text "[CTA verbatim]" in [contrast hex]. Text fills 60–80% of button width — no wrap, no clip.

[If CTA = null:]
No button on the canvas. Flow ends on the headline. Breathing room at the bottom — do not fill with random graphics.

Palette: dominant [hex1], accent [hex2]. Background should feel like a real scene with depth — not a flat gradient. The readability zone above keeps the text area clean.

Render every character of headline, sub-line, and button exactly as written. No invented words, no logos, no watermarks, no "Ad"/"Sponsored" labels, no mockup chrome around the banner.
[If non-English: subject and setting must feel native to {market}. No Western stock-photo defaults.]
[If RTL: subject LEFT half, headline RIGHT-aligned on right half, button bottom-LEFT.]
```

After filling, the prompt reads like a **short photoshoot brief** — enough to disambiguate the subject, scene, and copy, loose enough that the model brings creative execution to the scene, tight enough on the readability zone that the text never gets eaten by the background.

If the filled prompt exceeds 800 chars, tighten by:
1. Dropping adjectives ("warm side-key" not "soft warm side-key with golden bokeh")
2. Merging Scene + Lighting into one line
3. Dropping the second palette hex if the first carries enough mood

Never drop: language, register, copy verbatim, button verbatim (or "No button" line), the **readability zone** line, no-invent constraints, cultural-native flag (non-English), RTL flag (when applicable).

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

### Six decision principles (replace the old register lookup tables)

For each concept, decide on the spot:

**1. Subject** = the concept's specific direction (from Poll E) + (LANGUAGE → market demographics) + (LP demographic if Phase 0.4 succeeded). Make it specific: nationality, age range, expression, one wardrobe garment + color. Authentic to the market — never Western stock defaults for non-English banners. If the concept is product / typography-led, "no human" is a valid subject.

**2. Scene** = a real place + 1–2 named props that fit the copy's narrative. Bias toward matching the LP setting category for continuity. Don't over-describe — one line.

**3. Lighting** = matches register mood. Aspirational → warm/golden. Urgent → harder side / neon edge. Provocation → dramatic low-key. Trust → soft studio. Curiosity → soft directional + slight haze. Empowerment → cinematic mid-key. Identity → warm regional. **No lookup table — pick the descriptor that fits.** Avoid "neutral / balanced studio" unless the register is Trust.

**4. Background depth (v2.1 — adaptive, NOT a flat gradient).** Backgrounds must feel like real scenes with depth — atmospheric, layered, light-modeled. Foreground/midground/background separation, light direction, particles or texture where it fits the scene. The v2.0 "clean 2-stop gradient" rule was producing flat, boring banners — it is removed.

**Readability rule (hard, not soft):** every prompt must explicitly call out a *clean low-contrast zone* on the canvas where the headline + button overlay. This zone is the one place the background is intentionally simpler — softer focus, single tonal direction. The rest of the canvas can be as rich as the scene wants. The text never overlays the busiest part of the background.

**5. Palette** = TWO hex codes max in the prompt. Pick one dominant + one accent.
- **Continuity bias:** if Phase 0.4 succeeded, pull one or both hex from the LP palette.
- **Contrast rule:** the second hex must contrast strongly with the first (≥ 4.5:1 luminance ratio for the button pair, if a button exists).
- **Register flavor:** lean the palette family toward the register's mood, but don't over-prescribe. Aspirational tends warm + deep. Urgent tends dark + saturated accent. Trust tends cool + restrained. Curiosity tends muted + one bold accent.
- Pure `#FFFFFF` is fine if the design calls for it.

**6. Button (CTA).** Two branches:

- **Button picked in Poll D:**
  - Color = highest-contrast hex in the palette.
  - Shape: pill (16–24px radius) for warm / aspirational / curious / empowerment moods; rectangular (4–12px radius) for urgent / trust / institutional moods.
  - Height 110–140px on the 1200 canvas.
  - Text fills 60–80% of button width. **Hard rule:** no wrap, no clip.
  - For RTL: bottom-LEFT at thirds. For LTR: bottom-right or bottom-left at thirds, sharing an x-anchor with the headline text block (right-edge align is the LTR default).

- **No button picked (Poll D = "No button"):**
  - No button-shaped element anywhere on the canvas.
  - Visual flow ends on the headline.
  - Breathing room at the bottom — the prompt must explicitly state "no button; do not invent one; do not fill the bottom with graphics."

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
- Flat single-tone buttons (gradient OR solid — Claude decides per banner)
- "Neutral / balanced studio" lighting (fine for trust-register concepts)
- Symmetric / geometric / abstract backgrounds (let the model decide)
- Pixel-prescribed typography ladder (let the model handle line sizes within the canvas)

### What v2.1 newly bans

- **Flat 2-stop gradient as the entire background.** This was the v2.0 default and it kept producing dead, boring banners. Backgrounds must feel like real scenes with depth. The "readability zone" requirement protects the text — there's no longer a need to flatten the whole canvas to keep copy readable.

The principle: **specify intent, not execution.** Tell the model the scene + mood + copy + button color + readability zone; trust it on the rest.

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
