"""Client-generated IDs — idempotency key for offline-first sync (ADR-002).

Revision ID: 0006_client_id_idempotency
Revises: 0005_subscriptions
Create Date: 2026-08-28

Adds ``client_id`` (a client-generated ULID) to the syncable entities
(customers, products, orders, order_items, stock_movements). When the
desktop app writes offline, each row gets a ULID locally; on sync the server
dedupes on this key so a retried offline write applies exactly once
(ADR-002 rules 3 & 4).

Live-created rows leave ``client_id`` NULL; a unique index tolerates NULLs,
so this is additive and non-breaking. Idempotent (guarded DDL).
"""
from alembic import op

revision = "0006_client_id_idempotency"
down_revision = "0005_subscriptions"
branch_labels = None
depends_on = None


_TABLES = ["customers", "products", "orders", "order_items", "stock_movements"]


def upgrade() -> None:
    for table in _TABLES:
        op.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS client_id VARCHAR(26)")
        op.execute(f"CREATE UNIQUE INDEX IF NOT EXISTS uq_{table}_client_id ON {table} (client_id)")


def downgrade() -> None:
    # Deliberately non-destructive: client_id is sync provenance.
    pass
