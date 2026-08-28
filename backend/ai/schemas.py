"""Answer contract (Pass 1) — the structured response the model must return.

The frontend distinguishes fact / calculation / forecast / suggestion / draft
from the `kind` field — it never parses prose. `basis` states the data window
and sources; `actions` carries only registry-approved drafts.
"""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from .prompts import ALLOWED_KINDS, ALLOWED_PERIODS, ALLOWED_SOURCES


class AiBasis(BaseModel):
    period: Optional[str] = None
    sources: list[str] = Field(default_factory=list)

    @field_validator("period")
    @classmethod
    def _check_period(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v in ALLOWED_PERIODS:
            return v
        return None

    @field_validator("sources")
    @classmethod
    def _check_sources(cls, v: list[str]) -> list[str]:
        return [s for s in v if s in ALLOWED_SOURCES][:4]


class AiLink(BaseModel):
    label: str = Field(max_length=60)
    to: str = Field(max_length=200)


class AiAction(BaseModel):
    type: str  # validated against the registry in actions.py
    parameters: dict[str, Any] = Field(default_factory=dict)


class AiChatResponse(BaseModel):
    type: Literal["answer", "clarify"] = "answer"
    kind: str = "fact"
    title: str = Field(default="", max_length=160)
    message: str = Field(default="", max_length=4000)
    basis: AiBasis = Field(default_factory=AiBasis)
    follow_ups: list[str] = Field(default_factory=list)
    links: list[AiLink] = Field(default_factory=list)
    actions: list[AiAction] = Field(default_factory=list)

    @field_validator("kind")
    @classmethod
    def _check_kind(cls, v: str) -> str:
        return v if v in ALLOWED_KINDS else "fact"

    @field_validator("follow_ups", mode="before")
    @classmethod
    def _trim_follow_ups(cls, v: Any) -> list[str]:
        if not isinstance(v, list):
            return []
        out = [str(x)[:120] for x in v if str(x).strip()][:3]
        return out

    @field_validator("links", mode="before")
    @classmethod
    def _trim_links(cls, v: Any) -> Any:
        if not isinstance(v, list):
            return []
        return v[:3]
