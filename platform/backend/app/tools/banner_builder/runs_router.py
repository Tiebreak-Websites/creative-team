"""Banner Builder HTTP routes (mounted at /api/tools/banner-builder).

  POST /run                          -> validate + start a run (202)
  GET  /runs/{run_id}                -> poll status (frontend polls ~2s)
  GET  /runs/{run_id}/banners/{label}.png[?download=1]
  GET  /runs/{run_id}/download.zip   -> zip of all ok PNGs

Banners are create -> sort -> download only. No Figma, no plugin.
"""
import io
import re
import zipfile
from pathlib import Path
from typing import List

from fastapi import APIRouter, Body, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse

from ...auth import require_admin, require_user
from ... import copy_parse
from ... import references as references_store
from ... import runner
from ...brands import build_brands_router
from ...presets import build_presets_router
from ...sizes_config import build_sizes_router
from ...creative_director import VALID_EFFORTS
from ...models import RunRequest
from ...secrets import get_secret

_OPENAI_SECRET = {"env": "OPENAI_API_KEY", "label": "OpenAI API key",
                  "docs_url": "https://platform.openai.com/api-keys", "present": False}


def _slug(s: str) -> str:
    """Filesystem-safe slug for download filenames (alnum + dashes, lowercased)."""
    s = re.sub(r"[^A-Za-z0-9]+", "-", (s or "").strip()).strip("-").lower()
    return s[:80]


def _dir_bytes(d: Path) -> int:
    """Total size of the files directly inside a run dir (PNGs + run.json).

    Best-effort — lets the bulk-delete response report how much disk space it
    actually reclaimed, so the Disk Manager can prove the Render disk was freed.
    """
    total = 0
    try:
        for p in d.iterdir():
            if p.is_file():
                try:
                    total += p.stat().st_size
                except OSError:
                    pass
    except OSError:
        pass
    return total


def _enforce_owner(run, user: dict) -> None:
    """Only the person who started a run may cancel/approve/reject/delete it; admins
    may too. Raises 403 otherwise. Enforced server-side so one user can never act on
    another's generation.

    Fails CLOSED for a run with no recorded creator (every pre-attribution run that
    was rehydrated from disk hits this): such a run is admin-only, never open to
    every logged-in user — otherwise a non-owner could approve/cancel/delete it.
    """
    role = (user or {}).get("role")
    if role == "admin":
        return
    creator = (getattr(run, "created_by", "") or "").strip().lower()
    email = ((user or {}).get("email") or "").strip().lower()
    if creator and creator == email:
        return
    raise HTTPException(status_code=403,
                        detail="Only the person who started this generation can do that.")


def build_router() -> APIRouter:
    router = APIRouter()

    @router.post("/run")
    def create_run(req: RunRequest, user: dict = Depends(require_user)):
        api_key = get_secret("OPENAI_API_KEY")
        if not api_key:
            return JSONResponse(status_code=424, content={"missing_secrets": [_OPENAI_SECRET]})
        if req.model not in ("gpt-image-2", "gpt-image-1-mini"):
            raise HTTPException(status_code=422, detail={"errors": [f"unknown model '{req.model}'"]})
        if req.quality not in ("low", "medium", "high"):
            raise HTTPException(status_code=422, detail={"errors": [f"unknown quality '{req.quality}'"]})
        if req.effort and req.effort not in VALID_EFFORTS:
            raise HTTPException(status_code=422, detail={"errors": [f"unknown thinking effort '{req.effort}'"]})
        errors, concepts, sizes = runner.validate_request(req)
        if errors:
            raise HTTPException(status_code=422, detail={"errors": errors})
        # Collapse an accidental duplicate submit (double-click / network retry)
        # into the same run, and cap how many runs one account can fire (cost).
        user_key = (user or {}).get("email") or "user"
        idem = runner.idempotency_key(user_key, req)
        existing_id = runner.idempotent_run(idem)
        if existing_id:
            existing = runner.STORE.get(existing_id)
            if existing is not None:
                return JSONResponse(status_code=202, content=runner.run_to_dict(existing))
        if not runner.rate_limit_ok(user_key):
            raise HTTPException(
                status_code=429,
                detail={"errors": ["You've started a lot of runs in a short time. Please wait a minute, then try again."]},
            )
        run = runner.create_and_start_run(req, concepts, sizes, api_key, created_by=user_key)
        runner.remember_run(idem, run.id)
        return JSONResponse(status_code=202, content=runner.run_to_dict(run))

    @router.get("/runs")
    def list_runs(limit: int = 200):
        """All runs (shared gallery), newest first — so every logged-in user sees
        every generated banner, not just the ones in their own browser. Capped to
        the most recent `limit`."""
        runs = sorted(runner.STORE.all(), key=lambda r: r.created_at, reverse=True)
        runs = runs[: max(1, min(limit, 500))]
        return {"runs": [runner.run_to_dict(r) for r in runs]}

    @router.get("/runs/{run_id}")
    def get_run(run_id: str):
        run = runner.STORE.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="run not found")
        return runner.run_to_dict(run)

    @router.post("/runs/{run_id}/cancel")
    def cancel_run(run_id: str, user: dict = Depends(require_user)):
        # Owner-only: only the user who started the run (or an admin) may stop it,
        # so one user can't interrupt another's generation. 404 if unknown.
        run = runner.STORE.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="run not found")
        _enforce_owner(run, user)
        runner.cancel(run_id)
        return {"status": "cancelled"}

    @router.post("/runs/{run_id}/approve")
    def approve_run(run_id: str, payload: dict = Body(default={}), user: dict = Depends(require_user)):
        """Owner approves one or more versions (concepts) → recompose them to every
        size. Body {"concepts":[...]}; omit/empty to approve ALL awaiting. Owner-only."""
        run = runner.STORE.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="run not found")
        _enforce_owner(run, user)
        body = payload.get("concepts")
        if isinstance(body, list) and body:
            concepts = [str(c) for c in body]
        else:
            concepts = [ck for ck, st in run.approval_state.items() if st == "awaiting"]
        api_key = get_secret("OPENAI_API_KEY")
        if not api_key:
            return JSONResponse(status_code=424, content={"missing_secrets": [_OPENAI_SECRET]})
        return runner.approve_concepts(run, concepts, api_key=api_key)

    @router.post("/runs/{run_id}/reject")
    def reject_run(run_id: str, payload: dict = Body(default={}), user: dict = Depends(require_user)):
        """Owner rejects one or more versions — keep the MVP only, skip recompose.
        Body {"concepts":[...]} (required). Owner-only."""
        run = runner.STORE.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="run not found")
        _enforce_owner(run, user)
        body = payload.get("concepts")
        concepts = [str(c) for c in body] if isinstance(body, list) else []
        return runner.reject_concepts(run, concepts)

    @router.post("/references")
    async def upload_references(files: List[UploadFile] = File(...)):
        """Save 1-4 style-only reference images (png/jpg/webp, ~8MB each).

        Returns {"ids":[...]} — pass them back as RunRequest.references. The
        creative director uses them for palette/composition/mood/lighting ONLY
        and ignores any text/copy in them.
        """
        # Bound the file count BEFORE buffering any bytes into memory.
        if len(files) > references_store.MAX_FILES:
            raise HTTPException(status_code=422, detail="Too many files (max 4).")
        items = []
        for f in files:
            data = await f.read()
            items.append((data, f.content_type or "", f.filename or ""))
        try:
            ids = references_store.save_references(items)
        except references_store.ReferenceError as e:
            raise HTTPException(status_code=422, detail=str(e))
        return {"ids": ids}

    @router.post("/parse-copy")
    def parse_copy_route(payload: dict = Body(default={})):
        """Detect Title / Subtitle / Button from a pasted copy deck → concept cards.
        Deterministic parser (no LLM): handles labeled, numbered and plain blocks."""
        text = str(payload.get("text") or "")[:12000]
        return {"concepts": copy_parse.parse_copy(text, max_concepts=5)}

    @router.get("/runs/{run_id}/banners/{label}.png")
    def get_banner(run_id: str, label: str, download: int = 0, name: str = ""):
        run = runner.STORE.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="run not found")
        # Only serve known frames — also blocks path traversal via {label}.
        if label not in {runner._label(f["concept"], f["size"]) for f in run.frames_plan}:
            raise HTTPException(status_code=404, detail="unknown banner")
        png = run.dir / f"{label}.png"
        if not png.exists():
            raise HTTPException(status_code=404, detail="banner not generated yet")
        disposition = "attachment" if download else "inline"
        # Download name: caller-supplied, else the standard v{N}-{size}-{title}.
        concept, _, size = label.partition("__")
        fname = (_slug(name) or runner.export_name(run, concept, size)) + ".png"
        return FileResponse(
            str(png), media_type="image/png",
            headers={"Content-Disposition": f'{disposition}; filename="{fname}"'},
        )

    @router.delete("/runs/{run_id}/banners/{label}.png", status_code=204)
    def delete_banner(run_id: str, label: str, user: dict = Depends(require_user)):
        """Delete one banner for EVERYONE — removes the PNG from the disk and drops
        it from the run (re-persisted). Not a per-user hide, so it disappears from
        the shared gallery for all users.

        Owner-only (same guard as cancel/approve/reject): the deletion is shared and
        irreversible, so only the user who started the run — or an admin — may do it.
        """
        run = runner.STORE.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="run not found")
        _enforce_owner(run, user)
        if not runner.delete_frame(run, label):
            raise HTTPException(status_code=404, detail="unknown banner")
        return Response(status_code=204)

    @router.post("/runs/{run_id}/banners/{label}/regenerate")
    def regenerate_banner(run_id: str, label: str, payload: dict = Body(default={}),
                          user: dict = Depends(require_user)):
        """Re-roll ONE banner (a single size) in place — fixes a tile that came out
        wrong without re-running (and re-paying for) the whole batch. Owner-only.
        Returns the updated run; the frontend polls it back to 'ok'.

        Optional body {"prompt_override": "..."} re-rolls from a user-edited prompt
        (used verbatim, and it sticks for future re-rolls); pass "" to reset back to
        the generated prompt; omit it for a plain re-roll.
        """
        run = runner.STORE.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="run not found")
        _enforce_owner(run, user)
        # Validate the label against the run's plan (also blocks path-y input).
        if label not in {runner._label(f["concept"], f["size"]) for f in run.frames_plan}:
            raise HTTPException(status_code=404, detail="unknown banner")
        api_key = get_secret("OPENAI_API_KEY")
        if not api_key:
            return JSONResponse(status_code=424, content={"missing_secrets": [_OPENAI_SECRET]})
        raw_override = payload.get("prompt_override")
        override = str(raw_override) if raw_override is not None else None
        result = runner.regenerate_frame(run, label, api_key=api_key, prompt_override=override)
        if not result.get("ok"):
            raise HTTPException(status_code=409, detail=result.get("reason") or "cannot regenerate this banner")
        return runner.run_to_dict(run)

    @router.post("/runs/{run_id}/sizes")
    def add_sizes(run_id: str, payload: dict = Body(default={}), user: dict = Depends(require_user)):
        """Add more sizes to an already-approved version and recompose them off its
        existing master PNG — no need to start a whole new run. Owner-only.
        Body {"concept": "c1", "sizes": ["300x250", ...]}. Returns the updated run;
        the frontend resumes polling to watch the new sizes fill in.
        """
        run = runner.STORE.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="run not found")
        _enforce_owner(run, user)
        concept = str(payload.get("concept") or "")
        sizes = payload.get("sizes") or []
        if not concept:
            raise HTTPException(status_code=422, detail="concept is required")
        if not isinstance(sizes, list):
            raise HTTPException(status_code=422, detail="sizes must be a list")
        api_key = get_secret("OPENAI_API_KEY")
        if not api_key:
            return JSONResponse(status_code=424, content={"missing_secrets": [_OPENAI_SECRET]})
        result = runner.add_sizes(run, concept, [str(s) for s in sizes], api_key=api_key)
        if not result.get("ok"):
            raise HTTPException(status_code=409, detail=result.get("reason") or "cannot add sizes")
        return runner.run_to_dict(run)

    @router.post("/runs/bulk-delete")
    def bulk_delete(payload: dict = Body(default={}), user: dict = Depends(require_admin)):
        """Admin disk cleanup — delete banners and/or whole runs in one call.

        body: {"runs": ["r_x", ...],
               "banners": [{"run_id": "r_x", "label": "c1__1200x1200"}, ...]}

        Removes the real PNGs (and, for runs, the whole folder + run.json) from the
        mounted artifact disk, so it genuinely frees space — not just a UI hide.
        Best-effort per item: an unknown id is skipped and recorded in `errors`
        rather than failing the whole batch. Returns counts + freed_bytes so the
        Disk Manager can confirm exactly how much was reclaimed.
        """
        runs_in = payload.get("runs") or []
        banners_in = payload.get("banners") or []
        deleted_runs = 0
        deleted_banners = 0
        freed_bytes = 0
        errors: List[str] = []

        # Banners first: deleting them before their runs means a per-banner request
        # is never invalidated by its run disappearing out from under it.
        for item in banners_in:
            if not isinstance(item, dict):
                errors.append(f"bad banner entry: {item!r}")
                continue
            rid = str(item.get("run_id") or "")
            label = str(item.get("label") or "")
            run = runner.STORE.get(rid)
            if run is None:
                errors.append(f"run not found: {rid}")
                continue
            png = run.dir / f"{label}.png"
            try:
                size = png.stat().st_size if png.exists() else 0
            except OSError:
                size = 0
            if runner.delete_frame(run, label):
                deleted_banners += 1
                freed_bytes += size
            else:
                errors.append(f"unknown banner: {rid}:{label}")

        # Then whole runs (folder + every PNG + run.json).
        for rid in runs_in:
            rid = str(rid)
            run = runner.STORE.get(rid)
            if run is None:
                # Already gone (e.g. emptied by a banner delete above) — not an error
                # worth surfacing if we just deleted its last banner; otherwise note it.
                errors.append(f"run not found: {rid}")
                continue
            freed_bytes += _dir_bytes(run.dir)
            runner.delete_run(run)
            deleted_runs += 1

        return {
            "deleted_runs": deleted_runs,
            "deleted_banners": deleted_banners,
            "freed_bytes": freed_bytes,
            "errors": errors,
        }

    @router.get("/runs/{run_id}/download.zip")
    def download_zip(run_id: str):
        run = runner.STORE.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="run not found")
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for fr in run.frame_results.values():
                if fr.status == "ok" and fr.png_path and Path(fr.png_path).exists():
                    zf.write(fr.png_path, arcname=runner.export_name(run, fr.concept, fr.size) + ".png")
        buf.seek(0)
        return StreamingResponse(
            buf, media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{runner.batch_zip_name(run)}.zip"'},
        )

    @router.get("/runs/{run_id}/version.zip")
    def version_zip(run_id: str, concept: str, v: int = 1, title: str = ""):
        """Zip one banner version's ok PNGs — files named v{N}-{size}-{title}.png
        inside a v{N}-{title}.zip archive."""
        run = runner.STORE.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="run not found")
        slug = _slug(title)
        suffix = f"-{slug}" if slug else ""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for f in run.frames_plan:
                if f["concept"] != concept:
                    continue
                png = run.dir / f"{runner._label(f['concept'], f['size'])}.png"
                if png.exists():
                    zf.write(str(png), arcname=runner.export_name(run, concept, f["size"]) + ".png")
        buf.seek(0)
        return StreamingResponse(
            buf, media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="v{v}{suffix}.zip"'},
        )

    @router.get("/download_all.zip")
    def download_all(ids: str = ""):
        """Zip every ok PNG across one or more runs (?ids=a,b,c). Banners are
        namespaced by run id in the archive so labels can't collide."""
        run_ids = [x.strip() for x in ids.split(",") if x.strip()]
        buf = io.BytesIO()
        seen: set[str] = set()
        dates: list[str] = []
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for rid in run_ids:
                run = runner.STORE.get(rid)
                if run is None:
                    continue
                dates.append((run.created_at or runner._now())[:10])
                for fr in run.frame_results.values():
                    if fr.status == "ok" and fr.png_path and Path(fr.png_path).exists():
                        arc = runner.export_name(run, fr.concept, fr.size) + ".png"
                        if arc in seen:
                            arc = f"{arc[:-4]}-{rid[-4:]}.png"
                        seen.add(arc)
                        zf.write(fr.png_path, arcname=arc)
        buf.seek(0)
        zname = f"all-banners_{min(dates)}.zip" if dates else "banners.zip"
        return StreamingResponse(
            buf, media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{zname}"'},
        )

    @router.get("/selection.zip")
    def selection_zip(items: str = ""):
        """Zip a specific, hand-picked set of banners — ?items=runId:label,runId:label,...
        Each label is validated against its run's plan (also blocks path traversal);
        same-label banners from different runs are namespaced by run id."""
        buf = io.BytesIO()
        seen: set[str] = set()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for tok in items.split(","):
                tok = tok.strip()
                if ":" not in tok:
                    continue
                rid, label = tok.split(":", 1)
                rid, label = rid.strip(), label.strip()
                run = runner.STORE.get(rid)
                if run is None:
                    continue
                if label not in {runner._label(f["concept"], f["size"]) for f in run.frames_plan}:
                    continue
                png = run.dir / f"{label}.png"
                if not png.exists():
                    continue
                concept, _, size = label.partition("__")
                arc = runner.export_name(run, concept, size) + ".png"
                if arc in seen:
                    arc = f"{arc[:-4]}-{rid[-4:]}.png"
                seen.add(arc)
                zf.write(str(png), arcname=arc)
        buf.seek(0)
        return StreamingResponse(
            buf, media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="banners-selected_{runner._now()[:10]}.zip"'},
        )

    @router.get("/storage")
    def storage():
        """Usage of the banner artifact disk (PLATFORM_ARTIFACT_DIR) — powers the
        header storage indicator. Returns bytes for used / total / free."""
        import shutil
        try:
            root = runner.settings.ARTIFACT_ROOT
            root.mkdir(parents=True, exist_ok=True)
            total, used, free = shutil.disk_usage(root)
            return {"used_bytes": int(used), "total_bytes": int(total), "free_bytes": int(free)}
        except Exception:  # noqa: BLE001
            return {"used_bytes": 0, "total_bytes": 0, "free_bytes": 0}

    @router.get("/storage-diagnostic")
    def storage_diagnostic(_admin: dict = Depends(require_admin)):
        """Deep disk diagnostics (scans every run dir + run.json). Admin-only and
        on-demand — it used to run on every /api/health poll and grew with the
        gallery; moved here so the readiness probe stays cheap."""
        return runner.storage_stats()

    # Brands CRUD lives under this same prefix (/api/tools/banner-builder/brands).
    # GET is any logged-in user; writes self-gate with require_admin.
    router.include_router(build_brands_router())
    # Saved campaign presets (shared team library) under the same prefix.
    router.include_router(build_presets_router())
    # Size groups / bundles / custom sizes (shared, admin-editable).
    router.include_router(build_sizes_router())

    return router
