"""H2 — customer email uniqueness is tenant-scoped and live-row-only.

A soft-deleted customer's email must be reusable, exactly like the SKU rule
for products, while two LIVE customers in the same business cannot share it.
"""
from __future__ import annotations

CUSTOMER = {
    "full_name": "Ada Lovelace",
    "email": "ada@example.com",
    "company": "Analytical Engines",
}


async def test_duplicate_live_email_conflicts(api):
    first = await api.client.post("/customers", json=CUSTOMER)
    assert first.status_code == 201

    dup = await api.client.post("/customers", json=CUSTOMER)
    assert dup.status_code == 409
    assert "already exists" in dup.json()["detail"].lower()


async def test_recreate_after_soft_delete(api):
    created = await api.client.post("/customers", json=CUSTOMER)
    assert created.status_code == 201
    customer_id = created.json()["id"]

    deleted = await api.client.delete(f"/customers/{customer_id}")
    assert deleted.status_code == 204

    # The email is reusable now that the record is soft-deleted.
    recreated = await api.client.post("/customers", json=CUSTOMER)
    assert recreated.status_code == 201

    # Only the live record shows up in listings.
    listing = await api.client.get("/customers")
    emails = [c["email"] for c in listing.json()["items"]]
    assert emails == ["ada@example.com"]


async def test_email_reuse_is_tenant_scoped(api):
    api.set_user("user-a")
    a = await api.client.post("/customers", json=CUSTOMER)
    assert a.status_code == 201

    # A different business can use the same email.
    api.set_user("user-b")
    b = await api.client.post("/customers", json=CUSTOMER)
    assert b.status_code == 201
