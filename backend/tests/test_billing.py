"""Real Billing + Credits — plan state, computed credit balance, and
enforcement at the AI boundary. The ai_usage ledger is the single source of
truth for credits consumed; nothing is stored that can drift.
"""
from __future__ import annotations

import datetime as dt
import json

import pytest

from backend.ai import service as ai_service
from backend.ai.providers.openai import ProviderResult
from backend.models import AiUsage, Business


def _free_summary_body(body):
    assert body["plan"] == "free"
    assert body["granted"] == 25
    assert body["unlimited"] is False
    assert body["payment_connected"] is False
    return body


async def _summary(api):
    r = await api.client.get("/billing/summary")
    assert r.status_code == 200, r.text
    return r.json()


async def _seed_ai_data(api):
    """Give the tenant a product/customer/order so AI requests are admitted."""
    p = (await api.client.post("/products", json={
        "sku": "GAD-1", "name": "Gadget", "unit_price": 5.0, "current_stock": 10,
    })).json()
    c = (await api.client.post("/customers", json={
        "full_name": "Grace", "email": "grace@example.com",
    })).json()
    await api.client.post("/orders", json={
        "customer_id": c["id"],
        "items": [{"product_id": p["id"], "quantity": 4, "unit_price": 5.0}],
    })


def _install_fake(monkeypatch, output_tokens=20):
    class Fake:
        def complete(self, system, messages):
            return ProviderResult(
                text=json.dumps({
                    "type": "answer", "kind": "fact", "title": "t", "message": "m",
                    "basis": {"period": "last_30_days", "sources": ["orders"]},
                    "follow_ups": [], "links": [], "actions": [],
                }),
                input_tokens=100, output_tokens=output_tokens, model="fake-model",
            )
    monkeypatch.setattr(ai_service, "build_provider", lambda model, key: Fake())
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")


# ---------------------------------------------------------------------------
# Plan state
# ---------------------------------------------------------------------------

async def test_free_plan_autoprovisioned_with_allowance(api):
    body = _free_summary_body(await _summary(api))
    assert body["used"] == 0
    assert body["remaining"] == 25
    assert body["period"]["start"] <= body["period"]["end"]
    # The plan catalog is exposed with config-driven allowances.
    plans = {p["key"]: p for p in body["plans"]}
    assert plans["starter"]["credits_per_month"] == 200
    assert plans["enterprise"]["credits_per_month"] is None


async def test_plan_change_is_real_state(api):
    r = await api.client.post("/billing/plan", json={"plan": "starter"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["plan"] == "starter"
    assert body["granted"] == 200
    assert body["remaining"] == 200
    # Persists across requests.
    assert (await _summary(api))["plan"] == "starter"


async def test_plan_change_invalid(api):
    r = await api.client.post("/billing/plan", json={"plan": "platinum"})
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# Credit consumption (ledger = source of truth)
# ---------------------------------------------------------------------------

async def test_ai_chat_consumes_credits(api, monkeypatch):
    _install_fake(monkeypatch)  # 20 output tokens -> 1 credit (within free allowance)
    await _seed_ai_data(api)
    r = await api.client.post("/ai/chat", json={"question": "How are sales?"})
    assert r.status_code == 200, r.text
    body = await _summary(api)
    assert body["used"] == 1
    assert body["remaining"] == 24
    assert body["usage_month"]["requests"] == 1
    assert body["usage_month"]["output_tokens"] == 20


# ---------------------------------------------------------------------------
# Enforcement at the AI boundary
# ---------------------------------------------------------------------------

async def test_insufficient_credits_returns_402(api, session_factory, monkeypatch):
    _install_fake(monkeypatch)
    await _seed_ai_data(api)
    summary = await _summary(api)
    # Find the business (owner of the seeded tenant) and drain the free
    # allowance directly in the ledger: 25 requests x 1 credit.
    from sqlalchemy import select
    async with session_factory() as db:
        biz = (await db.execute(select(Business).where(Business.owner_id == "user-a"))).scalars().first()
        assert biz is not None
        for _ in range(25):
            db.add(AiUsage(business_id=biz.id, model="fake-model",
                           input_tokens=10, output_tokens=10, credits_used=1,
                           answer_kind="fact"))
        await db.commit()

    assert (await _summary(api))["remaining"] == 0

    r = await api.client.post("/ai/chat", json={"question": "How are sales?"})
    assert r.status_code == 402, r.text
    detail = r.json()["detail"]
    assert detail["error"] == "insufficient_credits"
    assert detail["plan"] == "free"
    assert detail["remaining"] == 0
    assert "credits" in detail["message"]

    # No usage was recorded for the rejected request.
    assert (await _summary(api))["used"] == 25


async def test_enterprise_is_unlimited(api, session_factory, monkeypatch):
    _install_fake(monkeypatch)
    await _seed_ai_data(api)
    r = await api.client.post("/billing/plan", json={"plan": "enterprise"})
    assert r.status_code == 200
    assert r.json()["unlimited"] is True
    assert r.json()["remaining"] is None

    # Even a drained month does not block an unlimited plan.
    from sqlalchemy import select
    async with session_factory() as db:
        biz = (await db.execute(select(Business).where(Business.owner_id == "user-a"))).scalars().first()
        for _ in range(5):
            db.add(AiUsage(business_id=biz.id, model="fake-model",
                           input_tokens=10, output_tokens=10, credits_used=1))
        await db.commit()

    r = await api.client.post("/ai/chat", json={"question": "How are sales?"})
    assert r.status_code == 200, r.text


async def test_previous_month_usage_does_not_count(api, session_factory):
    """Allowances refresh on the 1st — last month's usage doesn't reduce
    this month's remaining balance."""
    await _summary(api)  # provision
    from sqlalchemy import select
    today = dt.date.today()
    first_this = today.replace(day=1)
    last_month_day = (first_this - dt.timedelta(days=1))
    async with session_factory() as db:
        biz = (await db.execute(select(Business).where(Business.owner_id == "user-a"))).scalars().first()
        db.add(AiUsage(business_id=biz.id, model="fake-model",
                       input_tokens=10, output_tokens=10, credits_used=25,
                       created_at=dt.datetime.combine(last_month_day, dt.time(12))))
        await db.commit()

    body = await _summary(api)
    assert body["used"] == 0
    assert body["remaining"] == 25


# ---------------------------------------------------------------------------
# Credit math (pure)
# ---------------------------------------------------------------------------

def test_month_bounds():
    from backend.billing import month_bounds
    start, end = month_bounds(dt.date(2026, 8, 28))
    assert start == dt.datetime(2026, 8, 1)
    assert end == dt.datetime(2026, 9, 1)
    start, end = month_bounds(dt.date(2026, 12, 15))
    assert end == dt.datetime(2027, 1, 1)
