"""Co-op sync — server side of offline push (OFFLINE 3, one-way first).

Applies a batch of client-originated operations idempotently (ADR-002):

  * Every operation carries the entity's ``client_id`` (a client-generated
    ULID) as its idempotency key.
  * A ``create`` whose client_id already exists is a no-op that returns the
    existing server id — a retried offline write applies exactly once.
  * Stock is synced as an OPERATION (a signed movement), never as a final
    value; the movement is applied at most once (keyed by client_id), and the
    server re-validates rather than trusting the offline client.

Reference resolution: offline rows reference other entities by client_id
(e.g. an order's ``customer_client_id``). The server maps each client_id to
its server id before applying.
"""
from __future__ import annotations

from datetime import datetime
import re
from typing import Any, Optional

from sqlalchemy import select

from .models import (
    Customer,
    Order,
    OrderItem,
    OrderStatus,
    Product,
    StockMovement,
    StockMovementReason,
)

_VALID_REASONS = {r.value for r in StockMovementReason}

# Single source of truth for the order status machine. main.py's live
# /orders/{id}/status route and this sync path both validate against it.
ALLOWED_ORDER_TRANSITIONS: dict[str, set[str]] = {
    "pending": {"confirmed", "cancelled"},
    "confirmed": {"shipped", "cancelled"},
    "shipped": {"delivered"},
    "delivered": set(),
    "cancelled": set(),
}


class SyncError(ValueError):
    """Raised for an operation the server refuses (bad entity, missing ref).

    A plain SyncError is a TRANSIENT/unexpected failure — the op goes to the
    queue's 'failed' state and is retried. A SyncConflict (below) is a
    semantic collision with cloud state — retrying can't fix it; the op goes
    to the queue's 'conflict' state and waits for OFFLINE 5 resolution.
    """


class SyncConflict(SyncError):
    """The operation collided with current cloud state.

    Carries the structured information the local queue keeps and OFFLINE 5's
    resolution UI will show: the reason code, the local attempted values,
    and the current server values (where safe to expose).

    Reason codes:
      email_conflict     — the email is owned by a DIFFERENT customer
      sku_conflict       — the SKU is owned by a DIFFERENT product
      not_found          — the op targets a client_id with no server row
      invalid_transition — order status jump not in ALLOWED_ORDER_TRANSITIONS
      insufficient_stock — applying the movement would drive stock negative
    """

    def __init__(
        self,
        message: str,
        reason: str,
        entity: str,
        client_id: Optional[str],
        local: Optional[dict] = None,
        server: Optional[dict] = None,
    ):
        super().__init__(message)
        self.reason = reason
        self.entity = entity
        self.client_id = client_id
        self.local = local or {}
        self.server = server


# ---------------------------------------------------------------------------
# Uniqueness pre-checks (mirror the partial unique indexes, per business,
# live rows only — the same scope the DB constraint enforces).
# ---------------------------------------------------------------------------

async def _email_owner(db, business_id: int, email: Optional[str]):
    """The LIVE customer owning this email in the business, if any."""
    if not email:
        return None
    row = (await db.execute(
        select(Customer.id, Customer.client_id, Customer.full_name, Customer.email)
        .where(
            Customer.business_id == business_id,
            Customer.deleted_at.is_(None),
            Customer.email == email,
        )
    )).first()
    return row


def _customer_snapshot(row) -> dict:
    return {"id": row.id, "client_id": row.client_id, "full_name": row.full_name, "email": row.email}


async def _sku_owner(db, business_id: int, sku: Optional[str]):
    """The LIVE product owning this SKU in the business, if any."""
    if not sku:
        return None
    row = (await db.execute(
        select(Product.id, Product.client_id, Product.name, Product.sku)
        .where(
            Product.business_id == business_id,
            Product.deleted_at.is_(None),
            Product.sku == sku,
        )
    )).first()
    return row


def _product_snapshot(row) -> dict:
    return {"id": row.id, "client_id": row.client_id, "name": row.name, "sku": row.sku}


async def _resolve_client_id(db, model, client_id: str) -> Optional[int]:
    if not client_id:
        return None
    row = (
        await db.execute(select(model.id).where(model.client_id == client_id))
    ).scalars().first()
    return row


async def apply_push(db, business_id: int, operations: list[dict[str, Any]]) -> dict[str, Any]:
    """Apply a batch of client operations idempotently. Returns a summary.

    Every op resolves to exactly one outcome (OFFLINE 4):
      * applied  — a write happened                          (counted in applied)
      * skipped  — already applied (idempotent no-op)        (counted in skipped, id in ids)
      * conflict — collides with cloud state; retrying can't
                   fix it; the structured entry (reason, local, server)
                   is returned so the queue can hold it for resolution
      * failed   — transient/unexpected refusal (retryable)
    """
    applied = 0
    skipped = 0
    ids: dict[str, int] = {}
    conflicts: list[dict[str, Any]] = []
    failed: list[dict[str, str]] = []

    # Dependency-safe ordering: customers & products first (referenced), then
    # orders, order items, and stock movements.
    def _order(entity: str) -> int:
        return {
            "customer": 0,
            "product": 1,
            "order": 2,
            "order_item": 3,
            "stock_movement": 4,
        }.get(entity, 99)

    for op in sorted(operations, key=lambda o: _order(o.get("entity", ""))):
        entity = op.get("entity")
        client_id = op.get("client_id")
        operation = op.get("operation")
        payload = op.get("payload") or {}
        try:
            if entity == "customer":
                server_id, created = await _apply_customer(db, business_id, client_id, operation, payload)
            elif entity == "product":
                server_id, created = await _apply_product(db, business_id, client_id, operation, payload)
            elif entity == "order":
                server_id, created = await _apply_order(db, business_id, client_id, operation, payload)
            elif entity == "order_item":
                server_id, created = await _apply_order_item(db, business_id, client_id, operation, payload)
            elif entity == "stock_movement":
                server_id, created = await _apply_stock_movement(db, business_id, client_id, operation, payload)
            else:
                raise SyncError(f"Unknown entity: {entity}")
        except SyncConflict as c:
            conflicts.append({
                "operation_id": op.get("operation_id"),
                "entity": c.entity or entity or "",
                "client_id": c.client_id or client_id or "",
                "reason": c.reason,
                "error": str(c),
                "local": c.local,
                "server": c.server,
            })
            continue
        except SyncError as e:
            failed.append({"client_id": client_id or "", "entity": entity or "", "error": str(e)})
            continue
        # Success path: applied or idempotent-skip.
        if created:
            applied += 1
        else:
            skipped += 1
        if server_id is not None and client_id:
            ids[client_id] = server_id

    return {
        "applied": applied,
        "skipped": skipped,
        "ids": ids,
        "conflicts": conflicts,
        "failed": failed,
        # Back-compat alias for pre-OFFLINE 4 consumers (renderer queue
        # marking, older tests): transient failures.
        "errors": failed,
    }


# ---------------------------------------------------------------------------
# Per-entity application
# ---------------------------------------------------------------------------

async def _apply_customer(db, business_id, client_id, operation, payload):
    existing_id = await _resolve_client_id(db, Customer, client_id)
    if existing_id is not None:
        if operation == "update":
            c = (await db.execute(select(Customer).where(Customer.id == existing_id))).scalars().first()
            new_email = payload.get("email")
            if new_email is not None and new_email != c.email:
                owner = await _email_owner(db, business_id, new_email)
                if owner is not None and owner.id != existing_id:
                    # Another customer already owns this email. Never
                    # silently overwrite it and never auto-merge — the op
                    # conflicts and waits for resolution (OFFLINE 5).
                    raise SyncConflict(
                        f"customer {client_id}: email {new_email!r} belongs to customer {owner.id}",
                        reason="email_conflict", entity="customer", client_id=client_id,
                        local={"email": new_email, "full_name": payload.get("full_name")},
                        server=_customer_snapshot(owner),
                    )
            for f in ("full_name", "email", "phone", "company", "address"):
                if payload.get(f) is not None:
                    setattr(c, f, payload[f])
            await db.flush()
            return existing_id, True
        if operation == "delete":
            c = (await db.execute(select(Customer).where(Customer.id == existing_id))).scalars().first()
            c.deleted_at = datetime.utcnow()
            await db.flush()
            return existing_id, True
        return existing_id, False  # retried create -> idempotent no-op
    if operation != "create":
        raise SyncConflict(
            f"customer {client_id}: operation {operation} without an existing row",
            reason="not_found", entity="customer", client_id=client_id,
            local={"operation": operation},
        )
    name = payload.get("full_name") or "Unknown"
    email = payload.get("email")
    if email:
        # A DIFFERENT customer already owns this email -> conflict. (An exact
        # NAME match is NOT identity: same name, different email is simply a
        # different customer and is created as such — never auto-merged.)
        owner = await _email_owner(db, business_id, email)
        if owner is not None:
            raise SyncConflict(
                f"customer {client_id}: email {email!r} already belongs to customer {owner.id}",
                reason="email_conflict", entity="customer", client_id=client_id,
                local={"email": email, "full_name": name},
                server=_customer_snapshot(owner),
            )
    else:
        # The local layer allows email-less customers; the server requires an
        # email, so derive a stable placeholder (as the importer does) rather
        # than failing the sync.
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:24] or "customer"
        email = f"{slug}-{client_id[-6:].lower()}@coop.local"
    c = Customer(
        business_id=business_id,
        client_id=client_id,
        full_name=name,
        email=email,
        phone=payload.get("phone"),
        company=payload.get("company"),
        address=payload.get("address"),
        created_by="offline-sync",
    )
    db.add(c)
    await db.flush()
    return c.id, True


async def _apply_product(db, business_id, client_id, operation, payload):
    existing_id = await _resolve_client_id(db, Product, client_id)
    if existing_id is not None:
        if operation == "update":
            p = (await db.execute(select(Product).where(Product.id == existing_id))).scalars().first()
            new_sku = payload.get("sku")
            if new_sku is not None and new_sku != p.sku:
                owner = await _sku_owner(db, business_id, new_sku)
                if owner is not None and owner.id != existing_id:
                    # Another product owns this SKU. Never silently replace
                    # the server's SKU mapping — conflict for resolution.
                    raise SyncConflict(
                        f"product {client_id}: sku {new_sku!r} belongs to product {owner.id}",
                        reason="sku_conflict", entity="product", client_id=client_id,
                        local={"sku": new_sku, "name": payload.get("name")},
                        server=_product_snapshot(owner),
                    )
            for f in ("name", "sku", "category", "description", "unit_price", "cost_price", "reorder_level"):
                if payload.get(f) is not None:
                    setattr(p, f, payload[f])
            await db.flush()
            return existing_id, True
        if operation == "delete":
            p = (await db.execute(select(Product).where(Product.id == existing_id))).scalars().first()
            p.deleted_at = datetime.utcnow()
            await db.flush()
            return existing_id, True
        return existing_id, False  # retried create -> idempotent no-op
    if operation != "create":
        raise SyncConflict(
            f"product {client_id}: operation {operation} without an existing row",
            reason="not_found", entity="product", client_id=client_id,
            local={"operation": operation},
        )
    new_sku = payload.get("sku")
    if new_sku:
        owner = await _sku_owner(db, business_id, new_sku)
        if owner is not None:
            raise SyncConflict(
                f"product {client_id}: sku {new_sku!r} already belongs to product {owner.id}",
                reason="sku_conflict", entity="product", client_id=client_id,
                local={"sku": new_sku, "name": payload.get("name")},
                server=_product_snapshot(owner),
            )
    p = Product(
        business_id=business_id,
        client_id=client_id,
        name=payload.get("name") or "Unknown",
        sku=new_sku,
        category=payload.get("category"),
        description=payload.get("description"),
        unit_price=payload.get("unit_price") or 0.0,
        cost_price=payload.get("cost_price"),
        current_stock=payload.get("current_stock") or 0,
        reorder_level=payload.get("reorder_level") or 0,
        created_by="offline-sync",
    )
    db.add(p)
    await db.flush()
    return p.id, True


async def _apply_order(db, business_id, client_id, operation, payload):
    existing_id = await _resolve_client_id(db, Order, client_id)
    if existing_id is not None:
        if operation == "update":
            # Offline status changes (v1 offline boundary includes order
            # status changes). The transition is validated against the SAME
            # machine the live route uses. Stock for a cancellation arrives
            # as its own stock_movement operation (ADR-002 rule 5 — stock
            # syncs as operations), so it is applied exactly once there and
            # never re-restored here (no double restore).
            order = (await db.execute(select(Order).where(Order.id == existing_id))).scalars().first()
            current = order.status.value if hasattr(order.status, "value") else str(order.status)
            requested = payload.get("status")
            if not requested or requested == current:
                return existing_id, False  # idempotent no-op (retried op)
            if requested not in ALLOWED_ORDER_TRANSITIONS.get(current, set()):
                # A stale/invalid transition (the cloud moved on, or the op
                # skips a step) is a CONFLICT, not a transient failure:
                # re-pushing the same op will keep failing identically.
                raise SyncConflict(
                    f"order {client_id}: cannot transition from '{current}' to '{requested}'",
                    reason="invalid_transition", entity="order", client_id=client_id,
                    local={"status": requested},
                    server={"id": order.id, "status": current},
                )
            order.status = OrderStatus(requested)
            await db.flush()
            return existing_id, True
        return existing_id, False  # retried create -> idempotent no-op
    if operation != "create":
        raise SyncConflict(
            f"order {client_id}: operation {operation} without an existing row",
            reason="not_found", entity="order", client_id=client_id,
            local={"operation": operation},
        )
    customer_id = await _resolve_client_id(db, Customer, payload.get("customer_client_id"))
    if customer_id is None:
        raise SyncConflict(
            f"order {client_id}: unknown customer_client_id {payload.get('customer_client_id')!r}",
            reason="not_found", entity="order", client_id=client_id,
            local={"customer_client_id": payload.get("customer_client_id")},
        )
    status = payload.get("status") or "pending"
    if status not in {s.value for s in OrderStatus}:
        raise SyncError(f"order {client_id}: invalid status {status}")
    o = Order(
        business_id=business_id,
        client_id=client_id,
        customer_id=customer_id,
        status=OrderStatus(status),
        total_amount=payload.get("total_amount") or 0.0,
        order_date=_parse_dt(payload.get("order_date")),
        created_by="offline-sync",
    )
    db.add(o)
    await db.flush()
    return o.id, True


async def _apply_order_item(db, business_id, client_id, operation, payload):
    existing_id = await _resolve_client_id(db, OrderItem, client_id)
    if existing_id is not None:
        return existing_id, False
    if operation != "create":
        raise SyncError(f"order_item {client_id}: operation {operation} without an existing row")
    order_id = await _resolve_client_id(db, Order, payload.get("order_client_id"))
    product_id = await _resolve_client_id(db, Product, payload.get("product_client_id"))
    if order_id is None:
        raise SyncConflict(
            f"order_item {client_id}: unknown order_client_id {payload.get('order_client_id')!r}",
            reason="not_found", entity="order_item", client_id=client_id,
            local={"order_client_id": payload.get("order_client_id")},
        )
    if product_id is None:
        raise SyncConflict(
            f"order_item {client_id}: unknown product_client_id {payload.get('product_client_id')!r}",
            reason="not_found", entity="order_item", client_id=client_id,
            local={"product_client_id": payload.get("product_client_id")},
        )
    qty = payload.get("quantity") or 0
    price = payload.get("unit_price") or 0.0
    it = OrderItem(
        business_id=business_id,
        client_id=client_id,
        order_id=order_id,
        product_id=product_id,
        quantity=qty,
        unit_price=price,
        total_price=payload.get("total_price") or qty * price,
        created_by="offline-sync",
    )
    db.add(it)
    await db.flush()
    return it.id, True


async def _apply_stock_movement(db, business_id, client_id, operation, payload):
    """Apply a stock movement at most once (keyed by client_id). The signed
    change updates product.current_stock; the server never trusts a final
    value from the client."""
    existing_id = await _resolve_client_id(db, StockMovement, client_id)
    if existing_id is not None:
        return existing_id, False  # idempotent: the change is applied exactly once
    if operation != "create":
        raise SyncError(f"stock_movement {client_id}: operation {operation} without an existing row")
    product_id = await _resolve_client_id(db, Product, payload.get("product_client_id"))
    if product_id is None:
        raise SyncConflict(
            f"stock_movement {client_id}: unknown product_client_id {payload.get('product_client_id')!r}",
            reason="not_found", entity="stock_movement", client_id=client_id,
            local={"product_client_id": payload.get("product_client_id")},
        )
    change = int(payload.get("change") or 0)
    reason = payload.get("reason") or "correction"
    if reason not in _VALID_REASONS:
        raise SyncError(f"stock_movement {client_id}: invalid reason {reason}")
    p = (await db.execute(select(Product).where(Product.id == product_id))).scalars().first()
    new_stock = (p.current_stock or 0) + change
    if new_stock < 0:
        # Server re-validation (ADR-002 rule 7): refuse to drive stock
        # negative. This is a collision with the cloud's CURRENT stock (the
        # offline write assumed a different level) -> conflict, and the
        # movement is NOT applied (exactly-once is preserved: a retry after
        # a real restock can still apply it once).
        raise SyncConflict(
            f"stock_movement {client_id}: would drive stock negative ({new_stock})",
            reason="insufficient_stock", entity="stock_movement", client_id=client_id,
            local={"change": change, "reason": reason},
            server={"product_id": product_id, "current_stock": p.current_stock or 0},
        )
    p.current_stock = new_stock
    mv = StockMovement(
        business_id=business_id,
        product_id=product_id,
        change=change,
        reason=StockMovementReason(reason),
        note=payload.get("note"),
        client_id=client_id,
        actor="offline-sync",
    )
    db.add(mv)
    await db.flush()
    return mv.id, True


def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return datetime.utcnow()
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return datetime.utcnow()
