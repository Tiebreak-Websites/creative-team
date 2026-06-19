"""Figma QA plugin registration.

Wraps the existing /qa scripts (projects/qa/scripts/fetch.py + check.py + post.py)
behind a synchronous web endpoint. custom_ui=True tells the frontend to load the
bespoke FigmaQa component.

Secrets:
  - FIGMA_API_KEY   — required (passed to the scripts as FIGMA_TOKEN).
  - ANTHROPIC_API_KEY — optional; enables the AI tone judgment when `tone` is set.
"""
from ...contract import ToolMeta, ToolSpec, SecretReq
from ...registry import ToolRegistry
from .runs_router import build_router


class FigmaQa:
    spec = ToolSpec(
        meta=ToolMeta(
            id="qa",
            title="Figma QA",
            description="QA a localized Figma landing page — parity, placeholders, "
                        "broken images, overflow, CTA and regulator-phrase checks, "
                        "plus optional AI language/tone judgment.",
            category="QA",
            icon="check-circle",
            status="available",
            version="1.1",
            custom_ui=True,
            docs_url=".claude/commands/qa.md",
        ),
        fields=[],  # custom UI; no generic form
        secrets=[
            SecretReq("FIGMA_API_KEY", "Figma personal access token",
                      "https://www.figma.com/settings"),
            SecretReq("ANTHROPIC_API_KEY", "Anthropic API key (AI tone check, optional)",
                      "https://console.anthropic.com/settings/keys"),
        ],
    )

    def build_router(self):
        return build_router()


ToolRegistry.register(FigmaQa())
