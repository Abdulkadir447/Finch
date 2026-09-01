"""Rate limiting for /ai/chat (hardening backlog).

Unit tests drive the limiter directly (injectable clock, no server); the
route-level tests prove the 429 path by monkey-patching the process-wide
limiter with one that refuses everything.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from backend.ai.ratelimit import SlidingWindowRateLimiter


class _FakeClock:
    def __init__(self) -> None:
        self.now = 1_000.0

    def __call__(self) -> float:
        return self.now


def test_allows_up_to_the_limit_then_rejects():
    clock = _FakeClock()
    limiter = SlidingWindowRateLimiter(requests=3, window_seconds=60, now_fn=clock)
    for _ in range(3):
        limiter.check("business:1")  # no raise
    with pytest.raises(HTTPException) as exc:
        limiter.check("business:1")
    assert exc.value.status_code == 429
    assert exc.value.headers is not None
    assert int(exc.value.headers["Retry-After"]) >= 1


def test_window_expiry_allows_again():
    clock = _FakeClock()
    limiter = SlidingWindowRateLimiter(requests=1, window_seconds=10, now_fn=clock)
    limiter.check("business:1")
    with pytest.raises(HTTPException):
        limiter.check("business:1")
    clock.now += 10.1  # the old hit slides out of the window
    limiter.check("business:1")  # no raise


def test_keys_are_independent_per_tenant():
    clock = _FakeClock()
    limiter = SlidingWindowRateLimiter(requests=1, window_seconds=60, now_fn=clock)
    limiter.check("business:1")
    limiter.check("business:2")  # unaffected by business:1's hit
    with pytest.raises(HTTPException):
        limiter.check("business:1")


def test_zero_requests_disables_limiting():
    limiter = SlidingWindowRateLimiter(requests=0, window_seconds=60)
    for _ in range(100):
        limiter.check("business:1")  # never raises


def test_reset_clears_all_windows():
    limiter = SlidingWindowRateLimiter(requests=1, window_seconds=60)
    limiter.check("business:1")
    with pytest.raises(HTTPException):
        limiter.check("business:1")
    limiter.reset()
    limiter.check("business:1")  # no raise


class _RefusingLimiter:
    """Stands in for the process limiter in route tests: always 429."""

    def __init__(self) -> None:
        self.checks = 0

    def check(self, key: str) -> None:
        self.checks += 1
        raise HTTPException(status_code=429, detail="rate limited", headers={"Retry-After": "7"})


@pytest.mark.asyncio
async def test_ai_chat_returns_429_when_the_limiter_refuses(api, monkeypatch):
    refuser = _RefusingLimiter()
    monkeypatch.setattr("backend.ai.ratelimit._limiter", refuser)
    resp = await api.client.post("/ai/chat", json={"question": "hello"})
    assert resp.status_code == 429
    assert resp.headers["retry-after"] == "7"
    assert refuser.checks == 1
