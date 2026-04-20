---
description: Sync the latest team tools from GitHub into the local project folder
---

# /pull — fetch latest team tools

The user wants to download the latest version of the team's shared tools from GitHub (`chr1srusevv/creative-team`) into their local project folder. Follow these steps exactly, stopping to report if anything looks off:

1. **Check working tree is clean.** Run `git status --porcelain`. If there are uncommitted changes, STOP and tell the user they have local changes — ask whether to stash them, commit them first, or abort. Do not proceed automatically.
2. **Confirm the remote is the team repo.** Run `git remote get-url origin`. It should be `https://github.com/chr1srusevv/creative-team.git`. If it points somewhere else, tell the user and ask before changing it.
3. **Fetch and fast-forward `main`.**
   - `git fetch origin main`
   - If currently on `main`: `git pull --ff-only origin main`
   - If on a feature branch: stay on the feature branch, but update the local `main` ref with `git fetch origin main:main` so the user can rebase/merge later.
4. **Show what arrived.** Run `git log --oneline HEAD@{1}..HEAD` (or `git log --oneline -10 origin/main` if on a feature branch) and summarize the new commits in plain English — what tools or automations were added/changed. Keep it to 3–5 bullets.
5. **Flag follow-ups.** If any new files look like they need install steps (e.g. new `package.json`, new scripts, new env vars), call them out so the user knows.

Do not auto-rebase feature branches onto the new `main` — that's the user's call. Just make the latest `main` available locally and report what changed.
