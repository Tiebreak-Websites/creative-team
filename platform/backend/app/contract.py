"""The tool-plugin contract every platform module implements.

A plugin = metadata (drives the nav) + an input schema (a generic form OR a
custom UI) + declared secrets + a way to run. It is deliberately small: a
handful of field types cover the headless batch tools, and `custom_ui` is the
escape hatch for rich modules like the Banner Builder that ship their own UI
and routes.

Two ways a plugin exposes behavior to the backend (see registry.py):
  - `build_router() -> APIRouter`  — rich tools mount their own routes
                                     (Banner Builder: async runs, downloads).
  - `run(params, ctx) -> ToolResult` — simple batch tools get a generic
                                     POST /run mounted for them.
A plugin provides one or the other (or neither, for coming-soon teasers).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Literal, Optional

ToolStatus = Literal["available", "coming-soon", "desktop-only"]
FieldType = Literal["text", "textarea", "number", "select", "boolean"]


@dataclass(frozen=True)
class Field:
    """One input in a generic tool form."""
    name: str
    label: str
    type: FieldType = "text"
    required: bool = True
    default: Any = None
    help: Optional[str] = None
    options: Optional[list[str]] = None  # for type == "select"

    def to_dict(self) -> dict:
        return {
            "name": self.name, "label": self.label, "type": self.type,
            "required": self.required, "default": self.default,
            "help": self.help, "options": self.options,
        }


@dataclass(frozen=True)
class SecretReq:
    """A secret the tool needs (declared, not the value)."""
    env: str
    label: str
    docs_url: str = ""

    def to_dict(self, present: bool) -> dict:
        return {"env": self.env, "label": self.label,
                "docs_url": self.docs_url, "present": present}


@dataclass(frozen=True)
class ToolMeta:
    id: str                       # url-safe slug; primary key in the registry
    title: str
    description: str
    category: str = "General"     # nav grouping
    icon: str = "wrench"          # lucide-react icon name
    status: ToolStatus = "available"
    version: str = "1.0"
    custom_ui: bool = False       # frontend loads a bespoke component for this id
    docs_url: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "id": self.id, "title": self.title, "description": self.description,
            "category": self.category, "icon": self.icon, "status": self.status,
            "version": self.version, "custom_ui": self.custom_ui,
            "docs_url": self.docs_url,
        }


@dataclass(frozen=True)
class ToolSpec:
    meta: ToolMeta
    fields: list[Field] = field(default_factory=list)
    secrets: list[SecretReq] = field(default_factory=list)


@dataclass
class Artifact:
    kind: Literal["image", "file"]
    filename: str
    media_type: str
    bytes: int
    url: Optional[str] = None

    def to_dict(self) -> dict:
        return {"kind": self.kind, "filename": self.filename,
                "media_type": self.media_type, "bytes": self.bytes, "url": self.url}


@dataclass
class ToolResult:
    """Uniform result shape; ResultView renders it four ways (images / files /
    markdown report / raw json)."""
    status: Literal["ok", "error", "partial"]
    summary: dict = field(default_factory=dict)
    artifacts: list[Artifact] = field(default_factory=list)
    report_markdown: Optional[str] = None
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "status": self.status, "summary": self.summary,
            "artifacts": [a.to_dict() for a in self.artifacts],
            "report_markdown": self.report_markdown, "error": self.error,
        }


@dataclass
class RunContext:
    """Passed to a generic tool's run(); gives it a workspace + secret access."""
    run_dir: Path
    get_secret: Callable[[str], Optional[str]]
    log: Callable[[str], None] = lambda _m: None
