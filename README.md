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
| `.claude/commands/` | Team slash commands (`/pull`, `/push`, `/qa`, `/banner`) — loaded automatically by Claude Code |
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

### `/banner` (v1.0)
Generate CTR-optimized ad banners with **Higgsfield GPT Image 2** and drop them into a Figma file at the exact pixel sizes you ask for. End-to-end automation — one prompt, finished frames.

**Usage:**

```
/banner <figma-url> <WxH> [<WxH> ...]
Title: <verbatim title copy>
cta: <verbatim CTA copy>
```

**Example:**

```
/banner https://figma.com/design/<fileKey>/...
Title: 12 anos de escola. Nenhuma aula sobre investimentos.
cta: Receba Minha Consultoria Gratuita
960x1200, 1200x1200, 1200x628
```

**What happens:**

1. Resolves the GPT Image 2 model via the Higgsfield MCP connector.
2. Builds a senior-performance-marketing brief (dense, photorealistic, layered composition, two-tier hierarchy, strict typography + color rules) and substitutes your size + title + CTA. The design direction is **baked into the command** — you don't supply it.
3. Fires one `generate_image` call per size **in parallel** at `gpt_image_2`, `quality: high`, `resolution: 2k`, with the closest supported aspect ratio (`1:1`, `4:3`, `3:4`, `16:9`, `9:16`, `3:2`, `2:3`).
4. Creates one Figma frame per size at the **exact requested pixel dimensions**, side-by-side on the current page.
5. Downloads each finished render and pastes it into its matching frame as `scaleMode=FILL` via `upload_assets`.
6. Reports back with the file link, frame node IDs, and Higgsfield job IDs.

**Constraints — built into the command, do not bypass:**

- **GPT Image 2 only.** No substitution to other Higgsfield models (`soul_2`, `nano_banana_2`, `marketing_studio_image`).
- **Exact pixel sizes.** The Figma frame is always W×H to the pixel — the ad-platform spec is non-negotiable. Aspect mismatch between the generated image and the frame is absorbed by `scaleMode=FILL` (center crop).
- **Verbatim copy.** Title and CTA are passed through to the model unchanged — no translation, no rewording, no "improvements."
- **Figma is write-only.** The command never reads the file tree (no `get_metadata`, no `get_design_context`) — it only creates frames and paints fills. Avoids stalls on large campaign files.

Requires the Higgsfield and Figma MCP connectors to be configured. The command spec lives at [`.claude/commands/banner.md`](.claude/commands/banner.md).

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
