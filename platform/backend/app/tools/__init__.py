"""Importing this package registers the tool plugins.

The platform is now a single-purpose Banner Builder app, so only that tool is
registered. (The figma_qa / creative_summary / translate packages and the
`teasers` module still exist on disk but are intentionally not imported here.)
"""
from .banner_builder import plugin as _banner_builder  # noqa: F401 — registers Banner Builder
