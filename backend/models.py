"""SQLAlchemy ORM models for Co-op backend.

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
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
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
    owner_email = Column(String(255), index=True)     # business contact email (editable)
    industry = Column(String(100))
    currency = Column(String(8), default="USD")
    # Company profile fields (UXDS 15.6, Task 9) — additive, nullable.
    address = Column(String(500))
    phone = Column(String(20))
    tax_id = Column(String(100))
    website = Column(String(255))
    timezone = Column(String(64))
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
    # SKU uniqueness is TENANT-SCOPED and applies only to live rows
    # (Task 10 / audit fix B-1): two businesses may share a SKU, and a
    # soft-deleted product's SKU can be re-used. Partial unique index —
    # supported natively by Postgres/Supabase and SQLite.
    __table_args__ = (
        Index(
            "uq_products_business_sku",
            "business_id",
            "sku",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
            sqlite_where=text("deleted_at IS NULL"),
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    business_id = Column(Integer, index=True)            # tenant isolation
    sku = Column(String(100), nullable=False, index=True)
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
    import_batch_id = Column(Integer, ForeignKey("import_batches.id"), nullable=True)  # provenance: NULL = created live
    client_id = Column(String(26), nullable=True, unique=True)  # client-generated ULID (offline idempotency key)

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
    # Email is unique PER BUSINESS among LIVE rows only (Task 11 / audit H2):
    # two businesses may share a customer email, and a soft-deleted customer's
    # email becomes reusable — mirroring the products SKU rule. Partial unique
    # index, supported natively by Postgres/Supabase and SQLite.
    __table_args__ = (
        Index(
            "uq_customers_business_email",
            "business_id",
            "email",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
            sqlite_where=text("deleted_at IS NULL"),
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    business_id = Column(Integer, index=True)            # tenant isolation
    full_name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=False, index=True)
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
    import_batch_id = Column(Integer, ForeignKey("import_batches.id"), nullable=True)  # provenance: NULL = created live
    client_id = Column(String(26), nullable=True, unique=True)  # client-generated ULID (offline idempotency key)

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


# ---------------------------------------------------------------------------
# Import provenance (v1 Instant Onboarding, item 9)
#
# Every row created by the Intelligent Importer is stamped with the
# ``ImportBatch`` that created it. ``import_batch_id IS NULL`` means the
# record was created live in Co-op (manual/live); a set value means it came
# from that import batch — giving a clean split between "imported history"
# and "today's live sales", and making undoing an import a batch delete.
# ---------------------------------------------------------------------------
class ImportBatch(Base):
    """One uploaded file that was imported (one dataset per batch)."""

    __tablename__ = "import_batches"

    id = Column(Integer, primary_key=True, index=True)
    business_id = Column(Integer, index=True, nullable=False)
    dataset = Column(String(20), nullable=False)  # products | customers | orders
    filename = Column(String(255))
    row_count = Column(Integer, default=0)
    created_count = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())



class Order(Base):
    """Order entity (``orders`` table)."""

    __tablename__ = "orders"
    # Imported orders carry the source system's order reference
    # (``source_order_ref``) so a re-import of the same file is idempotent:
    # the same external reference can never create a second order per
    # business (partial unique index — mirrors the products SKU rule).
    # Native (live) orders leave it NULL.
    __table_args__ = (
        Index(
            "uq_orders_business_source_ref",
            "business_id",
            "source_order_ref",
            unique=True,
            postgresql_where=text("deleted_at IS NULL AND source_order_ref IS NOT NULL"),
            sqlite_where=text("deleted_at IS NULL AND source_order_ref IS NOT NULL"),
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    business_id = Column(Integer, index=True)            # tenant isolation
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    order_date = Column(DateTime, server_default=func.now())
    # native_enum=False keeps `status` a VARCHAR so the ORM-created schema
    # matches the Alembic baseline migration on every database (Task 11 / H4).
    status = Column(SAEnum(OrderStatus, native_enum=False), default=OrderStatus.pending, nullable=False)
    total_amount = Column(Float, nullable=False, default=0.0)
    created_by = Column(String(255), nullable=True)   # BSD Ch2.7 universal structure
    updated_by = Column(String(255), nullable=True)   # BSD Ch2.7 universal structure
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime, nullable=True)          # soft delete (BSD Ch1.17 / Ch2.12)
    deleted_by = Column(String(255), nullable=True)   # BSD Ch2.12 soft delete actor
    version = Column(Integer, default=1, nullable=False)  # optimistic lock (BSD Ch1.17 / Ch2.9)
    import_batch_id = Column(Integer, ForeignKey("import_batches.id"), nullable=True)  # provenance: NULL = created live
    client_id = Column(String(26), nullable=True, unique=True)  # client-generated ULID (offline idempotency key)
    source_order_ref = Column(String(100), nullable=True)  # external order number from the old system (import idempotency)

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
    import_batch_id = Column(Integer, ForeignKey("import_batches.id"), nullable=True)  # provenance: NULL = created live
    client_id = Column(String(26), nullable=True, unique=True)  # client-generated ULID (offline idempotency key)

    order = relationship("Order", back_populates="items")
    product = relationship("Product", back_populates="order_items")

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"<OrderItem id={self.id} order_id={self.order_id} "
            f"product_id={self.product_id} qty={self.quantity}>"
        )


# ---------------------------------------------------------------------------
# Stock movements — append-only inventory ledger (BSD Ch9 ``stock_movements``,
# UXDS 11.12). Every change to ``products.current_stock`` writes exactly one
# row here. Movements are immutable: no update/delete columns by design.
# ---------------------------------------------------------------------------
class StockMovementReason(str, Enum):
    initial = "initial"                      # initial stock at product creation
    purchase = "purchase"                    # manual adjustment reasons (UXDS 11.11)
    sale = "sale"
    damaged = "damaged"
    returned = "returned"
    correction = "correction"
    order = "order"                          # automatic: order created
    order_cancelled = "order_cancelled"      # automatic: order cancelled
    order_deleted = "order_deleted"          # automatic: order deleted


class StockMovement(Base):
    """One immutable row per stock change (audit trail, Task 8)."""

    __tablename__ = "stock_movements"

    id = Column(Integer, primary_key=True, index=True)
    business_id = Column(Integer, index=True, nullable=False)   # tenant isolation
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    change = Column(Integer, nullable=False)                    # signed quantity delta
    # VARCHAR, not a native Postgres enum, for parity with the Alembic
    # baseline (Task 11 / H4).
    reason = Column(SAEnum(StockMovementReason, native_enum=False), nullable=False)
    note = Column(String(500))
    order_id = Column(Integer, nullable=True)                   # set for order-driven moves
    actor = Column(String(255))                                 # Clerk user id
    created_at = Column(DateTime, server_default=func.now())
    client_id = Column(String(26), nullable=True, unique=True)  # client-generated ULID (offline idempotency key)

    product = relationship("Product")


# ---------------------------------------------------------------------------
# Profile — local user profile, keyed to the Clerk identity (BSD Ch3.11).
# Supabase is the storage layer for Co-op; identity comes from Clerk, so the
# profile is keyed by the Clerk user id and lives in Supabase Postgres.
# ---------------------------------------------------------------------------
class AiUsage(Base):
    """One metered AI request (AI Platform phase, Pass 4).

    Every successful /ai/chat request writes exactly one row: model, tokens
    and the credits charged under the current credit policy. Billing reads
    this ledger — it never re-derives usage from anywhere else, and the
    policy (credits per request / per 1k output tokens) lives in config,
    not in the AI engine, so pricing can change without touching AI code.
    """

    __tablename__ = "ai_usage"

    id = Column(Integer, primary_key=True, index=True)
    business_id = Column(Integer, index=True, nullable=False)
    user_id = Column(String(255))  # Clerk user id
    request_id = Column(String(64), index=True)  # idempotency key (client-generated or server-assigned)
    model = Column(String(64))
    input_tokens = Column(Integer, default=0)
    output_tokens = Column(Integer, default=0)
    credits_used = Column(Integer, default=0)
    answer_kind = Column(String(20))  # fact | calculation | forecast | suggestion | draft | clarify
    created_at = Column(DateTime, server_default=func.now())

    def __repr__(self) -> str:  # pragma: no cover
        return f"<AiUsage business={self.business_id} model={self.model!r} credits={self.credits_used}>"


class Subscription(Base):
    """The business's active plan (Real Billing phase).

    One row per business. Credits are NOT stored here — they are computed
    from the plan's monthly allowance (config) minus the SUM of the
    ``ai_usage`` ledger for the current calendar month, so the ledger stays
    the single source of truth and there is no balance to drift.

    Payments are deliberately out of scope for this phase: plan changes are
    real server-side state (enforcement + remaining are real), but nothing
    is charged until a payment provider is connected.
    """

    __tablename__ = "subscriptions"
    __table_args__ = (
        Index("uq_subscriptions_business", "business_id", unique=True),
    )

    id = Column(Integer, primary_key=True, index=True)
    business_id = Column(Integer, index=True, nullable=False)
    plan = Column(String(20), nullable=False, default="free")  # free | starter | professional | enterprise
    status = Column(String(20), nullable=False, default="active")
    updated_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Subscription business={self.business_id} plan={self.plan!r}>"


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
