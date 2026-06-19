"""FastAPI application entrypoint.

Run locally:
    cd platform/backend
    uvicorn app.main:app --reload --port 8000
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import plugin_bridge
from .registry import ToolRegistry, mount_tool_routers
from .routers import meta_router, tools_router
from .settings import settings
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
    app.include_router(meta_router.router)
    app.include_router(tools_router.router)
    app.include_router(plugin_bridge.build_plugin_router())
    mount_tool_routers(app)

    @app.get("/api/health")
    def health():
        return {"status": "ok", "tools": len(ToolRegistry.all())}

    return app


app = create_app()
