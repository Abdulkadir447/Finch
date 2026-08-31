"""Audit trail tenant scoping (hardening backlog: audit read view).

Revision ID: 0008_audit_business_id
Revises: 0007_ai_history
Create Date: 2026-08-31

Adds ``business_id`` to ``audit_log`` so entries can be listed per tenant.
Historical rows (if any) remain NULL — they predate tenant attribution and
are simply never returned by the tenant-scoped read view. New writes always
set it. Idempotent (guarded DDL), non-destructive.
"""

from alembic import op

revision = "0008_audit_business_id"
down_revision = "0007_ai_history"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS business_id INTEGER")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_audit_log_business_id ON audit_log (business_id)"
    )


def downgrade() -> None:
    # Non-destructive: tenant attribution is provenance, never dropped.
    pass
