# Build prompt — product switcher, Banner Edit workspace, LP Materials workspace

> Use this prompt to drive the next major round of work on **Internovus — Creative
> Builder** (repo `Tiebreak-Websites/creative-team`, working dir `Desktop\design`).
> It follows v1.45.0. Work lands on `main`, release = bump
> `platform/frontend/package.json` (MINOR per feature drop), then fast-forward
> `prod` and push — never commit straight to `prod`.

---

## Context you can rely on

- **Backend** `platform/backend` (FastAPI): `app/runner.py` (runs, frames, regenerate,
  add_sizes, persistence to the artifact disk + rehydrate), `app/engine.py`
  (`ensure_size()` — ANY sane WxH is generatable), `app/sizes_config.py` (shared size
  groups/bundles/custom sizes), `app/banner_engine/` (prompts, engine_core =
  OpenAI images generations/edits, reshape = exact-pixel export, logo_overlay),
  `app/creative_director.py` (GPT-5.5 art-direction pass), `app/brands.py`,
  `app/auth.py` (`require_user` / `require_admin`, `_enforce_owner` — owner-only writes).
- **Frontend** `platform/frontend` (React + Vite + Tailwind/shadcn):
  `src/App.tsx` (header, tabs, admin Settings), `src/bannerBuilder/BannerBuilder.tsx`
  (dashboard: size rail + concept cards + floating console), `Results.tsx` (gallery),
  `BannerLibrary.tsx` (detail lightbox: prompt-edit modal + grouped add-sizes picker),
  `sizesApi.ts`, `admin/SizesSettings.tsx`.
- **Recompose pipeline already exists**: every run has a master PNG per version;
  `POST /runs/{id}/sizes` + `runner.add_sizes` recompose a master into more sizes via
  OpenAI `images/edits` (mode="edit") + exact-pixel reshape. Reuse it — do not rebuild it.
- Generation is capped by a global OpenAI semaphore; runs persist as `run.json` + PNGs
  on `PLATFORM_ARTIFACT_DIR` (persistent disk in prod) and rehydrate on restart.
- Local verification: `platform/backend/.venv/Scripts/python.exe -m uvicorn app.main:app
  --port 8000`, Vite dev on 5173 proxies `/api`; dev login `kristiyan.rusev@tiebreak.dev`
  / `parola` (only when no ADMIN_PASSWORD configured). Frontend check:
  `npm run build` (tsc + vite) in `platform/frontend`.

---

## Part A — App shell: product switcher + per-product sub-tools

Restructure the header navigation:

1. **The Internovus logo becomes a product switcher (dropdown)** with two products:
   - **Banner Builder**
   - **Landing Page Builder**
   Clicking the logo opens the dropdown (logo + caret; current product name shown next
   to the logo). Switching products swaps the whole workspace and the sub-tool nav.
2. **The header nav becomes the SUB-TOOL bar of the active product** (the old
   "Banner Builder / LP Builder" top-level tabs disappear):
   - Banner Builder sub-tools: **Generate** (the current dashboard) and **Edit**
     (new — Part B). Leave the pattern open for more sub-tools later.
   - Landing Page Builder sub-tools: **LP Builder** (the existing placeholder page,
     moved into this new space) and **LP Materials** (new — Part C).
3. Persist the last product + sub-tool (localStorage) and reflect them in the URL
   (`?app=banner&tool=edit`) so refresh/deep-links restore the exact workspace.
4. Keep everything else in the header as-is (storage gauge, version badge, admin
   Settings, theme, user menu). Admin Settings, Disk Manager stay global.
5. Keep it keyboard/a11y-clean (the dropdown is a real menu: Esc closes, arrows move).

---

## Part B — Banner **Edit** workspace (text-correction + recompose)

New working space under Banner Builder. Purpose: a user attaches an **already
generated banner** that needs corrections — mainly wrong/typo'd/mistranslated **text**
— and the tool produces a corrected banner that is **pixel-identical everywhere except
the corrected text**, then optionally recomposes the corrected banner into more sizes.

### Core flow

1. **Attach a banner**: either (a) pick from the existing gallery (any run/banner the
   user owns; search + recent grid), or (b) upload a PNG/JPG (max ~10MB). The source
   image becomes the working canvas.
2. **Mark what to fix**: the user marks the text region(s) to change.
   - Provide a **rectangle tool** (drag a box over each wrong text block) and a
     **brush** for irregular shapes. Multiple regions per banner.
   - **Auto-detect text regions**: on attach, run a vision pass (GPT-5.5 with the
     image) that returns the banner's text blocks + bounding boxes + the text it read.
     Pre-draw the boxes and pre-fill "current text" so the user usually only types
     the replacement. Manual boxes stay available as a fallback.
3. **Per-region correction card**: current text (editable, pre-OCR'd) → **new text**,
   plus optional hints (keep same style / make smaller to fit / new language).
4. **Generate correction** — the preservation contract is the whole feature:
   - Build a mask (regions transparent = editable, everything else opaque) and call
     OpenAI `images/edits` with the ORIGINAL banner + mask + an instruction like:
     "Replace the text in the masked area: it must read exactly '<new text>'.
     Match the original font style, weight, size, color, alignment and background.
     Change NOTHING else."
   - **Hard guarantee**: after the model returns, composite ONLY the masked regions
     from the model output back onto the original PNG (Pillow, alpha from the mask,
     small feathered edge). Everything outside the mask is byte-for-byte the original.
     Never ship the raw model output as the result.
   - Generate **2–3 candidates** per correction (parallel, semaphore-capped) and show
     them side by side — text rendering is the flakiest part of image models, and
     candidates cost little compared to a user retry loop.
5. **Verify**: run a vision QA pass on each candidate — did the new text render
   exactly (spelling! diacritics!)? Show a per-candidate ✓/⚠ with what was read.
   Auto-retry once on failure (optional toggle).
6. **Review**: before/after slider (or hold-to-compare) + zoom. Accept a candidate →
   the corrected banner is saved as a new "edit run" (see storage below).
7. **Recompose into sizes**: an "Add sizes" button on the accepted result opens the
   SAME grouped size picker from v1.45.0 (server-driven groups + custom sizes) and
   recomposes the corrected banner into the chosen sizes via the existing
   `add_sizes` path. Implementation: the accepted corrected PNG becomes the
   master of a new run (one concept, master size = image's size registered via
   `engine.ensure_size`), so `runner.add_sizes` works unmodified.
8. **Iterate**: the result can be re-attached with one click for a second round
   (v1 → v2), keeping a provenance chain (`edited_from: {run_id, label}` stored on
   the run) that the detail view shows.

### Backend sketch

- `POST /tools/banner-builder/edits` (owner-gated): body = source (`{run_id,label}` or
  uploaded reference id), regions `[{x,y,w,h | mask_png}, current_text?, new_text,
  hints?}]`, `candidates: 2..3`. Creates an **edit run** (reuses the Run/FrameResult
  machinery, `intent: "text-edit"`) so polling, gallery, persistence, rehydrate,
  delete, zip, disk manager all work for free.
- `POST /tools/banner-builder/edits/detect` : vision pass → `{blocks:[{bbox, text}]}`.
- Store the original, the mask(s) and every candidate in the run dir (so QA and
  provenance are auditable). Cap: ≤6 regions, ≤3 candidates, rate-limited like runs.

### Extra ideas (include unless they explode scope)

- **Font-match hint**: ask the vision pass to describe the typography (family vibe,
  weight, color hex, case) and feed that into the edit instruction — noticeably
  better matches than "match the style".
- **Fit warnings**: if new text is much longer than the old (per language), warn and
  offer "allow the model to shrink the text to fit the same block".
- **Batch mode**: attach several sizes of the SAME creative and apply one text
  correction across all of them in one go (same regions scaled per size — the
  per-size bounding boxes come from the vision pass on each image).
- **Beyond text (phase 2, keep the UI ready)**: the same mask+composite machinery
  handles small object fixes (remove a watermark, fix a logo, swap a CTA color) —
  the region card just gets a free-text instruction instead of old/new text.
- Preserve the CROP-safety: if the user recomposes to extreme sizes, the existing
  crop-aware recompose prompt already handles it — no extra work.

---

## Part C — **LP Materials** workspace (under Landing Page Builder)

A dashboard that generates the small creative assets landing pages need. Three
sections, one shared pattern: cards of user input → GPT-5.5 "director" composes the
image prompt → gpt-image-2 generates → gallery-style results with per-item
regenerate + zip download. Persist as runs (`intent: "lp-materials"`) on the
artifact disk so they're shared/durable exactly like banners. **Global hard rule:
generated images contain NO text, NO letters, NO logos, NO watermarks** — bake it
into every prompt AND run a vision QA that flags text if it sneaks in.

### C1. Review avatars (1:1)

For testimonial/review sections: profile pictures that look like REAL users, not
stock photos.

- **Input**: a list of names (add rows one by one AND bulk-paste, one per line).
  Per row, auto-detect from the name via a small LLM call:
  `{language/script, likely country, gender, age guess}` — e.g. a Thai name → Thai
  person; works for ANY language because the LLM does the detection (no name
  dictionaries). Show the detection as editable chips per row (country, gender,
  age range 20s–60s) so the user can override before generating.
- **Output**: one 1:1 square avatar per name.
- **The look is the point — deliberately imperfect, maximum realism**. Style presets
  (checkbox per row / global):
  - *Cropped from a group photo* (off-center, someone's shoulder in frame)
  - *Low quality* (phone camera, slight blur/noise, bad lighting, harsh flash)
  - *Candid* (not posing for a portrait, imperfect angle, busy background)
  - Ethnicity/appearance aligned with the detected country; ordinary people (varied
    weight/age/looks), NEVER model-pretty, no studio lighting, no bokeh portrait.
- **Post-process for authenticity** (deterministic, Pillow — more reliable than
  prompting): downscale→upscale, mild JPEG artifacts, slight noise/vignette,
  small random crop offset. Make it a toggle ("degrade for realism", default on).
- Per-row regenerate; select-all download zip named by the person's name slug.

### C2. Four-card section (4:3)

The classic "benefits/steps" LP section: 4 images with a title + short text under
each (the text lives on the LP, not in the image).

- **Input**: 4 cards, each `title + small text`. (Allow 3–6 cards, default 4.)
- **Output**: one 4:3 image per card visualizing what the card's text is about.
- A **shared art direction** across the whole set (one director pass first:
  palette/mood/lighting/style so the 4 read as one family), then per-card prompts.
- **"Same person" toggle**: when on, the director invents ONE persona (described
  once in detail — age, look, clothing) and every card reuses that exact
  description in its prompt so the same character appears doing different things.
  When off, each card casts freely.
- Optional style reference upload (reuse the existing references store) and brand
  selector (reuse `brands.py`) to keep palettes on-brand.
- Per-card regenerate; regenerate-all keeps the shared direction.

### C3. Advertorial image

Like C2 but for a long-copy advertorial block: `title + long text` (up to ~2000
chars) → ONE editorial-photo image that visualizes the story (no text in image).

- Aspect selector: 4:3 (default), 16:9, 1:1 — reuse `ensure_size`/reshape for exact
  pixels.
- The director should summarize the copy into a single scene ("the strongest visual
  moment of this story"), not collage everything.
- 2 candidates side-by-side (long copy → more ambiguity), pick/regenerate.

### Shared UI notes

- One LP Materials page with the three sections as sub-tabs or stacked cards —
  follow the existing dashboard idiom (left rail = settings, center = results
  console). Reuse `Results`-style tiles, polling, and the toast for errors.
- Everything owner-gated like banner runs; admins see all in Disk Manager for free
  since these ARE runs.

---

## Cross-cutting requirements

- **Cost guards**: per-user rate limits (reuse `rate_limit_ok`), caps per request
  (≤6 edit regions, ≤3 candidates, ≤20 avatar rows, ≤6 section cards).
- **Errors are never silent** — surface backend `detail` in the existing toast.
- **No hardcoded lists** that admins may want to change later; follow the
  sizes_config pattern if a new catalog appears (e.g. avatar style presets).
- Keep `README.md` / `platform/README.md` in sync (new workspaces + endpoints).
- Add a `docs/feature-*.md` for the release like previous versions.

## Before building — confirm with the user

1. Sub-tool naming: "Generate / Edit" for Banner Builder; "LP Builder / LP Materials"
   for Landing Page Builder — OK?
2. Edit workspace: is gallery-pick + upload both needed at launch, or upload-only?
3. LP Materials: default counts (4 cards, 2 advertorial candidates, avatar caps) OK?
4. Should LP Materials results appear in the shared banner gallery or ONLY in their
   own workspace? (Recommend: own workspace only, but same disk/run store.)

## Acceptance & release

- `npm run build` clean; uvicorn boots; login → all four workspaces reachable via
  the logo switcher + sub-tools; deep-link URLs restore state.
- Edit flow verified on a real generated banner: corrected text reads correctly,
  a pixel-diff outside the mask is ZERO, recompose-to-sizes works off the result.
- Avatar flow verified with a Thai, an Arabic and a Latin-script name (detection,
  gender, look); C2 verified with "same person" on and off; C3 with long copy.
- Version bump (MINOR, one per release), land on `main`, fast-forward `prod`, push.
