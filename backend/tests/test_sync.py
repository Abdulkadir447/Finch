"""Offline sync push — idempotency, reference resolution, operation-based
stock. The server must apply a retried offline batch exactly once (ADR-002).
"""
from __future__ import annotations

from backend import sync
from backend.models import Customer, Product, StockMovement
from sqlalchemy import func, select


def _cust(cid, name="Grace", email="g@x.com"):
    return {"entity": "customer", "client_id": cid, "operation": "create",
            "payload": {"full_name": name, "email": email, "phone": None, "company": None, "address": None}}


def _prod(cid, name="Chair", sku="C1", price=100.0, stock=10):
    return {"entity": "product", "client_id": cid, "operation": "create",
            "payload": {"name": name, "sku": sku, "unit_price": price, "cost_price": None,
                        "current_stock": stock, "reorder_level": 5, "category": None, "description": None}}


def _move(cid, prod_cid, change, reason="correction"):
    return {"entity": "stock_movement", "client_id": cid, "operation": "create",
            "payload": {"product_client_id": prod_cid, "change": change, "reason": reason,
                        "note": None, "order_client_id": None, "applied_at": "2026-08-28T00:00:00"}}


async def _count(db, model, business_id=None):
    q = select(func.count()).select_from(model)
    if business_id is not None:
        q = q.where(model.business_id == business_id)
    return (await db.execute(q)).scalar()


async def test_create_is_idempotent_on_client_id(session_factory):
    async with session_factory() as db:
        biz_id = 999  # any tenant id; apply_push scopes by it
        ops = [_cust("CUST1"), _prod("PROD1")]
        r1 = await sync.apply_push(db, biz_id, ops)
        r2 = await sync.apply_push(db, biz_id, ops)  # retry the same batch
        assert r1["applied"] == 2
        assert r2["applied"] == 0, "a retried create must be a no-op"
        assert r2["skipped"] == 2
        # Same client_id maps to the same server id both times.
        assert r1["ids"]["CUST1"] == r2["ids"]["CUST1"]
        # Exactly one row each, not two.
        assert await _count(db, Customer, biz_id) == 1
        assert await _count(db, Product, biz_id) == 1
        await db.commit()


async def test_update_and_delete_apply(session_factory):
    async with session_factory() as db:
        biz_id = 998
        await sync.apply_push(db, biz_id, [_cust("CUST1", name="Grace")])
        upd = await sync.apply_push(db, biz_id, [
            {"entity": "customer", "client_id": "CUST1", "operation": "update",
             "payload": {"full_name": "Grace H", "email": None, "phone": "555", "company": None, "address": None}},
        ])
        assert upd["applied"] == 1
        row = (await db.execute(select(Customer).where(Customer.business_id == biz_id))).scalars().first()
        assert row.full_name == "Grace H"
        assert row.phone == "555"

        dele = await sync.apply_push(db, biz_id, [
            {"entity": "customer", "client_id": "CUST1", "operation": "delete", "payload": {}},
        ])
        assert dele["applied"] == 1
        row = (await db.execute(select(Customer).where(Customer.business_id == biz_id))).scalars().first()
        assert row.deleted_at is not None, "delete soft-deletes"
        await db.commit()


async def test_stock_movement_applies_change_exactly_once(session_factory):
    async with session_factory() as db:
        biz_id = 997
        await sync.apply_push(db, biz_id, [_prod("PROD1", stock=10)])
        # A -3 movement, pushed twice (retry) must apply only once.
        await sync.apply_push(db, biz_id, [_move("MOVE1", "PROD1", change=-3)])
        await sync.apply_push(db, biz_id, [_move("MOVE1", "PROD1", change=-3)])
        p = (await db.execute(select(Product).where(Product.business_id == biz_id))).scalars().first()
        assert p.current_stock == 7, "the -3 movement must apply exactly once (10 -> 7)"
        moves = (await db.execute(
            select(StockMovement).where(StockMovement.business_id == biz_id))).scalars().all()
        assert len(moves) == 1, "exactly one movement row"
        await db.commit()


async def test_stock_cannot_go_negative(session_factory):
    async with session_factory() as db:
        biz_id = 996
        await sync.apply_push(db, biz_id, [_prod("PROD1", stock=2)])
        r = await sync.apply_push(db, biz_id, [_move("MOVE1", "PROD1", change=-5)])
        assert r["applied"] == 0
        assert r["errors"] and "negative" in r["errors"][0]["error"]
        p = (await db.execute(select(Product).where(Product.business_id == biz_id))).scalars().first()
        assert p.current_stock == 2, "stock unchanged when the movement is refused"
        await db.commit()


async def test_order_resolves_customer_by_client_id(session_factory):
    from backend.models import Order, OrderItem

    async with session_factory() as db:
        biz_id = 995
        r = await sync.apply_push(db, biz_id, [
            _cust("CUST1"),
            _prod("PROD1"),
            {"entity": "order", "client_id": "ORD1", "operation": "create",
             "payload": {"customer_client_id": "CUST1", "status": "pending", "total_amount": 300.0,
                         "order_date": "2026-08-28T12:00:00"}},
            {"entity": "order_item", "client_id": "ORDIT1", "operation": "create",
             "payload": {"order_client_id": "ORD1", "product_client_id": "PROD1",
                         "quantity": 3, "unit_price": 100.0, "total_price": 300.0}},
        ])
        assert r["applied"] == 4, f"expected 4 applied, errors={r['errors']}"
        order = (await db.execute(select(Order).where(Order.business_id == biz_id))).scalars().first()
        assert order.client_id == "ORD1"
        item = (await db.execute(select(OrderItem).where(OrderItem.business_id == biz_id))).scalars().first()
        assert item.order_id == order.id
        assert item.product_id == (await db.execute(
            select(Product).where(Product.business_id == biz_id))).scalars().first().id
        await db.commit()


async def test_sync_push_endpoint_is_idempotent_over_http(api):
    """Full route integration: POST /sync/push applies a batch idempotently,
    including the Pydantic request model + auth + tenant scoping."""
    batch = {
        "operations": [
            {"entity": "customer", "client_id": "HTTPCUST1", "operation": "create",
             "payload": {"full_name": "Http Grace", "email": "h@x.com"}},
            {"entity": "product", "client_id": "HTTPPROD1", "operation": "create",
             "payload": {"name": "Http Chair", "sku": "HC1", "unit_price": 50.0, "current_stock": 5}},
        ]
    }
    r1 = await api.client.post("/sync/push", json=batch)
    assert r1.status_code == 200, r1.text
    assert r1.json()["applied"] == 2
    # Retry the identical batch over HTTP: a no-op.
    r2 = await api.client.post("/sync/push", json=batch)
    assert r2.status_code == 200
    assert r2.json()["applied"] == 0
    assert r2.json()["skipped"] == 2
    # Same client_id -> same server id across both calls.
    assert r1.json()["ids"]["HTTPCUST1"] == r2.json()["ids"]["HTTPCUST1"]


async def test_sync_push_rejects_bad_operation(api):
    r = await api.client.post("/sync/push", json={
        "operations": [
            {"entity": "customer", "client_id": "C1", "operation": "create", "payload": {}},
            {"entity": "customer", "client_id": "C2", "operation": "nonsense", "payload": {}},
        ]
    })
    assert r.status_code == 200
    body = r.json()
    assert body["applied"] == 1
    assert body["errors"] and "nonsense" in body["errors"][0]["error"]


async def test_unknown_reference_is_reported_not_fatal(session_factory):
    async with session_factory() as db:
        biz_id = 994
        r = await sync.apply_push(db, biz_id, [
            {"entity": "order", "client_id": "ORD1", "operation": "create",
             "payload": {"customer_client_id": "DOES_NOT_EXIST", "status": "pending",
                         "total_amount": 1.0, "order_date": None}},
        ])
        assert r["applied"] == 0
        assert r["errors"] and "customer_client_id" in r["errors"][0]["error"]
        await db.commit()


async def test_sync_pull_returns_full_mirror(api):
    """GET /sync/pull returns the full mirror (business + all entities), each
    record carrying id + client_id (null for live-created rows) + a cursor."""
    p = (await api.client.post("/products", json={
        "sku": "P-1", "name": "Chair", "unit_price": 100.0, "current_stock": 10,
    })).json()
    c = (await api.client.post("/customers", json={
        "full_name": "Grace", "email": "g@x.com",
    })).json()
    o = (await api.client.post("/orders", json={
        "customer_id": c["id"],
        "items": [{"product_id": p["id"], "quantity": 2, "unit_price": 100.0}],
    })).json()

    r = await api.client.get("/sync/pull")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["cursor"]
    assert body["business"]["id"] is not None
    assert body["counts"]["products"] == 1
    assert body["counts"]["customers"] == 1
    assert body["counts"]["orders"] == 1
    assert body["counts"]["order_items"] == 1
    assert body["counts"]["stock_movements"] >= 1  # order creation deducts stock
    prod = body["products"][0]
    assert prod["id"] == p["id"]
    assert prod["client_id"] is None  # created live, not offline
    assert prod["sku"] == "P-1"
    order = body["orders"][0]
    assert order["id"] == o["id"]
    assert order["customer_id"] == c["id"]
    assert order["status"] == "pending"


async def test_sync_pull_delta_filters_by_since(api):
    """GET /sync/pull?since=... returns only records updated after the cursor.

    Uses far-past / far-future cursors so the test is deterministic (no
    wall-clock precision dependence)."""
    await api.client.post("/products", json={
        "sku": "P-1", "name": "Chair", "unit_price": 100.0, "current_stock": 10,
    })
    await api.client.post("/customers", json={
        "full_name": "Grace", "email": "g@x.com",
    })

    # Full pull (no since) returns everything.
    full = (await api.client.get("/sync/pull")).json()
    assert full["cursor"]
    assert full["counts"]["products"] == 1
    assert full["counts"]["customers"] == 1

    # Delta with a far-past cursor returns everything (all records are newer).
    past = (await api.client.get("/sync/pull", params={"since": "2000-01-01T00:00:00"})).json()
    assert past["counts"]["products"] == 1
    assert past["counts"]["customers"] == 1

    # Delta with a far-future cursor returns nothing (no records that new).
    future = (await api.client.get("/sync/pull", params={"since": "2999-01-01T00:00:00"})).json()
    assert future["counts"]["products"] == 0
    assert future["counts"]["customers"] == 0
