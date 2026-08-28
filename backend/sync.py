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


class SyncError(ValueError):
    """Raised for an operation the server refuses (bad entity, missing ref)."""


async def _resolve_client_id(db, model, client_id: str) -> Optional[int]:
    if not client_id:
        return None
    row = (
        await db.execute(select(model.id).where(model.client_id == client_id))
    ).scalars().first()
    return row


async def apply_push(db, business_id: int, operations: list[dict[str, Any]]) -> dict[str, Any]:
    """Apply a batch of client operations idempotently. Returns a summary."""
    applied = 0
    skipped = 0
    ids: dict[str, int] = {}
    errors: list[dict[str, str]] = []

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

            # "created" == a write happened. A retried create (client_id already
            # exists) is a no-op -> skipped, which is what makes retries safe.
            if created:
                applied += 1
            else:
                skipped += 1
            if server_id is not None and client_id:
                ids[client_id] = server_id
        except SyncError as e:
            errors.append({"client_id": client_id or "", "entity": entity or "", "error": str(e)})
            skipped += 1

    return {"applied": applied, "skipped": skipped, "ids": ids, "errors": errors}


# ---------------------------------------------------------------------------
# Per-entity application
# ---------------------------------------------------------------------------

async def _apply_customer(db, business_id, client_id, operation, payload):
    existing_id = await _resolve_client_id(db, Customer, client_id)
    if existing_id is not None:
        if operation == "update":
            c = (await db.execute(select(Customer).where(Customer.id == existing_id))).scalars().first()
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
        raise SyncError(f"customer {client_id}: operation {operation} without an existing row")
    name = payload.get("full_name") or "Unknown"
    email = payload.get("email")
    if not email:
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
        raise SyncError(f"product {client_id}: operation {operation} without an existing row")
    p = Product(
        business_id=business_id,
        client_id=client_id,
        name=payload.get("name") or "Unknown",
        sku=payload.get("sku"),
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
        return existing_id, False  # idempotent: an order is applied once
    if operation != "create":
        raise SyncError(f"order {client_id}: operation {operation} without an existing row")
    customer_id = await _resolve_client_id(db, Customer, payload.get("customer_client_id"))
    if customer_id is None:
        raise SyncError(f"order {client_id}: unknown customer_client_id")
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
        raise SyncError(f"order_item {client_id}: unknown order_client_id")
    if product_id is None:
        raise SyncError(f"order_item {client_id}: unknown product_client_id")
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
        raise SyncError(f"stock_movement {client_id}: unknown product_client_id")
    change = int(payload.get("change") or 0)
    reason = payload.get("reason") or "correction"
    if reason not in _VALID_REASONS:
        raise SyncError(f"stock_movement {client_id}: invalid reason {reason}")
    p = (await db.execute(select(Product).where(Product.id == product_id))).scalars().first()
    new_stock = (p.current_stock or 0) + change
    if new_stock < 0:
        # Server re-validation (ADR-002 rule 7): refuse to drive stock negative.
        raise SyncError(f"stock_movement {client_id}: would drive stock negative ({new_stock})")
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
