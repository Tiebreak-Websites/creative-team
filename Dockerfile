# Whole-app image: builds the React SPA, then runs the FastAPI backend which
# serves that SPA (single origin — API at /api/*, UI everywhere else). One
# container does everything, deployed from the `prod` branch (see render.yaml
# and platform/DEPLOY.md). The Python backend can't run on Cloudflare serverless,
# but this image runs anywhere Docker does (Render / Railway / Fly).

# --- Stage 1: build the frontend ---
FROM node:20-slim AS frontend
WORKDIR /build
COPY platform/frontend/package.json platform/frontend/package-lock.json ./
RUN npm ci
COPY platform/frontend/ ./
RUN npm run build      # -> /build/dist

# --- Stage 2: backend + built SPA ---
FROM python:3.12-slim AS app
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /app/backend
COPY platform/backend/requirements.txt ./
RUN pip install -r requirements.txt
COPY platform/backend/ ./
# Place the built SPA where settings.FRONTEND_DIST resolves it:
#   PLATFORM_DIR/frontend/dist  ==  /app/frontend/dist
COPY --from=frontend /build/dist /app/frontend/dist

# Production defaults; real secrets/overrides come from the host's env vars.
ENV PLATFORM_HOST=0.0.0.0 \
    PLATFORM_COOKIE_SECURE=true \
    PLATFORM_DOCS=false
EXPOSE 8000
# Hosts (Render/Railway/Fly) inject $PORT; bind to it, fall back to 8000 locally.
CMD ["sh", "-c", "exec python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
