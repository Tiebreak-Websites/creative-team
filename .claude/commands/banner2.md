---
description: Render banner concepts with OpenAI gpt-image-2 (default, ~90s/call) or gpt-image-1-mini (--mini, ~20s/call). Loads design framework + reads LP context every run. Composes structured Creative Cards before prompting. Silent cliché QA + auto-redo before paint. Paint into Figma via single PS ThreadJob.
---

# /banner2 — OpenAI gpt-image-2 → Figma v1.5

**v1.5 = v1.4 speed architecture + /banner's full briefing quality.**

v1.4 over-optimized: stripped LP read, framework load, Creative Card, and cliché QA to hit 30s/run. Output quality dropped visibly vs `/banner` because those stripped phases were doing real work. v1.5 puts them back as silent (no user polls) so the brief reaching the model carries the same structured reasoning as `/banner`, without re-introducing blocking prompts.

## Modes

| Mode | Trigger | Model | Briefing | Wall clock (3×3) |
|---|---|---|---|---|
| **fast** (default) | bare `/banner2 ...` | gpt-image-2 | Full framework + LP + Creative Card + QA, no user polls | **~120s** |
| **`--mini`** | `--mini` flag | gpt-image-1-mini | Same briefing, smaller/faster model. For previews + iteration. | **~50s** |
| **`--strict`** | `--strict` flag | gpt-image-2 | Adds blocking user polls + MVP→pause→edit-chain | ~6 min |

Inline flags:
- `--mini` — swap to `gpt-image-1-mini` for ~4× faster gen at lower fidelity. Good for iteration.
- `--sizes=1200x1200,1200x628,1080x1920` — override default sizes.
- `--no-lp` — skip the LP screenshot read (saves ~5s; loses brand-continuity context).
- `--no-qa` — skip post-render cliché QA (saves ~20s; ships first-try output).
- `--edit-chain` — MVP→edits pipeline for cross-aspect consistency (requires gpt-image-2; +60s).
- `--no-paint` — generate only, save PNGs to `$env:TEMP\banner2\`.
- `--customize` / `--strict` — promote to strict mode with polls.

**Default sizes** when none specified: `1200x1200, 1200x628, 1080x1920`.

---

## v1.5 deltas vs v1.4 (quality recovery)

| Restored | Why it mattered | Cost |
|---|---|---|
| **Framework file loaded every run** (was --strict only) | Archetypes, layout locks, localization allowlists, typography rules, RTL, hard guardrails all reach the prompt | ~6k chars context, ~$0.10 |
| **LP screenshot read by default** (was --lp opt-in) | Brand-palette continuity. Without it, every run looks generic. | ~5s + 1 tool call |
| **Phase 1.0 Creative Card** silent per concept | 9-line structured reasoning before composing. Forces archetype + register + palette decisions. | ~5-10s of Claude composition |
| **Typography hard rule auto-injected** for accented-char titles | Stops "caminho" → "caminh?" class glitches | 0 — string check |
| **Localization atmosphere allowlist auto-injected** by detected language | "pt-BR" → "São Paulo warm daylight, terracotta…" instead of generic | 0 — table lookup |
| **Silent cliché QA + 1 auto-redo before paint** | Catches dark-office regressions, split-panel, typography glitches | ~20s + 3-9 image reads |
| **Default model `gpt-image-2`** (was mini) | Mini is fine for type-led posters; weaker on complex compositions. Quality > speed by default. | +60s wall clock vs mini |

**Net effect:** wall clock 30s → 120s. Cost ~$0.60 → ~$1.05. Output quality recovers to `/banner` parity.

---

## Input

```
/banner2 [flags] <figma-url-with-node-id>
Title: <full title text verbatim>           ← one or more (each = one concept, cap 10)
CTA: <button text verbatim>                 ← optional
```

**Required:** Figma URL with `node-id=X-Y` · at least one `Title:` (alias `Tittle:` / `Headline:`).
**Fail-fast errors:**
- No `node-id` → `❌ Select the hero frame in Figma first and re-paste the URL.`
- No `Title:` → `❌ /banner2 needs Title: <text> on its own line.`
- No `OPENAI_API_KEY` → `❌ Set OPENAI_API_KEY via $env or .env.`

---

## Fast mode pipeline (default — v1.5)

```
TURN 1 (~10s — parallel tool calls)
├─ Read .claude/memory/banner_design_framework.md (once per run)
├─ get_design_context(fileKey, nodeId) — LP screenshot + structure
└─ Compose Phase 1.0 Creative Card per concept (silent, in Claude reasoning)

TURN 2 (~5s — parallel tool calls)
├─ use_figma: create N×M frames in one JS call
└─ upload_assets × (N×M) in parallel — pre-fetched submit URLs

TURN 3 (~95s — single PowerShell ThreadJob)
└─ for each (prompt, size, submitUrl):
     ▸ POST /v1/images/generations  (model = gpt-image-2 default / gpt-image-1-mini if --mini)
     ▸ on b64 decode: save PNG, run silent QA check, POST PNG to submitUrl
     auto-redo concepts that fail QA (1 retry max each)
   wait all, return manifest

TURN 4 (~2s — Claude summary)
└─ Phase 8: Figma link + per-concept QA status + any failures
```

**Wall clock:** ~120s typical (3-concept × 3-size run). Auto-redos can add ~30-90s if a concept regresses.

---

## Phase 0 — silent setup (TURN 1)

### 0.1 Language detect (silent)
From Title + CTA. Labels: `pt-BR`, `pt-PT`, `es-LATAM`, `es-ES`, `en`, `ar`, `he`, `ur`, `fa`, `ps`, `th`, `tr`, `sv`, `de`, `ms`, `id`, `ja`, `zh`. Default `en`. Trigger RTL flag for `ar`, `he`, `ur`, `fa`, `ps`.

### 0.2 Register classify (silent)
Per § Register cues in framework. Default `curiosity`. Question marks + provocation words → `provocation`. Numbers + offers → `aspiration` or `urgency`. Trust signals + analyst counts → `trust`.

### 0.3 LP context read (silent, with retry)
**Tool selection:** see [`.claude/memory/figma_tool_selection.md`](../memory/figma_tool_selection.md). For LP visual style, prefer `mcp__a17e5c91-…__get_screenshot` (cheapest source of brand-continuity). If you also need node structure, add `mcp__framelink-figma__get_figma_data` (structured JSON, no code wrapper). Fall back to `get_design_context` only if Framelink is unavailable.

1. Call `get_screenshot(fileKey, nodeId, maxDimension=1200)` — and optionally `get_figma_data(fileKey, nodeId)` in parallel for structure.
2. On `session expired`: retry 2s, then 4s. After 2 retries → fall back to no-LP-context.
3. On success: extract one-line `LP visual style` (palette + tone + setting). **Do NOT enumerate exact props.** If node is a text-only brief frame (no visual LP), surface ONE inline question: re-paste with the LP node, or proceed with default palette (don't block on this in silent mode — pick a sensible default and surface the choice).

### 0.4/0.45/0.5 polls — SKIPPED in fast mode
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

## Phase 1 — compose visual prompt (silent)

For each (concept, size), build a ≤900-char prompt using § Visual Prompt Template from framework. **Mandatory auto-injections:**

1. **Localization atmosphere** — auto-inject the allowlist line for the detected language. e.g. for `pt-BR` add "São Paulo / Rio warm daylight, terracotta + sun-saturated colors, natural textures" unless the brief overrides.
2. **Typography hard rule** — if any title contains accented chars (ã, ç, ô, é, í, ñ, ü, ä, ö, å, ø, à, è, ù, â, ê, î, û, ÿ) OR ends with `?`, append: *"Render every word fully and legibly. The question mark must sit clearly AFTER the final letter — never overlap or cut letters."*
3. **RTL flag** — if RTL language, add "RTL composition: mirror visual hierarchy, title enters from right."
4. **Forbidden defaults** — short list from framework's Hard guardrails.

Length target 450–750 chars preferred, ≤900 hard.

---

## Phase 2 — render + silent QA (TURN 3, single PS call)

The PS ThreadJob fires generations in parallel and runs silent QA on each PNG as it decodes, BEFORE painting.

**Silent QA (6 binary checks per PNG):**
1. Campaign poster aesthetic (not editorial photo)?
2. Title legible and complete (no cut/overlapped letters)?
3. Design layer visible (graphic panels / gradients / atmosphere)?
4. Palette not regressed to dark editorial office?
5. No hard split-panel?
6. Local cue present (for non-English markets)?

Failed PNGs trigger ONE auto-redo with a corrective-prefix prompt. After 1 retry, the result is painted as-is and surfaced in Phase 8.

**PS payload pattern (UTF-8 bytes required):**

```powershell
$model = if ($mini) { "gpt-image-1-mini" } else { "gpt-image-2" }
$payload = @{ model=$model; prompt=$prompt; n=1; size=$size; quality="medium"; output_format="png" } | ConvertTo-Json -Compress -Depth 4
$bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
$resp = Invoke-WebRequest -Uri "https://api.openai.com/v1/images/generations" `
  -Method Post `
  -Headers @{ Authorization="Bearer $env:OPENAI_API_KEY"; "Content-Type"="application/json; charset=utf-8" } `
  -Body $bytes -TimeoutSec 540 -UseBasicParsing
$png = [Convert]::FromBase64String((($resp.Content | ConvertFrom-Json).data[0].b64_json))
[IO.File]::WriteAllBytes("$dir\$label.png", $png)
# Silent QA happens here (Claude analyzes the PNG via Read tool in TURN 3.5)
# Then POST to submitUrl
Invoke-WebRequest -Uri $submitUrl -Method Post `
  -Headers @{ "Content-Type"="image/png" } `
  -InFile "$dir\$label.png" -TimeoutSec 120 -UseBasicParsing
```

---

## Phase 3 — create Figma frames (in TURN 2)

Single `use_figma` JS call, frame name `Banner2 — {concept} — {W}x{H} — {runStamp}`. Re-resolve by name at paint time. Layout: row per concept, column per size.

## Phase 4 — paint (streamed inside TURN 3)

`upload_assets(nodeId, scaleMode=FILL, count=1)` URLs are pre-fetched in TURN 2. PS POSTs PNG bytes to each `submitUrl` as the gen completes. Single-path paint, no dual-write.

---

## Phase 5 — strict-mode designer pause (`--strict` only)

Single multi-select: "Which concepts to recomp? [✓] c1 [✓] c2 [✓] c3" + "Redo c1 master first" / "Stop".

---

## Phase 8 — summary

Figma URL + per-concept QA status. Surface:
- Concepts that needed auto-redo (and why)
- `moderation_blocked` / `429` retries
- Heavy-crop flags
- `paint_failed` rows
- Token+cost estimate

---

## Constraints (v1.5)

- **Default model:** `gpt-image-2` (was mini in v1.4 — swapped after quality-drop observation).
- **`--mini` for previews:** `gpt-image-1-mini`, ~4× faster, weaker on complex compositions.
- **Quality:** `medium` default. Never `high` (hangs `gpt-image-2`).
- **Output format:** `png`. **Size:** one of `1024x1024`, `1024x1536`, `1536x1024`.
- **UTF-8 byte body required** for non-ASCII titles.
- **Framework file loaded every run** from `.claude/memory/banner_design_framework.md` — was --strict-only in v1.3/v1.4.
- **LP context read every run** unless `--no-lp`.
- **Creative Card silent per concept** before prompt composition.
- **Typography rule auto-injected** for accented-char titles.
- **Localization allowlist auto-injected** by detected language.
- **Silent cliché QA + 1 auto-redo** before paint unless `--no-qa`.
- **Pipeline:** 3 Claude turns (setup · frames+URLs · gen+QA+paint) + summary.
- **Concurrency:** ThreadJob throttle 12.
- **Frame prefix `Banner2 —`**. Re-resolve by name at paint time.
- **No dual-write paint.**
- **Verbatim Title + CTA.**
- **`OPENAI_API_KEY` from `$env` or `.env`** — never echoed, never committed.
- **No autonomous commits.**

---

## Estimated wall clock + cost

| Run | v1.1 | v1.3 fast | v1.4 fast (mini) | **v1.5 fast (gpt-image-2)** | v1.5 --mini |
|---|---|---|---|---|---|
| 3 concepts × 3 sizes, pt-BR | ~40 min | ~2 min | ~30s | **~2 min** | ~50s |
| 3 concepts × 4 sizes, pt-BR | ~40 min | ~2.5 min | ~35s | **~2.5 min** | ~60s |
| 1 concept × 2 sizes | ~10 min | ~50s | ~25s | **~95s** | ~35s |

| Component (3×3 pt-BR) | v1.4 fast | **v1.5 fast** | v1.5 --mini |
|---|---|---|---|
| OpenAI API | ~$0.25 | **~$0.55** | ~$0.30 |
| Claude tokens (framework + Creative Card + QA reads) | ~$0.40 | **~$0.65** | ~$0.55 |
| **Total** | **~$0.65** | **~$1.20** | **~$0.85** |
| Output quality vs `/banner` | gap | **parity** | preview-grade |

Per-banner cost in v1.5 fast: **~$0.13** (production quality).
Per-banner cost in v1.5 --mini: **~$0.10** (preview / iteration quality).
