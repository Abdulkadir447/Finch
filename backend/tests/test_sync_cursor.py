"""OFFLINE 6 — regression tests for the E2E-discovered sync data-loss bugs.

Two bugs the real-runtime E2E (electron/e2e) exposed:

1. Cross-reference resolution (``_resolve_ref``): a cloud-mirrored row has a
   SERVER id but no client_id. A locally-created op that references such a
   row must resolve it via ``*_server_id`` (tenant-scoped), not only via
   ``*_client_id``. Previously the push failed with "unknown reference".

2. Same-second delta cursor (pull ``>=`` + second-precision cursor): on
   SQLite (second-precision CURRENT_TIMESTAMP) a strict ``>`` delta with a
   microsecond cursor silently drops any row whose timestamp equals the
   cursor's second, losing it from every future delta. The fix makes deltas
   at-least-once (``>=``) with a second-precision, monotone cursor.
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy import select

from backend import sync
from backend.models import Business, Customer, Order, Product


# ---------------------------------------------------------------------------
# Cross-reference resolution (client_id OR server_id, tenant-scoped)
# ---------------------------------------------------------------------------

async def test_order_create_resolves_cloud_customer_by_server_id(session_factory, api):
    """A locally-created order referencing a CLOUD customer (no client_id)
    resolves the customer via its server id (tenant-scoped)."""
    biz_id = 950
    cust_id = 9500
    async with session_factory() as db:
        # A cloud-native customer: server id, but NO client_id (created live,
        # not via offline push).
        db.add(
            Customer(
                business_id=biz_id,
                full_name="Cloud Cust",
                email="cc@x.com",
                client_id=None,
            )
        )
        await db.flush()
        await db.commit()
        cust_server_id = cust_id  # we set the id explicitly below

    # Give the customer a known server id.
    async with session_factory() as db:
        c = (await db.execute(
            select(Customer).where(Customer.business_id == biz_id)
        )).scalars().first()
        cust_server_id = c.id

    r = await _push_order_via_server_id(session_factory, biz_id, cust_server_id)
    assert r["applied"] == 1, f"order via customer_server_id must apply: {r}"
    assert r["conflicts"] == []

    async with session_factory() as db:
        o = (await db.execute(
            select(Order).where(Order.business_id == biz_id, Order.client_id == "ORD-SRV")
        )).scalars().first()
        assert o is not None, "the order must be created"
        assert o.customer_id == cust_server_id
        await db.commit()


async def _push_order_via_server_id(session_factory, biz_id: int, cust_server_id: int) -> dict:
    ops = [{
        "entity": "order", "client_id": "ORD-SRV", "operation": "create",
        "payload": {
            "customer_server_id": cust_server_id,  # cloud customer, no client_id
            "status": "pending", "total_amount": 100.0, "order_date": "2026-08-28T12:00:00",
        },
    }]
    async with session_factory() as db:
        r = await sync.apply_push(db, biz_id, ops)
        await db.commit()
        return r


async def test_server_id_resolution_is_tenant_scoped(session_factory, api):
    """A customer_server_id from ANOTHER business must NOT resolve (it is a
    miss, not a resolution) — the reference stays tenant-scoped."""
    biz_id = 960
    other_biz_id = 961
    async with session_factory() as db:
        other_cust = Customer(business_id=other_biz_id, full_name="Other", email="o@x.com")
        db.add(other_cust)
        await db.flush()
        other_cust_id = other_cust.id
        await db.commit()

    # An order in biz 960 referencing biz 961's customer by server id must
    # NOT resolve (tenant-scoped) -> not_found conflict.
    ops = [{
        "entity": "order", "client_id": "ORD-CROSS", "operation": "create",
        "payload": {
            "customer_server_id": other_cust_id,
            "status": "pending", "total_amount": 1.0, "order_date": "2026-08-28T12:00:00",
        },
    }]
    async with session_factory() as db:
        r = await sync.apply_push(db, biz_id, ops)
        await db.commit()
    assert r["applied"] == 0
    assert len(r["conflicts"]) == 1
    assert r["conflicts"][0]["reason"] == "not_found"


# ---------------------------------------------------------------------------
# Same-second delta cursor (at-least-once, second-precision cursor)
# ---------------------------------------------------------------------------

async def test_delta_cursor_is_second_precision_and_at_least_once(session_factory, api):
    """The pull cursor is second-precision and monotone non-decreasing, and
    the ``>=`` delta is at-least-once: a row touched in the SAME second as
    the cursor is re-delivered (never lost). On SQLite (second-precision
    CURRENT_TIMESTAMP) a strict ``>`` with a microsecond cursor would drop a
    same-second row from every future delta — the E2E data-loss bug."""
    await _seed_minimal(api)
    c1 = (await api.client.get("/sync/pull")).json()["cursor"]
    c1_dt = dt.datetime.fromisoformat(c1)
    assert c1_dt.microsecond == 0, "cursor must be second-precision"

    # Touch a row at EXACTLY the cursor's second, then delta-pull with
    # since=cursor: the row (updated_at == cursor's second) must be included
    # (>=, at-least-once), not lost.
    async with session_factory() as db:
        biz_id = await _biz_id_from(db)
        p = (
            (await db.execute(select(Product).where(Product.business_id == biz_id)))
            .scalars()
            .first()
        )
        p.updated_at = c1_dt  # same second as the cursor
        await db.commit()

    r = await api.client.get("/sync/pull", params={"since": c1})
    body = r.json()
    c2 = dt.datetime.fromisoformat(body["cursor"])
    assert c2.microsecond == 0, "cursor must stay second-precision"
    assert c2 >= c1_dt, "cursor must be monotone non-decreasing"
    assert body["counts"]["products"] >= 1, "a same-second update must be re-delivered (>=)"


async def _seed_minimal(api):
    await api.client.post(
        "/products",
        json={"sku": "CH1", "name": "Chair", "unit_price": 100.0, "current_stock": 5},
    )
    await api.client.post("/customers", json={"full_name": "Grace", "email": "g@x.com"})


async def _biz_id_from(db) -> int:
    b = (await db.execute(select(Business).where(Business.owner_id == "user-a"))).scalars().first()
    return b.id
