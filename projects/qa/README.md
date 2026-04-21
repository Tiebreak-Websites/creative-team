# QA — v1.1

Automated QA for localized Figma landing pages. Runs deterministic checks (content parity across Desktop/Tablet/Mobile, placeholder text, broken images, overflow, CTA issues, regulator-phrase warnings) as plain Python scripts against the Figma REST API, then uses Claude to judge language correctness and — optionally — conversion-focused tone.

**Architecture**: one HTTP fetch, local JSON analysis, no Figma MCP round-trips. Runs in seconds.

## Changelog

### v1.1 — 2026-04-21
- **Switched reads from Figma MCP → Figma REST API.** A full-file fetch that was taking 15+ minutes (and often never completing) now runs in ~3 seconds.
- **Split the command into two phases.** `fetch.py` + `check.py` handle all deterministic checks locally; Claude is only invoked for language judgment and (optionally) tone. This saves both time and tokens.
- **Added `--tone` flag.** Tone analysis is the expensive part; it's now opt-in instead of always-on.
- **Added `--post` flag with `post.py`.** Pin findings as Figma comments via REST. Off by default — the Markdown report is the primary deliverable.
- **Cache.** `fetch.py` writes to `.cache/<fileKey>.json` so iterating on check rules is free.
- Reports now land at `projects/<brand>/qa-reports/<timestamp>-<fileKey>.md`.

### v1.0 — initial /qa command
- Spec-only version that relied on the Figma MCP plugin sandbox. Deprecated in v1.1 due to payload-size timeouts on real LP files.

## One-time setup

1. **Python ≥ 3.8** — check with `python --version`. Uses stdlib only, no pip installs.
2. **Figma Personal Access Token**:
   - Go to [figma.com/settings](https://www.figma.com/settings) → **Personal access tokens** → **Create new token**.
   - Give it at minimum the **File content: Read** scope. Add **Comments: Write** if you want to use `--post`.
   - Copy the token and store it in your shell profile:
     ```bash
     # bash / zsh
     export FIGMA_TOKEN='figd_…'
     ```
     ```powershell
     # PowerShell — add to $PROFILE
     $env:FIGMA_TOKEN = 'figd_…'
     ```
   - Open a new terminal and confirm: `echo ${FIGMA_TOKEN:0:4}` should print the first 4 chars.

## How to run it

From anywhere in the repo:

```
/qa <figma-url> <language-code> [--brand <name>] [--tone] [--post]
```

- `<figma-url>` — any Figma file URL.
- `<language-code>` — ISO-639-1 code (`es`, `pt`, `fr`, `de`, …). "Spanish Latam" → `es`.
- `--brand` — optional folder name under `projects/` for per-brand config. Auto-detected when omitted.
- `--tone` — optional; adds conversion-tone analysis. Off by default (expensive).
- `--post` — optional; posts one Figma comment per finding. Off by default; report is always written to disk.

Output: a Markdown report at `projects/<brand>/qa-reports/<YYYY-MM-DD-HHmm>-<fileKey>.md`.

## Running the scripts directly (for testing)

```bash
# Fetch + cache the file
CACHE=$(python projects/qa/scripts/fetch.py <fileKey>)

# Run deterministic checks
python projects/qa/scripts/check.py "$CACHE" es --brand braintrade-template
```

`check.py` prints a JSON summary and writes `findings.json` + `texts.json` to `projects/qa/.cache/`. You can iterate on the check rules without re-fetching — the cache is the source of truth until you delete it.

## Per-brand config

If the Figma file belongs to a brand, drop `projects/<brand>/qa-config.json`:

```json
{
  "target_voice": "Confident, specific, benefit-led, action-driving.",
  "brand_name_allowlist": ["BrainTrade", "TradePro"],
  "loanword_allowlist": ["dashboard", "trading"],
  "device_widths": {
    "desktop_min": 1200,
    "tablet_min": 600
  }
}
```

Without it, `/qa` uses built-in defaults.

## What the scripts check

| Check | Where | Notes |
| --- | --- | --- |
| 5.1 Cross-device parity | `check.py` | Normalized text diff across Desktop/Tablet/Mobile |
| 5.2 Wrong language | Claude (always) | LLM judgment on `texts.json` |
| 5.3 Placeholder text | `check.py` | Regex: lorem ipsum / placeholder / TBD / TODO / XXX |
| 5.4 Broken images | `check.py` | Image fills without a resolved source |
| 5.5 Overflow | `check.py` | Text bbox > parent bbox (2px tolerance) |
| 5.6 CTA issues | `check.py` | Dummy labels + label mismatch across devices |
| 5.7 Regulator phrases | `check.py` | Regex warnings: guaranteed returns, risk-free, sin riesgo, etc. |
| 5.7 Conversion tone | Claude (`--tone` only) | LLM evaluation against brand `target_voice` |

## Files

| Path | What |
| --- | --- |
| [scripts/fetch.py](scripts/fetch.py) | Fetch + cache the Figma file via REST API |
| [scripts/check.py](scripts/check.py) | Deterministic checks → `findings.json` + `texts.json` |
| [scripts/post.py](scripts/post.py) | Post findings as pinned Figma comments (used by `--post`) |
| `.cache/` | Local cache of fetched files and findings (gitignored) |
| `qa-reports/` | Fallback reports when brand has no own folder (gitignored) |
| [../../.claude/commands/qa.md](../../.claude/commands/qa.md) | Slash-command definition — the orchestrator |

## Related

- Figma MCP tools are also wired up (`mcp__...__use_figma` family) — used for non-QA design flows, not `/qa`. `/qa` avoids MCP on purpose because REST is dramatically faster for whole-file reads.
