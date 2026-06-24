# Internovus - Creative Builder — project notes

This repo is the **Internovus - Creative Builder** web platform (formerly "Tiebreak / Creative Tools"; that earlier slash-command toolkit is retired). Two tools surface in the UI: **Banner Builder** (live) and **LP Builder** (in progress).

- **Backend:** `platform/backend` (FastAPI). **Frontend:** `platform/frontend` (React + Vite). **Figma plugin:** `platform/figma-plugin`.
- **Run + architecture:** `platform/README.md`. **Deploy:** `platform/DEPLOY.md`.
- **Secrets** live in a gitignored `.env` (`OPENAI_API_KEY`, `FIGMA_API_KEY`, `ANTHROPIC_API_KEY`) — never commit them.

## Branching & releases
- **`main`** — integration branch. All work lands here (directly, or via a short-lived branch → PR → `main`).
- **`prod`** — the live/release branch (what deploys). Updated **manually from `main`** — never commit straight to `prod`.
- **To release:** bump the version in `platform/frontend/package.json`, land it on `main`, then fast-forward/merge `main` into `prod` and push. The deploy rebuilds; the header version badge shows the new version + build date/time (auto-updated).
- **Versioning** (semver `MAJOR.MINOR.PATCH`): PATCH = fixes/tweaks, MINOR = new features/tools, MAJOR = redesign/breaking. One bump per release, not per commit.

## Conventions
- Don't commit secrets, `.venv/`, `node_modules/`, build output (`dist/`), or run artifacts (`.runs/`, `.cache/`) — see `.gitignore`.
- Keep `README.md` and `platform/README.md` in sync when tools change.
