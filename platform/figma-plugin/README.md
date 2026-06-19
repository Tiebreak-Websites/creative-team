# Creative Tools — Figma plugin

Companion plugin that places results from the web platform (creative summaries, translated pages) onto the Figma canvas. The web tools can read Figma and post comments via the API, but only a plugin can write real layers/pages — that's what this does.

## Install (once, per teammate)

1. In Figma **desktop**, open any file → **Menu → Plugins → Development → Import plugin from manifest…**
2. Select `platform/figma-plugin/manifest.json` from this repo.
3. The plugin now appears under **Plugins → Development → Creative Tools**.

The plugin talks to the local platform backend at `http://localhost:8000`, so the backend must be running (see `platform/README.md`).

## Use

1. In the web app, run **Creative Summary** or **Translate** on your Figma URL. The result shows a short **code** (e.g. `9F2A1C`).
2. Open the target file in Figma → run **Creative Tools** plugin.
3. Click **Apply latest result for this file**, or paste the **code** and click **Apply by code**.

It applies the staged operations:
- **Creative Summary** → a text block placed above the frame.
- **Translate** → a duplicated page per locale, with the text swapped to the translation.

## How it works

The backend stages each run's `figma_ops` (see `app/plugin_bridge.py`) keyed by a short code and the file key. The plugin fetches them (`GET /api/plugin/latest?file_key=…` or `/api/plugin/ops/{code}`) and applies them via the Figma API. Op vocabulary: `create_text`, `duplicate_page` (see `code.js`).

> Note: cross-origin fetch from the plugin's sandboxed iframe is allowed by the bridge's permissive CORS — fine for a local tool. For a shared deployment, lock that down.
