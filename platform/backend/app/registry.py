"""Tool registry: plugins self-register, the registry serves /api/tools and
mounts each plugin's routes onto the FastAPI app.

A plugin module calls `@ToolRegistry.register` on its plugin object. At startup
`app.tools` is imported (triggering every registration) and `mount_tool_routers`
wires each plugin's routes under /api/tools/{id}.
"""
from __future__ import annotations

import uuid
from typing import Dict, Optional

from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import JSONResponse

from .contract import RunContext, ToolSpec
from .secrets import get_secret, has_secret
from .settings import settings


class ToolRegistry:
    _plugins: Dict[str, object] = {}

    @classmethod
    def register(cls, plugin):
        tid = plugin.spec.meta.id
        if tid in cls._plugins:
            raise ValueError(f"duplicate tool id: {tid!r}")
        cls._plugins[tid] = plugin
        return plugin

    @classmethod
    def all(cls):
        return list(cls._plugins.values())

    @classmethod
    def get(cls, tid: str):
        return cls._plugins.get(tid)

    @classmethod
    def listing(cls) -> dict:
        """Nav payload: metadata + input schema + per-secret presence flags."""
        tools, categories = [], []
        for plugin in cls._plugins.values():
            spec: ToolSpec = plugin.spec
            entry = spec.meta.to_dict()
            entry["fields"] = [f.to_dict() for f in spec.fields]
            entry["secrets"] = [s.to_dict(has_secret(s.env)) for s in spec.secrets]
            tools.append(entry)
            if spec.meta.category not in categories:
                categories.append(spec.meta.category)
        return {"tools": tools, "categories": categories}


def _generic_router(plugin) -> APIRouter:
    """A POST /run for simple, schema-driven batch tools.

    Validates required fields, preflights declared secrets, gives the tool a
    fresh per-run workspace, and returns its ToolResult. (No tool ships on this
    path in v1 — the Banner Builder uses a custom router — but the path is real
    and unit-tested via a fake plugin so tool #2 can rely on it.)
    """
    spec: ToolSpec = plugin.spec
    router = APIRouter()

    @router.post("/run")
    def run_tool(params: dict = Body(default={})):
        missing = [f.name for f in spec.fields if f.required and params.get(f.name) in (None, "")]
        if missing:
            raise HTTPException(status_code=422,
                                detail={"errors": [f"missing required field '{m}'" for m in missing]})
        absent = [s.to_dict(False) for s in spec.secrets if not has_secret(s.env)]
        if absent:
            return JSONResponse(status_code=424, content={"missing_secrets": absent})
        run_dir = settings.ARTIFACT_ROOT / spec.meta.id / uuid.uuid4().hex[:12]
        run_dir.mkdir(parents=True, exist_ok=True)
        ctx = RunContext(run_dir=run_dir, get_secret=get_secret)
        try:
            result = plugin.run(params, ctx)
        except Exception as e:  # noqa: BLE001 - surface tool failures as a result
            return JSONResponse(status_code=200,
                                content={"status": "error", "summary": {},
                                         "artifacts": [], "report_markdown": None,
                                         "error": f"{type(e).__name__}: {e}"})
        return result.to_dict()

    return router


def mount_tool_routers(app, dependencies=None) -> None:
    for plugin in ToolRegistry.all():
        tid = plugin.spec.meta.id
        router: Optional[APIRouter] = None
        if hasattr(plugin, "build_router"):
            router = plugin.build_router()
        elif hasattr(plugin, "run"):
            router = _generic_router(plugin)
        if router is not None:
            app.include_router(router, prefix=f"/api/tools/{tid}", tags=[tid],
                               dependencies=dependencies or [])
