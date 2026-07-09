# Product switcher, Banner Edit workspace & LP Materials (v1.46.0)

Built from `docs/prompt-v1.46-product-split-banner-edit-lp-materials.md`.

## 1. App shell — two products behind the logo

The Internovus logo is now a **product switcher** (dropdown): **Banner Builder**
and **Landing Page Builder**. The header nav shows the ACTIVE product's
sub-tools:

- Banner Builder → **Generate** (the classic dashboard) · **Edit** (new)
- Landing Page Builder → **LP Builder** (the placeholder, moved here) ·
  **LP Materials** (new)

The last product+tool persists (localStorage) and mirrors into the URL
(`?app=banner&tool=edit`), so refresh and deep links restore the workspace.
Disk Manager (storage gauge) and admin Settings stay global.

## 2. Banner **Edit** — text correction with a preservation guarantee

Attach a banner (gallery pick or upload ≤10MB), mark the text region(s) by
dragging boxes (or **Auto-detect text** — a vision pass pre-draws boxes,
pre-fills the current text and captures a typography description), type the
replacement, choose 1–3 candidates, Generate.

- The correction is a **masked OpenAI images/edits** call, and preservation is
  enforced in code: only the masked regions of the model output are composited
  back onto the original PNG (feathered ~3px seam). Every pixel outside the
  marked regions is the original — verified in tests with a pixel diff.
- Each candidate gets a **vision QA read-back** (did the new text render
  exactly — spelling, diacritics?) shown as a ✓/⚠ badge; hold-to-compare
  against the original before accepting.
- **Accept** turns the candidate into a normal completed run
  (`runner.create_run_from_image`) — it appears in the Generate gallery,
  persists/rehydrates, and supports **Add sizes** (the shared grouped picker)
  which recomposes the corrected creative off its new master. Provenance
  (`edited_from`) is kept in `intent_meta`.
- Backend: `app/banner_edit.py` (upload/detect/job/accept routes under
  `/api/tools/banner-builder/edits*`); `engine_core.post_images_edits` gained
  an optional inpainting `mask`. Jobs are a working session (files under
  `ARTIFACT_ROOT/banner-edits`, metadata in-memory); the durable artifact is
  the accepted run. Caps: ≤6 regions, ≤3 candidates, rate-limited like runs.

## 3. LP Materials — landing-page asset generators

New workspace under Landing Page Builder (`app/lp_materials.py`, routes at
`/api/tools/lp-materials/*`, own persisted job store on the artifact disk +
rehydrate — separate from the banner gallery). Three generators; every prompt
forbids text in the image AND a vision QA flags any text that sneaks in.

1. **Review avatars (1:1, 800×800)** — enter names (any language, one per
   line) → an LLM detects language/country/gender/age per name (editable chips)
   → deliberately imperfect, maximally realistic profile photos: cropped from a
   group photo, low-quality phone camera, candid — never model-pretty. A
   deterministic Pillow **degrade** pass (downscale + JPEG artifacts) finishes
   the authenticity. Verified with a Thai name → Thai-looking result.
2. **Section cards (3–6 images, 4:3/1:1/16:9)** — title + small text per card;
   one direction pass gives the set a shared palette/lighting/style, then each
   card gets its own concrete scene. **Same person** toggle: one invented
   persona (detailed description reused verbatim) appears in every scene.
3. **Advertorial** — title + long copy → the LLM condenses the story into its
   single strongest visual moment → 1–3 editorial-photo candidates.

Per-item regenerate, per-item download, whole-job zip, owner-gated delete;
jobs poll live while generating. Caps: ≤20 avatars, 3–6 cards, ≤3 candidates.
