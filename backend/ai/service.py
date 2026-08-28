"""AI application service (Pass 1/2) — orchestrates one /ai/chat request.

    context builder  ->  verified business context (DB, read-only)
    provider         ->  the model (OpenAI today; swappable)
    schemas          ->  structured answer contract, validated
    actions          ->  fixed registry, business-rule validated
    usage            ->  metered ledger row

The deterministic insight engine (briefing.py) stays the source of verified
facts; the model explains and prioritises. If the model is unavailable or
returns something that fails the contract, the caller gets a clear
degradation signal — AI never blocks core operations (TRD Ch1.8).
"""
from __future__ import annotations

import json
import os
from typing import Any, Optional

from pydantic import ValidationError

from ..config import load_config, secret
from ..models import Business
from .actions import validate_actions, validate_links
from .context import build_context
from .providers.openai import ProviderError, build_provider
from .prompts import REPAIR_PROMPT, build_system_prompt, user_prompt
from .schemas import AiChatResponse
from .usage import month_usage, record_usage

__all__ = ["handle_chat", "ai_enabled", "AiUnavailable", "month_usage"]


class AiUnavailable(Exception):
    """Raised when the model cannot serve a request (no key / network / quota)."""


def _ai_config() -> dict[str, Any]:
    try:
        return load_config().get("ai", {}) or {}
    except Exception:  # noqa: BLE001
        return {}


def ai_enabled() -> bool:
    cfg = _ai_config()
    if not cfg.get("enabled", True):
        return False
    return bool(secret("OPENAI_API_KEY"))


def _default_model() -> str:
    return secret("OPENAI_MODEL") or _ai_config().get("model") or "gpt-4o-mini"


def _parse_reply(text: str) -> AiChatResponse:
    """Parse the model's JSON reply into the validated contract."""
    s = (text or "").strip()
    if s.startswith("```"):  # be forgiving: strip a code fence if one slipped in
        s = s.strip("`")
        if s.lower().startswith("json"):
            s = s[4:]
    data = json.loads(s)
    if not isinstance(data, dict):
        raise ValueError("reply is not a JSON object")
    return AiChatResponse.model_validate(data)


async def handle_chat(
    db,
    business: Business,
    user_id: Optional[str],
    question: str,
    history: Optional[list[dict[str, str]]] = None,
    request_id: Optional[str] = None,
) -> dict[str, Any]:
    """Run one grounded AI chat turn. Returns the structured response dict.

    Raises AiUnavailable when the model layer cannot serve the request —
    the route turns that into an honest 503 and the frontend falls back to
    the deterministic engine.
    """
    question = (question or "").strip()
    if not question:
        raise ValueError("question is required")
    if len(question) > 1000:
        question = question[:1000]

    # --- Verified context (read-only) ---------------------------------------
    context = await build_context(
        db, business.id,
        business_name=business.name or "",
        currency=business.currency or "USD",
    )
    has_data = (
        context["history"]["total_revenue"]
        or context["inventory"]["products"]
        or context["customers"]["total"]
    )

    # --- Model call (JSON mode, one repair retry) ----------------------------
    model = _default_model()
    api_key = secret("OPENAI_API_KEY") or ""
    try:
        provider = build_provider(model, api_key)
        system = build_system_prompt()
        context_json = json.dumps(context, ensure_ascii=False, separators=(",", ":"))
        messages = user_prompt(question, context_json, history or [])
        try:
            result = provider.complete(system, messages)
        except ProviderError:
            raise
        try:
            parsed = _parse_reply(result.text)
        except (ValueError, ValidationError):
            # One honest repair attempt.
            messages = messages + [
                {"role": "assistant", "content": result.text[:2000]},
                {"role": "user", "content": REPAIR_PROMPT},
            ]
            result2 = provider.complete(system, messages)
            result = result2
            parsed = _parse_reply(result2.text)  # raises -> 503 below if still broken
    except ProviderError as exc:
        raise AiUnavailable(str(exc)) from exc
    except (ValueError, ValidationError) as exc:
        raise AiUnavailable("The model's reply failed Co-op's verification contract.") from exc

    if not has_data:
        # Don't spend the owner's time (or credits) on an empty business.
        return {
            "type": "clarify",
            "kind": "clarify",
            "title": "No business data yet",
            "message": ("Co-op doesn't have any data for this business yet. "
                        "Import your products, customers or sales history and I can "
                        "start answering with verified numbers."),
            "basis": {"period": None, "sources": []},
            "follow_ups": ["Import my business data"],
            "links": [{"label": "Go to import", "to": "/import"}],
            "actions": [],
            "actions_rejected": [],
            "source": "assistant",
            "model": None,
            "credits_used": 0,
        }

    # --- Validate the proposal surface (links + actions) ---------------------
    links = validate_links(parsed.links)
    actions, rejected = await validate_actions(parsed.actions, db, business.id)

    credits = await record_usage(
        db,
        business_id=business.id,
        user_id=user_id,
        model=result.model,
        input_tokens=result.input_tokens,
        output_tokens=result.output_tokens,
        answer_kind=parsed.kind,
        request_id=request_id,
    )
    await db.flush()  # assign the usage row; committed with the request

    # If the model asked for a draft that failed business rules, make it
    # visible rather than silent — honesty is the product here.
    message = parsed.message
    for r in rejected:
        message += f"\n\n(Note: I couldn't prepare the requested {r['type'].lower()} — {r['reason']}.)"

    return {
        "type": parsed.type,
        "kind": parsed.kind,
        "title": parsed.title or "Co-op answer",
        "message": message,
        "basis": {"period": parsed.basis.period, "sources": parsed.basis.sources},
        "follow_ups": parsed.follow_ups,
        "links": links,
        "actions": actions,
        "actions_rejected": rejected,
        "source": "assistant",
        "model": result.model,
        "credits_used": credits,
    }
