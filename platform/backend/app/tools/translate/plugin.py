"""Translate (Figma) plugin registration.

Implements the platform contract: metadata (drives the nav), declared secrets,
and a custom router. The tool pastes a Figma page URL + target locales, extracts
the page's text via the existing projects/translate/scripts/extract.py, translates
it with the Claude API, validates each locale, and returns per-locale results to
preview/download. custom_ui=True tells the frontend to load the bespoke component.
"""
from ...contract import ToolMeta, ToolSpec, SecretReq
from ...registry import ToolRegistry
from .runs_router import build_router


class Translate:
    spec = ToolSpec(
        meta=ToolMeta(
            id="translate-figma",
            title="Translate Figma",
            description="Extract a Figma page's text, translate it into N locales with "
                        "Claude, validate, and download per-locale results.",
            category="Localization",
            icon="languages",
            status="available",
            version="1.0",
            custom_ui=True,
            docs_url=".claude/commands/translate-figma.md",
        ),
        fields=[],  # custom UI; no generic form
        secrets=[
            SecretReq("FIGMA_API_KEY", "Figma API key (personal access token)",
                      "https://www.figma.com/settings"),
            SecretReq("ANTHROPIC_API_KEY", "Anthropic API key",
                      "https://console.anthropic.com/settings/keys"),
        ],
    )

    def build_router(self):
        return build_router()


ToolRegistry.register(Translate())
