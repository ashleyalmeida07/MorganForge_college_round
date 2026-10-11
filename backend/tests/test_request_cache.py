"""ChainClient.list_requests: one shared getProgramAccounts for every status the workers ask for."""
import asyncio
import time

from app.chain.client import ChainClient
from app.config import settings

ROWS = [
    {"pda": "b", "status": "Claimed", "created_at": 2, "id": 2},
    {"pda": "a", "status": "Open", "created_at": 1, "id": 1},
    {"pda": "c", "status": "Open", "created_at": 3, "id": 3},
]


def _client(monkeypatch) -> tuple[ChainClient, list[int]]:
    chain = ChainClient("http://127.0.0.1:1", settings.program_id)
    calls: list[int] = []

    async def fake_program_accounts(name, extra=()):
        assert name == "Request" and not extra
        calls.append(1)
        await asyncio.sleep(0.01)
        return [dict(r) for r in ROWS]

    monkeypatch.setattr(chain, "_program_accounts", fake_program_accounts)
    return chain, calls


def test_statuses_share_one_fetch_and_filter_locally(monkeypatch):
    monkeypatch.setattr(settings, "request_cache_secs", 60.0)
    chain, calls = _client(monkeypatch)

    async def tick():
        return await asyncio.gather(
            chain.list_requests("Open"), chain.list_requests("Claimed"), chain.list_requests("Disputed")
        )

    open_, claimed, disputed = asyncio.run(tick())
    assert [r["pda"] for r in open_] == ["a", "c"], "filtered by status, sorted by creation"
    assert [r["pda"] for r in claimed] == ["b"] and disputed == []
    assert len(calls) == 1, "concurrent callers share one in-flight fetch"

    asyncio.run(chain.list_requests())
    assert len(calls) == 1, "served from cache within the TTL"

    open_[0]["status"] = "mutated"
    assert asyncio.run(chain.list_requests("Open"))[0]["status"] == "Open", "callers get copies"


def test_cache_expires(monkeypatch):
    monkeypatch.setattr(settings, "request_cache_secs", 60.0)
    chain, calls = _client(monkeypatch)
    asyncio.run(chain.list_requests("Open"))
    chain._requests_cache = (time.monotonic() - 61, chain._requests_cache[1])
    asyncio.run(chain.list_requests("Open"))
    assert len(calls) == 2

    monkeypatch.setattr(settings, "request_cache_secs", 0.0)
    asyncio.run(chain.list_requests("Open"))
    asyncio.run(chain.list_requests("Open"))
    assert len(calls) == 4, "request_cache_secs=0 disables caching"
