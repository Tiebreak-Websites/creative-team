"""FastAPI application entrypoint.

Run locally:
    cd platform/backend
    uvicorn app.main:app --reload --port 8000
"""
import mimetypes

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from . import plugin_bridge
from .auth import build_auth_router, require_user
from .registry import ToolRegistry, mount_tool_routers
from .routers import meta_router, tools_router
from .settings import settings
from .tool_config import build_config_router
from . import tools  # noqa: F401 — importing registers every tool plugin


# Some hosts don't map .webmanifest; serve the PWA manifest as the correct type.
mimetypes.add_type("application/manifest+json", ".webmanifest")


def create_app() -> FastAPI:
    docs = settings.ENABLE_DOCS
    app = FastAPI(
        title="Internal Tool Platform",
        version="1.0",
        docs_url="/docs" if docs else None,
        redoc_url="/redoc" if docs else None,
        openapi_url="/openapi.json" if docs else None,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_methods=["*"],
        allow_headers=["*"],
        allow_credentials=False,
    )
    # Public: auth endpoints + the Figma plugin bridge (the plugin iframe carries no session).
    app.include_router(build_auth_router())
    app.include_router(plugin_bridge.build_plugin_router())
    # Per-tool config self-gates per route (GET=any user, PUT=admin).
    app.include_router(build_config_router())
    # Everything else requires a valid session cookie.
    protected = [Depends(require_user)]
    app.include_router(meta_router.router, dependencies=protected)
    app.include_router(tools_router.router, dependencies=protected)
    mount_tool_routers(app, dependencies=protected)

    # Restore persisted banner runs from the durable disk (PLATFORM_ARTIFACT_DIR)
    # so the gallery survives restarts/redeploys. Never fatal.
    try:
        from . import runner as _banner_runner
        _banner_runner.rehydrate_runs()
    except Exception:  # noqa: BLE001
        pass

    @app.get("/api/health")
    def health():
        return {"status": "ok", "tools": len(ToolRegistry.all())}

    _mount_frontend(app)
    return app


def _mount_frontend(app: FastAPI) -> None:
    """Serve the built React SPA so the whole app is a single origin.

    When `frontend/dist` exists (a deploy after `npm run build`) the backend
    serves its static assets and falls back to index.html for any other path —
    so one `cloudflared` ingress rule covers both the API and the UI, and the
    session cookie is first-party (no CORS). In local dev the dist usually does
    not exist and Vite (:5173) serves the UI instead, so this is a no-op.

    Registered last, as a GET catch-all: the explicit /api routers and FastAPI's
    own /docs + /openapi.json are matched first; /api/* that falls through here
    still 404s as JSON rather than being masked by index.html.
    """
    dist = settings.FRONTEND_DIST
    index = dist / "index.html"
    if not index.is_file():
        return
    dist_root = dist.resolve()

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        candidate = (dist_root / full_path).resolve()
        # Path-traversal guard: only serve real files that stay inside dist.
        if dist_root in candidate.parents and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(index)  # SPA fallback


app = create_app()
