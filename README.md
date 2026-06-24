# Creative Tools

An internal web platform for the team's creative tools — generate banners, QA Figma landing pages, write creative summaries, and translate Figma pages, all from the browser. FastAPI backend + React (Vite) frontend, with a companion Figma plugin for writing results back onto the canvas.

## Tools

- **Banner Builder** — generate on-brand ad banners with OpenAI `gpt-image-2`; multi-concept, multi-size, download as PNG.
- **Figma QA** — paste a Figma LP URL → parity / placeholder / overflow / CTA / regulator-phrase checks (+ optional AI tone), and post findings as Figma comments.
- **Creative Summary** — paste a Figma LP URL → a short bilingual summary of what it promotes; place it on the canvas via the Figma plugin.
- **Translate** — extract a Figma page's text → translate into locales → preview / download; create translated pages via the Figma plugin.

## Run it locally

Prereqs: **Python 3**, **Node 18+**, and a `.env` (copy `.env.example`). `OPENAI_API_KEY` powers the Banner Builder; `FIGMA_API_KEY` + `ANTHROPIC_API_KEY` enable the Figma tools.

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
| [`platform/backend`](platform/backend) | FastAPI app + tool plugins; the bundled banner engine (`app/banner_engine/`) and Figma scripts (`figma_scripts/`) |
| [`platform/frontend`](platform/frontend) | React dashboard — top-nav shell + per-tool UIs |
| [`platform/figma-plugin`](platform/figma-plugin) | Companion Figma plugin that writes results (summaries, translated pages) onto the canvas |

See [`platform/README.md`](platform/README.md) for the architecture + how to add a new tool, and [`platform/figma-plugin/README.md`](platform/figma-plugin/README.md) to install the plugin.

## Deploy

To publish the whole app from one machine behind a Cloudflare Tunnel — a real HTTPS
web address protected by the app's own login, and installable as a desktop web-app
(PWA) — follow [`platform/DEPLOY.md`](platform/DEPLOY.md). (Optional: lock it down
further with Cloudflare Access.)
