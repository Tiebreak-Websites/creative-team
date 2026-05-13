# Creative Claude — Project Instructions

## Project Overview
This is a shared team project. All contributors must follow the rules below
so Claude Code behaves consistently for everyone.

---

## Git Workflow (REQUIRED)
- **Never work directly on `main`** — always use a feature branch
- Branch naming: `feature/your-name-description` (e.g. `feature/kristiyan-header`)
- Open a Pull Request and get at least 1 approval before merging to `main`
- Always `git pull origin main` before starting new work

---

## Protected Files — DO NOT MODIFY without team approval
- `projects/braintrade-template/index.html` — main LP template, changes need PR review
- `projects/braintrade-template/content.json` — shared content data, coordinate with team before editing

## Safe to Edit Freely
- Your own feature branch files
- Any file explicitly assigned to you in the PR/issue

---

## Claude Code Behavior
- Do not auto-commit — always ask before committing
- Do not push to `main` directly
- When unsure about a change, create a new branch and open a PR
- Keep code changes focused — one feature per branch

## Keep README.md in sync (REQUIRED)
- **Any change to a file in `.claude/commands/` MUST update `README.md` in the same PR.**
- Update the slash command's version number, one-line summary, usage example, key features, and any new requirements.
- If you add a new slash command, add a new expandable `<details>` section for it in the README's `## Commands` block, following the same shape as the existing ones (summary line → what it does → usage → example → features → requires → full spec link).
- If you delete a slash command, remove its README section.
- The README is the team's surface area — out-of-date docs cost everyone time. Treat it as part of the slash command, not a separate task.

---

## Project Knowledge (Claude Memory)
All shared knowledge lives in `.claude/memory/` — Claude loads these automatically:
- `MEMORY.md` — index of all memory files
- `project_figma_lp_template.md` — Figma file structure, section map, JS snippets, design tokens
- `reference_figma_file.md` — Figma file key, page names, all key node IDs

---

## Team Contacts
- Project owner: @chr1srusevv
- Repo: https://github.com/chr1srusevv/creative-team
