# Internal Tool Platform

A local-first web dashboard that turns this repo's tools into self-serve online modules. The logo is a **product switcher** between two products, each with its own sub-tools in the header:

- **Banner Builder** — **Generate** (the classic dashboard) and **Edit** (fix a finished banner's text: the whole banner is regenerated with the corrections applied — same scene/layout/person — with a typo guard before generating and a vision QA read-back after; `app/banner_edit.py` + `frontend/src/bannerBuilder/BannerEdit.tsx`).
- **Landing Page Builder** — **LP Builder** (section-based drag-and-drop landing-page builder: brand template library with per-language texts, iframe canvas at 1920/1199/375 with per-breakpoint overrides, inline text editing, LP Materials campaign assets, admin template manager, ZIP export of a ready-to-host html/css/js website; `app/lp_builder/` + `frontend/src/lpBuilder/`) and **LP Materials** (review avatars with name-driven nationality/gender detection, section-card image sets with an optional recurring persona, advertorial visuals; `app/lp_materials.py` + `frontend/src/lpMaterials/`). Generated materials contain no text — a vision QA flags any that sneaks in.

See `docs/feature-product-split-banner-edit-lp-materials.md` for the full feature notes.

- **Backend:** FastAPI (`platform/backend`) — a thin web layer that **reuses the existing banner engine in place** (`.claude/scripts/banner-openai/`), never copies it.
- **Frontend:** React + Vite + TypeScript (`platform/frontend`) — a sidebar dashboard that renders its nav from `/api/tools`.

---

## Run it locally

You need **Python 3** and **Node 18+**, and an `OPENAI_API_KEY` in the repo-root `.env` (copy `.env.example`) for the Banner Builder and LP Materials image generation.

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
| `PLATFORM_ENV` | `dev` | Set to `production` on a deploy — refuses the weak dev admin default, fails closed without a real admin, and turns API docs off (independent of `PLATFORM_COOKIE_SECURE`) |
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
Nav      ──GET /api/tools─────►  ToolRegistry (plugins self-register)
Banner   ──POST .../run────────► banner_builder plugin ──► runner.py ──► engine_core.generate_png()
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
| `app/tools/banner_builder/` | The Banner Builder plugin: `plugin.py` (registration) + `runs_router.py` (routes) |
| `app/lp_builder/`, `app/lp_materials.py`, `app/feedback.py` | LP Builder (sections/compose/export), LP Materials (campaign asset generation), and the suggestions widget store |

The banner engine itself was lightly refactored to give the web layer a clean seam without breaking the `/banner-openai` slash command: the OpenAI gen/edit core was extracted into `engine_core.py` (imported by both `run.py` and this backend), and `prompts.validate_manifest` gained an optional `require_submit_url` kwarg (default preserves CLI behavior). See `test_engine_core.py` for the regression guard.

---

## Admin features

Logged-in **admins** get two extra surfaces:

- **Disk Manager** — opened from the header **storage gauge** (`frontend/src/admin/DiskManager.tsx`); defaults to a list view, newest first — browse every generated
  batch (run) and banner held on the persistent artifact disk, sort by
  **date / size / name** (ascending or descending) in a **gallery** or **list**
  view, and delete a single banner, a whole batch, or a multi-selected mix. Each
  delete calls `POST /api/tools/banner-builder/runs/bulk-delete` (admin-only),
  which unlinks the real files from `PLATFORM_ARTIFACT_DIR` (reusing
  `runner.delete_frame` / `runner.delete_run`) and returns the bytes reclaimed — so
  it genuinely frees disk space, then refreshes the on-screen usage gauge.
- **Settings** (header → **Settings**) — two tabs:
  - **Brands** — the brand catalog (built-ins + admin-managed).
  - **Sizes & bundles** (`frontend/src/admin/SizesSettings.tsx`) — the shared
    size-group organization used by the dashboard rail AND the banner detail
    view's "Add sizes" picker: create/rename/delete groups, reorder them
    (order = position), add/remove sizes (any sane `WxH` — customs register
    automatically), and manage one-click size bundles. Backed by
    `GET/PUT /api/tools/banner-builder/size-config` (`app/sizes_config.py`),
    persisted on the artifact disk. Any logged-in user can add a **custom
    size** (`POST …/size-config/custom`); it lands in the shared "Custom
    sizes" group.

Both the shared gallery and the Disk Manager label each batch with **who generated
it** (run `created_by`, captured from the session). Admin access is role-based
(`require_admin`); users come from `ADMIN_EMAIL` + `ADMIN_PASSWORD(_HASH)` and/or
the `PLATFORM_USERS` env var (see `app/auth.py` and `DEPLOY.md`).

## Approval gate (MVP-first)

Each generation renders the **1200×1200 master (MVP) first**, then pauses at
`awaiting_approval`. The run **owner** reviews each version and **approves**
(recompose into all selected sizes) or **rejects** (keep the MVP only) — from the
gallery's version header or the banner lightbox. Approve / reject / cancel are
**owner-only** (`_enforce_owner`, 403 otherwise). Controlled by the
`BANNER_APPROVAL_MODE` env var (default **on**; set to `off` to auto-recompose) and
durable across restarts — the awaiting state + per-version approvals are persisted
and rehydrated (an interrupted recompose reverts to awaiting for re-approval).

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
