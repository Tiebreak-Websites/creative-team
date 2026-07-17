# Internovus - Creative Builder

Internovus's in-house web app for generating creative assets from the browser.
Light/dark themed and installable as a desktop web-app (PWA). FastAPI backend +
React (Vite) frontend.

## Tools

- **Banner Builder** — generate on-brand ad banners with OpenAI `gpt-image-2`; multi-concept, multi-size, download as PNG.
- **LP Builder** — section-based landing-page builder (templates, per-breakpoint editing, ZIP export) plus **LP Materials** (campaign asset generation).

Admins also get a **Disk Manager** (opened from the header storage gauge) to browse, sort (by date / size / name, in gallery or list view), and delete generated banners — single, whole batches, or a multi-selected mix — straight off the persistent disk, freeing storage for everyone. Every batch is labelled with who generated it.

## Run it locally

Prereqs: **Python 3**, **Node 18+**, and a `.env` (copy `.env.example`). `OPENAI_API_KEY` powers the Banner Builder and LP Materials.

**Backend** (terminal 1):
```bash
cd platform/backend
python -m venv .venv
# Windows:       ./.venv/Scripts/activate
# macOS / Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**Frontend** (terminal 2):
```bash
cd platform/frontend
npm install
npm run dev        # http://localhost:5173
```

## Structure

| Path | What it is |
| --- | --- |
| [`platform/backend`](platform/backend) | FastAPI app + tool plugins; the bundled banner engine (`app/banner_engine/`) and LP builder (`app/lp_builder/`) |
| [`platform/frontend`](platform/frontend) | React app — top nav (Banner Builder + LP Builder), light/dark theme, PWA |

See [`platform/README.md`](platform/README.md) for the architecture + how to add a new tool.

## Deploy

The live site runs as one Docker container (backend serves the SPA — single origin)
on a cloud host that **auto-deploys on every push to the `prod` branch**, secured by
the app's own login. Config: [`Dockerfile`](Dockerfile), [`render.yaml`](render.yaml).
Full walkthrough in [`platform/DEPLOY.md`](platform/DEPLOY.md). It's also installable
as a desktop web-app (PWA) from the live URL.
