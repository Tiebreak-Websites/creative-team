---
description: Commit current work and push it to the team GitHub repo as a pull request
---

# /push — ship current work to the team repo

The user wants to upload their latest changes to the shared `chr1srusevv/creative-team` GitHub repo so teammates can review and pull them. Follow the team's Git workflow from CLAUDE.md exactly:

- Never push directly to `main`.
- Always use a feature branch named `feature/<user>-<short-description>`.
- Open a pull request — never merge without review.
- Ask before committing (do not auto-commit).

Steps:

1. **Survey the changes.** Run in parallel:
   - `git status` (never use `-uall`)
   - `git diff` (unstaged + staged)
   - `git log --oneline -5` (for commit-message style)
   - `git branch --show-current`
2. **Branch check.** If the current branch is `main`:
   - STOP. Ask the user what the feature should be called and create `feature/<user>-<slug>` with `git checkout -b`. Do not commit on `main`.
3. **Show the user the diff summary** — one or two sentences on what changed and which files are affected. Then propose a commit message (1–2 sentences, focused on the *why*, matching the repo's existing style).
4. **Ask for confirmation** before staging and committing. Do not assume approval.
5. **Stage explicitly** — add files by name, never `git add -A` / `git add .` (risks committing secrets or junk). Skip anything that looks like credentials, `.env`, or build artefacts — warn the user if they're present.
6. **Commit** with the approved message, using a HEREDOC, and append:
   ```
   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   ```
7. **Push** with `git push -u origin <branch>`. If the push is rejected because the branch is out of date, fetch + rebase on `origin/main` and try again — never `--force` without asking.
8. **Open a pull request** — prefer `gh pr create` if `gh` is available; otherwise print the compare URL (`https://github.com/chr1srusevv/creative-team/compare/main...<branch>`) and ask the user to open it in the browser. PR title should be short (< 70 chars); body should have:
   - **Summary** — 1–3 bullets on what the change does and why
   - **Test plan** — checklist of how to verify it
9. **Report back** with the PR URL (or compare URL) so the user can share it with the team.

If any step fails, stop and explain — do not retry destructively (no `--force`, no `reset --hard`, no `--no-verify`).
