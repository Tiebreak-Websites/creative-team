"""Translate (Figma) HTTP routes (mounted at /api/tools/translate-figma).

  POST /run   -> validate secrets + run fetch→extract→translate→validate (synchronous),
                 returns the per-locale results. ~30-60s for a few locales.

Synchronous by design (per the spec): a run does fetch → extract → translate(per
locale) → validate and returns everything in one response.
"""
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ... import plugin_bridge
from ...secrets import has_secret

_REQUIRED_SECRETS = [
    {"env": "FIGMA_API_KEY", "label": "Figma API key (personal access token)",
     "docs_url": "https://www.figma.com/settings"},
    {"env": "ANTHROPIC_API_KEY", "label": "Anthropic API key",
     "docs_url": "https://console.anthropic.com/settings/keys"},
]


class RunRequest(BaseModel):
    figma_url: str
    locales: str
    page: str | None = None


def build_router() -> APIRouter:
    router = APIRouter()

    @router.post("/run")
    def create_run(req: RunRequest):
        missing = [s for s in _REQUIRED_SECRETS if not has_secret(s["env"])]
        if missing:
            return JSONResponse(status_code=424, content={"missing_secrets": missing})

        # Lazy import: only needs anthropic / the scripts on an actual run.
        from .engine import run_translation, TranslateError
        try:
            result = run_translation(req.figma_url, req.locales,
                                     (req.page or "").strip() or None)
        except TranslateError as e:
            return JSONResponse(status_code=200, content={"status": "error", "error": str(e)})
        except Exception as e:  # noqa: BLE001 - surface unexpected failures as a result
            return JSONResponse(status_code=200,
                                content={"status": "error", "error": f"{type(e).__name__}: {e}"})
        ops = [loc["figma_ops"] for loc in result.get("locales", []) if loc.get("figma_ops")]
        file_key = (result.get("source") or {}).get("fileKey", "")
        if ops and file_key:
            result["plugin_code"] = plugin_bridge.record("translate-figma", file_key, ops, "Translate")
        return result

    return router
