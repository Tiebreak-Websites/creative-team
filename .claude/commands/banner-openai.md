---
description: Render banner concepts with OpenAI gpt-image-2 (default) or gpt-image-1-mini (--mini). Cache-first LP read, structured Creative Card → Python prompt assembly, pre-flight moderation, --resume after crashes. Paints into Figma via a Python pipeline (stdlib ThreadPoolExecutor, conc 6, 429 retry, live progress).
---

# /banner-openai — OpenAI gpt-image-2 → Figma v1.7

**v1.7 = v1.6 runtime + reproducible prompt assembly + safety/efficiency upgrades.** v1.6 fixed the PowerShell hang. v1.7 cleans up everything else self-diagnosis surfaced after that:

- **Prompt assembly moved into Python** ([.claude/scripts/banner-openai/prompts.py](../scripts/banner-openai/prompts.py)) — single source of truth, unit-testable, ~$0.30/run cheaper in Claude tokens, prompts compress from ~1100 → ~870 chars (now actually inside the framework's 900-char hard limit).
- **LP screenshot cache** at [.claude/memory/lp_cache/](../memory/lp_cache/) — repeat campaigns on the same LP skip the screenshot fetch, save ~5s + ~$0.10 per re-run.
- **Pre-flight moderation** scans user input (title + hook + visual + avoid) for forbidden keywords (politicians, celebrities, banned visual concepts) BEFORE submitting to OpenAI. Saves ~30s + ~$0.04 per blocked job.
- **`--resume` mode** — if a run is interrupted, restart and only the failed/missing frames re-process. Results are written incrementally so the cache survives crashes.
- **Manifest validation** — fails fast on (concept, size) drift between `manifest.json` and `urls.json` instead of silently painting the wrong PNG to the wrong frame.
- **Carries forward from v1.6:** Python ThreadPoolExecutor, concurrency 6, built-in 429 retry with exp backoff, live per-job logging.

## Modes

| Mode | Trigger | Model | Briefing | Wall clock (3×3) |
|---|---|---|---|---|
| **fast** (default) | bare `/banner-openai ...` | gpt-image-2 | Full framework + LP + Creative Card + QA, no user polls | **~75–150s** |
| **`--mini`** | `--mini` flag | gpt-image-1-mini | Same briefing, smaller/faster model. For previews + iteration. | **~50s** |
| **`--strict`** | `--strict` flag | gpt-image-2 | Adds blocking user polls + MVP→pause→edit-chain | ~6 min |

Inline flags:
- `--mini` — swap to `gpt-image-1-mini` for ~4× faster gen at lower fidelity. Good for iteration.
- `--sizes=1200x1200,1200x628,1080x1920` — override default sizes.
- `--no-lp` — skip the LP screenshot read (saves ~5s; loses brand-continuity context).
- `--no-qa` — skip post-render cliché QA (saves ~20s; ships first-try output).
- `--edit-chain` — MVP→edits pipeline for cross-aspect consistency (requires gpt-image-2; +60s).
- `--no-paint` — generate only, save PNGs to `$env:TEMP\banner-openai\`.
- `--customize` / `--strict` — promote to strict mode with polls.
- `--concurrency=N` — override Python runner concurrency (default 6 — see § Constraints).
- `--resume` — re-use prior `results.json`; skip frames already painted ok. Use after a kill / crash / disconnect.
- `--no-cache` — bypass the LP cache and re-fetch the screenshot.
- `--no-moderation` — skip the pre-flight forbidden-keyword check (only use when you're sure).

**Default sizes** when none specified: `1200x1200, 1200x628, 1080x1920`.

---

## v1.7 deltas vs v1.6 (post-runtime cleanup)

| New | Why it mattered | Net effect |
|---|---|---|
| **Prompt assembly moved to [`prompts.py`](../scripts/banner-openai/prompts.py)** | v1.6 built ~14KB of per-run prompt strings inside Claude's context every time, untestable + token-heavy. v1.7 takes a structured concept dict and emits the 6-section template + all 4 auto-injections (localization, typography, RTL, layout) deterministically. | -$0.30/run Claude tokens, prompt size 1100 → 870c (under 900 hard limit), unit-testable |
| **Compressed `LOCALIZATION_ATMOS` + `LAYOUT_LOCKS` tables** | The verbose v1.6 strings pushed prompts to 1100+ chars. Trimmed sv from 160→47c, square layout from 175→110c, etc. | Same creative direction, ~25% smaller prompt |
| **LP screenshot cache** at [`.claude/memory/lp_cache/`](../memory/lp_cache/) | v1.6 re-fetched the screenshot every run on the same LP. Cache stores the extracted `lp_visual_style` summary (text only, ~200B per file), TTL 24h. | -5s + -$0.10 on repeat runs |
| **Pre-flight moderation check** in [`prompts.py`](../scripts/banner-openai/prompts.py) | v1.6 sent forbidden-keyword prompts (politicians, celebrities) to OpenAI cold and waited 30s for a `moderation_blocked` response. Now we substring-scan user input fields locally. | -30s + -$0.04 per blocked job; instant feedback |
| **`(concept, size)` validation** in run.py | v1.6 looked up by key but never asserted the urls.json/manifest.json sets matched. A drift would silently skip frames or paint the wrong PNG. | Fail-fast with clear error |
| **`--resume` mode** with incremental `results.json` writes | v1.6 had no recovery. If the runner died at 8/15, the user re-ran the whole batch (cost: ~$0.30 wasted). v1.7 writes results after each job; `--resume` skips frames whose status is `ok`. | Mid-run kills become recoverable |
| **`--no-moderation` and `--no-cache` escape hatches** | Sometimes you actually need the keyword (authorized portrait) or want a fresh LP read. Explicit opt-out beats silent override. | Cleaner debugging |
| **Carries forward from v1.6:** | Python ThreadPoolExecutor, concurrency 6, built-in 429 retry exp backoff, live per-job logging, page-root nodeId rejection, drop of `get_metadata` from Phase 0, single key resolver, reusable script in repo. | |

**What v1.7 keeps from v1.5:** framework load (still loaded once per run for Creative Card reasoning), Creative Card per concept (still in Claude — guides what fields to populate in the structured manifest), `--mini` / `--strict` modes, frame prefix, verbatim Title + CTA, hard guardrails.

---

## Input

```
/banner-openai [flags] <figma-url-with-node-id>
Title: <full title text verbatim>           ← one or more (each = one concept, cap 10)
CTA: <button text verbatim>                 ← optional
```

**Required:** Figma URL with `node-id=X-Y` · at least one `Title:` (alias `Tittle:` / `Headline:`).
**Fail-fast errors:**
- No `node-id` → `❌ Select the hero frame in Figma first and re-paste the URL.`
- `node-id=0:1` (page root) → `❌ "0:1" is the page root, not a hero frame. Click the actual LP frame in Figma and copy that URL.`
- No `Title:` → `❌ /banner-openai needs Title: <text> on its own line.`
- `OPENAI_API_KEY` not resolvable (see § Phase 0.0) → `❌ OPENAI_API_KEY not found. Tried: $env:OPENAI_API_KEY, ./.env, ../.env, ../../.env, ../../../.env, $HOME/.env. Set it in one of these and re-run.`
- `python --version` not on PATH → `❌ /banner-openai v1.7 requires Python 3.x on PATH. Install from python.org. (No PowerShell fallback — v1.5 PS pipeline was retired in v1.6 due to silent hangs.)`

---

## Fast mode pipeline (default — v1.6)

```
TURN 1 (~10s — parallel tool calls)
├─ Resolve OPENAI_API_KEY (Phase 0.0)
├─ Read .claude/memory/banner_design_framework.md (once per run)
├─ get_screenshot(fileKey, nodeId, maxDimension=1200) — LP visual style
└─ Compose Phase 1.0 Creative Card per concept (silent, in Claude reasoning)

TURN 2 (~5s — parallel tool calls)
├─ use_figma: create N×M frames in one JS call
└─ upload_assets × (N×M) in parallel — pre-fetched submit URLs

TURN 3 (~75-150s — single Bash call to Python runner)
└─ python .claude/scripts/banner-openai/run.py --dir $TEMP/banner-openai --concurrency 6
   Per job (ThreadPoolExecutor, max 6 parallel):
     ▸ POST /v1/images/generations  (model = gpt-image-2 default / gpt-image-1-mini if --mini)
     ▸ on HTTP 429: sleep 8s, retry. Then 16s, 32s, 64s. Max 4 attempts.
     ▸ on b64 decode: save PNG, run silent QA check, POST PNG to submitUrl
     ▸ stream "[HH:MM:SS] [N/total] {label} GEN/PAINT ok in Xms" to stdout
   wait all, write results.json, print per-job summary table

TURN 4 (~2s — Claude summary)
└─ Phase 8: Figma link + per-concept QA status + any failures
```

**Wall clock:** 75–150s typical (3-concept × 3-size run, conc=6, with one 429 wave). Auto-redos can add ~30-90s if a concept regresses.

---

## Phase 0 — silent setup (TURN 1)

### 0.0 Resolve OPENAI_API_KEY (silent, fail-fast)

Single ordered search list — first hit wins. Never echo the key, never log it.

```
1. $env:OPENAI_API_KEY                                  (already set in shell)
2. ./.env                                               (current working dir)
3. ../.env, ../../.env, ../../../.env                  (walk up to repo root)
4. $HOME/.env                                           (user-global fallback)
```

If none match: emit the fail-fast error from § Input and stop. Do **not** prompt the user — they can `cp .env.example .env` and re-run.

In `.env` files, accept any of `OPENAI_API_KEY=sk-...`, `OPENAI_API_KEY="sk-..."`, `OPENAI_API_KEY='sk-...'`. Strip outer quotes.

### 0.1 Language detect (silent)
From Title + CTA. Labels: `pt-BR`, `pt-PT`, `es-LATAM`, `es-ES`, `en`, `ar`, `he`, `ur`, `fa`, `ps`, `th`, `tr`, `sv`, `de`, `ms`, `id`, `ja`, `zh`. Default `en`. Trigger RTL flag for `ar`, `he`, `ur`, `fa`, `ps`.

### 0.2 Register classify (silent)
Per § Register cues in framework. Default `curiosity`. Question marks + provocation words → `provocation`. Numbers + offers → `aspiration` or `urgency`. Trust signals + analyst counts → `trust`.

### 0.3 LP context read (silent, cache-first in v1.7)

**Tool selection:** `mcp__a17e5c91-…__get_screenshot` only. v1.5 also called `get_metadata` in parallel; in v1.6 it's removed because it timed out twice on a real run against a large LP page (42k×24k px). The screenshot alone gives us the brand palette + tone + setting we need.

**v1.7 cache-first lookup** at [`.claude/memory/lp_cache/{fileKey}__{nodeId-with-dashes}.json`](../memory/lp_cache/):

1. **Page-root reject:** if `nodeId == "0:1"` (or any `0-1` URL form), emit the fail-fast error from § Input and stop. Page-root screenshots are useless for brand-continuity reads.
2. **Cache check:** if `lp_cache/{fileKey}__{nodeId-with-dashes}.json` exists AND `now - fetched_at < ttl_hours`, load `lp_visual_style` + `palette_hex` from it and **skip the screenshot fetch entirely**. Saves ~5s + ~$0.10 per repeat run on the same LP.
3. **Cache miss or expired:** call `get_screenshot(fileKey, nodeId, maxDimension=1200)`. On `session expired`: retry 2s, then 4s. After 2 retries → fall back to no-LP-context (silently — pick a sensible default palette and surface the choice in Phase 8).
4. **On success:** extract one-line `lp_visual_style` (palette + tone + setting) — **do NOT enumerate exact props**. Then **write the cache file** with `fetched_at: <ISO timestamp>`, `ttl_hours: 24`, `lp_visual_style`, `palette_hex`. Format documented in [`lp_cache/README.md`](../memory/lp_cache/README.md).
5. **`--no-cache` flag** bypasses both read and write — re-fetch and don't update.

### 0.4 / 0.45 / 0.5 polls — SKIPPED in fast mode
Only run in `--strict` / `--customize` mode.

---

## Phase 1.0 — Creative Card (silent, per concept)

Claude composes the 9-line card from § Visual Prompt Template in framework:

```
Campaign purpose:        <what's being sold + why now>
Market / language:       <e.g. pt-BR / LATAM>
Emotional register:      <from § Register cues>
Primary hook:            <number / phrase that dominates>
Main visual hierarchy:   <hero element + role of any support>
LP visual style:         <one line from Phase 0.3>
Required aspect ratios:  <list from input or defaults>
Layout lock:             <one line from § Aspect-Ratio Layout Locks>
Archetype:               <A / B / C / D / E from § Creative Archetypes>
Avoid:                   <specific cliché this concept could regress into>
```

Then pick palette (max 3 hex codes), locked across all aspects of THIS concept.

---

## Phase 1 — write structured manifest (v1.7)

v1.6 had Claude pre-compose the full prompt and write it to `manifest.concepts[k].base`. v1.7 inverts this: Claude writes a **structured concept** describing the creative decisions, and Python (`prompts.build_prompt()`) assembles the final 6-section prompt + auto-injections. Same creative direction, ~$0.30/run cheaper, prompt size 1100 → 870c, unit-testable.

For each concept, populate this dict from the Phase 1.0 Creative Card:

```json
{
  "title":           "...",                         // required, verbatim
  "locale":          "sv",                          // language tag, drives localization atmosphere
  "register":        "empowerment",                 // drives mood phrase
  "hook_phrase":     "personlig handledning",       // phrase to oversize as type-hero
  "lp_visual_style": "deep charcoal + vivid orange + barrel",   // from Phase 0.3 (cached or fresh)
  "palette_hex":     ["#0E0E10", "#F37021", "#FFFFFF"],         // locked palette
  "concept_visual":  "spotlight on glossy orange oil barrel + tick chart wave",
  "avoid":           "classroom, instructor portrait, headshot"
}
```

Auto-injections that Python applies (no Claude work needed):

1. **Localization atmosphere** — looked up from `LOCALIZATION_ATMOS[locale]` in [`prompts.py`](../scripts/banner-openai/prompts.py) (table mirrors framework § Localization).
2. **Typography hard rule** — auto-injected by `needs_typography_rule(title)` if title has accented chars OR ends with `?` / `!`.
3. **RTL composition** — auto-injected by `is_rtl(locale)` for `ar`, `he`, `ur`, `fa`, `ps`.
4. **Layout lock** — looked up from `LAYOUT_LOCKS[size]` per requested size.
5. **Forbidden defaults** — embedded in the readable-text-only line.

Write two files in `$TEMP/banner-openai/`:

- `manifest.json` — `{ "concepts": { key: <structured concept dict> } }`. The legacy v1.6 schema (`{ layouts, concepts.{k}.base }`) is still accepted by the runner for back-compat.
- `urls.json` — `[{ concept, size, openaiSize, submitUrl }, ...]` where `submitUrl` is the URL minted by `upload_assets` in Phase 2.

The runner asserts every (concept, size) in `urls.json` exists in `manifest.concepts` before starting; mismatches fail fast.

---

## Phase 2 — render + silent QA (TURN 3, single Bash call)

Single Bash invocation of the production runner — no per-run script generation:

```bash
export OPENAI_API_KEY=$(...)   # from Phase 0.0
python -u .claude/scripts/banner-openai/run.py \
  --dir "$TEMP/banner-openai" \
  --concurrency 6 \
  --max-retries 4 \
  --base-backoff 8 \
  --model gpt-image-2
```

**Flag mapping:**
- `/banner-openai --mini` → `--model gpt-image-1-mini`
- `/banner-openai --no-paint` → `--no-paint`
- `/banner-openai --resume` → `--resume` (runner skips frames whose `results.json` row is `ok` AND the PNG file still exists)
- `/banner-openai --no-moderation` → `--no-moderation` (runner skips the pre-flight forbidden-keyword check)

The runner:
- Streams per-job `[HH:MM:SS] [N/total] {label} GEN/PAINT ...` lines to stdout (line-buffered, `-u`), so the user sees the pipeline moving live.
- Runs the **moderation pre-flight** before each gen call. If `prompts.check_moderation(concept_dict)` returns `(False, reason)`, the job is marked `moderation_skip`, no OpenAI call happens, and Phase 8 surfaces the reason.
- Writes `$TEMP/banner-openai/results.json` **incrementally after each job** (atomic rename via `.tmp` → final), so `--resume` always sees a fresh snapshot even if the runner is killed mid-flight.

**Silent QA (6 binary checks per PNG, run by Claude after the runner finishes):**
1. Campaign poster aesthetic (not editorial photo)?
2. Title legible and complete (no cut/overlapped letters)?
3. Design layer visible (graphic panels / gradients / atmosphere)?
4. Palette not regressed to dark editorial office?
5. No hard split-panel?
6. Local cue present (for non-English markets)?

Failed PNGs trigger ONE auto-redo: re-mint upload URL for the failed frame, append a corrective prefix to the prompt, re-invoke `run.py` for that single job. After 1 retry, the result is painted as-is and surfaced in Phase 8.

---

## Phase 3 — create Figma frames (in TURN 2)

Single `use_figma` JS call, frame name `Banner-OpenAI — {concept} — {W}x{H} — {runStamp}`. Re-resolve by name at paint time. Layout: row per concept, column per size.

## Phase 4 — paint (streamed inside TURN 3 by the Python runner)

`upload_assets(nodeId, scaleMode=FILL, count=1)` URLs are pre-fetched in TURN 2. Python POSTs PNG bytes to each `submitUrl` as the gen completes. Single-path paint, no dual-write.

**URL TTL note:** Figma upload URLs expire after 10 minutes. With v1.6's 75–150s wall clock the TTL is no longer a real constraint for runs ≤ ~50 banners. For larger runs, mint URLs in chunks (e.g. 15 at a time, fan out, mint next chunk after the first batch finishes).

---

## Phase 5 — strict-mode designer pause (`--strict` only)

Single multi-select: "Which concepts to recomp? [✓] c1 [✓] c2 [✓] c3" + "Redo c1 master first" / "Stop".

---

## Phase 8 — summary

Figma URL + per-concept QA status. Surface:
- Concepts that needed auto-redo (and why)
- `moderation_skip` rows with the offending keyword — recommend rephrasing or `--no-moderation` if user has authorization
- `gen_http_error` rows with HTTP code (429 / 400 / 500…)
- Concepts that exhausted 4 retries on 429 — recommend re-running with `--concurrency=3`
- `paint_http_error` rows (often = expired Figma URL → re-mint and `--resume`)
- Heavy-crop flags
- Per-job timing (gen ms, paint ms) from `results.json`
- LP cache hit/miss (the cache lookup either saved ~5s or extracted+cached a fresh summary)

---

## Constraints (v1.7)

- **Default model:** `gpt-image-2`. **`--mini` for previews:** `gpt-image-1-mini` (weaker on complex compositions).
- **Quality:** `medium` default. Never `high` (hangs `gpt-image-2`).
- **Output format:** `png`. **Size:** one of `1024x1024`, `1024x1536`, `1536x1024`. The Python runner accepts only these three.
- **UTF-8 byte body required** for non-ASCII titles. `urllib.request` does this natively; no special encoding needed.
- **Framework file loaded every run** from `.claude/memory/banner_design_framework.md`.
- **LP context cache-first:** read [`.claude/memory/lp_cache/`](../memory/lp_cache/) first; fetch+cache on miss/expired (TTL 24h). Bypass with `--no-cache`.
- **Page-root nodeId rejected** in Phase 0.3.
- **`get_metadata` removed** from Phase 0 (was a flake source).
- **Creative Card silent per concept** in Claude reasoning, then materialized as a structured concept dict in `manifest.json`.
- **Prompt assembly in Python** via [`prompts.py`](../scripts/banner-openai/prompts.py). All four auto-injections (localization, typography, RTL, layout) live there. Prompt target ~750c, ~870c typical, 900c hard.
- **Moderation pre-flight** scans user input fields (title, hook, visual, lp_style, avoid) for forbidden keywords before each gen call. Bypass with `--no-moderation`.
- **Manifest validation:** every (concept, size) in `urls.json` must resolve to a concept in `manifest.concepts` and a size in `LAYOUT_LOCKS`. Fails fast if not.
- **Silent cliché QA + 1 auto-redo** before paint unless `--no-qa`.
- **Pipeline:** 3 Claude turns (setup · frames+URLs · gen+QA+paint) + summary.
- **Concurrency:** ThreadPoolExecutor `max_workers=6` (v1.5 was 12 → triggered OpenAI 429s on first batch).
- **429 retry:** built into [run.py](../scripts/banner-openai/run.py) — exp backoff 8s → 16s → 32s → 64s, max 4 attempts per job.
- **`--resume` mode:** incremental `results.json` writes (atomic rename) survive crashes; `--resume` skips frames whose status is `ok` AND PNG file exists.
- **Live progress:** runner uses `python -u` and `print(..., flush=True)` so the user sees per-job lines stream as they complete.
- **Frame prefix `Banner-OpenAI —`**. Re-resolve by name at paint time.
- **No dual-write paint.**
- **Verbatim Title + CTA.**
- **`OPENAI_API_KEY`** resolved by single ordered helper (§ Phase 0.0). Never echoed, never committed.
- **Python 3.x on PATH** (stdlib only — no `pip install` needed).
- **No autonomous commits.**

---

## Estimated wall clock + cost

| Run | v1.5 (PS, hang-prone) | v1.6 (Python conc=6) | **v1.7 (Python + cache + structured)** | v1.7 `--mini` |
|---|---|---|---|---|
| 3 concepts × 3 sizes, pt-BR (cold cache) | ~2 min (or ∞) | ~75–150s | **~75–150s** | ~50s |
| 3 concepts × 3 sizes, pt-BR (cache hit) | n/a | ~75–150s | **~70–145s** (-5s LP fetch) | ~45s |
| 5 concepts × 3 sizes, sv | unfinished | ~150s | **~140s** (smaller prompts) | ~80s |
| 1 concept × 2 sizes | ~95s | ~70s | **~70s** | ~35s |
| Re-run after kill at job 8/15 (`--resume`) | full re-run ($0.30 wasted) | full re-run | **resumes from 9/15** | resumes |

| Component (3×3 pt-BR, cold cache) | v1.5 fast | v1.6 fast | **v1.7 fast** | v1.7 `--mini` |
|---|---|---|---|---|
| OpenAI API | ~$0.55 | ~$0.55 | **~$0.55** | ~$0.30 |
| Claude tokens (framework + Creative Card + QA reads + prompt assembly) | ~$0.65 | ~$0.55 | **~$0.25** (prompt assembly off-loaded to Python) | ~$0.20 |
| **Total** | **~$1.20** | **~$1.10** | **~$0.80** | **~$0.50** |
| With LP cache hit | — | — | **~$0.70** (-$0.10 Claude tokens) | **~$0.45** |
| Output quality vs `/banner-higgsfield` | parity (when ran) | parity | **parity** | preview-grade |
| Reliability | broke on long runs | production-stable | **production-stable + resumable** | ok |

Per-banner cost in v1.7 fast: **~$0.09** (production quality, cold cache).
Per-banner cost in v1.7 `--mini`: **~$0.06** (preview / iteration quality).
Per-banner cost in v1.7 fast with cache hit: **~$0.08**.
