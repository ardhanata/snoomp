# ──────────────────────────────────────────────────────────────────────────
# Stage 1 — build the frontend
#
# The frontend is compiled here and copied into the runtime image, so the
# image tag IS the artifact: backend and frontend can never drift apart, and
# the deployment host needs no Node toolchain.
# ──────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS frontend

WORKDIR /build

# Copy manifests first so `npm ci` is cached until dependencies actually change.
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
# vite.config.ts reads ../VERSION for the build stamp logged at startup.
COPY VERSION ../VERSION

# Served same-origin by the backend, so the API base is a relative path and
# needs no build-time host. This is what makes one image work on any host.
ENV VITE_API_URL=""
ENV VITE_WS_URL=""

RUN npm run build


# ──────────────────────────────────────────────────────────────────────────
# Stage 2 — Python runtime
# ──────────────────────────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# iputils-ping: ICMP checker fallback when raw sockets are unavailable.
# libpq5: psycopg2 runtime. Build toolchain is installed, used, then removed
# in a single layer so it doesn't ship in the final image.
RUN apt-get update && apt-get install -y --no-install-recommends \
        iputils-ping \
        libpq5 \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt .
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libffi-dev libssl-dev libpq-dev \
    && pip install --no-cache-dir -r requirements.txt \
    && apt-get purge -y --auto-remove build-essential libffi-dev libssl-dev libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY backend/ /app/
COPY VERSION /VERSION

# Baked frontend. FRONTEND_DIST in app/main.py points here by default.
COPY --from=frontend /build/dist /app/frontend_dist

# Non-root. ICMP raw sockets come from NET_RAW in compose, not from root.
RUN useradd --system --create-home --uid 10001 snoomp \
    && chown -R snoomp:snoomp /app
USER snoomp

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/api/version || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
