# Feature spec: editable prompts + add-sizes-after-approval (Banner Builder)

**Status:** shipped in **v1.44.0** · **Target:** Internovus Creative Builder · **Branch flow:** land on `main`, bump the version in `platform/frontend/package.json`, then merge `main` → `prod` (per `CLAUDE.md`).

> **As built (v1.44.0):** the three open decisions below were resolved as — (1) the **full composed prompt** is editable (used verbatim), with a **"Reset to generated"** button so the guardrailed prompt is always one click away; (2) sizes can be added to any **non-rejected** version (approved, or auto-completed when the gate is off); (3) an edited prompt **persists** as that frame's default for future re-rolls until reset.

Two related enhancements to the Banner Builder, requested by leadership as: *"edit prompt generation"* and *"resize later to add more sizes of the approved banner."* This spec grounds both in the current code and flags the decisions that must be confirmed before building.

---

## Current behaviour (verified in code)

- The composed image prompt **is already shown** to users, but **read-only** (with a Copy button) in the banner detail view — `platform/frontend/src/bannerBuilder/BannerLibrary.tsx:384-419`. It is stored on each frame at `platform/backend/app/runner.py:652` (`fr.prompt = prompt`) and serialized to the frontend at `runner.py:1314`.
- **Regenerate** exists (`BannerLibrary.tsx:472-479` → `POST /runs/{id}/banners/{label}/regenerate`, `platform/backend/app/tools/banner_builder/runs_router.py:235-253` → `runner.regenerate_frame`, `runner.py:1224-1257`) but it **rebuilds the prompt from scratch** from unchanged inputs each call and accepts **no override** — so there is currently no way to edit the prompt and re-run from the edited text.
- Sizes are chosen **only** in the pre-run composer (`BannerBuilder.tsx` "Banner Sizes" panel, ~`:807-901`). After a run is approved and recomposed, **no endpoint appends sizes** to the run — confirmed by full route review. Adding sizes today requires a brand-new run.
- The **master PNG survives** after completion (`ARTIFACT_ROOT/banner-builder/{run_id}/{concept}__{size}.png`, deleted only by explicit delete). Regenerate already relies on this, so "recompose more sizes later from the existing master" is structurally feasible.
- Approval state is tracked **per concept**, not per size (`runner.py:1146-1199`).

---

## Feature 1 — Edit the generation prompt before regenerating

Let a user modify the prompt and regenerate the banner from their edited version.

**Backend**
- `POST /runs/{id}/banners/{label}/regenerate` gains an optional `prompt_override` field in the request body (owner-only, unchanged auth).
- When `prompt_override` is present and non-empty, `_gen_one_frame` uses it **verbatim** instead of calling `build_prompt` / `build_recomp_prompt`. When absent/empty, behaviour is unchanged (rebuild as today).
- Persist the override on the `FrameResult` so it survives reload and displays on the card.

**Frontend**
- In the detail view where the prompt is shown read-only, make it an editable textarea with **Save & Regenerate** and **Reset to generated**.

## Feature 2 — Add more sizes to an already-approved banner

Select an approved banner and generate additional sizes from its existing master PNG, without a new run.

**Backend**
- New owner-only `POST /runs/{id}/sizes` — body: `{ concept, sizes: [...] }`. Validate each size against the allowed list (`engine.LAYOUT_BASE`); reject unknown sizes.
- New `runner.add_sizes(run, concept, new_sizes)` that:
  1. Verifies the master PNG exists (return **409** if it was deleted).
  2. Appends new `{concept, size, mode:"edit", phase:"recomp"}` entries to `run.frames_plan` and new `FrameResult`s to `run.frame_results` (skip sizes already present).
  3. Briefs the new sizes (creative director, or the deterministic fallback template).
  4. Reopens run status from terminal to a recompose state and runs the new frames under the existing per-concept recomp lock (`runner.py:153-160`) so it can't race an in-flight regenerate.

**Frontend**
- Add a size-picker + **"Generate more sizes"** action to the completed-run gallery (which currently has no size UI).
- That action must call `setPolling(true)` so the gallery resumes polling and shows the new sizes as they finish (the poll loop stops on terminal runs).

---

## Decisions (resolved as built — flip any and the structure is unchanged)

| # | Question | **Shipped choice** | Why |
|---|----------|--------------------|-----|
| 1 | Edit the **full composed prompt** or only the **creative-brief paragraph**? | **Full composed prompt**, with **"Reset to generated"** | Most literal reading of "edit prompt generation," and the Reset button neutralises the guardrail risk — the generated, guardrailed prompt is always one click away. |
| 2 | Can sizes be added to a **rejected** version, or approved only? | **Any non-rejected version** (approved, or gate-off completed) | Matches the approval gate's intent (a rejected version stays MVP-only) without blocking gate-off runs, which have no explicit "approved" state. |
| 3 | Does an edited prompt become the **new default** for future re-rolls of that frame, or apply to **one**? | **Persists** as the new default (until reset) | Least surprising — the user sees their edit "stick" on the card rather than silently reverting. |

To change decision #1 to brief-only, feed the edited text in as the concept's `creative_brief` and rebuild instead of using it verbatim; the endpoint/UI plumbing is otherwise identical.

---

## Out of scope / notes
- No change to the initial run-creation flow, the approval gate itself, or the security fixes shipped in v1.43.5.
- Cost note: both features let users trigger additional image-generation calls (edited-prompt regenerate, extra sizes). No new per-user cost cap is included here — if leadership wants one, it's a separate decision.
