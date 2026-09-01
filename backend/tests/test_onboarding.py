"""Onboarding state endpoint — regression test for the F821 scope-lambda bug.

The lint sweep (ruff E/F/W) caught a genuine bug here: the tenant-filter
lambda was written as a bare tuple instead of a parenthesised tuple, so the
endpoint raised NameError and fresh tenants were silently pushed past the
Welcome screen (the frontend defaults to hasData=true on error).

These tests pin the contract: 200 + correct counts for empty and populated
tenants, driven through the real ASGI app with a fake Clerk identity.
"""

import pytest


@pytest.mark.asyncio
async def test_onboarding_state_empty_business(api):
    # get_current_business auto-provisions the tenant on first contact
    resp = await api.client.get("/onboarding/state")
    assert resp.status_code == 200
    assert resp.json() == {"has_data": False, "products": 0, "customers": 0, "orders": 0}


@pytest.mark.asyncio
async def test_onboarding_state_counts_real_data(api):
    # one product + one customer + one order = onboarded
    prod = await api.client.post(
        "/products",
        json={"name": "Chair", "sku": "CH1", "unit_price": 100.0, "current_stock": 5},
    )
    prod_id = prod.json()["id"]
    cust = await api.client.post(
        "/customers", json={"full_name": "Grace Hopper", "email": "grace@example.com"}
    )
    cust_id = cust.json()["id"]
    await api.client.post(
        "/orders",
        json={
            "customer_id": cust_id,
            "status": "delivered",
            "items": [{"product_id": prod_id, "quantity": 2, "unit_price": 100.0}],
        },
    )

    resp = await api.client.get("/onboarding/state")
    assert resp.status_code == 200
    body = resp.json()
    assert body["has_data"] is True
    assert body["products"] == 1
    assert body["customers"] == 1
    assert body["orders"] == 1


@pytest.mark.asyncio
async def test_onboarding_state_is_tenant_scoped(api):
    """Two identities must never see each other's counts."""
    api.set_user("user-a")
    await api.client.post(
        "/products", json={"name": "Chair", "sku": "CH1", "unit_price": 50.0, "current_stock": 5}
    )
    api.set_user("user-b")
    resp = await api.client.get("/onboarding/state")
    assert resp.status_code == 200
    assert resp.json()["has_data"] is False
