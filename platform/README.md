# Internal Tool Platform

A local-first web dashboard that turns this repo's tools into self-serve online modules. v1 ships the platform shell + the **Banner Builder**; future tools plug in through a small contract.

- **Backend:** FastAPI (`platform/backend`) — a thin web layer that **reuses the existing banner engine in place** (`.claude/scripts/banner-openai/`), never copies it.
- **Frontend:** React + Vite + TypeScript (`platform/frontend`) — a sidebar dashboard that renders its nav from `/api/tools`.

---

## Run it locally

You need **Python 3** and **Node 18+**, and an `OPENAI_API_KEY` in the repo-root `.env` (copy `.env.example`). `ANTHROPIC_API_KEY` is optional (only the Banner Builder's "Generate with AI" button uses it).

**Backend** (terminal 1):
```bash
cd platform/backend
python -m venv .venv
# Windows:        ./.venv/Scripts/activate
# macOS / Linux:  source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**Frontend** (terminal 2):
```bash
cd platform/frontend
npm install
npm run dev          # http://localhost:5173  (proxies /api → http://127.0.0.1:8000)
```

Open http://localhost:5173 and pick **Banner Builder**.

### Config (all env-driven, local defaults)

| Var | Default | Purpose |
| --- | --- | --- |
| `PLATFORM_HOST` / `PLATFORM_PORT` | `127.0.0.1` / `8000` | Backend bind address |
| `PLATFORM_CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Allowed frontend origins (deploy: set your URL) |
| `PLATFORM_OPENAI_CONCURRENCY` | `6` | Hard ceiling on concurrent OpenAI calls across all runs/users |
| `PLATFORM_BRIEF_MODEL` | `claude-sonnet-4-6` | Model for the AI-assist brief |
| `PLATFORM_ENGINE_DIR` | `<repo>/.claude/scripts/banner-openai` | Where the banner engine lives |
| `PLATFORM_ARTIFACT_DIR` | `platform/backend/.runs` | Per-run PNG workspace (gitignored) |
| `VITE_API_BASE` (frontend) | `/api` | API base; set to a full URL for a deployed backend |

Secrets are resolved at runtime from the process env first, then the repo-root `.env` (same ordered search the engine uses); they're never logged or written to disk.

---

## Deploy (push-to-`prod` cloud host + installable web-app)

The live site runs as **one Docker container** (backend serves the built SPA via
`app/main._mount_frontend`, so it's single-origin: API at `/api/*`, UI everywhere
else, no CORS, `Secure` cookie) on a cloud host that **auto-deploys on every push to
`prod`**. See [`DEPLOY.md`](DEPLOY.md). Config: [`../Dockerfile`](../Dockerfile),
[`../render.yaml`](../render.yaml). The Python backend can't run on Cloudflare
serverless, so the whole app is containerized (Render/Railway/Fly). It's also
installable as a desktop web-app (PWA) from the live URL (manifest/SW/icons in
`frontend/public/`). A Cloudflare-Tunnel self-host path remains in [`deploy/`](deploy).

---

## Tests

```bash
# Backend smoke (boots the app, checks /api/meta, /api/tools, the 422 validation path; no billable calls)
cd platform/backend && ./.venv/Scripts/python.exe test_smoke.py

# Engine seam regression (proves the /banner-openai slash command is unaffected)
cd ../../.claude/scripts/banner-openai && python -m unittest test_engine_core

# Frontend typecheck + build
cd ../../../platform/frontend && npm run build
```

---

## Architecture

```
React (Vite) dashboard          FastAPI backend                       Banner engine (reused in place)
────────────────────            ───────────────                       ───────────────────────────────
Sidebar  ──GET /api/tools─────►  ToolRegistry (plugins self-register)
Banner   ──POST .../run────────► banner_builder plugin ──► runner.py ──► engine_core.generate_png()
  AI     ──POST .../suggest────► brief.py ──Claude API──► validate/repair via prompts.py
  poll   ──GET .../runs/{id}───► RunStore + ThreadPool + global OpenAI semaphore
  view   ──GET .../*.png,.zip──► .runs/{id}/*.png
```

Key files:

| File | Role |
| --- | --- |
| `app/contract.py` | The plugin contract — `ToolMeta`, `ToolSpec`, `Field`, `SecretReq`, `ToolResult` |
| `app/registry.py` | `ToolRegistry`, `/api/tools` listing, dynamic router mounting |
| `app/engine.py` | Adapter that imports the in-place banner engine (`prompts.py`, `engine_core.py`) |
| `app/runner.py` | Banner job runner — RunStore, two-phase master→recompose, global semaphore |
| `app/tools/banner_builder/` | The first plugin: `plugin.py` (registration) + `runs_router.py` (routes) + `brief.py` (AI-assist) |
| `app/tools/teasers.py` | Registers coming-soon / desktop-only tools so the nav shows the full toolbelt |

The banner engine itself was lightly refactored to give the web layer a clean seam without breaking the `/banner-openai` slash command: the OpenAI gen/edit core was extracted into `engine_core.py` (imported by both `run.py` and this backend), and `prompts.validate_manifest` gained an optional `require_submit_url` kwarg (default preserves CLI behavior). See `test_engine_core.py` for the regression guard.

---

## Admin features

Logged-in **admins** get two extra surfaces:

- **Disk Manager** — a top-nav **Disk** tab (`frontend/src/admin/DiskManager.tsx`) — browse every generated
  batch (run) and banner held on the persistent artifact disk, sort by
  **date / size / name** (ascending or descending) in a **gallery** or **list**
  view, and delete a single banner, a whole batch, or a multi-selected mix. Each
  delete calls `POST /api/tools/banner-builder/runs/bulk-delete` (admin-only),
  which unlinks the real files from `PLATFORM_ARTIFACT_DIR` (reusing
  `runner.delete_frame` / `runner.delete_run`) and returns the bytes reclaimed — so
  it genuinely frees disk space, then refreshes the on-screen usage gauge.
- **Brands** — a read-only built-in brand catalog (header → **Brands**).

Both the shared gallery and the Disk Manager label each batch with **who generated
it** (run `created_by`, captured from the session). Admin access is role-based
(`require_admin`); users come from `ADMIN_EMAIL` + `ADMIN_PASSWORD(_HASH)` and/or
the `PLATFORM_USERS` env var (see `app/auth.py` and `DEPLOY.md`).

---

## How to add a tool

The Banner Builder ships a **custom UI** (`custom_ui=True`). Most future tools are simpler headless batch jobs and use the **generic form** path instead. To add one:

1. **Create a package** under `app/tools/<your_tool>/` with a `plugin.py`.
2. **Declare the spec and register it:**
   ```python
   from ...contract import ToolMeta, ToolSpec, Field, SecretReq, ToolResult, RunContext
   from ...registry import ToolRegistry

   class MyTool:
       spec = ToolSpec(
           meta=ToolMeta(id="my-tool", title="My Tool", description="…",
                         category="QA", icon="check-circle", status="available", version="1.0"),
           fields=[Field("file_key", "Figma file key", "text")],
           secrets=[SecretReq("FIGMA_API_KEY", "Figma token", "https://figma.com/settings")],
       )
       def run(self, params: dict, ctx: RunContext) -> ToolResult:
           # ctx.run_dir is a fresh workspace; ctx.get_secret(name) reads secrets.
           ...
           return ToolResult(status="ok", summary={...}, artifacts=[...], report_markdown="…")

   ToolRegistry.register(MyTool())
   ```
   A tool exposes **either** a `run(params, ctx)` handler (the registry mounts a generic `POST /run` and the frontend renders `fields` as a form) **or** a `build_router()` returning a FastAPI `APIRouter` (for rich tools like the Banner Builder).
3. **Wire it up** — add one import line to `app/tools/__init__.py`:
   ```python
   from .my_tool import plugin  # noqa: F401
   ```
4. **Custom UI (optional)** — set `custom_ui=True` and add a React component under `frontend/src/<yourTool>/`, branched in `frontend/src/App.tsx`. Skip this for generic-form tools.
5. **Docs (required)** — per `CLAUDE.md`, update this file and the root `README.md` Platform section in the same PR.

Tools that can't run headless (need Figma/Higgsfield MCP, or local Git) register as `status="desktop-only"`; planned-but-unbuilt ones use `status="coming-soon"`. Both appear in the nav as teasers with no run route — see `app/tools/teasers.py`.
