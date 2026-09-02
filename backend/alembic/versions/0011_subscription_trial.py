"""Free trial on subscriptions — opt-in, one per business.

Revision ID: 0011_subscription_trial
Revises: 0010_team_model
Create Date: 2026-09-02

Adds the trial window to ``subscriptions``:

* ``trial_plan``       — the paid plan being trialled (never written to ``plan``)
* ``trial_started_at`` — when the owner opted in; also the "already used" marker
* ``trial_ends_at``    — end of the window; expiry is evaluated lazily on read

Keeping the trial in its own columns means the effective plan is a pure
function of (plan, trial_plan, trial_ends_at, now) — no scheduler, no job
that can fail to run, and no stored balance that can drift.

Idempotent (guarded DDL), additive only.
"""

from alembic import op

revision = "0011_subscription_trial"
down_revision = "0010_team_model"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS trial_plan VARCHAR(20)")
    op.execute("ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ")
    op.execute("ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ")


def downgrade() -> None:
    # Trial history is billing-relevant (it proves a trial was consumed);
    # deliberately non-destructive, in line with the other billing migrations.
    pass
