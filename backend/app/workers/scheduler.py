"""APScheduler wiring for the background workers.

Jobs: "provider", "verifier", "finalizer", "indexer", "anchor".
Each job is wrapped so it records last_run / last_ok / last_error / duration and
can never raise into the scheduler. A per-job asyncio.Lock serializes scheduled
runs with manual runs triggered via run_job_now() (POST /admin/run/{job}).
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.config import settings
from app.workers.common import job_finished, job_started, status_snapshot

logger = logging.getLogger("verity.workers.scheduler")

JOB_NAMES = ("provider", "verifier", "finalizer", "indexer", "anchor")

_scheduler: AsyncIOScheduler | None = None
_locks: dict[str, asyncio.Lock] = {}


def _job_funcs() -> dict[str, Callable[[], Awaitable[Any]]]:
    # Imported lazily so a broken optional dependency can't break app startup.
    from app.chain import indexer
    from app.workers.finalizer import finalizer_tick
    from app.workers.provider import provider_tick
    from app.workers.verifier import verifier_tick

    return {
        "provider": provider_tick,
        "verifier": verifier_tick,
        "finalizer": finalizer_tick,
        "indexer": indexer.index_once,
        "anchor": indexer.maybe_anchor_audit_root,
    }


def _intervals() -> dict[str, int]:
    return {
        "provider": max(1, settings.provider_interval_secs),
        "verifier": max(1, settings.verifier_interval_secs),
        "finalizer": max(1, settings.finalizer_interval_secs),
        "indexer": max(1, settings.indexer_interval_secs),
        "anchor": max(30, settings.indexer_interval_secs * 3),
    }


def _lock(name: str) -> asyncio.Lock:
    lock = _locks.get(name)
    if lock is None:
        lock = asyncio.Lock()
        _locks[name] = lock
    return lock


async def _run_job(name: str) -> dict[str, Any]:
    """Run one job with status bookkeeping. Never raises."""
    async with _lock(name):
        job_started(name)
        t0 = time.perf_counter()
        try:
            fn = _job_funcs()[name]
            result = await fn()
            job_finished(name, ok=True, duration_s=time.perf_counter() - t0, result=result)
            return {"ok": True, "result": result}
        except Exception as e:
            logger.exception("worker job %s failed", name)
            job_finished(name, ok=False, duration_s=time.perf_counter() - t0, error=e)
            return {"ok": False, "error": f"{type(e).__name__}: {e}"[:1000]}


def _make_job(name: str) -> Callable[[], Awaitable[None]]:
    async def job() -> None:
        try:
            await _run_job(name)
        except BaseException as e:  # CancelledError on shutdown, etc.
            if isinstance(e, asyncio.CancelledError):
                raise
            logger.exception("unexpected error escaping job %s", name)

    job.__name__ = f"verity_{name}_job"
    return job


def start_scheduler() -> AsyncIOScheduler | None:
    """Start background workers (call from the FastAPI lifespan, inside the event loop)."""
    global _scheduler
    if not settings.workers_enabled:
        logger.info("workers disabled (WORKERS_ENABLED=false); scheduler not started")
        return None
    if _scheduler is not None and _scheduler.running:
        return _scheduler

    sched = AsyncIOScheduler(timezone=timezone.utc)
    now = datetime.now(timezone.utc)
    intervals = _intervals()
    for i, name in enumerate(JOB_NAMES):
        sched.add_job(
            _make_job(name),
            trigger="interval",
            seconds=intervals[name],
            id=name,
            name=name,
            max_instances=1,
            coalesce=True,
            misfire_grace_time=max(5, intervals[name]),
            replace_existing=True,
            next_run_time=now + timedelta(seconds=3 + i * 1.5),  # stagger first runs
        )
    sched.start()
    _scheduler = sched
    logger.info("worker scheduler started: %s", intervals)
    return sched


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is None:
        return
    try:
        if _scheduler.running:
            _scheduler.shutdown(wait=False)
            logger.info("worker scheduler stopped")
    except Exception as e:
        logger.warning("error shutting down scheduler: %s", e)
    finally:
        _scheduler = None


def worker_status() -> dict[str, Any]:
    """Snapshot for /health and /admin."""
    snap = status_snapshot()
    intervals = _intervals()
    running = bool(_scheduler is not None and _scheduler.running)
    jobs: dict[str, Any] = {}
    for name in JOB_NAMES:
        entry = dict(snap.get(name) or {
            "running": False, "runs": 0, "last_run": None, "last_ok": None,
            "last_duration_ms": None, "last_result": None, "last_error": None,
            "last_error_at": None, "error_count": 0, "recent_errors": [],
        })
        entry["interval_secs"] = intervals[name]
        next_run = None
        if running:
            try:
                job = _scheduler.get_job(name)  # type: ignore[union-attr]
                if job is not None and job.next_run_time is not None:
                    next_run = job.next_run_time.astimezone(timezone.utc).isoformat()
            except Exception:
                pass
        entry["next_run"] = next_run
        jobs[name] = entry
    return {"enabled": settings.workers_enabled, "running": running, "jobs": jobs}


async def run_job_now(name: str) -> dict[str, Any]:
    """Run a job immediately (waits for any in-flight run of the same job).

    Returns {"job", "ok", "result"|"error", "status"}. Raises ValueError for unknown names.
    """
    if name not in JOB_NAMES:
        raise ValueError(f"unknown job '{name}'; expected one of {', '.join(JOB_NAMES)}")
    outcome = await _run_job(name)
    return {"job": name, **outcome, "status": worker_status()["jobs"][name]}
