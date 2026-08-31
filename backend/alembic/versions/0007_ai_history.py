"""AI history — the owner-visible AI activity ledger (AI Platform phase).

Revision ID: 0007_ai_history
Revises: 0006_client_id_idempotency
Create Date: 2026-08-28

Adds ``ai_history``: one row per COMPLETED /ai/chat turn (question,
answered kind/title, short summary, model, credits). ``ai_usage`` meters
cost; this ledger is what the UI's "AI activity" panel shows. Tenant
scoped, additive only — never rewrites or drops data.
"""

from alembic import op

revision = "0007_ai_history"
down_revision = "0006_client_id_idempotency"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS ai_history (
            id              BIGSERIAL PRIMARY KEY,
            business_id     INTEGER NOT NULL,
            user_id         VARCHAR(255),
            request_id      VARCHAR(64),
            question        TEXT NOT NULL,
            answer_kind     VARCHAR(20),
            answer_title    VARCHAR(255),
            answer_summary  TEXT,
            report_key      VARCHAR(20),
            model           VARCHAR(64),
            credits_used    INTEGER NOT NULL DEFAULT 0,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_ai_history_business ON ai_history (business_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_ai_history_request ON ai_history (request_id)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_ai_history_business_created ON "
        "ai_history (business_id, created_at)"
    )


def downgrade() -> None:
    # AI history is owner data; deliberately non-destructive.
    pass
