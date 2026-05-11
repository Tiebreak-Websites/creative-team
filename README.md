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

### `/banner` (v1.6)
Generate CTR-optimized ad banners with **Higgsfield GPT Image 2** and drop them into a Figma file at the exact pixel sizes you ask for. **v1.4 introduces a designer architecture** — Claude reads the design framework, reasons through the creative decisions for each specific banner (subject, setting, lighting, palette, typography, money element, CTA), and writes a **concrete scene-level prompt** that the image model can render directly. The previous versions copy-pasted a generic rule manual to the model, which it can't act on. v1.4 fixes that.

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

**What happens (v1.4 flow):**

1. **Detect LANGUAGE.** Claude reads the copy and pins the market (`pt-BR`, `es-LATAM`, `Arabic`, `Hebrew`, `English`, etc.) — this drives every imagery decision.
2. **MVP composition (silent).** Claude reads the **Design Framework** (slot rules, money-element priority, localization decision tree, RTL handling, hierarchy, typography, color, CTA spec, DO NOT RENDER list) and internally answers the **9-decision checklist** for this specific banner: realistic customer, hero subject (named demographics + wardrobe + pose), setting (named environment + props), lighting (direction + temperature + mood), composition direction (LTR / RTL), money element (the specific phrase), color palette (3 colors with hex), typography (concrete typefaces per LANGUAGE), CTA treatment.
3. **MVP prompt.** Claude fills the **Visual Prompt Template** with those concrete decisions — a scene-level brief naming a specific person in a specific outfit in a specific setting, with every word of copy spelled out with exact typography and position. ~1,500–2,000 chars. Ships to GPT Image 2 at 1200×1200 / 1:1.
4. **Recomposition (silent).** For every non-1:1 size, Claude composes a **spatial-translation prompt** — same scene, new aspect, naming exactly where the subject moves, where the text reflows, where the gradient extends, where the CTA repositions. The MVP image is passed as a reference (`medias[].role: "image"`). ~800–1,200 chars per recomposition.
5. **1:1 sizes reuse the MVP image** directly — no extra generation.
6. **Figma pass.** One frame per requested size at the exact pixel dimensions, side-by-side. Each render painted in as `scaleMode=FILL` via `upload_assets`.
7. Reports back with the file link, frame node IDs, and Higgsfield job IDs (MVP + recomposed).

**Why the designer architecture:** v1.0 → v1.3 all made the same mistake — pasting a generic rule manual to GPT Image 2 and hoping the model would interpret it. GPT Image 2 is a rendering engine, not a creative director — it can't reason "identify the money element by priority list" or "match the lighting to the emotional register." Those decisions have to be made *before* the prompt is written, by someone who can read the copy and think about who's going to click. v1.4 puts Claude in the designer seat and reduces the model's job to "render exactly this scene."

**Three layers, three audiences:**

| Layer | Audience | Length |
|---|---|---|
| **§ Design Framework** | Claude only | Long (full v1.2 rules) — never sent to the model |
| **§ Composition Guide** | Claude only | ~3K chars — never sent to the model |
| **§ Visual Prompt** | GPT Image 2 | ≤ 2,000 chars — the only thing the model sees |

The framework and guide are Claude's textbook. The visual prompt is the brief Claude hands the renderer.

**Constraints — built into the command, do not bypass:**

- **GPT Image 2 only.** No substitution to other Higgsfield models (`soul_2`, `nano_banana_2`, `marketing_studio_image`).
- **Resolution is always `1k`.** Both the MVP and every recomposition are generated at `resolution: "1k"`. The Figma frame is the source of truth for pixel dimensions; the generated image is fitted via `scaleMode: FILL`, so higher resolutions waste Higgsfield credit without improving the deliverable.
- **MVP is always 1200×1200 (1:1).** The v1.2 brief is tightly coupled to the 1200×1200 canvas (90px x-height minimums, 60px edge safe area, 90px button height). Recomposition is the only way to produce non-1:1 banners — non-1:1 banners are never generated from scratch.
- **LANGUAGE drives the whole banner.** It's not just a script setting — it determines subject, setting, wardrobe, palette mood, and composition direction (LTR vs RTL). Auto-detected from the copy.
- **MVP is the single source of truth.** Every recomposition passes the MVP's `job_id` as a `medias[]` entry with `role: "image"` so the model treats it as the authoritative master.
- **Exact pixel sizes.** The Figma frame is always W×H to the pixel — the ad-platform spec is non-negotiable. Aspect mismatch between the generated image and the frame is absorbed by `scaleMode=FILL` (center crop).
- **Verbatim copy.** Title and CTA are passed through unchanged — no translation, no rewording, no "improvements." The recomposition prompt's "NO NEW CONTENT" rules forbid the model from inventing or editing copy.
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
