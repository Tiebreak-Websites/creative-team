# Creative Tools — project notes

This repo is the **Creative Tools web platform**. (It used to be a Claude Code slash-command toolkit; that has been retired in favor of this web app.)

- **Backend:** `platform/backend` (FastAPI). **Frontend:** `platform/frontend` (React + Vite). **Figma plugin:** `platform/figma-plugin`.
- **Run + architecture:** `platform/README.md`. Adding a tool: the "How to add a tool" section there.
- **Secrets** live in a gitignored `.env` (`OPENAI_API_KEY`, `FIGMA_API_KEY`, `ANTHROPIC_API_KEY`) — never commit them.

## Conventions
- Work on a feature branch; open a PR before merging to `main`.
- Don't commit secrets, `.venv/`, `node_modules/`, build output (`dist/`), or run artifacts (`.runs/`, `.cache/`) — see `.gitignore`.
- Keep `README.md` and `platform/README.md` in sync when tools change.
