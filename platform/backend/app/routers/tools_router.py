"""GET /api/tools — nav metadata + input schemas + secret-presence flags."""
from fastapi import APIRouter

from ..registry import ToolRegistry

router = APIRouter(prefix="/api", tags=["tools"])


@router.get("/tools")
def list_tools():
    return ToolRegistry.listing()
