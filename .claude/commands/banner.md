---
description: Render banner concepts with Higgsfield GPT Image 2 and paint them into a Figma file. Strict input. Minimal questions. Silent execution. The user provides Title + CTA + a Figma URL with the hero node pre-selected.
---

# /banner — Designer flow (Higgsfield GPT Image 2 → Figma) v2.2

## What changed in v2.2 (from v2.1)

- **Strict input.** User provides `Title:` and `CTA:` labels and a Figma URL where the hero frame is already selected (URL must contain `node-id=`). No more "guess which line is the headline" polls.
- **One title question, total.** Claude asks which part of the title gets the gold-gradient highlight (money element). That's it. The whole title is rendered as the banner copy — no separate sub-line concept.
- **CTA = button verbatim, or "no button".** If the user provides `CTA:`, that's the button text. If missing, Claude suggests 3 short CTA candidates derived from the copy + "no button" as the last option.
- **No sizes/headline/sub-line/extras polls.** Sizes default to `[1200×1200, 1200×628, 1080×1920]` if not provided. Always 1 banner per run. Want more concepts? Re-run.
- **Hero node is required, not auto-located.** No more `get_metadata` exploration. Claude calls `get_screenshot` directly on the node-id in the URL. If the URL has no `node-id`, fail-fast with a clear instruction to select the hero in Figma and re-paste.
- **Silent execution.** No language-detection lines, no register-classification lines, no cost previews surfaced. Just do the work. Only critical issues surface mid-run. Phase 8 summary surfaces any problems that occurred so the user can upgrade the process.
- **Egress allowlist documented up front.** Cloud Claude Code environments must allowlist `d8j0ntlcm91z4.cloudfront.net` and `mcp.figma.com` before /banner can paint into Figma. Pre-flight checks both and fails fast with the exact hosts.

## Architecture

| Layer | Audience | What it is | Length |
|---|---|---|---|
| **§ Design Framework** | Claude only | Principle-driven design system — adaptive decisions, hard guardrails | No cap |
| **§ Visual Prompt** | GPT Image 2 | A short scene-level brief Claude composes fresh. Names subject, scene, copy verbatim, highlight phrase, CTA verbatim, palette mood. | **~500 chars soft, ≤800 hard** |
| **§ Recomposition Prompt** | GPT Image 2 | Spatial translation — how the master rebuilds for a new aspect. | **≤1,500 chars** |

Workflow:

1. **Parse + pre-flight.** Validate Figma URL has `node-id`, parse Title + CTA, run egress + MCP connectivity checks. Fail-fast on missing required input.
2. **LP hero read.** Direct `get_screenshot` call on the user-provided node-id. Retry-on-session-expired.
3. **Polls (minimal).** Up to 4 short clickable polls — only the ones whose answers aren't already in the input:
   - Title highlight pick (always)
   - CTA suggestion (only if `CTA:` missing)
   - Visual direction (always — content-driven from LP + copy)
   - Local cultural cues (skip for English with no identity hook)
4. **MVP pass.** Compose one short prompt → render 1 master at 1200×1200.
5. **Figma frames + MVP paint.** Create the requested frames → paint the master into the 1:1 frame.
6. **🛑 Designer review pause.** One clickable poll: Continue / Redo / Stop.
7. **Recomp pass.** Recompose master to each non-1:1 size in parallel.
8. **Paint + summary.** Paint recomps. Surface a one-line summary + a problem-list (silent issues found during the run).

---

## Input parsing — strict

The user pastes:

```
/banner <figma-url-with-node-id>
Title: <full title text verbatim>
CTA: <button text verbatim>
[<WxH> ...]   ← optional
```

### Required

- **Figma URL with `node-id`.** Must be `https://figma.com/design/<fileKey>/...?node-id=<X-Y>...`. The user has to pre-select the hero frame in Figma so the URL carries the node-id. Extract both `fileKey` and `nodeId` (convert `X-Y` → `X:Y`).
- **`Title:` line.** The full headline copy verbatim. Accept the typo `Tittle:` and the alias `Headline:`. Use the WHOLE title text on the banner — never split into "headline + sub-line".
- **`CTA:` line** — OPTIONAL. If present, use verbatim on the button. If absent, Phase 0.5 asks via poll (Claude suggests 3 short candidates + "no button").

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
3. **On success:** analyze silently for `subject archetype`, `top 3 hex`, `tone`, `setting`, and a one-line `LP purpose`. Cache by `fileKey + nodeId`.
4. **On any other error:** fall back to no-LP-context. Record in the problem-list for Phase 8.

No status line is surfaced. The LP read informs Phase 0.5's visual-direction poll silently.

---

## Phase 0.5 — minimal polls (BLOCKING, clickable, plain language)

Up to 4 polls. Each one is short. Skip any poll whose answer is already in input.

### Poll 1 — Title highlight (ALWAYS shown)

Compose 3–4 candidate phrases from the title that could carry the gold-gradient highlight. Rank by money-element strength (numbers/% > national/identity hook > intensity verb > else first 1–3 words). Last option is always "highlight whole title" (uniform — no money-element treatment).

```
AskUserQuestion {
  question: "Which part of the title pops?",
  header: "Highlight",
  multiSelect: false,
  options: [
    { label: "<phrase 1>",        description: "<60-char preview of the phrase>" },
    { label: "<phrase 2>",        description: "<60-char preview>" },
    { label: "<phrase 3>",        description: "<60-char preview>" },
    { label: "No highlight",      description: "Render the title uniformly. No gold treatment." }
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

Claude composes 3–4 specific directions for THIS banner — grounded in the LP purpose + title + register + market. NOT a generic category menu.

```
AskUserQuestion {
  question: "What should the banner show?",
  header: "Visual",
  multiSelect: false,
  options: [
    { label: "<specific direction 1>", description: "<concrete subject + setting + lighting>" },
    { label: "<specific direction 2>", description: "<concrete subject + setting + lighting>" },
    { label: "<specific direction 3>", description: "<concrete subject + setting + lighting>" },
    { label: "Creative AI decides",    description: "Claude picks freely." }
  ]
}
```

Each direction MUST connect to the LP's promise (not just its aesthetic), be visually distinct from the others, and be culturally native to the LANGUAGE market.

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

## Phase 1 — compose the visual prompt (silent)

Compose ONE prompt using **§ Visual Prompt Template**. Soft ~500 chars, hard ≤800.

**Decide on the spot from LP + copy + register + market:**

1. **Subject.** From the picked visual direction + LANGUAGE + LP demographic. Specific: nationality, age range, expression, wardrobe color. Authentic to the market. "No human" is valid for product/typography-led directions.
2. **Scene.** A real place + 1–2 named props from the picked direction. Bias toward the LP setting category.
3. **Lighting.** One phrase matching register + LP feel.
4. **Palette.** Two hex codes — dominant + accent. Pull from LP palette when available; ensure ≥ 4.5:1 contrast for the button pair.
5. **Background depth.** Scene-driven, NOT a flat gradient. Atmospheric, layered, light-modeled. **Hard rule:** the prompt must call out a *clean low-contrast zone* where the title + button overlay so readability is preserved.
6. **Highlight phrase.** The user's Poll 1 pick gets a gold-gradient + thin underline treatment (for aspiration / identity / empowerment registers) or a saturated accent letterform treatment (for urgency / provocation / trust / curiosity). If "No highlight" was picked, render the title uniformly.
7. **CTA.** If a CTA was set: highest-contrast palette hex, pill (warm registers) or rectangular (institutional), 110–140px tall, text fills 60–80% button width — no wrap, no clip. If "No button": prompt explicitly states no button, flow ends on title.
8. **Local cues.** From Poll 4 (Subtle / Strong / None).

**Render verbatim** every character of Title and CTA. Spell every accent, diacritic, digit exactly.

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

Capture `mvp_job_id`.

**Polling cadence (silent unless slow):**

1. First check at **t+60s**.
2. Then every **30s**.
3. At **t+180s**, emit `⚠️ MVP still rendering after 180s — continuing.`
4. Hard cap **t+5min** — mark failed, proceed if possible.

---

## Phase 3 — create Figma frames

Single horizontal row, idempotent placement (scan for existing `Banner` frames, start below them).

```js
const sizes = [/* injected */];
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
for (const [w, h] of sizes) {
  const f = figma.createFrame();
  f.name = `Banner — ${w}x${h} — ${runStamp}`;
  f.resize(w, h);
  f.x = x; f.y = runY;
  f.fills = [];
  f.clipsContent = true;
  f.cornerRadius = 0;
  figma.currentPage.appendChild(f);
  ids.push({ size: `${w}x${h}`, id: f.id });
  x += w + sizeGap;
}
return { runStamp, frames: ids };
```

---

## Phase 4 — paint MVP into 1:1 frame

Three parallel turns:

1. `curl -sL -o /tmp/banner/mvp.png "<rawUrl>"` — single bash call.
2. `upload_assets(fileKey, nodeId=<mvp_frame_id>, scaleMode=FILL, count=1)` — returns submit URL on `mcp.figma.com`.
3. `curl -sS -X POST -H "Content-Type: image/png" --data-binary @/tmp/banner/mvp.png "<submitUrl>"` — POST the bytes.

**If Phase 4 fails due to egress block** (caught earlier in pre-flight, but defense-in-depth): record `paint_failed` in the problem-list; surface a one-liner: `⚠️ Paint blocked — MVP available at <rawUrl>. Drag into the 1200×1200 frame manually.` Then skip to Phase 8 (no recomp — pointless without paint).

---

## Phase 5 — 🛑 designer review pause (one short poll)

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

**On "Redo it":** re-compose the prompt with varied subject specifics (different age within range / different prop / different time of day), regenerate at 1200×1200, overwrite the frame fill, return to Phase 5.

**On "Stop here":** delete the empty non-1:1 frames for this run, skip to Phase 8.

---

## Phase 6 — recompose to non-1:1 sizes

For each non-1:1 size, compose a recomp prompt using **§ Recomposition Prompt Template** (≤ 1,500 chars). Pass `mvp_job_id` as `medias[].role: "image"`.

**Aspect map:**

| Size | Aspect | Recompose? |
|---|---|---|
| any 1:1 | 1:1 | reuse MVP |
| 1200×628 | 16:9 | yes (WIDE) |
| 960×1200 / 1080×1350 | 3:4 | yes (TALL) |
| 1200×960 | 4:3 | yes (mild WIDE) |
| 1080×1920 | 9:16 | yes (TALL) |
| 1920×1080 | 16:9 | yes (WIDE) |

If `|frame_aspect − render_aspect| / max(...) > 5%`, add the safe-area line: `Leave 8% safe area on <axis> — frame will crop ~7% off those edges.`

Fire all recomps in parallel. Polling cadence same as Phase 2.

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

The problem list ONLY surfaces issues that were silently handled — egress block, MCP retry-on-session-expired count, recomp failures, etc. It is the channel for the user to see what the spec needs to improve.

---

# § Visual Prompt Template

≤800 chars hard. Whole Title goes in verbatim. Highlight phrase gets the accent treatment. No sub-line concept.

```
1200×1200 banner, photoreal. {LANGUAGE} ({market}). {register} mood. Direction: <one-line from Poll 3>.

Subject: <one line — nationality, age, expression, wardrobe color, pose. Or "no human; <object> as hero">.

Scene: <one line — setting + 1-2 named props. Atmospheric depth.>
[If local cues = Strong: + named cultural reference.]
[If local cues = Subtle: + one ambient regional cue.]

Lighting: <one phrase — direction + warmth + DoF>.

Readability zone: clean low-contrast area on the <side> of the canvas — softer focus, single tonal direction — where the title and button overlay.

Layout ({LTR|RTL}): subject <left|right>; title text on the opposite half, <left|right>-aligned.

Title (render verbatim, exact characters):
"<full title text>"
Highlight: "<phrase from Poll 1>" gets <gold-gradient + thin underline | saturated accent letterforms | uniform> treatment.
[If "No highlight": render the title uniformly, no accent treatment.]

[If CTA picked:]
Button: <pill | rectangular>, 110–140px tall, fill <hex>, text "<CTA verbatim>" in <contrast hex>. Text fills 60–80% button width, no wrap, no clip.

[If CTA = no-button:]
No button on the canvas. Flow ends on the title. Breathing room at the bottom.

Palette: dominant <hex1>, accent <hex2>. Real scene with depth, not flat gradient.

Render every character exactly. No invented logos, watermarks, "Ad" labels, mockup chrome.
[If non-English: native to {market}, no Western defaults.]
[If RTL: subject LEFT, title RIGHT-aligned, button bottom-LEFT.]
```

---

# § Recomposition Prompt Template

≤ 1,500 chars. The MVP image is provided as `medias[].role: "image"`.

```
RECOMPOSE the attached master (1200×1200) into {W}×{H}. Master = source of truth. Same subject, same text, same colors, same typography, same button. Not a stretch, not a crop, not a fresh generation.

NEW LAYOUT (<WIDE | TALL | SQUARE-ISH>):
- Subject: <repositioning + framing rule>. Same wardrobe, expression, lighting.
- Product proof if MVP had one (phone/laptop/watch): MUST remain visible and legible.
- Title: <reflow rule — preserve line-break structure proportionally>. Never cut copy. Highlight phrase keeps its treatment.
- Button if present: <new position>. Same color, shape, height-to-canvas ratio. Text fills 60-80% button width, no wrap, no clip.
- Background: base extends along the new long axis, same palette hex.

SAFE AREA: [if crop > 5%: "Leave 8% safe area on <axis> — frame will crop ~7%."].

CONSTRAINTS: exactly {W}×{H} px. No new content. No watermarks, AI marks, mockup chrome. [If RTL: keep mirrored direction.]
```

---

# § Design Framework (Claude only)

Never sent to the model. The principles Claude reasons from when composing Phase 1.

### Six decision principles

For each banner, decide on the spot:

**1. Subject** = direction (from Poll 3) + LANGUAGE + LP demographic. Specific. Authentic.

**2. Scene** = real place + 1–2 named props that fit the title's narrative. Bias toward LP setting.

**3. Lighting** = register mood. Aspirational → warm/golden. Urgent → harder side / neon edge. Provocation → dramatic low-key. Trust → soft studio. Curiosity → soft directional + slight haze. Empowerment → cinematic mid-key. Identity → warm regional.

**4. Background depth** = scene-driven with atmospheric layering. **Readability rule:** every prompt must call out a clean low-contrast zone where text overlays. Flat 2-stop gradient is banned.

**5. Palette** = 2 hex (dominant + accent). LP-continuity bias if Phase 0.3 succeeded. ≥ 4.5:1 contrast for the button pair.

**6. Button (CTA).** If picked: highest-contrast hex, pill (warm) or rect (institutional), 110–140px tall, text 60–80% of width, no wrap/clip. If "no button": no button-shaped element anywhere on the canvas, flow ends on title.

### Highlight phrase treatment (v2.2 — the one-question outcome)

The user picks which part of the title pops (Poll 1). Treatment by register:

- **Aspiration / Identity / Empowerment** → gold-gradient (#D4A017 → #F5C842) on the letterforms + thin 3px gold underline below those words. Weight 900. No box, no highlighter.
- **Urgency** → solid saturated red (#E54B2C) on the letterforms. Weight 900. Size escalation carries it.
- **Provocation** → accent color on letterforms + 2px outline box at 60% opacity around only those words. Slightly off-axis (1–2°).
- **Trust** → brand color on letterforms. Weight 900. No ornament. Contrast carries it.
- **Curiosity** → bold accent on letterforms + thin 2px underline at 80% opacity.

If user picked "No highlight" → render the title uniformly with no accent treatment. The visual flow rests on lighting + subject + composition.

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

---

## Constraints

- Visual Prompt ~500 soft, ≤800 hard.
- Recomp Prompt ≤1,500.
- GPT Image 2 only. `gpt_image_2`. Never substitute.
- Resolution always `1k`.
- MVP always 1200×1200 (1:1).
- MVP is the source of truth for recomps via `medias[].role: "image"`.
- Verbatim Title + CTA.
- Exact pixel sizes.
- Figma is read+write.
- Egress allowlist required: `d8j0ntlcm91z4.cloudfront.net` + `mcp.figma.com`.
- No autonomous commits.
