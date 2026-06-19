"""Banner Builder plugin registration.

Implements the platform contract: metadata (drives the nav), declared secrets,
and a custom router (rich async UI — campaign settings menu + concept cards,
progress, sorted gallery). custom_ui=True tells the frontend to load the
bespoke Banner Builder component. No Figma — create, sort, download.
"""
from ...contract import ToolMeta, ToolSpec, SecretReq
from ...registry import ToolRegistry
from .runs_router import build_router


class BannerBuilder:
    spec = ToolSpec(
        meta=ToolMeta(
            id="banner-builder",
            title="Banner Builder",
            description="Generate on-brand ad banners with OpenAI gpt-image-2 — "
                        "campaign settings, concept cards, multi-size, download as PNG.",
            category="Creative",
            icon="image",
            status="available",
            version="2.0",
            custom_ui=True,
            docs_url=".claude/commands/banner-openai.md",
        ),
        fields=[],  # custom UI; no generic form
        secrets=[
            SecretReq("OPENAI_API_KEY", "OpenAI API key",
                      "https://platform.openai.com/api-keys"),
        ],
    )

    def build_router(self):
        return build_router()


ToolRegistry.register(BannerBuilder())
