---
description: Render banner concepts with OpenAI gpt-image-1 (via direct REST) and paint them into a Figma file. Same logic as /banner — Claude controls the brief, the image model controls the picture — but swaps Higgsfield for the OpenAI Images API. Prompts are short creative briefs, not photoshoot directions. Never dark editorial office scenes. User-controlled setup (sizes first, then customize vs auto). Multi-concept ready. The user provides one-or-more Title lines + a Figma URL with the hero node pre-selected. Requires OPENAI_API_KEY env var (or local .env).
---

# /banner2 — Designer flow (OpenAI gpt-image-1 → Figma) v1.0

`/banner2` is a **drop-in fork of `/banner` v2.7**. Every phase, every poll, every guardrail, every prompt template is identical — **except the image-generation backend is swapped from Higgsfield's `gpt_image_2` MCP tool to OpenAI's `gpt-image-1` REST endpoints** (`/v1/images/generations` for MVPs, `/v1/images/edits` for recomps with the master attached).

If you've used `/banner`, the workflow is the same; the deltas are confined to **§ Phase 2 (MVP render)**, **§ Phase 6 (recomp render)**, **§ Pre-flight**, **§ Aspect map**, and the **§ Constraints** at the bottom. Everything else in this file is a verbatim mirror of `/banner` v2.7.

---

## What's the same

- Claude/image-model responsibility split (Claude = BRIEF, image model = PICTURE)
- 6-section short Visual Prompt template (450–750 chars preferred, ≤900 hard)
- Phase 1.0 Creative Card (9 lines per concept)
- Phase 2.5 cliché QA + 1 auto-redo
- Phase 6.5 silent visual QA before paint
- Phase 0.4 / 0.45 / 0.5 user polls
- 5 creative archetypes, Typography Hero Rule, CTA color tier rule
- Localization atmosphere allowlists + market exclusion lists
- RTL composition rules
- Multi-concept (cap 10), grid frame layout, idempotent placement
- Verbatim Title + CTA
- Recomp prompt template, Campaign Element Manifest
- Hard guardrails (no dark office, no split panel, no invented text in screens/UI)

## What's different

| Concern | `/banner` (Higgsfield) | `/banner2` (OpenAI) |
|---|---|---|
| MVP endpoint | `generate_image` MCP tool with `model=gpt_image_2`, `aspect_ratio="1:1"`, `quality="high"`, `resolution="1k"` | `POST https://api.openai.com/v1/images/generations` with `model=gpt-image-1`, `size="1024x1024"`, `quality="high"`, `n=1`, `output_format="png"` |
| Recomp endpoint | Same `generate_image` tool, master passed via `medias[].role: "image"` | `POST https://api.openai.com/v1/images/edits` (multipart), master attached as `image[]=@<path>`, `size` set per target aspect |
| Polling | Async — `job_display` polled at t+60s then every 30s, queue-aware extension to t+30min | **Synchronous** — request blocks until image is returned (typically 20–90s). No polling. Per-call HTTP timeout 300s. |
| Auth | Higgsfield MCP token configured at MCP setup time | `OPENAI_API_KEY` env var (or `.env`). Read at run-time. Never logged, never written to a Bash response body. |
| Concurrency cap | Hard ceiling at 8 concurrent jobs (Ultra Monthly plan) | OpenAI rate limit is org-scoped (RPM + TPM). Default chunk size is **5 concurrent** image calls — chunk Phase 2 / Phase 6 fires accordingly. Increase only if the org tier supports it. |
| Egress allowlist | `d8j0ntlcm91z4.cloudfront.net` + `mcp.figma.com` | `api.openai.com` + `mcp.figma.com` |
| Result fetch | Higgsfield serves a CloudFront URL; `curl -o file.png <rawUrl>` | OpenAI returns base64 in `data[0].b64_json`; decode with `jq -r ... \| base64 -d > file.png` |
| Sizes supported | Any aspect — Higgsfield handles arbitrary aspect ratios at 1k resolution | gpt-image-1 supports exactly 3: `1024x1024`, `1024x1536`, `1536x1024` (and `auto`). Mapped per target aspect — see § Aspect map. |
| Available aspects | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3 | 1:1, ≈3:2 (1536×1024), ≈2:3 (1024×1536). For 16:9 / 9:16 targets, the closest supported size is used and `scaleMode=FILL` handles the residual crop (typically 10–22%). |
| `models_explore` pre-flight | Resolves `gpt_image_2` model id | Removed — model id is the literal string `gpt-image-1` |
| Cross-check on flaky job lookup | `show_generations` if `job_display` returns empty | N/A — synchronous endpoint, no separate job store |

Everything else below mirrors `/banner` v2.7 line-for-line, with the few endpoint-specific replacements marked **`[banner2 swap]`**.

---

## Architecture

| Layer | Audience | What it is | Length |
|---|---|---|---|
| **§ Design Framework** | Claude only | Principle-driven brief system — campaign understanding, layout locks, hard guardrails | No cap |
| **Creative Card** | Claude only | 9-line per-concept brief extracted in Phase 1.0 | ~ 9 lines |
| **§ Visual Prompt** | gpt-image-1 | Short creative brief — Format + market + mood → Campaign-poster direction → Layout lock → Visual atmosphere → Copy / CTA → Constraints | **450–750 chars preferred, ≤900 hard** |
| **§ Recomposition Prompt** | gpt-image-1 (edits) | Layout redesign per format — same campaign, new spatial structure | **≤1,200 chars** |

Workflow:

1. **Parse + pre-flight.** Validate Figma URL has `node-id`, parse Title(s) + CTA + (optional) sizes, run egress + MCP + OpenAI auth checks. Fail-fast on missing required input.
2. **LP hero read.** Direct `get_screenshot` call on the user-provided node-id. Retry-on-session-expired.
3. **Phase 0.4 — Size selection poll** (BLOCKING). Skip if sizes were passed in input.
4. **Phase 0.45 — Creative control mode poll** (BLOCKING). Customize vs Auto.
5. **Phase 0.5 — Creative polls** (per concept). RUN ONLY in Customize mode. In Auto mode, internally generate 3 campaign directions and pick silently.
6. **Phase 1.0 — Creative Card.** Extract a tight 9-line card per concept. No more 8-step scene reasoning.
7. **Phase 1 — Compose short prompt.** 6 sections, ≤900 chars hard.
8. **Phase 2 — Render MVP at 1024×1024** per concept (chunked, ≤5 concurrent). **`[banner2 swap]`** Synchronous OpenAI Images Generations call. No polling.
9. **Phase 2.5 — MVP cliché QA + auto-redo.** 6-question check; 1 corrective retry max.
10. **Phase 3 + 4 — Figma frames + MVP paint.**
11. **Phase 5 — 🛑 Designer review pause.** Per-concept Redo / Continue / Stop.
12. **Phase 6 + 6.5 + 7 — Recomp + silent QA + paint.** **`[banner2 swap]`** Synchronous OpenAI Images Edits call with master attached. No polling.
13. **Phase 8 — Summary + problem list.**

---

## Input parsing — strict

The user pastes:

```
/banner2 <figma-url-with-node-id>
Title: <full title text verbatim>           ← one or more lines (multi-concept)
Title: <second concept's title>             ← optional additional concepts
CTA: <button text verbatim>                 ← optional; applies to all concepts unless per-concept supplied
[<WxH> ...]                                  ← optional; if present, skips Phase 0.4 size poll
```

### Required

- **Figma URL with `node-id`.** Must be `https://figma.com/design/<fileKey>/...?node-id=<X-Y>...`. Extract both `fileKey` and `nodeId` (convert `X-Y` → `X:Y`).
- **`Title:` line(s).** The full headline copy verbatim. Accept the typo `Tittle:` and the alias `Headline:`. Use the WHOLE title text on the banner — never split. Multiple `Title:` lines = multiple concepts. **Cap at 10 concepts per run.**
- **`CTA:` line(s)** — OPTIONAL. Same semantics as `/banner`.

### Optional

- **Sizes.** Zero or more `WxH` tokens in input. If present → use them, **skip Phase 0.4 size poll**. If missing → ask via Phase 0.4 poll. Always include `1200×1200` as MVP/master unless explicitly excluded.

### Fail-fast (clear errors)

- No `node-id` in Figma URL → **`❌ Select the hero frame in Figma first, then copy the URL with the node selected and re-paste. /banner2 needs node-id=X-Y in the URL to read the LP context.`**
- No Figma URL at all → **`❌ /banner2 needs a Figma file URL with the hero node selected.`**
- No `Title:` → **`❌ /banner2 needs Title: <headline text> on its own line.`**
- No `OPENAI_API_KEY` env var **and** no `.env` file with the key → **`❌ /banner2 needs OPENAI_API_KEY set. Either: $env:OPENAI_API_KEY = 'sk-...' (PowerShell, current session) or create a .env file in the repo root with OPENAI_API_KEY=sk-... (already gitignored).`**

---

## Pre-flight (silent unless something breaks) **`[banner2 swap]`**

Run in parallel, fail-fast on hard requirements:

1. **OpenAI auth.** Verify `OPENAI_API_KEY` is readable from either `$env:OPENAI_API_KEY` or `.env`. Do a minimal probe: `GET https://api.openai.com/v1/models/gpt-image-1` with the bearer token. Expected: HTTP 200 with `{"id":"gpt-image-1",...}`. On 401 → fail-fast with `❌ OPENAI_API_KEY rejected (HTTP 401). Rotate the key at platform.openai.com/api-keys and retry.` On 404 → `❌ gpt-image-1 not available on this org. Check tier/access at platform.openai.com.`
2. **Figma MCP connected?** Need `get_screenshot`, `use_figma`, `upload_assets`. Missing → `❌ /banner2 needs Figma MCP read+write access.`
3. **Egress allowlist check.** Test both hosts in parallel:
   - `https://api.openai.com/`
   - `https://mcp.figma.com/`
   Look for `host_not_allowed` in the body. On allow-list failure, surface and ask Continue (no paint) / Stop.

All checks finish in under 3 seconds. Silent on success. The API key is **never** echoed to the user or to any tool log.

### API key resolution rules

- Preferred: `$env:OPENAI_API_KEY` (PowerShell session var, never persisted to disk).
- Fallback: `.env` file in repo root with `OPENAI_API_KEY=sk-...`. The file is already gitignored.
- **Never** hardcode the key into prompts, Bash commands echoed to the user, or any committed file. Refer to it as `"$env:OPENAI_API_KEY"` (PowerShell) or `"$OPENAI_API_KEY"` (POSIX) only.
- **Never** log the key in tool output. If a curl command would expose it, build the auth header via a temp file or PowerShell variable; do not print the header.

---

## Phase 0 — silent setup

(Identical to `/banner` — language detect, register classify, LP hero read with retry.)

### Phase 0.1 — language (silent)

Detect from Title + CTA. Labels: `pt-BR`, `pt-PT`, `es-LATAM`, `es-ES`, `English`, `Arabic`, `Hebrew`, `Urdu`, `Farsi`, `Pashto`, `th-TH`, `tr-TR`, `sv-SE`, `de-DE`, `ms-MY`, `id-ID`, otherwise closest. Default `English`.

### Phase 0.2 — register (silent)

Classify from Title + CTA per **§ Register cues**: `aspiration / urgency / provocation / trust / curiosity / empowerment / identity`. Default `curiosity`.

### Phase 0.3 — LP hero (silent, with retry)

1. Call `get_screenshot(fileKey, nodeId, maxDimension=1200)`.
2. **On `session expired`:** retry with 2s then 4s. After 2 retries → fall back to no-LP-context (silent).
3. **On success:** extract a one-line `LP visual style` (palette + tone + setting + LP CTA color if visible + LP purpose). **Do NOT enumerate exact props.**
4. **On any other error:** fall back, record in Phase 8 problem-list.

---

## Phase 0.4 — size selection (BLOCKING)

(Identical to `/banner`.) Multi-select poll: 1200×1200 / 1200×628 / 1080×1920 / 960×1200 / 1920×1080 / 300×250 / 728×90 / 300×600 / All-standard / Custom. 1200×1200 always included as MVP/master.

## Phase 0.45 — creative control mode (BLOCKING)

(Identical to `/banner`.) Customize vs Auto.

## Phase 0.5 — creative polls (CUSTOMIZE MODE ONLY)

(Identical to `/banner` — Poll 1 Title highlight / Poll 2 CTA suggestion / Poll 3 Campaign direction / Poll 4 Local cues.)

## Phase 1.0 — Creative Card

(Identical to `/banner`.)

```
Campaign purpose:        <what is being sold + why now>
Market / language:       <e.g. Malay / Malaysia (ms-MY)>
Emotional register:      <register from Phase 0.2>
Primary hook:            <number / phrase / claim that dominates>
Main visual hierarchy:   <hero element + role of any support>
LP visual style:         <one-line from Phase 0.3 — palette + tone, NO prop enumeration>
Required aspect ratios:  <list from Phase 0.4>
Layout lock:             <one-line position rules from § Aspect-Ratio Layout Locks>
Avoid:                   <specific cliché this concept could regress into>
```

---

## Phase 1 — compose the visual prompt (silent)

Use **§ Visual Prompt Template v1.0** (identical structure to /banner v2.7). **450–750 chars preferred, ≤900 hard.**

---

## Phase 2 — render MVP **`[banner2 swap — synchronous OpenAI call]`**

**MVP target size:** 1024×1024 (the only 1:1 size OpenAI gpt-image-1 supports). The Figma frame is created at 1200×1200; `scaleMode=FILL` upscales the 1024 master to 1200 (negligible loss for paid-social).

**Single concept call — POSIX/Bash example:**

```bash
mkdir -p /tmp/banner2
# Build payload as a JSON file to avoid any shell escaping of the prompt
cat > /tmp/banner2/mvp-b1-payload.json <<'JSON'
{
  "model": "gpt-image-1",
  "prompt": "<filled Visual Prompt — 450-750 chars>",
  "n": 1,
  "size": "1024x1024",
  "quality": "high",
  "output_format": "png"
}
JSON

# Synchronous call. Typical latency 20-90s. Timeout 300s.
curl -sS --max-time 300 https://api.openai.com/v1/images/generations \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  --data @/tmp/banner2/mvp-b1-payload.json \
  -o /tmp/banner2/mvp-b1-resp.json

# Decode b64 PNG to file
jq -r '.data[0].b64_json' /tmp/banner2/mvp-b1-resp.json | base64 -d > /tmp/banner2/mvp-b1.png

# Sanity check
test -s /tmp/banner2/mvp-b1.png && echo "ok" || echo "empty PNG — check resp.json for error"
```

**PowerShell variant (if Bash unavailable):**

```powershell
$payload = @{ model = "gpt-image-1"; prompt = "<filled>"; n = 1; size = "1024x1024"; quality = "high"; output_format = "png" } | ConvertTo-Json -Compress -Depth 4
$payload | Out-File -Encoding utf8 -NoNewline /tmp/banner2/mvp-b1-payload.json
$resp = Invoke-RestMethod -Uri "https://api.openai.com/v1/images/generations" -Method Post -Headers @{ Authorization = "Bearer $env:OPENAI_API_KEY" } -ContentType "application/json" -Body $payload -TimeoutSec 300
[IO.File]::WriteAllBytes("/tmp/banner2/mvp-b1.png", [Convert]::FromBase64String($resp.data[0].b64_json))
```

**Multi-concept (chunked ≤5 concurrent):** fire 5 generations in parallel using a single Bash message with multiple `curl ... &` calls + `wait`, or via separate Bash tool calls in the same assistant turn. After the first chunk completes, fire the next chunk.

**On HTTP error (4xx / 5xx):**

- `401` → surface immediately as **`❌ OPENAI_API_KEY rejected — rotate at platform.openai.com.`** Halt run.
- `429` (rate limit) → back off 30s, retry once. If still 429, surface as a Phase 8 problem-list item and continue with whichever concepts succeeded.
- `400` content policy violation (`error.code = "moderation_blocked"` or similar) → record concept as failed, queue **one** simplified retry (mirrors v2.7 lesson: drop subject-specific descriptors, swap to abstract metaphor). After 1 retry, surface to designer pause regardless.
- `500-504` → retry once after 15s.
- Any other body shape — log under Phase 8 problem-list verbatim.

**Never:** print the full `Authorization` header back to the user. If a Bash response is going to leak the header, redirect curl output to a file and only read the file body.

---

## Phase 2.5 — MVP cliché QA + auto-redo

(Identical to `/banner` v2.7.) Read the rendered PNG, answer the same 6 questions. One corrective retry max with the same corrective prefix:

> *Previous result looked too much like a dark editorial / finance photo. Regenerate as a bold localized campaign poster with oversized typography, visible graphic panels, brighter premium palette, local atmosphere, and no office / desk / lamp / analyst props.*

---

## Phase 3 — create Figma frames

(Identical to `/banner`.) Grid: one row per concept, one column per size. Idempotent placement.

> **Note on returned node IDs (carried over from v2.7 problem-list):** The IDs returned by `use_figma` at frame-creation time may differ from the IDs Figma persists after the script commits. When subsequent paint calls need a nodeId, **re-resolve the frame by `name`** via `figma.currentPage.findAll(n => n.name === "...")` rather than trusting the create-time ID. This avoids the off-by-one mis-routing that bit /banner runs in May 2026.

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
    f.name = `Banner2 — ${concept} — ${w}x${h} — ${runStamp}`;
    f.resize(w, h);
    f.x = x; f.y = rowY;
    f.fills = [];
    f.clipsContent = true;
    f.cornerRadius = 0;
    figma.currentPage.appendChild(f);
    conceptFrames.push({ size: `${w}x${h}`, id: f.id, name: f.name });
    x += w + sizeGap;
  }
  result.frames.push({ concept, rows: conceptFrames });
}
return result;
```

(Note frame name prefix is `Banner2` so runs from `/banner` and `/banner2` don't collide on the same Figma page.)

---

## Phase 4 — paint MVP into 1:1 frame

Two safe paths — pick whichever has worked most reliably for the active Figma MCP session:

**Path A — upload_assets + curl POST (mirrors /banner).** Three parallel turns:

1. `# PNG already on disk at /tmp/banner2/mvp-b<n>.png`
2. `upload_assets(fileKey, nodeId=<mvp_frame_id>, scaleMode=FILL, count=1)`
3. `curl -sS -X POST -H "Content-Type: image/png" --data-binary @/tmp/banner2/mvp-b<n>.png "<submitUrl>"`

**Path B — direct fill via use_figma (recommended after the v2.7 ID-mismatch lesson).** After Path A's POST succeeds, also call `use_figma` to explicitly set the fill, using the `imageHash` returned by Path A and the frame node resolved by **name lookup** (not the original create-time ID):

```js
const target = figma.currentPage.findAll(n => n.name === "<exact frame name>")[0];
target.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: "<hash from Path A response>" }];
```

This double-write makes the paint resilient to the `placedOnNodeId` field being absent in upload responses, which has been observed silently dropping placements.

**If Phase 4 fails due to egress block:** record `paint_failed` in problem-list; surface `⚠️ Paint blocked — MVP available at /tmp/banner2/mvp-b<n>.png. Drag into the 1200×1200 frame manually.` Skip to Phase 8.

---

## Phase 5 — 🛑 designer review pause

(Identical to `/banner`.)

---

## Phase 6 — recompose to non-1:1 sizes **`[banner2 swap — Images Edits with master attached]`**

For each non-1:1 size, compose a recomp prompt using **§ Recomposition Prompt Template** (≤ 1,200 chars). The master PNG (Phase 2 MVP) is attached as a multipart `image[]` to OpenAI's Images Edits endpoint.

**Edits call example:**

```bash
curl -sS --max-time 300 https://api.openai.com/v1/images/edits \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -F "model=gpt-image-1" \
  -F "image[]=@/tmp/banner2/mvp-b1.png" \
  -F "prompt=<filled Recomposition Prompt>" \
  -F "n=1" \
  -F "size=1536x1024"  `# WIDE — see Aspect map` \
  -F "quality=high" \
  -F "output_format=png" \
  -o /tmp/banner2/b1-wide-resp.json

jq -r '.data[0].b64_json' /tmp/banner2/b1-wide-resp.json | base64 -d > /tmp/banner2/b1-wide.png
```

**Chunked concurrency.** Fire ≤5 recomp edits per chunk. Total recomp count for a typical 7-concept × 2-non-1:1-size run is 14; that's three chunks of 5/5/4.

**Recomp is layout REDESIGN per format, not resize.** Apply the aspect-ratio layout lock from § Aspect-Ratio Layout Locks. Pass the Campaign Element Manifest verbatim from Phase 1.0.

### § Aspect map **`[banner2 swap — adjusted for gpt-image-1 fixed sizes]`**

gpt-image-1 supports three sizes: `1024x1024`, `1024x1536`, `1536x1024`. The Figma frame is the exact target W×H; `scaleMode=FILL` handles the crop/scale between render-aspect and frame-aspect. Crop percentages are **larger** than /banner because OpenAI's fixed sizes don't match every frame aspect.

| Frame size | Frame aspect | OpenAI `size` | Render aspect | Per-aspect layout | Crop % | Notes |
|---|---|---|---|---|---|---|
| any 1:1 | 1.000 | 1024×1024 | 1.000 | SQUARE | 0% | Reuse MVP (no recomp needed) |
| 1200×628 | 1.911 | 1536×1024 | 1.500 | WIDE | ~21% vertical | Heavy crop — enforce 12% safe area top + bottom |
| 960×1200 | 0.800 | 1024×1536 | 0.667 | PORTRAIT | ~17% horizontal | Heavy crop — enforce 10% safe area left + right |
| 1080×1350 | 0.800 | 1024×1536 | 0.667 | PORTRAIT | ~17% horizontal | Heavy crop — enforce 10% safe area left + right |
| 1200×960 | 1.250 | 1536×1024 | 1.500 | MILD WIDE | ~17% horizontal | Heavy crop — enforce 10% safe area left + right |
| 1080×1920 | 0.5625 | 1024×1536 | 0.667 | TALL | ~16% horizontal | Enforce 10% safe area left + right |
| 1920×1080 | 1.778 | 1536×1024 | 1.500 | LANDSCAPE | ~16% vertical | Enforce 10% safe area top + bottom |
| 300×250 | 1.200 | 1536×1024 | 1.500 | MILD WIDE | ~20% horizontal | Heavy crop — flag in Phase 8 |
| 728×90 | 8.089 | 1536×1024 | 1.500 | EXTREME WIDE | ~81% vertical | Unusable — surface in Phase 8 problem-list, recommend manual HTML5 |
| 300×600 | 0.500 | 1024×1536 | 0.667 | TALL | ~25% horizontal | Heavy crop — flag in Phase 8 |

**Safe-area axis derivation.** Same rule as /banner: when `frame_aspect > render_aspect`, crops vertical axis; when `frame_aspect < render_aspect`, crops horizontal axis. The crop percentages are higher for /banner2 — recomp prompts MUST include the safe-area instruction at the `crop_pct > 10%` threshold (down from /banner's 5%) because the baseline crop is already heavier.

**Campaign element manifest** from Phase 1.0 is passed verbatim into the recomp prompt (same as /banner). Recomps must preserve design assets — NOT physical props.

---

## Phase 6.5 — silent visual QA

(Identical to `/banner` v2.7.) Critical failures (split-panel, no design layer, edge clipping, dark-office regression) trigger ONE auto-retry with a corrective prompt. Cap auto-retries at 1 per concept × size.

---

## Phase 7 — paint recomps

(Identical to `/banner` Phase 4 — same Path A + Path B double-write pattern.)

---

## Phase 8 — summary + problem list

Short success message + Figma file URL. Include a `⚠️ Problems during this run` block with any:

- `moderation_blocked` retries
- Rate-limit (429) deferrals
- Heavy-crop flags (>20%)
- `paint_failed` rows
- API timeouts that succeeded on retry

---

# § Visual Prompt Template (v1.0 — short creative brief)

(Identical structure to `/banner` v2.7 Visual Prompt Template. The model receives the same kind of 6-section short brief.)

**450–750 chars preferred, hard ≤900.**

```
{W}x{H} premium localized campaign poster for {MARKET}, {REGISTER} mood. Finished paid-social creative, not an editorial office photo.

Main hook: "{highlight phrase}" is the visual hero. Use bold graphic ad layout, oversized typography, premium {palette} color system, clean copy zone, and visible design layer.

Layout: {aspect-ratio layout lock — one sentence}. Title reads exactly: "{Title}". CTA "{CTA}" {CTA placement if present}.

Visual atmosphere: {local market cue, one phrase}, subtle {campaign theme} energy, soft gradients, curved panels, polished campaign lighting. Optional photo-real subject only as support, integrated into the design.

Readable text only: Title and CTA. No logos, no fake UI, no invented text. Avoid {forbidden defaults — short list}.
```

**Note on `{W}x{H}` in the prompt:** Even though the actual OpenAI `size` parameter is fixed at one of three values, keep the **frame** W×H in the prompt copy — it anchors the model's spatial intuition. The `size` parameter in the API call is set separately per § Aspect map.

---

# § Recomposition Prompt Template

(Identical structure to `/banner` v2.7.)

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

SAFE AREA: {if crop_pct > 10% — "Leave 10–12% safe area on <vertical | horizontal> axis."}

Constraints: exactly {W}×{H} px. No new content. No watermarks. NO HARD SPLIT-PANEL. NO regression into office / desk / lamp / notebook / coffee / analyst portrait / AI chip still life. Any screen/chart/UI blurred or abstract. {If RTL: keep mirrored direction.}
```

---

# § Design Framework (Claude only)

(Identical to `/banner` v2.7 — copied verbatim. Six decision principles, Aspect-Ratio Layout Locks, 5 Creative Archetypes, Claude-vs-image-model responsibility split, Background Logic, Highlight phrase treatment, CTA Color Tier rule, Register cues, Localization atmosphere allowlists incl. Malaysia, RTL, Typography, Hard guardrails.)

### Six decision principles

For each banner:

1. **Hook visual** — which element of the Title (number / phrase / claim) is the campaign hero. Numbers ≥ 2 digits or % or strong single-word claims auto-trigger typography-hero mode.
2. **Layout lock** — the per-aspect-ratio placement rule. Claude enforces; the image model obeys.
3. **Subject role** — optional support, not hero (unless the brief is explicitly a portrait campaign). Claude does not enumerate exact features.
4. **Background atmosphere** — 1–2 short phrases.
5. **Palette** — 2 hex + body color. LP-continuity bias. ≥ 4.5:1 button contrast.
6. **Button (CTA)** — Tier 2 hex, polished campaign button, height = `clamp(canvas_h × 0.08, 80, 160) px`.

### § Aspect-Ratio Layout Locks (ONE LINE EACH)

- **1:1 — SQUARE (master):** *Large title block on left / top-left or center-left. Visual / atmosphere on right or background. CTA below title if present. Key hook can become oversized and dominant.*
- **1200×628 — WIDE:** *Copy + CTA on left 40–45%. Visual / atmosphere on right 55–60%. No tall stacked text. Strong horizontal campaign composition.*
- **9:16 — TALL (Story / Reel):** *Title top 20–30%. Visual center 40–50%. CTA bottom-center if present. Mobile safe zones (top 8%, bottom 12%).*
- **3:4 — PORTRAIT:** *Title upper. Visual center. CTA lower. Premium editorial poster feel, still campaign-designed.*
- **16:9 — LANDSCAPE (Hero):** *Title + CTA in left third or left 40%. Large visual atmosphere on right. Wide cinematic campaign layout, not a photo with text.*

DISPLAY (300×250 / 728×90 / 300×600): heavy crop, Phase 6.5 may flag as unusable.

### § Creative Archetypes (5 — pick ONE per concept)

- **A. Local Hero Campaign** — native subject OR local environment + large campaign title.
- **B. Premium Offer Poster** — huge number / %, bonus, key phrase dominates. Typography is the hero.
- **C. Editorial Lifestyle Campaign** — believable person in local lifestyle context, designed as a poster.
- **D. Cultural Prestige Campaign** — local architecture / skyline / regional identity frames the message.
- **E. Minimal Premium Typographic Campaign** — title carries the ad.

### § What Claude controls vs what gpt-image-1 controls

**Claude controls (in the prompt):**
- Format + market + mood
- Hook ("Main hook: '{phrase}' is the visual hero")
- Layout lock (one sentence per aspect ratio)
- Verbatim Title + CTA text
- CTA placement
- Palette names (or hex if LP-derived)
- Local market cue (1–2 words)
- Forbidden defaults (short list)

**gpt-image-1 controls (Claude does NOT prescribe):**
- Exact subject features (age, hair, wardrobe, expression)
- Specific room interior, props
- Lighting angle / color temperature
- Decorative ornament style
- How the design layer renders
- Atmospheric depth treatment
- Font choice

Stay in your lane.

### § Background Logic

**Use:** continuous campaign background · graphic panels · soft gradients · local atmosphere · decorative energy · clean copy zone · visual flow between text and hero.

**Avoid:** continuous office scene · realistic desk environment · corporate room · dark luxury interior · flat split panel.

### § Highlight phrase treatment

(Same internal computation rules as /banner v2.7. Output as `"oversized [color] typography"` in the prompt.)

### CTA Color Tier rule

(Same as /banner — Tier 1 ≠ Tier 2 in hex.)

### Register cues

(Same table as /banner v2.7.)

### Localization (atmosphere-first allowlists)

(Same allowlists as /banner v2.7 + Malaysia added.)

- **Nordic / Swedish:** "Stockholm waterfront / Nordic skyline atmosphere, deep navy + ivory + gold / neon-green palette, golden-hour or cool daylight, soft curved panels, minimal-but-bold typographic hierarchy."
- **DACH:** "Berlin / Zurich / Vienna skyline silhouette, engineering-precision graphic structure, neutral grey + accent palette."
- **LATAM:** "São Paulo / Mexico City warm daylight, terracotta + sun-saturated colors, natural textures."
- **MENA Gulf:** "Gulf skyline silhouette, marble-texture gradient + restrained gold-line ornament framing."
- **East Asia (urban):** "Dense city neon abstracted into color flow, glass-tower silhouette, sleek tech-surface gradient."
- **Thailand:** "Bangkok temple gold-tone + soft warm light, saturated jewel-tone palette, subtle ornamental framing."
- **JP:** "Tokyo / Kyoto refined minimalism, ink-and-gold or refined neon palette, soft architectural silhouette."
- **Malaysia:** "Kuala Lumpur skyline silhouette (Petronas Towers optional), warm tropical light, deep black + rich gold + ivory palette, polished campaign atmosphere, subtle Malay batik or arabesque ornament — no dark office."
- **Indonesia:** "Jakarta skyline silhouette, warm tropical daylight, terracotta + saffron + ivory palette, soft architectural softness."

**Market exclusion lists** (same as /banner).

### RTL composition

(Same as /banner.)

### Typography

- LTR headline: Inter (default), Söhne, Helvetica Now.
- Max 2 typefaces. Weights 700–900. No drop shadows, no outlining, no distortion.

### Hard guardrails

(Same as /banner v2.7, plus:)

- **Never** include `OPENAI_API_KEY` or its value in any prompt, comment, or echoed Bash command.
- **Never** commit a file containing the key. `.env` is gitignored — confirm before any commit that no key string leaked into another file.

---

## Final Internal Check (6 questions before MVP and after)

Before sending the prompt to gpt-image-1, Claude must mentally answer:

1. Does this **sound like a brief** or a photoshoot direction?
2. Is the **title / offer the hero**?
3. Is the **layout lock present** for the aspect ratio?
4. Did I **avoid enumerating** exact features, exact props, exact lighting angles?
5. Did I **name the forbidden defaults** to avoid?
6. Is the prompt **≤ 900 chars** (preferably 450–750)?

After MVP renders, Phase 2.5 cliché QA asks the same set against the rendered image.

---

## Constraints **`[banner2 swap — OpenAI specifics]`**

- Visual Prompt 450–750 chars preferred, ≤900 hard.
- Recomp Prompt ≤1,200 hard.
- **OpenAI `gpt-image-1` only.** Never substitute with another model.
- **Quality always `high`.** (gpt-image-1 supports `low` / `medium` / `high` — paid-social ships at `high`.)
- **Output format always `png`.**
- **Size set per § Aspect map** — one of `1024x1024`, `1024x1536`, `1536x1024`.
- MVP always 1024×1024 (1:1). Painted into 1200×1200 frame with `scaleMode=FILL`.
- MVP master is the input to recomps via Images Edits `image[]` multipart attachment.
- Verbatim Title + CTA.
- **Phase 0.4 size selection BLOCKING** (unless sizes in input).
- **Phase 0.45 creative mode BLOCKING** (Customize vs Auto).
- **Phase 0.5 polls run ONLY in Customize mode.**
- **Auto mode internally generates 3 candidate campaign directions** before picking.
- **Phase 1.0 — Creative Card extraction** (9 lines per concept).
- **Pick ONE of 5 creative archetypes per concept.**
- **Typography Hero Rule:** number / % / strong claim → type is hero.
- **Background = continuous promotional campaign composition** — NEVER hard split-panel, NEVER dark office scene.
- **Per-aspect layout lock** = one sentence per format.
- **Title visual rows pinned across recomps.**
- **Title block height = clamp(canvas_h × 0.22, 180, 480) px.**
- **CTA height = clamp(canvas_h × 0.08, 80, 160) px.**
- **Subject vertical fill in TALL/PORTRAIT:** 45–55% of canvas height (only when a subject is used).
- **CTA color tier rule:** Tier 1 (highlight) ≠ Tier 2 (CTA) in hex.
- **Campaign element manifest** carried into every recomp.
- **Phase 2.5 MVP cliché QA + auto-redo** — 1 corrective retry max.
- **Phase 6.5 silent visual QA** before painting recomps.
- **Synchronous OpenAI calls.** No polling. Per-request HTTP timeout 300s. Retry rules: 429 → 30s backoff then once; 5xx → 15s backoff then once; 400 moderation → 1 simplified retry.
- **Concurrency cap 5 per chunk** for Phase 2 and Phase 6. Bump only if the OpenAI org tier supports it.
- **Frame name prefix `Banner2`** so /banner and /banner2 grids never collide on the same page.
- **Re-resolve frame nodes by name** at paint time (carried over from v2.7 ID-mismatch problem-list).
- **`upload_assets` paint is doubled with a `use_figma` fill-set** for resilience.
- Figma is read+write.
- **Egress allowlist required: `api.openai.com` + `mcp.figma.com`.**
- **`OPENAI_API_KEY` env var or `.env` required.** Key never echoed in tool output.
- No autonomous commits.
