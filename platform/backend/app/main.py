"""FastAPI application entrypoint.

Run locally:
    cd platform/backend
    uvicorn app.main:app --reload --port 8000
"""
import mimetypes

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from .auth import build_auth_router, require_user
from .lp_materials import build_lp_materials_router
from .registry import ToolRegistry, mount_tool_routers
from .routers import meta_router, tools_router
from .settings import settings
from .tool_config import build_config_router
from . import tools  # noqa: F401 — importing registers every tool plugin


# Some hosts don't map .webmanifest; serve the PWA manifest as the correct type.
mimetypes.add_type("application/manifest+json", ".webmanifest")

# Content-Security-Policy scoped to exactly what the SPA loads: same-origin code,
# Google Fonts (stylesheet + font files), and images from self / data: / blob: /
# any https (brand SVGs as data URIs, flag icons, generated banner PNGs).
# `frame-ancestors 'none'` blocks clickjacking; `connect-src 'self'` keeps API
# calls same-origin. script-src refuses inline JS via 'unsafe-inline' and instead
# allows only the no-flash theme bootstrap by its sha256 hash (see below); style-src
# keeps 'unsafe-inline' because React sets dynamic inline styles that can't be hashed.
def _inline_script_hashes() -> list:
    """sha256 CSP hashes of the inline <script> blocks in the BUILT index.html.

    Read as bytes (no newline translation) from the actual served file, so the
    hash always matches what the browser computes. Empty in dev (no dist), where
    Vite serves the HTML and script-src falls back to 'unsafe-inline'."""
    import re
    import hashlib
    import base64
    try:
        html = (settings.FRONTEND_DIST / "index.html").read_bytes().decode("utf-8", "replace")
    except Exception:  # noqa: BLE001
        return []
    out = []
    # Inline scripts only: <script> with NO src attribute (the bundle has src).
    for m in re.finditer(r"<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)</script>", html):
        digest = hashlib.sha256(m.group(1).encode("utf-8")).digest()
        out.append("'sha256-" + base64.b64encode(digest).decode("ascii") + "'")
    return out


def _build_csp() -> str:
    hashes = _inline_script_hashes()
    script_src = ("'self' " + " ".join(hashes)) if hashes else "'self' 'unsafe-inline'"
    return (
        "default-src 'self'; "
        "img-src 'self' data: blob: https:; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com data:; "
        f"script-src {script_src}; "
        "connect-src 'self'; "
        "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"
    )


_CSP = _build_csp()

# A 40 MB ceiling on any request body. The only sizeable input is the 1–4 style
# reference images; this stops a single huge/streamed body from buffering into RAM.
_MAX_BODY_BYTES = 40 * 1024 * 1024


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Defense-in-depth for an internal, never-indexed tool: rejects oversized
    request bodies up front, then stamps every response with no-index, anti-
    clickjacking, no-sniff, referrer, permissions, and CSP headers."""

    async def dispatch(self, request, call_next):
        cl = request.headers.get("content-length")
        if cl:
            try:
                if int(cl) > _MAX_BODY_BYTES:
                    return JSONResponse(status_code=413, content={"detail": "Payload too large."})
            except ValueError:
                pass
        resp = await call_next(request)
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        resp.headers["X-Robots-Tag"] = "noindex, nofollow"
        # A route may set its own (still restrictive) CSP — e.g. the LP Builder's
        # browser preview page needs form-action/connect beyond 'self'. Only
        # stamp the global policy when the route didn't.
        if "Content-Security-Policy" not in resp.headers:
            resp.headers["Content-Security-Policy"] = _CSP
        return resp


def create_app() -> FastAPI:
    docs = settings.ENABLE_DOCS
    app = FastAPI(
        title="Internal Tool Platform",
        version="1.0",
        docs_url="/docs" if docs else None,
        redoc_url="/redoc" if docs else None,
        openapi_url="/openapi.json" if docs else None,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_methods=["*"],
        allow_headers=["*"],
        allow_credentials=False,
    )
    # Added last → outermost: security headers wrap every response (incl. CORS
    # preflight and static assets) and the body-size guard runs before routing.
    app.add_middleware(SecurityHeadersMiddleware)
    # Public: auth endpoints only (login/logout/me). Everything else is gated.
    app.include_router(build_auth_router())
    # Per-tool config self-gates per route (GET=any user, PUT=admin).
    app.include_router(build_config_router())
    # Everything else requires a valid session cookie.
    protected = [Depends(require_user)]
    app.include_router(meta_router.router, dependencies=protected)
    app.include_router(tools_router.router, dependencies=protected)
    mount_tool_routers(app, dependencies=protected)
    # LP Materials (avatars / section cards / advertorial images) — its own
    # workspace + store, same session gate as everything else.
    app.include_router(build_lp_materials_router(),
                       prefix="/api/tools/lp-materials", dependencies=protected)
    # LP Builder — section-based landing-page builder (templates, projects,
    # composition + ZIP export). Same session gate.
    from .lp_builder import build_lp_builder_router
    app.include_router(build_lp_builder_router(),
                       prefix="/api/tools/lp-builder", dependencies=protected)
    # CRM Email Builder — table-based email composition. The tool itself is
    # session-gated like everything else...
    from .email_builder import build_email_builder_router, build_public_email_router
    app.include_router(build_email_builder_router(),
                       prefix="/api/tools/email-builder", dependencies=protected)
    # ...but images are served WITHOUT auth, because the person opening the
    # email is a recipient in Gmail with no session here. Read-only, confined
    # to the email asset directory, and the 32-hex filename is the capability.
    app.include_router(build_public_email_router(), prefix="/e")

    # Admin user management (Supabase users table) — dormant until the keys
    # exist; the whole prefix is admin-gated.
    from .admin_users import build_admin_users_router
    from .auth import require_admin as _require_admin
    app.include_router(build_admin_users_router(),
                       prefix="/api/admin", dependencies=[Depends(_require_admin)])

    # Floating suggestions/bug-report widget — per-user threads, admin checkmarks.
    from .feedback import build_feedback_router
    app.include_router(build_feedback_router(),
                       prefix="/api/feedback", dependencies=protected)

    # Restore persisted banner runs from the durable disk (PLATFORM_ARTIFACT_DIR)
    # so the gallery survives restarts/redeploys. Run in a BACKGROUND thread so a
    # slow/large disk scan can't delay startup and fail the health check (which
    # would trigger a restart loop). Never fatal.
    try:
        import threading as _threading
        from . import runner as _banner_runner
        from . import lp_materials as _lp_materials
        _threading.Thread(target=_banner_runner.rehydrate_runs, daemon=True,
                          name="bb-rehydrate").start()
        _threading.Thread(target=_lp_materials.rehydrate_jobs, daemon=True,
                          name="lpm-rehydrate").start()
        # LP Builder rehydrates SYNCHRONOUSLY: it must seed the built-in
        # section library before the first /sections request, and the disk
        # scan is a handful of small JSON files.
        from . import lp_builder as _lp_builder
        _lp_builder.rehydrate()
        # Same reasoning for the email block library.
        from .email_builder import core as _email_core
        _email_core.rehydrate()
    except Exception:  # noqa: BLE001
        pass

    @app.get("/api/health")
    def health():
        """Readiness probe Render polls (healthCheckPath). Cheap + HONEST: a deploy
        that's missing the OpenAI key or can't write the artifact disk would let
        every Generate fail while still reporting healthy — so gate readiness on
        those and return 503 when not ready, which fails the health check and keeps
        the previous good deploy live. Deliberately does NOT run the full
        storage_stats() disk scan (that grew with the gallery and ran on every
        poll) — heavy diagnostics live behind the admin /storage-diagnostic route."""
        import os
        from .secrets import get_secret
        from . import runner
        checks = {"openai_key": bool(get_secret("OPENAI_API_KEY")), "disk_writable": False}
        try:
            art = runner.settings.ARTIFACT_ROOT
            art.mkdir(parents=True, exist_ok=True)
            checks["disk_writable"] = os.access(art, os.W_OK)
        except Exception:  # noqa: BLE001
            checks["disk_writable"] = False
        ready = checks["openai_key"] and checks["disk_writable"]
        body = {"status": "ok" if ready else "degraded",
                "tools": len(ToolRegistry.all()), "checks": checks}
        return body if ready else JSONResponse(status_code=503, content=body)

    @app.get("/api/app-build")
    def app_build():
        """The deployed SPA's content-hashed bundle name. The frontend polls this
        to detect a NEW deploy and offer a reload, so users never get stuck on a
        stale cached bundle. /api/* is network-only in the service worker, so this
        is always fresh."""
        import re
        try:
            html = (settings.FRONTEND_DIST / "index.html").read_text(encoding="utf-8")
            m = re.search(r"assets/index-[\w.-]+\.js", html)
            return {"bundle": m.group(0) if m else None}
        except Exception:  # noqa: BLE001
            return {"bundle": None}

    _mount_frontend(app)
    return app


def _mount_frontend(app: FastAPI) -> None:
    """Serve the built React SPA so the whole app is a single origin.

    When `frontend/dist` exists (a deploy after `npm run build`) the backend
    serves its static assets and falls back to index.html for any other path —
    so one `cloudflared` ingress rule covers both the API and the UI, and the
    session cookie is first-party (no CORS). In local dev the dist usually does
    not exist and Vite (:5173) serves the UI instead, so this is a no-op.

    Registered last, as a GET catch-all: the explicit /api routers and FastAPI's
    own /docs + /openapi.json are matched first; /api/* that falls through here
    still 404s as JSON rather than being masked by index.html.
    """
    dist = settings.FRONTEND_DIST
    index = dist / "index.html"
    if not index.is_file():
        return
    dist_root = dist.resolve()

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        candidate = (dist_root / full_path).resolve()
        # Path-traversal guard: only serve real files that stay inside dist.
        if dist_root in candidate.parents and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(index)  # SPA fallback


app = create_app()
