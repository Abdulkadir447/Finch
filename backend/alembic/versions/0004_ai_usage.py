"""AI usage ledger — metering for the AI Platform phase.

Revision ID: 0004_ai_usage
Revises: 0003_source_order_ref
Create Date: 2026-08-28

Adds ``ai_usage``: one row per successful AI request (model, tokens,
credits under the configured credit policy, answer kind). Billing reads
this ledger for real AI usage; the credit policy itself lives in
config/<env>.json ("ai" section), so pricing changes never touch AI code.

Idempotent (guarded DDL), additive only — never rewrites or drops data.
"""
from alembic import op

revision = "0004_ai_usage"
down_revision = "0003_source_order_ref"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ai_usage (
            id              BIGSERIAL PRIMARY KEY,
            business_id     INTEGER NOT NULL,
            user_id         VARCHAR(255),
            request_id      VARCHAR(64),
            model           VARCHAR(64),
            input_tokens    INTEGER NOT NULL DEFAULT 0,
            output_tokens   INTEGER NOT NULL DEFAULT 0,
            credits_used    INTEGER NOT NULL DEFAULT 0,
            answer_kind     VARCHAR(20),
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_ai_usage_business ON ai_usage (business_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_ai_usage_request ON ai_usage (request_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_ai_usage_business_created ON ai_usage (business_id, created_at)")


def downgrade() -> None:
    # Usage history is billing-relevant; deliberately non-destructive.
    pass
