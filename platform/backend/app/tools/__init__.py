"""Importing this package registers every tool plugin.

Adding a new tool = drop a package here and add one import line below.
"""
from .banner_builder import plugin as _banner_builder  # noqa: F401 — registers Banner Builder
from .figma_qa import plugin as _figma_qa  # noqa: F401 — registers Figma QA
from .creative_summary import plugin as _creative_summary  # noqa: F401 — registers Creative Summary
from .translate import plugin as _translate  # noqa: F401 — registers Translate (Figma)
from . import teasers  # noqa: F401 — registers coming-soon / desktop-only tools
