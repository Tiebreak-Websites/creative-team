"""CRM Email Builder — table-based email composition for the CRM team."""
from .router import build_email_builder_router, build_public_email_router

__all__ = ["build_email_builder_router", "build_public_email_router"]
