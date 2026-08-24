"""M6 — product edit safety: stock and SKU are immutable on update."""
from __future__ import annotations

PRODUCT = {
    "sku": "SKU-042",
    "name": "Widget",
    "unit_price": 10.0,
    "current_stock": 5,
    "reorder_level": 1,
}


async def test_put_cannot_change_stock(api):
    created = await api.client.post("/products", json=PRODUCT)
    pid = created.json()["id"]

    updated = await api.client.put(
        f"/products/{pid}",
        json={"name": "Renamed", "current_stock": 999, "sku": "HACKED"},
    )
    assert updated.status_code == 200
    body = updated.json()
    assert body["name"] == "Renamed"
    assert body["current_stock"] == 5  # unchanged
    assert body["sku"] == "SKU-042"  # SKU immutable


async def test_soft_deleted_sku_is_reusable(api):
    created = await api.client.post("/products", json=PRODUCT)
    assert created.status_code == 201
    pid = created.json()["id"]

    deleted = await api.client.delete(f"/products/{pid}")
    assert deleted.status_code == 204

    recreated = await api.client.post("/products", json=PRODUCT)
    assert recreated.status_code == 201
