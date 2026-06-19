"""Teaser registrations for tools shown in the nav but not run from the web.

A teaser is a ToolMeta with no run route; the frontend renders a "coming-soon"
or "desktop-only" state from its `status`. Per the team decision, the remaining
Claude-Code-only commands (/banner-prompt, /banner-higgsfield, /pull, /push) are
NOT surfaced in the web platform, so this list is currently empty. To add one
back, append a ToolMeta below.
"""
from ..contract import ToolMeta, ToolSpec
from ..registry import ToolRegistry


class _Teaser:
    def __init__(self, meta: ToolMeta):
        self.spec = ToolSpec(meta=meta)


_TEASERS: list[ToolMeta] = []

for _m in _TEASERS:
    ToolRegistry.register(_Teaser(_m))
