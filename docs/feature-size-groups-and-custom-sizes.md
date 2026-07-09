# Size groups, custom sizes & the reworked banner detail actions (v1.45.0)

Four Banner Builder changes, all landed together.

## 1. Prompt editing moved into a big modal

The banner detail view's prompt card is read-only again; its **Edit prompt**
button opens a large modal with the whole prompt in a full-height textarea and
the actions inside it: **Regenerate** (primary), **Cancel**, and **Reset to
generated** when an override is active. The standalone Regenerate button in the
right rail is gone — regeneration always goes through the prompt editor now.

- Unchanged text → a plain re-roll (keeps whatever prompt the frame uses).
- Changed text → a sticky `prompt_override` (same backend contract as v1.44).
- **Edit prompt shows even when a banner has no recorded prompt** (old runs) —
  you can write one from scratch and regenerate. This was the main "options
  missing" fix: the button no longer requires a stored prompt.
- Failed regenerate/add-sizes calls now surface the backend's reason in a toast
  instead of silently doing nothing.

## 2. Add sizes → a grouped picker matching the dashboard

**Add sizes** opens a modal organized exactly like the dashboard's size rail:
the same server-driven groups, collapsible with per-group selection counts, a
search box, and a custom-size input. Sizes the version already has are shown
checked-and-disabled. Available on every non-rejected version (during and after
generation; the backend still requires the master PNG on disk).

## 3. Status only while generating

The gallery status bar shows a label only while something is generating (the
current stage: reading the brief / art-directing / rendering masters /
recomposing). Idle labels — "Awaiting your approval", "All banners ready",
"Some runs failed" — are gone, as are the per-version approval pills. The
Approve/Reject buttons still appear whenever a decision is needed, and run
errors still surface in the alert box.

## 4. Server-driven size groups, custom sizes, bundles, admin manager

- **`GET/PUT /api/tools/banner-builder/size-config`** — one shared organization
  of size groups (order = position) and one-click bundles, stored as
  `config/sizes.json` on the artifact disk (the persistent disk on the cloud
  deploy, so it survives restarts and redeploys). Seeded from the previous
  hardcoded platform list.
- **`POST /api/tools/banner-builder/size-config/custom`** — any logged-in user
  can add a custom `WxH`; it lands in the shared **Custom sizes** group. The
  dashboard offers this via the Custom sizes group's inline input and via the
  size search (type an unknown size → "Add custom size").
- **Custom sizes are truly generatable**: `engine.ensure_size()` registers any
  sane `WxH` (50–4096 px per side, aspect ≤ 10:1) at runtime — nearest OpenAI
  aspect for generation, layout language inherited from the closest built-in
  aspect, exact-pixel reshape as before. Run validation, add-sizes, and
  rehydrated runs all go through it, and `/api/meta` sizes are dynamic.
- **Admin → Settings → Sizes & bundles**: create/rename/delete groups, reorder
  them (up/down = position), add/remove sizes per group, and manage bundles.
  The Custom sizes group is locked (rename/delete disabled). The old "Brands"
  header button is now "Settings" with Brands / Sizes & bundles tabs.
