# Creative Team

A shared toolkit for the design + creative team — Figma automations, banner generators, QA tools, and team knowledge — all built to run inside [Claude Code](https://claude.com/claude-code).

Open this folder with `claude`, type `/pull` to sync the latest tools, and start working. Every team command is one slash away. Every change goes through a pull request.

---

## What's in here

### Projects

| Path | What it is |
| --- | --- |
| [`projects/braintrade-template/`](projects/braintrade-template/) | BrainTrade landing-page template (`index.html` + `content.json`). Protected — changes need PR review. |
| [`projects/creative-summary/`](projects/creative-summary/) | Bilingual creative summary automation for Figma LPs. Scaffolded, in progress. |
| [`projects/qa/`](projects/qa/) | Automated QA for localized Figma landing pages. Parity, language, images, overflow, CTAs, regulator phrases. |

### Shared infrastructure

| Path | What it is |
| --- | --- |
| [`.claude/commands/`](.claude/commands/) | Team slash commands — auto-loaded by Claude Code in this repo |
| [`.claude/memory/`](.claude/memory/) | Shared Claude memory — Figma file keys, node IDs, design tokens |
| [`CLAUDE.md`](CLAUDE.md) | Team rules Claude follows here (read this first) |

---

## Getting started

```bash
git clone https://github.com/chr1srusevv/creative-team.git
cd creative-team
claude
```

Claude auto-loads `CLAUDE.md`, the shared memory, and every team slash command. Then in the Claude prompt:

```
/pull
```

This fetches the latest `main`, refuses to clobber uncommitted work, and summarizes what teammates have shipped since you last synced.

---

## Daily workflow

1. **Pull first.** `/pull` — always sync before starting new work.
2. **Branch.** Create `feature/<your-name>-<what-you-are-building>`. Never commit to `main`.
3. **Build.** Edit, test, ask Claude for help.
4. **Ship.** `/push` — Claude shows the diff, proposes a commit message, asks for confirmation, pushes the branch, and opens a PR.
5. **Review.** Get at least one approval before merging to `main`.

---

## Team slash commands

All live in [`.claude/commands/`](.claude/commands/). Each command links to its spec for the full details.

### [`/pull`](.claude/commands/pull.md)

Sync the latest team tools from GitHub into your local folder. Safe to run anytime — refuses to overwrite uncommitted work.

### [`/push`](.claude/commands/push.md)

Commit your current work and push it to the team repo as a pull request. Enforces the feature-branch rule, asks before committing, never force-pushes.

### [`/qa`](.claude/commands/qa.md) — v1.1

QA a localized Figma landing page in seconds.

```
/qa <figma-url> <lang> [--brand <name>] [--tone] [--post]
```

One-shot REST fetch + deterministic Python checks (parity, placeholders, images, overflow, CTAs, regulator phrases) plus LLM judgment on language and conversion tone. Writes a Markdown report to `projects/<brand>/qa-reports/`. Optionally pins comments to Figma nodes with `--post`.

Requires `FIGMA_TOKEN` (Personal Access Token from figma.com/settings) in your shell env. One-time setup: [`projects/qa/README.md`](projects/qa/README.md).

### [`/banner`](.claude/commands/banner.md) — v1.6

Generate CTR-optimized ad banners with **Higgsfield GPT Image 2** and drop them into a Figma file at the exact pixel sizes you ask for. Claude reads the design framework, reasons through the creative decisions for each banner (subject, setting, lighting, palette, typography, money element, CTA), writes a scene-level prompt, ships it to GPT Image 2 at 1200×1200, recomposes for every other requested aspect, and paints each finished image into a Figma frame.

```
/banner <figma-url> <WxH> [<WxH> ...]
Title: <verbatim title copy>
cta: <verbatim CTA copy>
```

Example:

```
/banner https://figma.com/design/<fileKey>/...
Title: 12 anos de escola. Nenhuma aula sobre investimentos.
cta: Receba Minha Consultoria Gratuita
960x1200, 1200x1200, 1200x628
```

**What you get:** one Figma frame per requested size at exact pixel dimensions, the rendered banner painted in as a fill, plus a summary table with frame node IDs, Higgsfield job IDs, and any crop or timeout warnings.

**v1.6 highlights** (full spec in [`banner.md`](.claude/commands/banner.md)):

- **Auto-detects language** from the copy — drives subject, palette, typography, and LTR/RTL direction
- **One-line cost preview** before any credit fires (`🧾 Plan: N sizes → 1 MVP + M recomps = 1+M generations`)
- **Tight polling** — completion detected within 8s of actually finishing, not 75s later
- **Aspect-mismatch crop warnings** — no more silent FILL crops lopping heads off subjects
- **Idempotent placement** — re-runs land below prior frames, never overlapping at `x=0`
- **Partial failures tolerated** — paint the successful banners, report the rest with their job IDs so you can retry

Requires the Higgsfield and Figma MCP connectors to be configured.

### [`/banner-prompt`](.claude/commands/banner-prompt.md) — v1.0

Same creative reasoning as `/banner` — **without** firing Higgsfield or touching Figma. Pure prompt output you can copy-paste anywhere, plus 5 numbered alternative approaches you can switch between by replying with a single digit.

```
/banner-prompt
Title: <verbatim title copy>
cta: <verbatim CTA copy>   (optional in this mode)
```

Useful when you want to:

- Review the prompt before spending any credit to render
- Iterate cheaply (~$0) across multiple creative directions
- Hand the prompt to a different image tool or vendor

**What you get:**

1. A `📋 Approach:` summary line
2. A fenced code block with the ready-to-copy visual prompt (≤ 2,000 chars)
3. A `🎨 5 alternative approaches` list — reply with `1`–`5` to regenerate in that direction, or describe your own in one line, or type `done` to finish.

Every variant is held to the same framework rules as `/banner` — cultural safety, RTL handling, verbatim copy, hex-coded palettes, money-element priority.

---

## Protected files — ask before editing

- `projects/braintrade-template/index.html` — main LP template; structural changes need PR discussion
- `projects/braintrade-template/content.json` — shared content; coordinate with the team
- `CLAUDE.md` — team rules; changes require team sign-off

Everything else in your feature branch is yours to iterate on freely.

---

## Rules Claude Code follows here

Summarized from [`CLAUDE.md`](CLAUDE.md):

- Never commit directly to `main`
- Never auto-commit — always ask first
- Never force-push, skip hooks, or `reset --hard` without asking
- Always work on a feature branch, always open a PR, always get review

If Claude ever suggests bypassing these, push back — they exist because they've prevented lost work before.

---

## Contacts

- Project owner: [@chr1srusevv](https://github.com/chr1srusevv)
- Repo: https://github.com/chr1srusevv/creative-team
- Issues / feedback: open a GitHub issue on this repo

---

## License

Internal team use. Do not redistribute outside the team without project-owner approval.
