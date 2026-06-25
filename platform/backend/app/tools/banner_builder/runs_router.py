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

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

from ... import references as references_store
from ... import runner
from ...brands import build_brands_router
from ...creative_director import VALID_EFFORTS
from ...models import RunRequest
from ...secrets import get_secret

_OPENAI_SECRET = {"env": "OPENAI_API_KEY", "label": "OpenAI API key",
                  "docs_url": "https://platform.openai.com/api-keys", "present": False}


def _slug(s: str) -> str:
    """Filesystem-safe slug for download filenames (alnum + dashes, lowercased)."""
    s = re.sub(r"[^A-Za-z0-9]+", "-", (s or "").strip()).strip("-").lower()
    return s[:80]


def build_router() -> APIRouter:
    router = APIRouter()

    @router.post("/run")
    def create_run(req: RunRequest):
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
        run = runner.create_and_start_run(req, concepts, sizes, api_key)
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
    def cancel_run(run_id: str):
        # Flags the run; the runner stops between frames and between phases,
        # leaving already-finished banners intact. 404 if the run is unknown.
        if not runner.cancel(run_id):
            raise HTTPException(status_code=404, detail="run not found")
        return {"status": "cancelled"}

    @router.post("/references")
    async def upload_references(files: List[UploadFile] = File(...)):
        """Save 1-4 style-only reference images (png/jpg/webp, ~8MB each).

        Returns {"ids":[...]} — pass them back as RunRequest.references. The
        creative director uses them for palette/composition/mood/lighting ONLY
        and ignores any text/copy in them.
        """
        items = []
        for f in files:
            data = await f.read()
            items.append((data, f.content_type or "", f.filename or ""))
        try:
            ids = references_store.save_references(items)
        except references_store.ReferenceError as e:
            raise HTTPException(status_code=422, detail=str(e))
        return {"ids": ids}

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
        # Optional caller-supplied download name, e.g. v1-1200x1200-title.png
        fname = (_slug(name) or label) + ".png"
        return FileResponse(
            str(png), media_type="image/png",
            headers={"Content-Disposition": f'{disposition}; filename="{fname}"'},
        )

    @router.get("/runs/{run_id}/download.zip")
    def download_zip(run_id: str):
        run = runner.STORE.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="run not found")
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for fr in run.frame_results.values():
                if fr.status == "ok" and fr.png_path and Path(fr.png_path).exists():
                    zf.write(fr.png_path, arcname=Path(fr.png_path).name)
        buf.seek(0)
        return StreamingResponse(
            buf, media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="banners_{run_id}.zip"'},
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
                label = runner._label(f["concept"], f["size"])
                png = run.dir / f"{label}.png"
                if png.exists():
                    zf.write(str(png), arcname=f"v{v}-{f['size']}{suffix}.png")
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
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for rid in run_ids:
                run = runner.STORE.get(rid)
                if run is None:
                    continue
                for fr in run.frame_results.values():
                    if fr.status == "ok" and fr.png_path and Path(fr.png_path).exists():
                        zf.write(fr.png_path, arcname=f"{rid}/{Path(fr.png_path).name}")
        buf.seek(0)
        return StreamingResponse(
            buf, media_type="application/zip",
            headers={"Content-Disposition": 'attachment; filename="banners.zip"'},
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
                arc = f"{label}.png"
                if arc in seen:
                    arc = f"{rid}/{label}.png"
                seen.add(arc)
                zf.write(str(png), arcname=arc)
        buf.seek(0)
        return StreamingResponse(
            buf, media_type="application/zip",
            headers={"Content-Disposition": 'attachment; filename="banners-selected.zip"'},
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

    # Brands CRUD lives under this same prefix (/api/tools/banner-builder/brands).
    # GET is any logged-in user; writes self-gate with require_admin.
    router.include_router(build_brands_router())

    return router
