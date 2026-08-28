"""Real Billing + Credits (phase: make credits and plan enforcement real).

The dependency chain, top to bottom:

    AI request  ->  ai_usage ledger  ->  credits consumed
                 ->  plan allowance (config)  ->  remaining balance
                 ->  enforcement  ->  Billing UI  ->  (payment provider later)

Design decisions
----------------
* **Credits are computed, never stored.** ``remaining = allowance - SUM
  (ai_usage.credits_used this month)``. The ledger written by the AI
  service is the single source of truth — there is no balance column that
  can drift, and re-computation is always reproducible.
* **Calendar-month periods.** Allowances refresh on the 1st; usage is
  month-to-date. Simple, deterministic, testable.
* **Config-driven allowances.** Plan names/prices are product decisions
  (config/<env>.json "billing" section), so the credit economy can change
  without touching this code — same rule that governs the credit policy.
* **Payments are NOT in this phase.** Plan changes are real server-side
  state (enforcement and remaining are real), but nothing is charged until
  a payment provider is connected. The UI keeps its honest preview banner.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Any, Optional

from sqlalchemy import func, select

from .config import load_config
from .models import AiUsage, Business, Subscription

PLAN_FREE = "free"
PLAN_STARTER = "starter"
PLAN_PROFESSIONAL = "professional"
PLAN_ENTERPRISE = "enterprise"

VALID_PLANS = (PLAN_FREE, PLAN_STARTER, PLAN_PROFESSIONAL, PLAN_ENTERPRISE)

# Fallback allowances if config is missing (mirrors config/*.json).
DEFAULT_ALLOWANCES: dict[str, Optional[int]] = {
    PLAN_FREE: 25,
    PLAN_STARTER: 200,
    PLAN_PROFESSIONAL: 1000,
    PLAN_ENTERPRISE: None,  # unlimited
}


class InvalidPlan(ValueError):
    pass


# ---------------------------------------------------------------------------
# Plan configuration (config-driven, like the credit policy)
# ---------------------------------------------------------------------------

def plan_config() -> dict[str, dict[str, Any]]:
    try:
        cfg = load_config().get("billing", {}).get("plans", {}) or {}
    except Exception:  # noqa: BLE001 — config must never break billing math
        cfg = {}
    out: dict[str, dict[str, Any]] = {}
    for plan in VALID_PLANS:
        entry = dict(cfg.get(plan) or {})
        if "credits_per_month" not in entry:
            entry["credits_per_month"] = DEFAULT_ALLOWANCES[plan]
        out[plan] = entry
    return out


def allowance_for(plan: str) -> Optional[int]:
    """Monthly credit allowance; None = unlimited."""
    return plan_config().get(plan, {}).get("credits_per_month")


def plan_label(plan: str) -> str:
    return plan_config().get(plan, {}).get("label") or plan.capitalize()


def min_request_credits() -> int:
    """The minimum a request can cost (before token-based additions)."""
    try:
        cfg = load_config().get("ai", {}) or {}
        return max(1, int(cfg.get("credits_per_request", 1)))
    except Exception:  # noqa: BLE001
        return 1


# ---------------------------------------------------------------------------
# Periods
# ---------------------------------------------------------------------------

def month_bounds(today: Optional[dt.date] = None) -> tuple[dt.datetime, dt.datetime]:
    """[start, end) of the calendar month containing `today`."""
    today = today or dt.date.today()
    start = dt.datetime.combine(today.replace(day=1), dt.time.min)
    if today.month == 12:
        nxt = dt.date(today.year + 1, 1, 1)
    else:
        nxt = dt.date(today.year, today.month + 1, 1)
    end = dt.datetime.combine(nxt, dt.time.min)
    return start, end


# ---------------------------------------------------------------------------
# Subscription state
# ---------------------------------------------------------------------------

async def get_or_create_subscription(db, business: Business) -> Subscription:
    """Every business has exactly one subscription (free until upgraded)."""
    sub = (await db.execute(
        select(Subscription).where(Subscription.business_id == business.id)
    )).scalars().first()
    if sub is None:
        sub = Subscription(business_id=business.id, plan=PLAN_FREE, status="active")
        db.add(sub)
        await db.flush()
    return sub


async def used_credits(db, business_id: int, start: dt.datetime, end: dt.datetime) -> int:
    """Credits consumed in [start, end) — straight from the AI ledger."""
    return int((await db.execute(
        select(func.coalesce(func.sum(AiUsage.credits_used), 0))
        .where(
            AiUsage.business_id == business_id,
            AiUsage.created_at >= start,
            AiUsage.created_at < end,
        )
    )).scalar() or 0)


@dataclass
class CreditState:
    plan: str
    label: str
    unlimited: bool
    granted: Optional[int]
    used: int
    remaining: Optional[int]
    period_start: str
    period_end: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "plan": self.plan,
            "label": self.label,
            "unlimited": self.unlimited,
            "granted": self.granted,
            "used": self.used,
            "remaining": self.remaining,
            "period": {"start": self.period_start, "end": self.period_end},
        }


async def credit_state(db, business: Business) -> CreditState:
    """The business's current credit position (computed, never stored)."""
    sub = await get_or_create_subscription(db, business)
    start, end = month_bounds()
    used = await used_credits(db, business.id, start, end)
    allowance = allowance_for(sub.plan)
    unlimited = allowance is None
    remaining = None if unlimited else max(0, (allowance or 0) - used)
    return CreditState(
        plan=sub.plan,
        label=plan_label(sub.plan),
        unlimited=unlimited,
        granted=None if unlimited else (allowance or 0),
        used=used,
        remaining=remaining,
        period_start=start.date().isoformat(),
        period_end=(end - dt.timedelta(seconds=1)).date().isoformat(),
    )


class InsufficientCredits(Exception):
    """Raised by the AI service when a request cannot be afforded.

    The route maps this to HTTP 402 with a structured body the UI renders
    as an honest 'out of credits' card (with a billing link) — never a
    silent failure.
    """

    def __init__(self, state: CreditState, required: int):
        self.state = state
        self.required = required

    def to_dict(self) -> dict[str, Any]:
        s = self.state
        return {
            "error": "insufficient_credits",
            "plan": s.plan,
            "granted": s.granted,
            "used": s.used,
            "remaining": s.remaining,
            "required": self.required,
            "message": (
                f"You've used all {s.used} AI credits available on the "
                f"{s.label} plan this month. Upgrade your plan to keep "
                f"asking Co-op."
            ),
        }


async def check_credits(db, business: Business) -> CreditState:
    """Enforcement gate for AI requests.

    Admits the request when the minimum possible cost (base request
    credit) is affordable; the ACTUAL cost is recorded after the model
    runs, and a response that costs more than the remainder is allowed to
    complete (the ledger then shows 0 remaining). This keeps the gate
    simple and deterministic while the ledger stays exact.
    """
    state = await credit_state(db, business)
    if state.unlimited:
        return state
    if (state.remaining or 0) < min_request_credits():
        raise InsufficientCredits(state, min_request_credits())
    return state


# ---------------------------------------------------------------------------
# Plan changes (real state, no payment in this phase)
# ---------------------------------------------------------------------------

async def change_plan(db, business: Business, plan: str, actor: Optional[str] = None) -> Subscription:
    """Switch the business's plan.

    Real server-side state (enforcement + remaining change immediately),
    but deliberately payment-free: a payment provider is a later phase.
    The new allowance applies for the whole current calendar month; usage
    keeps counting month-to-date (no proration — keep it explainable).
    """
    plan = (plan or "").strip().lower()
    if plan not in VALID_PLANS:
        raise InvalidPlan(f"plan must be one of: {', '.join(VALID_PLANS)}")
    sub = await get_or_create_subscription(db, business)
    sub.plan = plan
    sub.status = "active"
    sub.updated_by = actor or business.owner_id
    await db.flush()
    return sub


async def billing_summary(db, business: Business) -> dict[str, Any]:
    """GET /billing/summary — plan + credits + the month's metered usage."""
    state = await credit_state(db, business)
    start, end = month_bounds()
    usage = (await db.execute(
        select(
            func.count(AiUsage.id),
            func.coalesce(func.sum(AiUsage.input_tokens), 0),
            func.coalesce(func.sum(AiUsage.output_tokens), 0),
        ).where(
            AiUsage.business_id == business.id,
            AiUsage.created_at >= start,
            AiUsage.created_at < end,
        )
    )).one()
    return {
        **state.to_dict(),
        "plans": [
            {"key": p, "label": plan_label(p), "credits_per_month": allowance_for(p)}
            for p in VALID_PLANS
        ],
        "usage_month": {
            "requests": int(usage[0] or 0),
            "input_tokens": int(usage[1] or 0),
            "output_tokens": int(usage[2] or 0),
            "credits_used": state.used,
        },
        "payment_connected": False,  # real in this phase: nothing is charged yet
    }
