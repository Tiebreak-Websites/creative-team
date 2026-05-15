---
description: Render banner concepts with OpenAI gpt-image-2 (default) or gpt-image-1-mini (--mini) and paint them into Figma. MVP-first — generates a 1200×1200 master per concept, then recomposes (not regenerates) into the other sizes via /v1/images/edits. /banner-openai = interactive flow with polls + designer pause. /banner-openai --fast = ship-only, no polls, no pause, requires sizes. Push notification on done.
---

# /banner-openai — OpenAI gpt-image-2 → Figma v1.9

Two flows, one runner. **MVP-first** in both: the 1:1 master is generated first, then every other size is a **recomposition** of that master via `/v1/images/edits` (not a fresh generation). No cross-aspect divergence.

| Command | Polls | Designer pause | Sizes | Notify | Use when |
|---|---|---|---|---|---|
| `/banner-openai ...` | Yes (Phase 2) | Yes (after MVP) | optional | Yes | Default — interactive, designer-driven |
| `/banner-openai --fast ...` | No | No | **required** | Yes | Ship now |
| `/banner-openai --mini ...` | Yes | Yes | optional | Yes | Same flow as default, gpt-image-1-mini model |
| `/banner-openai --fast --mini ...` | No | No | **required** | Yes | Fastest possible preview |

**Reasoning style — strict.** Fast: 1-2 status lines + notification. Casual: one short line per phase + notification + total wall clock. Never narrate the assembled brief. Never show the prompt. The PNG painted into Figma is the deliverable.

**Why MVP-first.** Mirrors `/banner-higgsfield` v2.7. A fresh generation per size produces 3 slightly different barrels / splashes / skylines — same concept, different compositions. Recomposing from the MVP guarantees the visual elements are *the same*, only the layout changes per aspect. Lower variance, better paid-social consistency.

---

## Input

```
/banner-openai [--fast] [--mini] [other flags] <figma-url-with-node-id>
Title: <full title text verbatim>           ← one or more (each = one concept, cap 10)
CTA: <button text verbatim>                 ← optional
Sizes: 1200x1200, 1200x628, 1080x1920       ← optional in casual / required in --fast
```

`Sizes:` always includes `1200x1200` as the MVP master — auto-added if the user omitted it. If the user passes only `1200x1200`, the run skips Phase 5b (recomp) entirely.

### Fail-fast errors (one short line, then stop)

- No `node-id` → `Pick the hero frame in Figma and re-paste the URL.`
- `node-id=0:1` (page root) → `That's the page root, not a hero. Click the LP frame and re-paste.`
- Hero bounds < 800×400 px → `Selected node looks like a sub-element. Pick the hero frame and re-paste.`
- No `Title:` → `Need Title: <text> on its own line.`
- `--fast` with no sizes → `--fast requires Sizes: W1xH1, W2xH2 (no defaults in fast mode).`
- `OPENAI_API_KEY` missing → `OPENAI_API_KEY not found. Add to .env and re-run.`
- `python --version` fails → `Need Python 3.x on PATH.`

---

## Phase 1 — Setup (silent, parallel)

One Claude turn. Emit nothing in fast; emit `Phase 1: setup` in casual.

1. Resolve `OPENAI_API_KEY` via ordered search: `$env:OPENAI_API_KEY` → `./.env` → `../.env` → `../../.env` → `../../../.env` → `$HOME/.env`. Never echo.
2. Read `.claude/memory/banner_design_framework.md` once.
3. **Hero bounds sanity check** — reject sub-elements (W<800 or H<400 px).
4. **LP context, cache-first** at `.claude/memory/lp_cache/{fileKey}__{nodeId}.json`:
   - Cache hit + fresh → load `lp_visual_style` + `palette_hex`, skip the screenshot fetch.
   - Cache miss / expired → `get_screenshot(fileKey, nodeId, maxDimension=1200)`, retry 2s+4s on `session expired`, fall back to neutral defaults after 2 retries. Write cache on fresh fetch.
   - `--no-cache` bypasses both read and write.
5. Language detect from Title + CTA. RTL flag for `ar / he / ur / fa / ps`.
6. Register classify (`urgency / curiosity / aspiration / provocation / trust / empowerment / identity`).

---

## Phase 2 — Brief

**Fast mode:** No polls. Compose the structured concept dict from inputs + Phase 1 defaults. Skip to Phase 3.

**Casual mode:** Two `AskUserQuestion` calls. Emit `Phase 2: asking` then `Phase 2: brief locked`.

### Casual poll set (first AskUserQuestion call, up to 4 questions):

1. **Sizes** *(skip if user passed `Sizes:` or `--sizes=`)* — multi-select from `1200x1200`, `1200x628`, `1080x1920`, `1080x1350`, `1920x1080`. Default recommendation marked. `1200x1200` always included as MVP master.
2. **Concept count** *(skip if user passed ≥ 2 Titles)* — `Render 1 concept` vs `Generate 2-3 variants of the same Title`.
3. **Model** *(skip if user passed `--mini`)* — `gpt-image-2 (quality)` vs `gpt-image-1-mini (faster preview)`.

### Second poll — Brief approval:

After composing the structured concept(s), show one summary line per concept:

```
c1: sv · urgency · hook "galet höga" · palette #0E0E10/#F37021/#FFFFFF · barrel + Stockholm skyline
```

Ask: `Render / Adjust direction / Stop`. `Adjust direction` cap = 2 loops.

### Structured concept dict (output of Phase 2, written to manifest.json in Phase 3):

```json
{
  "title": "...",                    // verbatim, required
  "locale": "sv",                    // language tag
  "register": "urgency",             // mood
  "hook_phrase": "galet höga",       // oversized type-hero phrase
  "lp_visual_style": "...",          // one line from Phase 1.4
  "palette_hex": ["#...","#...","#..."],
  "concept_visual": "...",           // one-line per-concept visual hook
  "avoid": "..."                     // negative-instruction field, excluded from moderation scan
}
```

Auto-injections live in [`prompts.py`](../scripts/banner-openai/prompts.py) (localization, typography rule, RTL, layout lock, forbidden defaults) — Claude does not compose them.

---

## Phase 3 — Frames + URLs

One Claude turn. Emit `Phase 3: creating N×M frames` in casual; silent in fast.

1. Single `use_figma` JS call: create all N×M frames sized exactly W×H, named `Banner-OpenAI — {concept} — {W}x{H} — {runStamp}`, placed in a row-per-concept × column-per-size grid offset right of the hero. **Note** the 1200×1200 frame `nodeId` for each concept — that's where the MVP gets painted in Phase 4.
2. Parallel `upload_assets(fileKey, nodeId=<frame_id>, count=1, scaleMode=FILL)` for every frame → one `submitUrl` per frame.
3. Write to the **Windows-side TEMP path** (`$env:TEMP\banner-openai\` or via `cygpath -w`):
   - `manifest.json` — `{ "concepts": { key: <structured concept dict> } }` — written ONCE, reused by both runner invocations.
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

On `Redo Cn`: compose a corrective concept dict (different archetype, not just different props), re-run Phase 4 for that concept only (`--resume` keeps the others), return to 5a.

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
3. Per-job, the runner detects `mode: "edit"` and calls `post_images_edits()` — multipart POST to `/v1/images/edits` with the master PNG bytes as `image[]` and the recomp prompt from `prompts.build_recomp_prompt(concept, master_size, target_size)` (mirrors framework's § Recomposition Prompt Template, ~800-1100c, hard cap 1200c).
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

Removed in v1.9 (carried from v1.8): `--strict`, `--customize`, `--edit-chain` (now default), `--no-qa`, `--no-lp`.

---

## Moderation

Substring scan, case-insensitive, on `title + hook_phrase + concept_visual + lp_visual_style` only. Blocks: politicians, brand-risky real persons, banned visual concepts. Bypass with `--no-moderation`.

**The `avoid` field is excluded from the scan** — it is a list of negative instructions; including it triggers false positives. Forbidden keywords in `avoid` are still enforced via the auto-injected "no flags, no real person, no fake UI" guardrail in the gen + recomp prompts.

---

## Constraints

- Default model `gpt-image-2`; `--mini` swaps to `gpt-image-1-mini`. Quality `medium` (never `high`). Output PNG.
- OpenAI sizes restricted to `1024x1024 / 1024x1536 / 1536x1024`.
- **MVP always 1200×1200** (1:1). All non-1:1 sizes recompose from it via `/v1/images/edits`.
- Pipeline = exactly 5 Claude turns (setup · brief · frames+URLs · MVP gen+paint · recomp gen+paint+notify). In casual, Phase 5a inserts an `AskUserQuestion` turn between MVP paint and recomp.
- Concurrency 6. Figma upload URLs expire after 10 min — current wall clocks stay under that even for ~50-banner runs.
- Verbatim Title + CTA — never paraphrase, never split across panels.
- `OPENAI_API_KEY` never echoed, never committed, never written to any logged command.
- Python 3.x stdlib only.
- No autonomous commits.

---

## Wall clock (3 concepts × 3 sizes, sv, cache-hit)

| Mode | MVP gen | Designer pause | Recomp gen | Total |
|---|---|---|---|---|
| `--fast` | ~60-75s | — | ~50-65s (2 sizes × 3 concepts in parallel, mode=edit) | **~115-145s** |
| `--fast --mini` | ~30-40s | — | ~25-35s | **~55-75s** |
| default (casual) | ~60-75s | ~10-20s (1 click) | ~50-65s | **~125-165s** |
| `--mini` (casual) | ~30-40s | ~10-20s | ~25-35s | **~65-95s** |

Per-banner cost: `--fast` ≈ $0.08 (gpt-image-2) / $0.05 (mini). MVP is one gen call per concept; each recomp is one edit call per (concept × non-1:1 size).
