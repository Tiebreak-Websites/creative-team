"""Creative Summary HTTP routes (mounted at /api/tools/creative-summary).

  POST /run   body {figma_url: str, post_comment?: bool}
              -> read LP copy via Figma REST, author the bilingual summary with
                 Claude, optionally post it as a pinned Figma comment, and return
                 the deliverable + figma_ops + figma_comment.

Synchronous: a single POST does the whole job (~15-40s). Both required secrets
are preflighted; if either is missing we return 424 with {"missing_secrets":[...]}
listing only the absent one(s). Secret values are never logged.
"""
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ... import plugin_bridge
from ...secrets import get_secret, has_secret

_FIGMA_SECRET = {
    "env": "FIGMA_API_KEY",
    "label": "Figma API key (file read)",
    "docs_url": "https://www.figma.com/developers/api#access-tokens",
}
_ANTHROPIC_SECRET = {
    "env": "ANTHROPIC_API_KEY",
    "label": "Anthropic API key (summary)",
    "docs_url": "https://console.anthropic.com/settings/keys",
}


class RunRequest(BaseModel):
    figma_url: str
    post_comment: bool = False


def build_router() -> APIRouter:
    router = APIRouter()

    @router.post("/run")
    def run(req: RunRequest):
        # Preflight both secrets; surface only the missing ones.
        missing = []
        if not has_secret("FIGMA_API_KEY"):
            missing.append({**_FIGMA_SECRET, "present": False})
        if not has_secret("ANTHROPIC_API_KEY"):
            missing.append({**_ANTHROPIC_SECRET, "present": False})
        if missing:
            return JSONResponse(status_code=424, content={"missing_secrets": missing})

        # Lazy import: only pull in httpx/anthropic once secrets are present.
        from .summary import (
            SummaryError,
            build_figma_ops,
            extract_lp,
            generate_summary,
            parse_figma_url,
            post_comment,
            render_markdown,
            render_text,
        )

        figma_token = get_secret("FIGMA_API_KEY")
        anthropic_key = get_secret("ANTHROPIC_API_KEY")

        try:
            file_key, node_id = parse_figma_url(req.figma_url)
            lp = extract_lp(file_key, node_id, figma_token)
            result = generate_summary(lp["copy"], anthropic_key)
        except SummaryError as e:
            return JSONResponse(status_code=e.status, content={"error": e.message})

        summary_text = render_text(result)
        summary_markdown = render_markdown(result, lp["frame"]["name"])
        frame = lp["frame"]

        figma_ops = build_figma_ops(frame, summary_text)
        figma_comment = {"message": summary_text, "node_id": frame.get("node_id")}

        posted_comment = False
        post_error = None
        if req.post_comment:
            try:
                posted_comment = post_comment(file_key, frame, summary_text, figma_token)
            except SummaryError as e:
                post_error = e.message  # don't fail the whole run on a comment hiccup

        body = {
            "status": "ok",
            "summary_markdown": summary_markdown,
            "summary_text": summary_text,
            "language": result["language"],
            "english_only": result["english_only"],
            "figma_ops": figma_ops,
            "figma_comment": figma_comment,
            "posted_comment": posted_comment,
            "frame": {"node_id": frame.get("node_id"), "name": frame.get("name")},
        }
        body["plugin_code"] = plugin_bridge.record(
            "creative-summary", file_key, figma_ops, "Creative Summary"
        )
        if post_error:
            body["post_error"] = post_error
        return body

    return router
