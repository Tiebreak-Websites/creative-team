"""Creative Summary plugin registration.

Implements the platform contract: metadata (drives the nav), declared secrets,
and a custom router (synchronous run that reads a Figma LP and authors a
bilingual creative summary). custom_ui=True tells the frontend to load the
bespoke Creative Summary component.
"""
from ...contract import ToolMeta, ToolSpec, SecretReq
from ...registry import ToolRegistry
from .router import build_router


class CreativeSummary:
    spec = ToolSpec(
        meta=ToolMeta(
            id="creative-summary",
            title="Creative Summary",
            description="Paste a Figma LP URL — auto-generate a bilingual creative "
                        "summary of what it promotes, download it, and post it to Figma.",
            category="Creative",
            icon="sparkles",
            status="available",
            version="1.0",
            custom_ui=True,
            docs_url="projects/creative-summary/README.md",
        ),
        fields=[],  # custom UI; no generic form
        secrets=[
            SecretReq("FIGMA_API_KEY", "Figma API key (file read)",
                      "https://www.figma.com/developers/api#access-tokens"),
            SecretReq("ANTHROPIC_API_KEY", "Anthropic API key (summary)",
                      "https://console.anthropic.com/settings/keys"),
        ],
    )

    def build_router(self):
        return build_router()


ToolRegistry.register(CreativeSummary())
