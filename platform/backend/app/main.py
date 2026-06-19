"""FastAPI application entrypoint.

Run locally:
    cd platform/backend
    uvicorn app.main:app --reload --port 8000
"""
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import plugin_bridge
from .auth import build_auth_router, require_user
from .registry import ToolRegistry, mount_tool_routers
from .routers import meta_router, tools_router
from .settings import settings
from .tool_config import build_config_router
from . import tools  # noqa: F401 — importing registers every tool plugin


def create_app() -> FastAPI:
    app = FastAPI(title="Internal Tool Platform", version="1.0")
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

    @app.get("/api/health")
    def health():
        return {"status": "ok", "tools": len(ToolRegistry.all())}

    return app


app = create_app()
