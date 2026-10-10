"""Verity API entrypoint: `uvicorn app.main:app` (run from backend/)."""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.chain.client import ChainError
from app.config import settings
from app.routes import (
    activity,
    admin,
    ai,
    auth_wallet,
    disputes,
    health,
    programs,
    providers,
    requests,
)

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
for noisy in ("httpx", "httpcore", "hpack", "apscheduler.executors.default"):
    logging.getLogger(noisy).setLevel(logging.WARNING)
log = logging.getLogger("verity")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    log.info("Verity API starting (cluster=%s, program=%s)", settings.cluster, settings.program_id)
    started = False
    try:
        from app.workers.scheduler import start_scheduler

        start_scheduler()
        started = True
        log.info("background workers started (enabled=%s)", settings.workers_enabled)
    except Exception:  # noqa: BLE001 - the API must boot even if workers cannot
        log.exception("failed to start background workers; API continues without them")
    try:
        yield
    finally:
        if started:
            try:
                from app.workers.scheduler import shutdown_scheduler

                shutdown_scheduler()
            except Exception:  # noqa: BLE001
                log.exception("error while shutting down workers")
        log.info("Verity API stopped")


app = FastAPI(
    title="Verity API",
    description="Verifiable computation on Solana: commit -> execute -> receipt -> independent re-execution -> dispute.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=r"https://([a-zA-Z0-9-]+\.)*vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)


@app.exception_handler(ChainError)
async def chain_error_handler(request: Request, exc: ChainError) -> JSONResponse:
    log.warning("chain error on %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse(
        status_code=502,
        content={
            "error": str(exc) or "Solana transaction failed",
            "code": getattr(exc, "code", None),
            "logs": list(getattr(exc, "logs", None) or [])[-30:],
        },
    )


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"error": "internal server error", "detail": str(exc)[:500]})


for module in (health, auth_wallet, programs, requests, disputes, providers, activity, admin, ai):
    app.include_router(module.router)


@app.get("/", include_in_schema=False)
async def root() -> dict[str, str]:
    return {"name": "Verity API", "docs": "/docs", "health": "/health"}
