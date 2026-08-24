"""M9 — every dashboard/inventory surface uses the same low-stock definition.

low  = in stock (current_stock > 0) but at/below the reorder level
out  = current_stock == 0
"""
from __future__ import annotations

PRODUCTS = [
    {"sku": "H-1", "name": "Healthy", "unit_price": 5.0, "current_stock": 10, "reorder_level": 2},
    {"sku": "L-1", "name": "Low", "unit_price": 5.0, "current_stock": 2, "reorder_level": 5},
    {"sku": "O-1", "name": "Out", "unit_price": 5.0, "current_stock": 0, "reorder_level": 5},
]


async def _seed(api):
    for p in PRODUCTS:
        r = await api.client.post("/products", json=p)
        assert r.status_code == 201, r.text


async def test_dashboard_summary_consistency(api):
    await _seed(api)
    r = await api.client.get("/dashboard/summary")
    assert r.status_code == 200
    data = r.json()
    assert data["low_stock_count"] == 1  # only L-1 (O-1 is "out", not "low")
    assert data["out_of_stock_count"] == 1


async def test_inventory_summary_consistency(api):
    await _seed(api)
    r = await api.client.get("/inventory/summary")
    data = r.json()
    assert data["low_stock_count"] == 1
    assert data["out_of_stock_count"] == 1


async def test_dashboard_low_stock_endpoint_consistency(api):
    await _seed(api)
    r = await api.client.get("/dashboard/low-stock")
    assert r.json() == 1


async def test_products_low_stock_filter_consistency(api):
    await _seed(api)
    r = await api.client.get("/products", params={"low_stock": "true"})
    skus = sorted(p["sku"] for p in r.json()["items"])
    assert skus == ["L-1"]
