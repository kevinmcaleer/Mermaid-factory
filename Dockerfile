# syntax=docker/dockerfile:1

# ---- Stage 1: bundle the browser code (mermaid.js, CodeMirror, page scripts)
FROM node:25-bookworm-slim AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN mkdir -p ../app/static && npm run build -- --app-only

# ---- Stage 2: Python runtime
FROM python:3.13-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    APP_ENV=production \
    HOST=0.0.0.0 \
    PORT=8000 \
    DATABASE_PATH=/data/mermaid.db \
    PUID=1000 \
    PGID=1000

WORKDIR /app
COPY requirements.txt ./
RUN pip install -r requirements.txt

# Unprivileged user. The entrypoint re-maps it to PUID/PGID so files in the
# mounted /data directory are owned by your host user.
RUN groupadd --gid 1000 app && useradd --uid 1000 --gid app --no-create-home --shell /usr/sbin/nologin app

COPY app/ ./app/
COPY scripts/ ./scripts/
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY --from=frontend /build/app/static/build ./app/static/build
RUN chmod +x /usr/local/bin/entrypoint.sh ./scripts/*.sh \
    && mkdir -p /data /backups

VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import os,urllib.request,sys; sys.exit(0 if urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8000\")}/health', timeout=4).status == 200 else 1)"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["python", "-m", "app"]
