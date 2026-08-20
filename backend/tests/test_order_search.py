"""M4/M7 — order search + published status transitions."""
from __future__ import annotations

PRODUCT = {"sku": "SKU-007", "name": "Widget", "unit_price": 10.0, "current_stock": 5}
CUSTOMER = {"full_name": "Ada", "email": "ada@example.com"}


async def _order_id(api, customer_name=CUSTOMER["full_name"]):
    p = await api.client.post("/products", json=PRODUCT)
    c = await api.client.post(
        "/customers", json={**CUSTOMER, "full_name": customer_name}
    )
    o = await api.client.post(
        "/orders",
        json={
            "customer_id": c.json()["id"],
            "items": [{"product_id": p.json()["id"], "quantity": 1, "unit_price": 10.0}],
        },
    )
    assert o.status_code == 201
    return o.json()["id"]


async def test_search_by_order_number_variants(api):
    oid = await _order_id(api)
    padded = f"#{'ORD-'}{oid:04d}"

    for term in (str(oid), f"{oid:04d}", padded, padded.lstrip("#")):
        r = await api.client.get("/orders", params={"search": term})
        assert r.status_code == 200
        ids = [o["id"] for o in r.json()["items"]]
        assert oid in ids, f"search '{term}' did not find order {oid}"


async def test_search_by_customer_name(api):
    await _order_id(api, customer_name="Grace Hopper")
    r = await api.client.get("/orders", params={"search": "grace"})
    assert r.status_code == 200
    assert r.json()["total"] >= 1


async def test_orders_publish_allowed_transitions(api):
    oid = await _order_id(api)
    r = await api.client.get(f"/orders/{oid}")
    assert r.status_code == 200
    assert set(r.json()["allowed_transitions"]) == {"confirmed", "cancelled"}

    # After confirming, the backend publishes the new legal set.
    await api.client.put(f"/orders/{oid}/status", json={"status": "confirmed"})
    r = await api.client.get(f"/orders/{oid}")
    assert set(r.json()["allowed_transitions"]) == {"shipped", "cancelled"}
