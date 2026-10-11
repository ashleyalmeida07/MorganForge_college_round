# Verity API (FastAPI + in-process provider/verifier/finalizer/indexer workers).
# Build context: the REPO ROOT (Render's default)   ->   docker build -f backend/Dockerfile .
# The root .dockerignore sends only backend/app, backend/scripts and backend/requirements.txt.
# Config comes from environment variables only (Render dashboard); no .env file is baked in.
FROM python:3.11.9-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install -r requirements.txt

COPY backend/app ./app
COPY backend/scripts ./scripts

RUN useradd --create-home --uid 10001 verity && chown -R verity /app
USER verity

# Render injects PORT (10000 by default). Exactly one worker: the background jobs must not run twice.
EXPOSE 10000
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000} --workers 1"]
