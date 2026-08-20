"""SQLAlchemy ORM models for Finch backend.

Implements the BSD Chapter 1 backend foundation:

  * Multi-tenant isolation  — every business table carries ``business_id``
    (BSD Ch1.8 / Ch1.17). Single-owner dev keeps it NULL; the column is
    the isolation key once multi-business lands.
  * Soft delete           — ``deleted_at`` on every major entity (BSD Ch1.17).
  * Optimistic concurrency — ``version`` column (BSD Ch1.17) lets the sync
    layer detect conflicts without locking.
  * Domain tables          — ``businesses`` (AFD Ch1.10 Company Setup),
    ``sync_queue`` (BSD Ch1.9 / Ch1.17), ``audit_log`` (BSD Ch1.17),
    ``analytics_snapshots`` (BSD Ch1.17 session-based report cache).

Timestamps (``created_at`` / ``updated_at``) are maintained by the ORM via
``server_default`` + ``onupdate`` so they stay correct without DB triggers.
"""

from __future__ import annotations

from enum import Enum

from sqlalchemy import (
    Column,
    DateTime,
    Enum as SAEnum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    """Base class for all ORM models (SQLAlchemy 2.0 style)."""

    __abstract__ = True


# ---------------------------------------------------------------------------
# Business (tenant root) — AFD Ch1.10 Company Setup, BSD Ch1.8 multi-tenant
# ---------------------------------------------------------------------------
class Business(Base):
    """A tenant. Every record in the system belongs to exactly one business."""

    __tablename__ = "businesses"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    owner_id = Column(String(255), index=True)        # Clerk user id of the owner
    owner_email = Column(String(255), index=True)
    industry = Column(String(100))
    currency = Column(String(8), default="USD")
    created_by = Column(String(255), nullable=True)   # BSD Ch2.7 universal structure
    updated_by = Column(String(255), nullable=True)   # BSD Ch2.7 universal structure
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime, nullable=True)  # soft delete (BSD Ch1.17 / Ch2.12)
    deleted_by = Column(String(255), nullable=True)   # BSD Ch2.12 soft delete actor
    version = Column(Integer, default=1, nullable=False)  # optimistic lock (BSD Ch1.17 / Ch2.9)


class Product(Base):
    """Product entity. Includes relationship to ``OrderItem``."""

    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    business_id = Column(Integer, index=True)            # tenant isolation
    sku = Column(String(100), unique=True, nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(String(1000))
    category = Column(String(100))
    unit_price = Column(Float, nullable=False)
    cost_price = Column(Float)
    current_stock = Column(Integer, default=0)
    reorder_level = Column(Integer, default=5)
    created_by = Column(String(255), nullable=True)   # BSD Ch2.7 universal structure
    updated_by = Column(String(255), nullable=True)   # BSD Ch2.7 universal structure
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime, nullable=True)          # soft delete (BSD Ch1.17 / Ch2.12)
    deleted_by = Column(String(255), nullable=True)   # BSD Ch2.12 soft delete actor
    version = Column(Integer, default=1, nullable=False)  # optimistic lock (BSD Ch1.17 / Ch2.9)

    order_items = relationship(
        "OrderItem",
        back_populates="product",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Product id={self.id} sku={self.sku!r} name={self.name!r}>"


class Customer(Base):
    """Customer entity (``customers`` table)."""

    __tablename__ = "customers"

    id = Column(Integer, primary_key=True, index=True)
    business_id = Column(Integer, index=True)            # tenant isolation
    full_name = Column(String(255), nullable=False)
    email = Column(String(255), unique=True, nullable=False, index=True)
    phone = Column(String(20))
    address = Column(String(500))
    company = Column(String(255))
    password_hash = Column(String(255), nullable=True)
    created_by = Column(String(255), nullable=True)   # BSD Ch2.7 universal structure
    updated_by = Column(String(255), nullable=True)   # BSD Ch2.7 universal structure
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime, nullable=True)          # soft delete (BSD Ch1.17 / Ch2.12)
    deleted_by = Column(String(255), nullable=True)   # BSD Ch2.12 soft delete actor
    version = Column(Integer, default=1, nullable=False)  # optimistic lock (BSD Ch1.17 / Ch2.9)

    orders = relationship(
        "Order",
        back_populates="customer",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Customer id={self.id} email={self.email!r}>"


class OrderStatus(str, Enum):
    """Enum for order status values used by the ``orders`` table."""

    pending = "pending"
    confirmed = "confirmed"
    shipped = "shipped"
    delivered = "delivered"
    cancelled = "cancelled"


class Order(Base):
    """Order entity (``orders`` table)."""

    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True)
    business_id = Column(Integer, index=True)            # tenant isolation
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    order_date = Column(DateTime, server_default=func.now())
    status = Column(SAEnum(OrderStatus), default=OrderStatus.pending, nullable=False)
    total_amount = Column(Float, nullable=False, default=0.0)
    created_by = Column(String(255), nullable=True)   # BSD Ch2.7 universal structure
    updated_by = Column(String(255), nullable=True)   # BSD Ch2.7 universal structure
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime, nullable=True)          # soft delete (BSD Ch1.17 / Ch2.12)
    deleted_by = Column(String(255), nullable=True)   # BSD Ch2.12 soft delete actor
    version = Column(Integer, default=1, nullable=False)  # optimistic lock (BSD Ch1.17 / Ch2.9)

    customer = relationship("Customer", back_populates="orders")
    items = relationship(
        "OrderItem",
        back_populates="order",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Order id={self.id} status={self.status.value!r}>"


class OrderItem(Base):
    """OrderItem entity (``order_items`` table)."""

    __tablename__ = "order_items"

    id = Column(Integer, primary_key=True, index=True)
    business_id = Column(Integer, index=True)            # tenant isolation
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    quantity = Column(Integer, nullable=False)
    unit_price = Column(Float, nullable=False)  # price at the moment of ordering
    total_price = Column(Float, nullable=False)
    created_by = Column(String(255), nullable=True)   # BSD Ch2.7 universal structure
    updated_by = Column(String(255), nullable=True)   # BSD Ch2.7 universal structure
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime, nullable=True)          # soft delete (BSD Ch1.17 / Ch2.12)
    deleted_by = Column(String(255), nullable=True)   # BSD Ch2.12 soft delete actor
    version = Column(Integer, default=1, nullable=False)  # optimistic lock (BSD Ch1.17 / Ch2.9)

    order = relationship("Order", back_populates="items")
    product = relationship("Product", back_populates="order_items")

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"<OrderItem id={self.id} order_id={self.order_id} "
            f"product_id={self.product_id} qty={self.quantity}>"
        )


# ---------------------------------------------------------------------------
# Profile — local user profile, keyed to the Clerk identity (BSD Ch3.11).
# Supabase is the storage layer for Finch; identity comes from Clerk, so the
# profile is keyed by the Clerk user id and lives in Supabase Postgres.
# ---------------------------------------------------------------------------
class Profile(Base):
    """Local user profile, linked to the Clerk identity.

    ``clerk_user_id`` stores the external auth user id (Clerk ``sub`` claim);
    the local integer ``id`` keeps the ORM layer backward-compatible with the
    rest of the schema (UUID primary keys are deferred per BSD Ch2.5).
    Authentication *tokens* are intentionally NOT stored here (BSD Ch3.17) —
    Clerk session tokens are verified per-request against Clerk's public JWKS.
    """

    __tablename__ = "profiles"

    id = Column(Integer, primary_key=True, index=True)
    clerk_user_id = Column(String(255), unique=True, nullable=False, index=True)
    full_name = Column(String(255))
    email = Column(String(255), unique=True, index=True)
    avatar_url = Column(String(1024))
    phone_number = Column(String(40))
    preferred_language = Column(String(16), default="en")
    timezone = Column(String(64))
    created_by = Column(String(255), nullable=True)   # BSD Ch2.7 universal structure
    updated_by = Column(String(255), nullable=True)   # BSD Ch2.7 universal structure
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime, nullable=True)          # soft delete (BSD Ch1.17 / Ch2.12)
    deleted_by = Column(String(255), nullable=True)   # BSD Ch2.12 soft delete actor
    version = Column(Integer, default=1, nullable=False)  # optimistic lock (BSD Ch1.17 / Ch2.9)


# ---------------------------------------------------------------------------
# Sync queue — dedicated offline-first synchronization buffer (BSD Ch1.9 / Ch1.17)
# ---------------------------------------------------------------------------
class SyncQueue(Base):
    """One row per local mutation awaiting cloud replication."""

    __tablename__ = "sync_queue"

    id = Column(Integer, primary_key=True, index=True)
    business_id = Column(Integer, index=True)
    entity_type = Column(String(50), nullable=False)   # 'order' | 'product' | ...
    entity_id = Column(Integer, nullable=False)
    operation = Column(String(20), nullable=False)      # 'create' | 'update' | 'delete'
    payload = Column(Text)                             # JSON-serialised change
    status = Column(String(20), default="pending")     # pending | synced | failed
    created_at = Column(DateTime, server_default=func.now())
    synced_at = Column(DateTime, nullable=True)


# ---------------------------------------------------------------------------
# Audit log — change tracking via DB triggers (BSD Ch1.17)
# ---------------------------------------------------------------------------
class AuditLog(Base):
    """Append-only record of mutations for security & change tracking."""

    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, index=True)
    table_name = Column(String(50), nullable=False)
    record_id = Column(Integer, nullable=True)
    action = Column(String(20), nullable=False)        # INSERT | UPDATE | DELETE
    actor = Column(String(255))
    change_json = Column(Text)
    created_at = Column(DateTime, server_default=func.now())


# ---------------------------------------------------------------------------
# Analytics snapshots — session-based report cache (BSD Ch1.17)
# ---------------------------------------------------------------------------
class AnalyticsSnapshot(Base):
    """Cached dashboard/forecast metrics, regenerated per session."""

    __tablename__ = "analytics_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    business_id = Column(Integer, index=True)
    snapshot_date = Column(DateTime, server_default=func.now())
    metric_key = Column(String(50), nullable=False)
    metric_value = Column(Float)
    dimensions_json = Column(Text)
