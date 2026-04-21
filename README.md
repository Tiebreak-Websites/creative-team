# Creative Team

Shared home for the Figma tools, automations, and landing-page. Everything here is designed to be used alongside [Claude Code](https://claude.com/claude-code) — Runs Claude in this folder, pulls the latest tools, and ships new ones back via pull requests.

---

## What's in here

### Projects

| Path | What it is |
| --- | --- |
| [`projects/braintrade-template/`](projects/braintrade-template/) | BrainTrade landing-page template (`index.html` + `content.json`). Protected — changes need PR review. |
| [`projects/creative-summary/`](projects/creative-summary/) | Automation that reads a Figma LP file and places a bilingual creative summary above the desktop frame. Scaffolded, build in progress. |
| [`projects/qa/`](projects/qa/) | **v1.1** — Automated QA for localized Figma landing pages. Python scripts (REST API, no MCP) + LLM judgment. Runs in seconds. Checks parity, language, placeholders, images, overflow, CTAs, regulator phrases, conversion tone. |

### Shared infrastructure

| Path | What it is |
| --- | --- |
| `.claude/commands/` | Team slash commands (`/pull`, `/push`, `/qa`) — loaded automatically by Claude Code |
| `.claude/memory/` | Shared Claude memory — Figma file keys, node IDs, design tokens |
| `CLAUDE.md` | Project rules Claude Code follows in this repo (read this first) |

---

## Getting started

### 1. Clone the repo into your local Claude folder

```bash
git clone https://github.com/chr1srusevv/creative-team.git
cd creative-team
```

### 2. Open the folder with Claude Code

```bash
claude
```

Claude will auto-load `CLAUDE.md`, the shared memory, and the team slash commands.

### 3. Before you start new work — pull the latest

Inside Claude Code, run:

```
/pull
```

This fetches the latest `main`, checks your working tree is clean, and summarizes what teammates have shipped since you last synced.

---

## Daily workflow

1. **Pull first.** `/pull` — always sync before starting.
2. **Branch.** Create a feature branch: `feature/<your-name>-<what-you-are-building>`. Never commit to `main`.
3. **Build.** Work on your feature — edit files, ask Claude for help, test locally.
4. **Ship.** Run `/push` in Claude Code. It will:
   - Show you the diff
   - Propose a commit message
   - Ask for confirmation (no auto-commits)
   - Push your branch
   - Open a pull request (or give you the compare URL)
5. **Review.** Get at least one approval before merging to `main`.

---

## Team slash commands

These live in `.claude/commands/` and are available to anyone who clones the repo.

### `/pull`
Sync the latest team tools from GitHub into your local folder. Safe to run anytime — it refuses to overwrite uncommitted work.

### `/push`
Commit your current work and push it to the team repo as a pull request. Enforces the feature-branch rule, asks before committing, and never force-pushes.

### `/qa` (v1.1)
QA a localized Figma landing page. Usage: `/qa <figma-url> <lang> [--brand <name>] [--tone] [--post]`. Runs a one-shot REST fetch + deterministic Python checks (parity, placeholders, images, overflow, CTAs, regulator phrases) and uses Claude only for language and optional tone judgment. Writes a Markdown report to `projects/<brand>/qa-reports/`, optionally pins comments to Figma nodes with `--post`.

Requires `FIGMA_TOKEN` (Personal Access Token from figma.com/settings) in your shell env. See [`projects/qa/README.md`](projects/qa/README.md) for one-time setup.

---

## Protected files — ask before editing

- `projects/braintrade-template/index.html` — main LP template; structural changes need a PR discussion
- `projects/braintrade-template/content.json` — shared content; coordinate with the team before editing
- `CLAUDE.md` — project rules; changes require team sign-off

Everything else in your feature branch is yours to iterate on freely.

---

## Rules Claude Code follows here

Summarized from `CLAUDE.md`:

- Never commit directly to `main`.
- Never auto-commit — always ask first.
- Never force-push, never skip hooks, never reset --hard without asking.
- Always work on a feature branch, always open a PR, always get review.

If Claude ever suggests bypassing these, push back — they exist because they've saved us from lost work before.

---

## Contacts

- Project owner: [@chr1srusevv](https://github.com/chr1srusevv)
- Repo: https://github.com/chr1srusevv/creative-team
- Issues / feedback: open a GitHub issue on this repo

---

## License

Internal team use. Do not redistribute outside the team without project-owner approval.
