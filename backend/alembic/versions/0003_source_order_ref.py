"""External order reference — idempotent sales-history re-imports.

Revision ID: 0003_source_order_ref
Revises: 0002_import_provenance
Create Date: 2026-08-28

Adds ``orders.source_order_ref``: the old system's order number (e.g.
"A-1048") captured at import time. A partial unique index on
(business_id, source_order_ref) among live, ref-stamped rows makes
re-importing the same sales file a no-op for already-imported orders —
far more reliable than row-content deduplication. Native (live) orders
leave the column NULL and are unaffected.

Idempotent (guarded DDL), additive only — never rewrites or drops data.
"""
from alembic import op

revision = "0003_source_order_ref"
down_revision = "0002_import_provenance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS source_order_ref VARCHAR(100)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_orders_source_ref ON orders (source_order_ref)")
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_business_source_ref
            ON orders (business_id, source_order_ref)
            WHERE deleted_at IS NULL AND source_order_ref IS NOT NULL
        """
    )


def downgrade() -> None:
    # Deliberately non-destructive (matches baseline policy): the reference is
    # additive provenance and dropping it would break import idempotency.
    pass
