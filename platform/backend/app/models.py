"""Pydantic request models for the Banner Builder endpoints.

The web UI is organized as a campaign-settings menu (sizes / model / quality /
locale / optional style) plus a list of simple *concept cards*. A card carries
only what a marketer types — Title (required), Subtitle (optional), and Button
text (optional). The engine concept ({title, locale, hook_phrase,
creative_brief, cta?, button_combo?}) is synthesized from the card + campaign
style on the server (see runner.card_to_concept).
"""
from typing import List, Optional

from pydantic import BaseModel, Field


class ConceptIn(BaseModel):
    """One concept card as typed by the user. Engine fields are derived."""
    key: str
    title: str
    subtitle: Optional[str] = None
    button: Optional[str] = None


class RunRequest(BaseModel):
    """A campaign run: settings menu + concept cards."""
    model: str = "gpt-image-2"
    quality: str = "medium"              # gpt-image-2 image quality: low | medium | high
    effort: Optional[str] = None         # GPT-5.5 thinking effort override; None -> admin default
    locale: str = "en"
    sizes: List[str] = Field(default_factory=lambda: ["1200x1200"])
    style: Optional[str] = None          # optional look / brand vibe
    # Style-only reference images (ids from POST /references). The creative
    # director uses them for palette/composition/mood/lighting ONLY — never copy.
    references: List[str] = Field(default_factory=list)
    # Optional brand: folds the brand palette into the art direction, and (when a
    # raster logo + logo_corner are set) composites the logo onto each finished PNG.
    brand_id: Optional[str] = None
    logo_corner: Optional[str] = None    # 'tl' | 'tr' | 'bl' | 'br'
    concepts: List[ConceptIn]
