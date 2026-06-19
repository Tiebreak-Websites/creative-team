"""Pydantic request models for the Banner Builder endpoints."""
from typing import List, Optional

from pydantic import BaseModel, Field


class ConceptIn(BaseModel):
    key: str
    title: str
    locale: str = "en"
    hook_phrase: str
    creative_brief: str
    cta: Optional[str] = None
    button_combo: Optional[List[str]] = None


class RunRequest(BaseModel):
    banner_text: str
    locale: str = "en"
    model: str = "gpt-image-2"
    quality: str = "medium"
    sizes: List[str] = Field(default_factory=lambda: ["1200x1200"])
    concepts: List[ConceptIn]


class SuggestRequest(BaseModel):
    banner_text: str
    cta: Optional[str] = None
    locale: str = "en"
    concept_count: int = 3
