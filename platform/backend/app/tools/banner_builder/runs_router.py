"""Banner Builder HTTP routes (mounted at /api/tools/banner-builder).

  POST /run                          -> validate + start a run (202)
  GET  /runs/{run_id}                -> poll status (frontend polls ~2s)
  GET  /runs/{run_id}/banners/{label}.png[?download=1]
  GET  /runs/{run_id}/download.zip   -> zip of all ok PNGs

Banners are create -> sort -> download only. No Figma, no plugin.
"""
import io
import zipfile
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

from ... import runner
from ...models import RunRequest
from ...secrets import get_secret

_OPENAI_SECRET = {"env": "OPENAI_API_KEY", "label": "OpenAI API key",
                  "docs_url": "https://platform.openai.com/api-keys", "present": False}


def build_router() -> APIRouter:
    router = APIRouter()

    @router.post("/run")
    def create_run(req: RunRequest):
        api_key = get_secret("OPENAI_API_KEY")
        if not api_key:
            return JSONResponse(status_code=424, content={"missing_secrets": [_OPENAI_SECRET]})
        if req.model not in ("gpt-image-2", "gpt-image-1-mini"):
            raise HTTPException(status_code=422, detail={"errors": [f"unknown model '{req.model}'"]})
        if req.quality not in ("low", "medium"):
            raise HTTPException(status_code=422, detail={"errors": [f"unknown quality '{req.quality}'"]})
        errors, concepts, sizes = runner.validate_request(req)
        if errors:
            raise HTTPException(status_code=422, detail={"errors": errors})
        run = runner.create_and_start_run(req, concepts, sizes, api_key)
        return JSONResponse(status_code=202, content=runner.run_to_dict(run))

    @router.get("/runs/{run_id}")
    def get_run(run_id: str):
        run = runner.STORE.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="run not found")
        return runner.run_to_dict(run)

    @router.get("/runs/{run_id}/banners/{label}.png")
    def get_banner(run_id: str, label: str, download: int = 0):
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
        return FileResponse(
            str(png), media_type="image/png",
            headers={"Content-Disposition": f'{disposition}; filename="{label}.png"'},
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

    return router
