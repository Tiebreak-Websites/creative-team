---
description: QA a localized Figma landing page — fast script-driven checks (parity, placeholders, images, overflow, CTAs, regulator phrases) plus LLM judgment on language + conversion tone
---

# /qa — Figma landing-page QA

The teammate is asking Claude to QA a localized landing page inside Figma. Two phases:

1. **Fast, deterministic checks** run as Python scripts against the Figma REST API. One HTTP fetch, local JSON analysis. No Figma MCP round-trips.
2. **LLM judgment** (language correctness, conversion-focused tone) runs in this conversation on a compact text dump emitted by Phase 1.

Output is a Markdown report at `projects/<brand>/qa-reports/<YYYY-MM-DD-HHmm>-<fileKey>.md`. Posting comments to Figma is intentionally *opt-in* (`--post`) — not done by default.

## Input parsing

Arguments: `$ARGUMENTS`

Expected format: `<figma-url> <language-code> [--brand <name>] [--tone] [--post]`

- `<figma-url>` — any valid Figma file URL; parse out the file key yourself. From `https://figma.com/design/:fileKey/:fileName?node-id=…`, the fileKey is the segment after `/design/`.
- `<language-code>` — ISO-639-1 code (`es`, `pt`, `fr`, `de`). Phrases like "Spanish Latam" → map to `es`. If the teammate gives you a label you can't confidently map, ask.
- `--brand <name>` — optional; folder name under `projects/`. If omitted, try to auto-match the Figma file name against folders in `projects/` and use the hit.
- `--tone` — optional. Runs Phase 2 tone analysis. Off by default because tone analysis is the expensive part; skip it for routine localization QA.
- `--post` — optional. Posts one Figma comment per finding (requires `FIGMA_TOKEN` with comment scope). Off by default — the Markdown report is the primary deliverable.

If `<figma-url>` or `<language-code>` is missing, stop and tell the teammate the expected usage — do not guess.

## Pre-flight

1. `echo $FIGMA_TOKEN | head -c 4` — if empty, stop and tell the teammate to set `FIGMA_TOKEN` (see [projects/qa/README.md](../../projects/qa/README.md)).
2. `python --version` — must be ≥3.8. If Python is missing, stop and link the teammate to python.org.

**Figma read path:** see [`.claude/memory/figma_tool_selection.md`](../memory/figma_tool_selection.md). Deterministic Phase 1 checks use the Python scripts (canonical). For ad-hoc node inspection in Phase 2 LLM judgment (e.g. "what does node 1:234 actually contain?"), prefer `mcp__framelink-figma__get_figma_data` over `get_design_context` — cleaner JSON, no code wrapper.

## Phase 1 — deterministic checks (scripts)

Run both scripts from the repo root:

```bash
CACHE=$(python projects/qa/scripts/fetch.py <fileKey>)
python projects/qa/scripts/check.py "$CACHE" <lang> [--brand <name>]
```

`check.py` prints a JSON summary to stdout with `findingsPath`, `textsPath`, and counts. Read both files.

`findings.json` already covers checks **5.1 parity, 5.3 placeholder, 5.4 broken images, 5.5 overflow, 5.6 CTA issues (partial), and regulator-phrase warnings from 5.7**. No LLM calls needed for any of these.

If either script exits non-zero, read its stderr, surface the error to the teammate, and stop.

## Phase 2 — LLM judgment (only if `--tone` is set, or always for language)

### 2a. Wrong language (check 5.2) — always runs

Read `texts.json`. For each text in the target-language devices, flag any that is obviously not in the target language (full English sentences, mixed-language phrases). Skip loanwords/brand names per the brand's `qa-config.json` allowlists.

Append one finding per flagged text to the findings list, in the same shape as Phase 1:
```json
{"check": "wrong-language", "severity": "error", "device": "<device>", "nodeId": "<id>", "message": "<describe>"}
```

### 2b. Conversion-focused tone (check 5.7) — only with `--tone`

Read `texts.json`. For each major copy block (hero, h1, h2, body with fontSize≥16, CTAs), evaluate against the brand's `target_voice` (or default voice). Flag vague, hedged, filler, or tonally-off blocks. For each flagged block, produce a one-line "what's weak", one-line "why it hurts conversion", and one tighter "suggested rewrite". Append as findings with `check: "tone"`, `severity: "error"` (or `warning` for minor), and include `rewrite` field.

Only run this if `--tone` was passed. Otherwise skip and note in the summary.

## Phase 3 — write the report

Create `projects/<brand>/qa-reports/<YYYY-MM-DD-HHmm>-<fileKey>.md` (create folders as needed — use `<brand>=default` if no brand). Structure:

```markdown
# QA report — <fileName>

- File: https://figma.com/design/<fileKey>/
- Language: <lang>
- Brand: <brand-or-default>
- Ran at: <timestamp>
- Counts: <N> issues (<E> errors, <W> warnings)

## Summary by check
| Check | Errors | Warnings |
| --- | --- | --- |
…

## Findings

### Cross-device parity (5.1)
- [error] desktop · nodeId `1:31` — <message>
…
```

One section per check category. For tone findings, include the rewrite block.

## Phase 4 — optional: post to Figma (only if `--post`)

Run:
```bash
python projects/qa/scripts/post.py projects/qa/.cache/<fileKey>.findings.json
```

The script posts one pinned comment per finding (small delay between calls for rate-limit safety) and prints a JSON summary with posted/failed counts. Known limitation: instance-internal node IDs of the form `I<parent>;<child>` will 400 — those findings are skipped and reported as failures. The Markdown report still covers them.

Requires `FIGMA_TOKEN` with Comments:Write scope.

## Phase 5 — summarize in chat

One-line summary followed by a short breakdown:

```
/qa done — <N> issues (<E> errors, <W> warnings) · report: projects/<brand>/qa-reports/<filename>.md · brand: <detected-or-default> · tone: <on|skipped> · comments: <posted-count|skipped>
```

Then: issues-per-device table + issues-per-check table (reuse what's in the report).

## Caching

`fetch.py` writes the full file JSON to `projects/qa/.cache/<fileKey>.json`. Re-running `check.py` against that cache is free. If the teammate wants fresh data, delete the cache file (or just re-run `fetch.py` — it overwrites).

## Fail-fast rules

- Missing `FIGMA_TOKEN`: stop, link the teammate to setup docs.
- `fetch.py` errors: read stderr, surface verbatim. Common causes: bad file key, token lacks file access, file is in a team the token can't reach.
- `check.py` errors: usually ambiguous device classification. Tell the teammate to rename a frame or add `device_widths` overrides to `projects/<brand>/qa-config.json`.
- Never silently skip a check. If language/tone LLM judgment can't complete (e.g. texts.json empty), say so.

## Defaults (when no qa-config.json is present)

```json
{
  "target_voice": "Confident, specific, benefit-led, action-driving. Retail-friendly but authoritative. Every headline earns its space.",
  "brand_name_allowlist": [],
  "loanword_allowlist": [],
  "device_widths": { "desktop_min": 1200, "tablet_min": 600 }
}
```

## Non-goals for this version

- Does not compare LA content against an EN reference.
- Does not auto-fix anything in Figma.
- Does not block `/push`.
- Does not generate more than one suggested rewrite per tone issue.
- Does not evaluate color contrast, accessibility, or breakpoints beyond the three device frames.
