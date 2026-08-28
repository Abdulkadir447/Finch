"""Subscriptions — real plan state for the billing + credits phase.

Revision ID: 0005_subscriptions
Revises: 0004_ai_usage
Create Date: 2026-08-28

Adds ``subscriptions``: one row per business holding the active plan.
Credits themselves are never stored here — they are computed as
plan allowance (config) minus the ``ai_usage`` ledger for the current
calendar month, keeping the ledger the single source of truth.

Idempotent (guarded DDL), additive only.
"""
from alembic import op

revision = "0005_subscriptions"
down_revision = "0004_ai_usage"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS subscriptions (
            id          BIGSERIAL PRIMARY KEY,
            business_id INTEGER NOT NULL,
            plan        VARCHAR(20) NOT NULL DEFAULT 'free',
            status      VARCHAR(20) NOT NULL DEFAULT 'active',
            updated_by  VARCHAR(255),
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_business ON subscriptions (business_id)")


def downgrade() -> None:
    # Plan state is billing-relevant; deliberately non-destructive.
    pass
