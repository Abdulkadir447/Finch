"""Team model — memberships, roles, invitations (TRD Ch17 §17.7).

The owner can already invite people and assign the five future roles;
enforcement lives in get_current_business (write matrix by path) and in
the owner-only team endpoints. Multi-user identity comes from
TestApi.set_user (no live Clerk needed).
"""

import pytest


async def _owner_business(api):
    api.set_user("owner-a", email="owner@example.com")
    resp = await api.client.get("/auth/me")
    assert resp.status_code == 200
    return resp.json()


async def _invite(api, email, role="sales"):
    resp = await api.client.post("/team/invites", json={"email": email, "role": role})
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.mark.asyncio
async def test_invite_appears_in_auth_me_and_accepts(api):
    await _owner_business(api)
    invite = await _invite(api, "grace@example.com", role="sales")

    # The invitee, before accepting, sees the pending invitation and NO business.
    api.set_user("user-grace", email="grace@example.com")
    me = (await api.client.get("/auth/me")).json()
    assert me["business_id"] is None
    assert me["pending_invitation"]["token"] == invite["token"]
    assert me["pending_invitation"]["role"] == "sales"

    resp = await api.client.post("/team/invites/accept", json={"token": invite["token"]})
    assert resp.status_code == 200, resp.text
    assert resp.json()["role"] == "sales"

    me = (await api.client.get("/auth/me")).json()
    assert me["role"] == "sales"
    assert me["business_id"] is not None  # bound to the inviting tenant
    assert me["business_name"]
    assert me["pending_invitation"] is None


@pytest.mark.asyncio
async def test_accept_rejects_wrong_email(api):
    await _owner_business(api)
    invite = await _invite(api, "right@example.com", role="viewer")

    api.set_user("user-wrong", email="wrong@example.com")
    resp = await api.client.post("/team/invites/accept", json={"token": invite["token"]})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_accept_rejects_revoked_token(api):
    await _owner_business(api)
    invite = await _invite(api, "revoked@example.com", role="viewer")

    await api.client.delete(f"/team/invites/{invite['token']}")
    api.set_user("user-revoked", email="revoked@example.com")
    resp = await api.client.post("/team/invites/accept", json={"token": invite["token"]})
    assert resp.status_code == 400

    # Reusing an accepted token also fails.
    await _owner_business(api)
    invite2 = await _invite(api, "once@example.com", role="viewer")
    api.set_user("user-once", email="once@example.com")
    resp = await api.client.post("/team/invites/accept", json={"token": invite2["token"]})
    assert resp.status_code == 200
    api.set_user("user-once-again", email="once@example.com")
    resp = await api.client.post("/team/invites/accept", json={"token": invite2["token"]})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_invite_duplicate_member_rejected(api):
    await _owner_business(api)
    invite = await _invite(api, "dup@example.com", role="sales")
    api.set_user("user-dup", email="dup@example.com")
    await api.client.post("/team/invites/accept", json={"token": invite["token"]})

    api.set_user("owner-a", email="owner@example.com")
    resp = await api.client.post(
        "/team/invites", json={"email": "dup@example.com", "role": "viewer"}
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_non_owner_cannot_manage_team(api):
    await _owner_business(api)
    invite = await _invite(api, "staff@example.com", role="manager")
    api.set_user("user-staff", email="staff@example.com")
    await api.client.post("/team/invites/accept", json={"token": invite["token"]})

    # Manager reads the roster but cannot invite or change roles.
    resp = await api.client.get("/team")
    assert resp.status_code == 200
    assert any(m["user_id"] == "user-staff" for m in resp.json()["members"])
    resp = await api.client.post(
        "/team/invites", json={"email": "someone@example.com", "role": "viewer"}
    )
    assert resp.status_code == 403
    resp = await api.client.patch(
        "/team/members/user-staff", json={"role": "sales"}
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_owner_changes_role_and_removes_member(api):
    await _owner_business(api)
    invite = await _invite(api, "move@example.com", role="viewer")
    api.set_user("user-move", email="move@example.com")
    await api.client.post("/team/invites/accept", json={"token": invite["token"]})

    api.set_user("owner-a", email="owner@example.com")
    resp = await api.client.patch("/team/members/user-move", json={"role": "inventory"})
    assert resp.status_code == 200
    assert resp.json()["role"] == "inventory"

    resp = await api.client.delete("/team/members/user-move")
    assert resp.status_code == 200

    api.set_user("user-move", email="move@example.com")
    me = (await api.client.get("/auth/me")).json()
    # Removed member falls back to a fresh auto-provisioned business.
    assert me["role"] == "owner"


@pytest.mark.asyncio
async def test_write_matrix_enforced_by_role(api):
    await _owner_business(api)
    sales_invite = await _invite(api, "sales@example.com", role="sales")
    viewer_invite = await _invite(api, "viewer@example.com", role="viewer")

    api.set_user("user-sales", email="sales@example.com")
    await api.client.post("/team/invites/accept", json={"token": sales_invite["token"]})
    api.set_user("user-viewer", email="viewer@example.com")
    await api.client.post("/team/invites/accept", json={"token": viewer_invite["token"]})

    # Viewer: reads pass, every write fails.
    api.set_user("user-viewer", email="viewer@example.com")
    assert (await api.client.get("/products")).status_code == 200
    assert (
        await api.client.post(
            "/products",
            json={"name": "Chair", "sku": "CH1", "unit_price": 50.0, "current_stock": 5},
        )
    ).status_code == 403
    assert (
        await api.client.post("/customers", json={"full_name": "Grace", "email": "g@x.com"})
    ).status_code == 403

    # Sales: customers/orders writable, products read-only.
    api.set_user("user-sales", email="sales@example.com")
    assert (
        await api.client.post("/customers", json={"full_name": "Grace", "email": "g2@x.com"})
    ).status_code == 201
    assert (
        await api.client.post(
            "/products", json={"name": "Desk", "sku": "DK1", "unit_price": 80.0, "current_stock": 3}
        )
    ).status_code == 403


@pytest.mark.asyncio
async def test_member_sees_team_business_data(api):
    await _owner_business(api)
    await api.client.post(
        "/products", json={"name": "Chair", "sku": "CH1", "unit_price": 50.0, "current_stock": 5}
    )
    invite = await _invite(api, "s@example.com", role="inventory")
    api.set_user("user-s", email="s@example.com")
    await api.client.post("/team/invites/accept", json={"token": invite["token"]})

    products = (await api.client.get("/products")).json()
    assert products["items"][0]["sku"] == "CH1"
    state = (await api.client.get("/onboarding/state")).json()
    assert state["has_data"] is True
