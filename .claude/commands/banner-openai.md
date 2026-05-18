---
description: Render banner concepts with OpenAI gpt-image-2 (default) or gpt-image-1-mini (--mini) and paint them into Figma. v2.0 — Claude is the creative director per concept (writes a free-prose creative brief), Python layer carries only system guardrails (layout, button placement, hard negatives, typography rule). MVP-first — 1200×1200 master per concept, then recompose into other sizes via /v1/images/edits. /banner-openai = interactive flow with polls + designer pause. /banner-openai --fast = ship-only, no polls, no pause, requires sizes. Push notification on done.
---

# /banner-openai — OpenAI gpt-image-2 → Figma v2.0

Two flows, one runner. **MVP-first** in both: the 1:1 master is generated first, then every other size is a **recomposition** of that master via `/v1/images/edits`. **Claude is the creative director** per concept — writes a free-prose creative brief; the Python layer only stamps the universal guardrails (premise, hard negatives, aspect-locked layout + button placement, verbatim title, typography rule, RTL rule).

| Command | Polls | Designer pause | Sizes | Notify | Use when |
|---|---|---|---|---|---|
| `/banner-openai ...` | Yes (Phase 2) | Yes (after MVP) | optional | Yes | Default — interactive, designer-driven |
| `/banner-openai --fast ...` | No | No | **required** | Yes | Ship now |
| `/banner-openai --mini ...` | Yes | Yes | optional | Yes | Same flow as default, gpt-image-1-mini model |
| `/banner-openai --fast --mini ...` | No | No | **required** | Yes | Fastest possible preview |

**Reasoning style — strict.** Fast: 1-2 status lines + notification. Casual: one short line per phase + notification + total wall clock. Never narrate the assembled brief. Never show the prompt. The PNG painted into Figma is the deliverable.

---

## Core ruleset (v2.0)

1. **Copy is sacred.** Banner text and CTA text are rendered **verbatim**. Claude never paraphrases, never translates, never abbreviates.
2. **No `CTA:` line → no button.** The literal keyword `CTA:` on its own line is the only trigger for a rendered button.
3. **Hook is a 2–4 word fragment** pulled verbatim from the banner text. Claude picks which fragment, and writes how it's treated.
4. **Hook rotates per concept.** Across N concepts of the same banner text, Claude rotates the hook through different phrases in the copy.
5. **Button color is contrast-first.** Claude picks from the approved 10-pair palette (below) — must contrast strongly against the chosen background, concept fit as tiebreaker.
6. **Button placement is aspect-locked** (not Claude's call) — see the per-size table below. RTL auto-mirrors.
7. **Variance is adaptive.** For N > 1, Claude reads the banner text + LP context and proposes a distribution of visual directions (subject / people / brand-asset / typographic / etc.).
8. **People are photo-real but generic.** Face partially obscured (back of head, profile, over-the-shoulder, hand gesture). Never an identifiable real person.
9. **Backgrounds are thematic for every concept** (including typographic) — tied to the copy theme.
10. **Brand-asset hygiene applies to every concept.** If a brand is named in the copy, render it as text only — never the logo, wordmark, droplet/glyph, branded packaging, branded oil drum, branded fuel pump, or branded signage. Recognizable real-world architecture (Petronas Towers, Burj Khalifa, Eiffel Tower, etc.) is forbidden in all concepts — use abstract silhouettes only. No invented infographic icon rows or feature-grid icons unless the copy explicitly calls for them.
11. **Palette is Claude's call per concept.** LP cache is reference only — Claude can ignore or honor it freely.
12. **Cap of 5 concepts** per run (genuine differentiation gets hard beyond 5).
13. **Visual hierarchy is system-enforced.** With CTA: hook ~30–40% canvas height (prominent, not consuming), body title ~6–8% (legible support), button **LARGE at ~14–18%** (action anchor, command-presence, very generous internal padding). Without CTA: hook bumps to ~40–50%; body + thematic visual share the rest.
14. **CTA text is normalized at runtime.** A single trailing period on the CTA text is stripped automatically (`"Pelajari cara mengikut." → "Pelajari cara mengikut"`) — buttons don't carry sentence-end punctuation. Other punctuation (commas, !, ?) is preserved verbatim.

---

## Approved CTA button colors

Claude picks one combo per concept that has a CTA. Defined in [`prompts.py`](../scripts/banner-openai/prompts.py) and validated at runtime.

| BG | Text | Notes |
|---|---|---|
| `#2563EB` | `#FFFFFF` | blue |
| `#F97316` | `#FFFFFF` | orange |
| `#16A34A` | `#FFFFFF` | green |
| `#DC2626` | `#FFFFFF` | red |
| `#7C3AED` | `#FFFFFF` | violet |
| `#FACC15` | `#111111` | yellow (dark text) |
| `#14B8A6` | `#FFFFFF` | teal |
| `#BE123C` | `#FFFFFF` | rose |

Black (`#111827`) and white (`#FFFFFF`) button backgrounds are deliberately excluded — buttons must read as colored action elements, not chromatic neutrals that blend into the design.

## Aspect-locked button placement

| Size | Button placement |
|---|---|
| `1200x1200`, `1080x1080` | bottom-left, aligned with copy block left edge |
| `1200x628` | bottom-left next to copy block |
| `1080x1920` | bottom-center inside mobile bottom safe zone |
| `1080x1350`, `960x1200` | bottom-left, aligned with copy block left edge |
| `1920x1080` | left third, vertically below copy block |
| `1200x960` | bottom-left next to copy block |

RTL locales (ar/he/ur/fa/ps) auto-mirror these placements (e.g. bottom-left → bottom-right).

---

## Input

```
/banner-openai [--fast] [--mini] [other flags] <figma-url-with-node-id>
Banner text: <full verbatim banner text — may be multiple sentences>
CTA: <button text verbatim>                 ← optional; no CTA line → no button
Sizes: 1200x1200, 1200x628, 1080x1920       ← optional in casual / required in --fast
```

Legacy `Title:` is still accepted as an alias for `Banner text:` (single concept). Multiple `Banner text:` blocks not supported in v2.0 — N concepts come from the concept-count poll in Phase 2.

`Sizes:` always includes `1200x1200` as the MVP master — auto-added if omitted. If the user passes only `1200x1200`, the run skips Phase 5b (recomp) entirely.

### Fail-fast errors (one short line, then stop)

- No `node-id` → `Pick the hero frame in Figma and re-paste the URL.`
- `node-id=0:1` (page root) → `That's the page root, not a hero. Click the LP frame and re-paste.`
- Hero bounds < 800×400 px → `Selected node looks like a sub-element. Pick the hero frame and re-paste.`
- No `Banner text:` → `Need Banner text: <text> on its own line.`
- `--fast` with no sizes → `--fast requires Sizes: W1xH1, W2xH2 (no defaults in fast mode).`
- `OPENAI_API_KEY` missing → `OPENAI_API_KEY not found. Add to .env and re-run.`
- `python --version` fails → `Need Python 3.x on PATH.`
- Concept count > 5 → `Cap is 5 concepts per run — beyond that, genuine differentiation degrades.`

---

## Phase 1 — Setup (silent, parallel)

One Claude turn. Emit nothing in fast; emit `Phase 1: setup` in casual.

1. Resolve `OPENAI_API_KEY` via ordered search: `$env:OPENAI_API_KEY` → `./.env` → `../.env` → `../../.env` → `../../../.env` → `$HOME/.env`. Never echo.
2. Read `.claude/memory/banner_design_framework.md` once (reference only — used by Claude when writing the creative brief in Phase 2).
3. **Hero bounds sanity check** — reject sub-elements (W<800 or H<400 px).
4. **LP context, cache-first** at `.claude/memory/lp_cache/{fileKey}__{nodeId}.json`:
   - Cache hit + fresh → load `lp_visual_style` + `palette_hex` as **reference** for Claude.
   - Cache miss / expired → `get_screenshot(fileKey, nodeId, maxDimension=1200)`, retry 2s+4s on `session expired`, fall back to neutral defaults after 2 retries. Write cache on fresh fetch.
   - `--no-cache` bypasses both read and write.
   - **Note v2.0:** LP cache is reference only — Claude reads it when composing the creative brief and may honor or ignore it per concept. It is NOT auto-injected into the prompt anymore.
5. Language detect from banner text. Drives "local people" + "local atmosphere" choices in Phase 2.
6. RTL flag for `ar / he / ur / fa / ps`.

---

## Phase 2 — Brief (Claude as creative director)

**Fast mode:** No polls. Claude composes the concept(s) silently using the rules below. Skip to Phase 3.

**Casual mode:** Two `AskUserQuestion` calls. Emit `Phase 2: asking` then `Phase 2: brief locked`.

### Casual poll 1 — operational (up to 4 questions):

1. **Sizes** *(skip if user passed `Sizes:` or `--sizes=`)* — multi-select from `1200x1200`, `1200x628`, `1080x1920`, `1080x1350`, `1920x1080`. `1200x1200` always included as MVP master.
2. **Concept count** — `1` / `2` / `3` / `5` (cap 5).
3. **Model** *(skip if user passed `--mini`)* — `gpt-image-2 (quality)` vs `gpt-image-1-mini (faster preview)`.

### Composing N concept dicts (Claude's job)

For each concept, Claude writes a hybrid structured + prose dict. **Hook rotates across concepts**, **palette is Claude's call per concept**, **direction is adaptive** to the copy.

**Variance distribution (Claude proposes — adaptive, not hardcoded).** For N concepts, Claude reads the banner text and LP context, then picks N visual directions that fit. Example for `Banner text: Oil prices fell. The ringgit moved. PETRONAS earnings shifted. CTA: Learn to connect those dots.` at N=5:

- 2 subject-driven (oil barrel / refinery silhouette / commodity atmosphere)
- 2 people-driven (English-language locale, photo-real partial — face obscured)
- 1 brand-asset (PETRONAS-adjacent color + generic product cue — no logo)

Distribution is **proposed in the brief approval poll**, not hardcoded.

**Hook rotation across N concepts.** Pull different 2–4 word fragments from the banner text per concept. For the example above:

- c1: hook `"OIL PRICES FELL"` (typographic, charcoal + saturated orange)
- c2: hook `"THE RINGGIT MOVED"` (subject, refinery atmosphere)
- c3: hook `"PETRONAS EARNINGS SHIFTED"` (brand-asset, brand-adjacent green-teal)
- c4: hook `"CONNECT THE DOTS"` (people, photo-real partial, Asian financial district atmosphere)
- c5: hook `"OIL PRICES FELL"` (people, photo-real partial, trader gesture)

**Creative brief paragraph (~250–400c per concept).** Claude writes prose covering: visual direction, hook treatment (color / weight / placement detail), palette, atmosphere / surface, mood. Free-form — no template, no slots.

**Brief-authoring rules — what NOT to write into the brief:**
- Never name a recognizable real-world building. Use generic descriptors: `"twin-tower skyline silhouette"` not `"Petronas Towers"`; `"Gulf marina skyline"` not `"Burj Al Arab"`; `"European cathedral spires"` not `"Notre-Dame"`.
- Never request the brand's logo, droplet, glyph, wordmark, or branded packaging/signage in the brief — even when the brand is named in the copy. Brand-adjacent color is fine; brand visual mark is not.
- Never request decorative icon rows, infographic icon sets, or feature-grid icons unless the copy explicitly calls for them.
- Never enumerate the subject's exact features (age, hair, exact wardrobe, expression) for people-driven concepts — partial-obscured / over-the-shoulder framing only.

**Button combo.** Picked contrast-first against the background Claude proposed. Tiebreaker = concept-fit (urgency → red, growth → green, attention → yellow/orange, premium → black/white).

### Concept dict (v2.0 — written to manifest.json in Phase 3):

```json
{
  "title": "Oil prices fell. The ringgit moved. PETRONAS earnings shifted.",
  "locale": "en",
  "hook_phrase": "OIL PRICES FELL",
  "creative_brief": "Type-hero poster. Hook in saturated #F97316 filled letters, condensed display weight, anchored upper-left against a deep charcoal matte gradient. Faint refinery silhouette in navy at the lower edge as thematic anchor. Editorial confident, not loud.",
  "cta": "Learn to connect those dots",
  "button_combo": ["#F97316", "#FFFFFF"]
}
```

`cta` + `button_combo` are paired — both present or both absent. `hook_phrase` must be a verbatim case-insensitive substring of `title` (validated by [`prompts.py`](../scripts/banner-openai/prompts.py) at runtime).

### Casual poll 2 — brief approval:

Show one summary line per concept + the proposed distribution:

```
Distribution: 2 typographic · 2 people · 1 brand-asset
c1: typographic · hook "OIL PRICES FELL" · #F97316/#FFFFFF button · charcoal + orange
c2: subject (refinery) · hook "THE RINGGIT MOVED" · #16A34A/#FFFFFF button · navy + teal
c3: brand-asset · hook "PETRONAS EARNINGS SHIFTED" · #14B8A6/#FFFFFF button · brand-adjacent
c4: people · hook "CONNECT THE DOTS" · #2563EB/#FFFFFF button · daylight finance district
c5: people · hook "OIL PRICES FELL" · #DC2626/#FFFFFF button · trader gesture, warm
```

Ask: `Render / Adjust direction / Stop`. `Adjust direction` cap = 2 loops.

---

## Phase 3 — Frames + URLs

One Claude turn. Emit `Phase 3: creating N×M frames` in casual; silent in fast.

1. Single `use_figma` JS call: create all N×M frames sized exactly W×H, named `Banner-OpenAI — {concept} — {W}x{H} — {runStamp}`, placed in a row-per-concept × column-per-size grid offset right of the hero. **Note** the 1200×1200 frame `nodeId` for each concept — that's where the MVP gets painted in Phase 4.
2. Parallel `upload_assets(fileKey, nodeId=<frame_id>, count=1, scaleMode=FILL)` for every frame → one `submitUrl` per frame.
3. Write to the **Windows-side TEMP path** (`$env:TEMP\banner-openai\` or via `cygpath -w`):
   - `manifest.json` — `{ "concepts": { key: <concept dict> } }` — written ONCE, reused by both runner invocations.
   - **No `urls.json` yet** — Phase 4 and Phase 5b each write their own scoped `urls.json`.

Size → openaiSize map (the runner accepts only the 3 OpenAI-supported sizes):

| Frame size | openaiSize |
|---|---|
| 1200x1200, 1080x1080 | `1024x1024` |
| 1200x628, 1920x1080, 1200x960 | `1536x1024` |
| 1080x1920, 1080x1350, 960x1200 | `1024x1536` |

---

## Phase 4 — MVP gen + paint (1200×1200 only)

Emit `Phase 4: rendering MVP` in casual; silent in fast.

1. Write `urls.json` containing **only** the 1200×1200 frame per concept (N rows, mode default `"gen"`).
2. Invoke the runner:
   ```bash
   python -u .claude/scripts/banner-openai/run.py \
     --dir "$(cygpath -w $TEMP)/banner-openai" \
     --concurrency 6 \
     --max-retries 4 \
     --base-backoff 8 \
     --model gpt-image-2   # or gpt-image-1-mini if --mini
   ```
3. Runner streams `[N/total] {label} GEN ok in Xms` per job, paints each MVP into its 1:1 frame via the pre-minted `submitUrl`, writes `results.json` incrementally, and saves the master PNG to `$dir/{concept}__1200x1200.png` (used as input in Phase 5b).

After this phase, the user sees the MVP painted in Figma. In casual mode, this is when the designer pause runs (next).

---

## Phase 5 — Designer pause (casual) + Recomp + paint

### 5a. Designer pause — **CASUAL ONLY**

Emit `Phase 5a: review`. One `AskUserQuestion`:

- **1 concept:** `Looks good / Redo MVP (different direction) / Stop here (skip other sizes)`.
- **Multiple concepts:** cap top-level options at 4 (`All look good`, `Redo any`, `Stop here`, one most-likely concept). On `Redo any` → follow-up question lists concepts to choose from.

On `Redo Cn`: compose a corrective concept dict (different visual direction, different hook fragment if helpful), re-run Phase 4 for that concept only (`--resume` keeps the others), return to 5a.

On `Stop here`: exit. The MVPs already painted in 1:1 frames are the deliverable.

On `Looks good` / `All look good`: proceed to 5b.

**Fast mode:** skip 5a entirely. Auto-continue to 5b.

### 5b. Recomp gen + paint (non-1:1 sizes only)

Emit `Phase 5b: recomposing` in casual; silent in fast. Skip if the user requested only `1200x1200`.

1. Write a new `urls.json` containing **only** the non-1:1 frames per approved concept:
   ```json
   {
     "concept": "c1",
     "size": "1080x1920",
     "openaiSize": "1024x1536",
     "submitUrl": "<from Phase 3>",
     "mode": "edit",
     "master_size": "1200x1200",
     "master_png": "C:/.../Temp/banner-openai/c1__1200x1200.png"
   }
   ```
2. Invoke the runner with `--resume` (preserves MVP rows in `results.json`):
   ```bash
   python -u .claude/scripts/banner-openai/run.py \
     --dir "$(cygpath -w $TEMP)/banner-openai" \
     --concurrency 6 --resume \
     --model gpt-image-2
   ```
3. Per-job, the runner detects `mode: "edit"` and calls `post_images_edits()` — multipart POST to `/v1/images/edits` with the master PNG bytes as `image[]` and the recomp prompt from `prompts.build_recomp_prompt(concept, master_size, target_size)`. Recomp preserves title + hook + CTA + button combo + palette, only the layout and button placement change per aspect.
4. Each successful edit is painted into its frame via the Phase 3 `submitUrl`.

Recomp HTTP errors surface as `edit_http_error` / `edit_failed`; missing master PNG surfaces as `master_missing`. Same exp-backoff retry as gen.

---

## Phase 6 — Deliver + notify

The runner finished. Compute total wall clock from prompt-submit to now. No QA pass, no auto-redo, no Claude-side image inspection. The PNGs are already painted.

**Fast mode output:**
```
✅ N/M painted · {totalSec}s
```
Then `PushNotification`: `Banners Ready ✅ {N}/{M} painted in {totalSec}s`.

**Casual mode output:**
```
✅ N/M painted · {totalSec}s · {figmaUrl pointing at the first frame node}
```
Then `PushNotification`: `Banners Ready ✅ {N}/{M} painted in {totalSec}s · open Figma to view`.

If any frame is not `ok`, append a one-line per-failure note (status + concept + size + short error). No table, no recommendations, no commentary.

**Cap notification body at 200 chars. Lead with the actionable fact.**

---

## Flags

- `--fast` — strip polls, strip designer pause, require sizes, ship-only
- `--mini` — `gpt-image-1-mini` model (same flow as default)
- `--sizes=W1xH1,W2xH2,...` — explicit sizes (alternative to `Sizes:` block)
- `--no-paint` — save PNGs only, skip Figma paint
- `--resume` — re-run skipping frames already `ok` in `results.json`
- `--no-cache` — bypass the LP screenshot cache for this run
- `--no-moderation` — skip pre-flight forbidden-keyword check
- `--concurrency=N` — override runner concurrency (default 6)

Removed in v2.0: `--strict`, `--customize`, `--edit-chain` (default), `--no-qa`, `--no-lp`. The `register` classification, the per-archetype surface table, the auto-injected localization atmosphere, and the 60/30/10 palette allocation rule are all gone — Claude composes those into the creative brief when the concept needs them.

---

## Moderation

Substring scan, case-insensitive, on `title + hook_phrase + creative_brief + cta`. Blocks: politicians, brand-risky real persons, banned visual concepts. Bypass with `--no-moderation`.

---

## Constraints

- Default model `gpt-image-2`; `--mini` swaps to `gpt-image-1-mini`. Quality `medium` (never `high`). Output PNG.
- OpenAI sizes restricted to `1024x1024 / 1024x1536 / 1536x1024`.
- **MVP always 1200×1200** (1:1). All non-1:1 sizes recompose from it via `/v1/images/edits`.
- **Concept cap = 5.** Beyond that, genuine differentiation degrades.
- **Copy verbatim** — never paraphrase the banner text or CTA, never split across panels.
- **Hook = verbatim substring of banner text** — validated at runtime by `prompts.validate_manifest`.
- **Button combo from approved 10-pair palette only** — validated at runtime.
- Pipeline = exactly 5 Claude turns (setup · brief · frames+URLs · MVP gen+paint · recomp gen+paint+notify). In casual, Phase 5a inserts an `AskUserQuestion` turn between MVP paint and recomp.
- Concurrency 6. Figma upload URLs expire after 10 min — current wall clocks stay under that even for ~25-banner runs.
- `OPENAI_API_KEY` never echoed, never committed, never written to any logged command.
- Python 3.x stdlib only.
- No autonomous commits.

---

## Wall clock (3 concepts × 3 sizes, en, cache-hit)

| Mode | MVP gen | Designer pause | Recomp gen | Total |
|---|---|---|---|---|
| `--fast` | ~60-75s | — | ~50-65s (2 sizes × 3 concepts in parallel, mode=edit) | **~115-145s** |
| `--fast --mini` | ~30-40s | — | ~25-35s | **~55-75s** |
| default (casual) | ~60-75s | ~10-20s (1 click) | ~50-65s | **~125-165s** |
| `--mini` (casual) | ~30-40s | ~10-20s | ~25-35s | **~65-95s** |

Per-banner cost: `--fast` ≈ $0.08 (gpt-image-2) / $0.05 (mini). MVP is one gen call per concept; each recomp is one edit call per (concept × non-1:1 size).
