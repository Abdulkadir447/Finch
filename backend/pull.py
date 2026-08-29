"""Co-op sync — cloud -> local PULL (OFFLINE 3, Part 1).

Builds the mirror payload the desktop app downloads to populate (and later
refresh) its local SQLite mirror. This is the server half of the initial
pull + reconnect refresh; the renderer downloads it (with the Clerk token)
and hands it to the main-process mirror module, which upserts it into SQLite
by stable identity (client_id, falling back to server id for cloud-native
rows).

Full vs. delta:
  * No ``since``  -> full dump (initial pull). Includes soft-deleted rows so
                     the mirror can reflect deletions.
  * ``since`` set -> delta: rows with ``updated_at > since`` (and, for the
                     immutable stock_movements ledger, ``created_at > since``).

The payload is read-only and carries no secrets. Each record carries both
``id`` (server id) and ``client_id`` (ULID, or null for cloud-native rows) so
the local/cloud identity mapping stays stable (OFFLINE 3 requirement).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import select

from .models import Business, Customer, Order, OrderItem, Product, StockMovement


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt is not None else None


def _biz(model, **fields: Any) -> dict[str, Any]:
    """Serialise a row to the mirror shape: id + client_id + fields + deleted_at."""
    out: dict[str, Any] = {"id": model.id, "client_id": getattr(model, "client_id", None)}
    for k, v in fields.items():
        out[k] = v
    return out


def _enum_value(v: Any) -> Any:
    return v.value if hasattr(v, "value") else v


async def build_pull_payload(
    db, business: Business, since: Optional[datetime] = None
) -> dict[str, Any]:
    """Build the mirror payload for a business (full dump, or delta since ``since``)."""
    bid = business.id

    def _updated(model):
        return [model.updated_at > since] if since is not None else []

    def _created(model):
        return [model.created_at > since] if since is not None else []

    customers = (
        (await db.execute(
            select(Customer).where(Customer.business_id == bid, *_updated(Customer))
        )).scalars().all()
    )
    products = (
        (await db.execute(
            select(Product).where(Product.business_id == bid, *_updated(Product))
        )).scalars().all()
    )
    orders = (
        (await db.execute(
            select(Order).where(Order.business_id == bid, *_updated(Order))
        )).scalars().all()
    )
    order_items = (
        (await db.execute(
            select(OrderItem).where(OrderItem.business_id == bid, *_updated(OrderItem))
        )).scalars().all()
    )
    # stock_movements is immutable: filter on created_at for deltas.
    movements = (
        (await db.execute(
            select(StockMovement).where(StockMovement.business_id == bid, *_created(StockMovement))
        )).scalars().all()
    )

    customers_out = [
        _biz(
            c,
            full_name=c.full_name, email=c.email, phone=c.phone, address=c.address,
            company=c.company, deleted_at=_iso(c.deleted_at), updated_at=_iso(c.updated_at),
        )
        for c in customers
    ]
    products_out = [
        _biz(
            p,
            sku=p.sku, name=p.name, description=p.description, category=p.category,
            unit_price=p.unit_price, cost_price=p.cost_price,
            current_stock=p.current_stock, reorder_level=p.reorder_level,
            deleted_at=_iso(p.deleted_at), updated_at=_iso(p.updated_at),
        )
        for p in products
    ]
    orders_out = [
        _biz(
            o,
            customer_id=o.customer_id, status=_enum_value(o.status),
            total_amount=o.total_amount, order_date=_iso(o.order_date),
            deleted_at=_iso(o.deleted_at), updated_at=_iso(o.updated_at),
        )
        for o in orders
    ]
    order_items_out = [
        _biz(
            it,
            order_id=it.order_id, product_id=it.product_id, quantity=it.quantity,
            unit_price=it.unit_price, total_price=it.total_price,
            deleted_at=_iso(it.deleted_at), updated_at=_iso(it.updated_at),
        )
        for it in order_items
    ]
    movements_out = [
        {
            "id": m.id, "client_id": m.client_id, "product_id": m.product_id,
            "change": m.change, "reason": _enum_value(m.reason), "note": m.note,
            "order_id": m.order_id, "created_at": _iso(m.created_at),
        }
        for m in movements
    ]

    business_out = {
        "id": business.id,
        "name": business.name,
        "currency": business.currency,
        "industry": business.industry,
        "address": business.address,
        "phone": business.phone,
        "tax_id": business.tax_id,
        "website": business.website,
        "timezone": business.timezone,
        "updated_at": _iso(business.updated_at),
    }

    return {
        "cursor": datetime.utcnow().isoformat(),
        "since": _iso(since),
        "business": business_out,
        "customers": customers_out,
        "products": products_out,
        "orders": orders_out,
        "order_items": order_items_out,
        "stock_movements": movements_out,
        "counts": {
            "customers": len(customers_out),
            "products": len(products_out),
            "orders": len(orders_out),
            "order_items": len(order_items_out),
            "stock_movements": len(movements_out),
        },
    }
