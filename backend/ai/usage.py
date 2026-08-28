"""AI usage ledger + credit policy (Pass 4).

Every successful AI request records one ``ai_usage`` row. Billing reads this
ledger for real usage — it never re-derives numbers from anywhere else.

The credit policy is CONFIG-DRIVEN (config/<env>.json "ai" section), not
hard-coded in the engine, so pricing can change without touching AI code:

    "ai": {
        "credits_per_request": 1,
        "free_output_tokens": 500,
        "credits_per_1k_output_tokens": 1
    }

Credits = credits_per_request
        + ceil(max(0, output_tokens - free_output_tokens) / 1000
               * credits_per_1k_output_tokens)
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import func, select

from ..config import load_config
from ..models import AiUsage


@dataclass(frozen=True)
class CreditPolicy:
    credits_per_request: int = 1
    free_output_tokens: int = 500
    credits_per_1k_output_tokens: int = 1

    def apply(self, input_tokens: int, output_tokens: int) -> int:
        extra = max(0, output_tokens - self.free_output_tokens)
        return self.credits_per_request + math.ceil(extra / 1000 * self.credits_per_1k_output_tokens)


def credit_policy() -> CreditPolicy:
    try:
        cfg = load_config().get("ai", {}) or {}
        return CreditPolicy(
            credits_per_request=int(cfg.get("credits_per_request", 1)),
            free_output_tokens=int(cfg.get("free_output_tokens", 500)),
            credits_per_1k_output_tokens=int(cfg.get("credits_per_1k_output_tokens", 1)),
        )
    except Exception:  # noqa: BLE001 — policy must never break a request
        return CreditPolicy()


async def record_usage(
    db,
    business_id: int,
    user_id: Optional[str],
    model: str,
    input_tokens: int,
    output_tokens: int,
    answer_kind: str,
    request_id: Optional[str] = None,
) -> int:
    """Persist one metered AI request. Returns the credits charged.

    The row is added to the caller's session; the request transaction's
    commit makes it durable. (If the request is rolled back for any reason,
    no usage is recorded — the owner is never billed for a failed answer.)
    """
    policy = credit_policy()
    credits = policy.apply(input_tokens, output_tokens)
    db.add(AiUsage(
        business_id=business_id,
        user_id=user_id,
        request_id=(request_id or "")[:64] or None,
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        credits_used=credits,
        answer_kind=(answer_kind or "")[:20] or None,
    ))
    return credits


async def month_usage(db, business_id: int, month_start, month_end) -> dict:
    """Aggregate the ledger for one calendar month (billing's source of truth)."""
    row = (await db.execute(
        select(
            func.count(AiUsage.id),
            func.coalesce(func.sum(AiUsage.input_tokens), 0),
            func.coalesce(func.sum(AiUsage.output_tokens), 0),
            func.coalesce(func.sum(AiUsage.credits_used), 0),
        ).where(
            AiUsage.business_id == business_id,
            AiUsage.created_at >= month_start,
            AiUsage.created_at < month_end,
        )
    )).one()
    return {
        "requests": row[0],
        "input_tokens": int(row[1]),
        "output_tokens": int(row[2]),
        "credits_used": int(row[3]),
    }
