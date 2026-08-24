"""Order lifecycle — legal/illegal status transitions end to end."""
from __future__ import annotations

PRODUCT = {"sku": "SKU-002", "name": "Gadget", "unit_price": 5.0, "current_stock": 10}
CUSTOMER = {"full_name": "Grace", "email": "grace@example.com"}


async def _create_order(api):
    p = await api.client.post("/products", json=PRODUCT)
    c = await api.client.post("/customers", json=CUSTOMER)
    o = await api.client.post(
        "/orders",
        json={
            "customer_id": c.json()["id"],
            "items": [{"product_id": p.json()["id"], "quantity": 1, "unit_price": 5.0}],
        },
    )
    return o.json()["id"]


async def _status(api, order_id):
    return await api.client.get(f"/orders/{order_id}")


async def test_pending_to_delivered_and_terminal(api):
    oid = await _create_order(api)

    assert (await _status(api, oid)).json()["status"] == "pending"

    # pending -> delivered directly is illegal (must go through confirm/ship).
    assert (await api.client.put(f"/orders/{oid}/status", json={"status": "delivered"})).status_code == 409

    assert (await api.client.put(f"/orders/{oid}/status", json={"status": "confirmed"})).status_code == 200
    assert (await api.client.put(f"/orders/{oid}/status", json={"status": "shipped"})).status_code == 200
    assert (await api.client.put(f"/orders/{oid}/status", json={"status": "delivered"})).status_code == 200

    # delivered is terminal.
    assert (await api.client.put(f"/orders/{oid}/status", json={"status": "cancelled"})).status_code == 409
    assert (await api.client.put(f"/orders/{oid}/status", json={"status": "shipped"})).status_code == 409


async def test_shipped_cannot_be_cancelled(api):
    oid = await _create_order(api)
    await api.client.put(f"/orders/{oid}/status", json={"status": "confirmed"})
    await api.client.put(f"/orders/{oid}/status", json={"status": "shipped"})
    assert (await api.client.put(f"/orders/{oid}/status", json={"status": "cancelled"})).status_code == 409
