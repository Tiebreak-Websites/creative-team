# Build prompt — Banner Edit canvas v2 + LP Materials dashboard & workspace v2

> Next round on **Internovus — Creative Builder** (repo `Tiebreak-Websites/creative-team`,
> working dir `Desktop\design`). Follows v1.48.0. Work lands on `main`; release =
> bump `platform/frontend/package.json` (MINOR), fast-forward `prod`, push.
> Verify in the local preview (backend: `platform/backend/.venv/Scripts/python.exe
> -m uvicorn app.main:app --port 8000`, dev login `kristiyan.rusev@tiebreak.dev` /
> `parola`; `npm run build` must pass). `preview_screenshot` is flaky here —
> verify with DOM evals.

## Context (v1.48.0 state)

- **Banner Edit** (`frontend/src/bannerBuilder/BannerEdit.tsx`, backend
  `app/banner_edit.py`): centered canvas; floating draggable region cards with
  dashed connector lines (currently to the region CENTER); double-click region →
  move/resize; auto text-detect on attach; bottom console (source thumb,
  upload/gallery icons, auto-detect, variants 1–3, quality, sizes, Generate);
  candidates strip above the console; accept → run via
  `runner.create_run_from_image` + optional auto `add_sizes`.
- **LP Materials** (`frontend/src/lpMaterials/`, backend `app/lp_materials.py`):
  campaign groups (hero cover, name, tag, market) → centered workspace (3
  generator tabs + campaign-scoped feed below); customers detect via a button;
  age bands 20s–70s; 4 authenticity toggles (all default ON); section cards
  stacked vertically; advertorial has a 1–3 candidates picker.

---

## Part A — Banner Edit canvas v2

1. **Connector lines point at the region's NUMBER badge**, not the region
   center. The badge is the small numbered box at the region's top-left
   (`-left-px -top-5`); the line's endpoint (and its dot) must anchor there
   (region top-left in canvas coords, minus the badge offset). Keep the card-end
   anchor as is.
2. **Console = ONE row.** Everything currently in the bottom console fits one
   non-wrapping row (`flex-nowrap`; allow horizontal scroll only under ~640px).
   The **Generate button gets bigger** (size="lg", wider padding) — it is the
   hero of the console.
3. **Exit option.** A clear way to leave the current edit: an ✕ "Close" control
   (top-right of the canvas area or next to the source thumb) that calls
   `resetForSource(null)` back to the dropzone. Confirm first when there are
   regions with typed text or an unaccepted finished job ("Discard this edit?").
4. **Erase-only regions.** Each floating card gets a small mode switch:
   **Replace** (default: type the new text) or **Remove** (delete the marked
   text entirely — no replacement). Backend: allow `new_text` to be empty when
   `mode: "remove"` is sent per region; the instruction for such a region says
   "reconstruct the clean background exactly — the erased text is GONE; do not
   render any text here", and the QA read-back checks the text is ABSENT.
   Region outline color: use a distinct color for remove-mode (e.g. red) vs
   replace (emerald when filled).
5. **Candidate layout rework.** While generating and after: candidates are
   **vertically stacked on the RIGHT side of the banner** with a generous gap
   from it (banner shifts slightly left; think `banner … [gap ≥64px] … column`).
   - **Generating status on TOP** of that column ("Generating 2 candidates…"
     with spinner; then "Pick the best one").
   - Candidate tiles below it (image, QA badge, "Use this").
   - **Compare (hold) button at the BOTTOM** of the column.
   - The column scrolls if needed; it never overlaps the console.
6. **Console diet.**
   - **Remove the Variants picker** — candidates are fixed at 2 server-side
     default (keep the API param; just no UI).
   - **Remove the Sizes button** from the console (sizes move to the post-accept
     console — see 7).
   - Upload and From-gallery buttons get **small text labels** under/next to the
     icons ("Upload", "Gallery") instead of icon-only.
   - Keep: source thumb, Auto-detect, Quality, Generate (big).
7. **Post-accept console REPLACES the main console.** After "Use this":
   - The main console hides; a **new console takes its exact place** (same
     centered floating position/size) — the user works only with it.
   - Contents: "Saved to gallery ✓" chip · **size picker** (opens the shared
     grouped AddSizesModal; chosen sizes appear as removable chips IN the
     console) · a **Generate button** that starts the recompose — selection
     does NOT execute on close of the picker; nothing runs until Generate is
     clicked · "New edit" (exit back to dropzone) · "Done".
   - The recompose MUST be the same path as Banner Builder's generate
     recompose: the accepted image already IS a fresh master (a new MVP) via
     `create_run_from_image`, and `POST /runs/{id}/sizes` → `runner.add_sizes`
     recomposes off it exactly like the generate flow. No new pipeline — just
     defer the call until Generate.
   - After Generate: show "Recomposing N sizes — watch them under Generate" in
     the same console, keep New edit/Done available.

### A8 — suggested NEXT edit capabilities (pick 2–3 if time allows, else document)

- **Object cleanup**: a region mode "Remove object" (same mask machinery) for
  watermarks, stray logos, photobombers — instruction differs only slightly
  from erase-text.
- **Element swap**: free-instruction region mode ("make the button red",
  "swap the phone for a laptop") — the region card takes an instruction
  instead of old/new text.
- **Translate mode**: one click → auto-detect all text, LLM translates every
  block to a chosen locale, pre-fills all cards → one Generate localizes the
  whole banner.
- **Extend/outpaint**: grow the banner to a new aspect by generating outward
  (background continuation) instead of cover-cropping.
- **Batch correction**: apply the same regions/corrections across every size
  of the same creative in one job.
- **Brand logo stamp**: composite a brand's raster logo (brands.py) into a
  chosen corner post-edit — deterministic, no model call.

---

## Part B — LP Materials v2

1. **Compact customer name inputs.** Replace the names textarea with individual
   name fields sized like a real name (~"Trevor Hawkins" width, e.g. `w-44`),
   laid out as wrapping chips/inputs + a "+" to add another. Cap 20.
2. **No Detect button — detection is automatic.** When a name input is
   committed (blur or Enter, debounce ~600ms; skip if unchanged), call the
   existing detect endpoint with that ONE name (+ campaign market) and fill the
   row's profile card. Cards stack VERTICALLY below the name fields:
   - **Gender = two buttons** (Female / Male), the detected one auto-selected;
     click to override.
   - **Age = a stepper**: `–` on the left, `+` on the right, the band shown in
     the middle; bands **20s…80s** (add "80s" to `_AGES`, the detect schema and
     everywhere validated).
   - Keep Country (compact input, market-prefilled) and Look (free text).
   - While a name's detection is in flight, show a mini spinner on its card;
     a failed detect falls back to market/defaults silently.
3. **Authenticity = 8 options, NONE selected by default.** Only what the user
   picks applies; unselected = a clean-but-real baseline profile photo prompt.
   Options (backend style flags + prompt lines):
   1. Cropped from a group photo
   2. Phone-camera quality
   3. Unstaged / candid
   4. Degrade for realism (the Pillow post-pass)
   5. Direct flash / harsh lighting
   6. Outdoor everyday background (street, market, park)
   7. Indoor home background (living room, kitchen)
   8. Slightly dated photo (older camera, early-smartphone vibe)
   Backend: default every flag to False (this REVERSES the current default-on
   behavior); baseline prompt keeps "ordinary believable person, eye contact,
   slight smile, NOT a model/studio" always.
4. **Section cards: horizontal row + compact inputs + people options.** Cards
   render side by side (3–6 in a horizontally scrollable row, each ~w-56):
   title input + a SMALL subtext area (2 rows, `overflow-hidden` — clamping is
   fine; content like "Cycles de livraison / Airbus publie des données
   mensuelles…" must not stretch the card). Below the row keep aspect, and add:
   - **People in photos** toggle (default ON). OFF → the direction pass is told
     "NO people anywhere — objects, environments, close-ups only" and persona
     is disabled.
   - Keep **Same person across all images** (only enabled when People is ON).
5. **Advertorial simplifications.** Remove the candidates picker (server default
   1 candidate; keep the API param). Add the same **People in photos** toggle
   (OFF → no-people scene).
6. **Campaign workspace = two columns.** The console column sits LEFT but with
   real margin from the viewport edge (centered two-column grid, e.g.
   `max-w-6xl mx-auto grid grid-cols-[minmax(380px,460px)_1fr] gap-6`):
   - LEFT: campaign header + the generator console (as now).
   - RIGHT: **Assets panel** — this campaign's generations grouped **by
     category**: Customers, Section cards, Advertorial, and a new **Hero**
     category showing a "coming soon" placeholder (no backend). Each category
     = header (icon, name, count) + thumbnail grid of that kind's items
     (click → existing lightbox; keep per-item download/regenerate/zip access,
     job delete can live behind a small menu or per-category latest-job row).
   - **Ghost cards when empty**: a just-opened campaign shows skeleton/ghost
     placeholder tiles (low-opacity dashed cards with the category icon) in
     each category, signalling what will appear there.
7. **Home page = professional dashboard.** Replace the centered
   title/subtitle/button hero with a proper dashboard header:
   - Left: title "LP Materials" + one-line subtitle.
   - Right: primary **New campaign** button.
   - A stats strip: total campaigns · total images generated · currently
     generating (live) — computable from `listCampaigns()`.
   - A toolbar row: **search** (name/tag/market), **tag filter** chips (from
     existing campaign tags), **sort** (newest / name / most images).
   - The campaign grid below stays, filtered/sorted by the toolbar.
   - Keep the New-campaign inline creator card behavior.

## Cross-cutting

- Backend changes small: region `mode` (replace/remove) + QA absent-check;
  `_AGES` + "80s"; authenticity flags (default off) + new prompt lines;
  cards/advertorial `people: bool`; advertorial default candidates 1. Persisted
  job params keep working (rehydrate tolerant of missing new keys).
- Every new control keeps the error-toast discipline (no silent failures).
- Update `docs/feature-*.md` + platform/README.md; bump MINOR (v1.49.0).

## Acceptance

- Edit: line endpoints touch the numbered badges; one-row console with big
  Generate; ✕ exits (with confirm when dirty); a Remove-mode region erases text
  (verified live on a real banner); candidates in a right-side column (status
  top, Compare bottom); post-accept console replaces the main one and sizes run
  ONLY on its Generate click (recompose lands in the Generate gallery).
- LP: typing a name auto-fills its profile card (no Detect button anywhere);
  gender buttons + age stepper reaching 80s; 8 authenticity options all OFF by
  default; horizontal compact section cards (French sample content doesn't
  stretch them); people toggles honored (verify one no-people cards/advertorial
  direction); two-column workspace with categorized assets + Hero "coming soon"
  + ghost cards on an empty campaign; dashboard header with stats, search, tag
  filter, sort.
