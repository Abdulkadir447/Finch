"""Team model — memberships + invitations (TRD Ch17 §17.7).

Revision ID: 0010_team_model
Revises: 0009_ai_response_style
Create Date: 2026-08-31

Adds ``business_members`` (non-owner users with a role per business) and
``business_invitations`` (email-based, token-bearing invites). Idempotent
(guarded DDL), additive, no data movement.
"""

from alembic import op

revision = "0010_team_model"
down_revision = "0009_ai_response_style"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE TABLE IF NOT EXISTS business_members ("
        "id INTEGER PRIMARY KEY, "
        "business_id INTEGER NOT NULL REFERENCES businesses(id), "
        "user_id VARCHAR(255) NOT NULL, "
        "email VARCHAR(255), "
        "role VARCHAR(20) NOT NULL, "
        "invited_by VARCHAR(255), "
        "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, "
        "updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, "
        "CONSTRAINT uq_member_business_user UNIQUE (business_id, user_id)"
        ")"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_business_members_business_id "
        "ON business_members (business_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_business_members_user_id "
        "ON business_members (user_id)"
    )
    op.execute(
        "CREATE TABLE IF NOT EXISTS business_invitations ("
        "id INTEGER PRIMARY KEY, "
        "business_id INTEGER NOT NULL REFERENCES businesses(id), "
        "email VARCHAR(255) NOT NULL, "
        "role VARCHAR(20) NOT NULL, "
        "token VARCHAR(64) NOT NULL UNIQUE, "
        "status VARCHAR(20) NOT NULL DEFAULT 'pending', "
        "created_by VARCHAR(255), "
        "accepted_by VARCHAR(255), "
        "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, "
        "expires_at TIMESTAMP"
        ")"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_business_invitations_business_id "
        "ON business_invitations (business_id)"
    )


def downgrade() -> None:
    # Non-destructive: team tables are never dropped.
    pass
