"""LLM providers — the ONLY place a model API is called (Pass 1).

The application layer (ai/service.py) talks to a provider through one tiny
interface: ``complete(system, messages) -> ProviderResult``. Swapping models
(or providers) never touches context building, prompts, schemas, usage or
actions.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional


class ProviderError(Exception):
    """Raised when the model call fails (network, auth, quota, HTTP error)."""


@dataclass
class ProviderResult:
    text: str
    input_tokens: int
    output_tokens: int
    model: str


class BaseProvider:
    name = "base"

    def __init__(self, model: str) -> None:
        self.model = model

    def complete(self, system: str, messages: list[dict[str, str]]) -> ProviderResult:  # pragma: no cover
        raise NotImplementedError


class OpenAIProvider(BaseProvider):
    """OpenAI Chat Completions via httpx (no SDK dependency).

    Requests JSON-mode output so the structured answer contract is reliable.
    The API key comes from the environment (OPENAI_API_KEY) — never stored
    in config files or the frontend.
    """

    name = "openai"
    API_URL = "https://api.openai.com/v1/chat/completions"

    def __init__(self, model: str, api_key: str, timeout_seconds: float = 45.0) -> None:
        super().__init__(model)
        if not api_key:
            raise ProviderError("OpenAI API key is not configured (OPENAI_API_KEY).")
        self.api_key = api_key
        self.timeout_seconds = timeout_seconds

    def complete(self, system: str, messages: list[dict[str, str]]) -> ProviderResult:
        import httpx

        payload: dict[str, Any] = {
            "model": self.model,
            "temperature": 0.2,
            "max_tokens": 900,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": system}, *messages],
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        try:
            resp = httpx.post(
                self.API_URL, json=payload, headers=headers, timeout=self.timeout_seconds
            )
        except httpx.HTTPError as exc:
            raise ProviderError(f"Could not reach the model: {exc.__class__.__name__}") from exc

        if resp.status_code != 200:
            detail = ""
            try:
                detail = resp.json().get("error", {}).get("message", "")[:200]
            except Exception:  # noqa: BLE001
                detail = resp.text[:200]
            raise ProviderError(f"Model error (HTTP {resp.status_code}): {detail}")

        data = resp.json()
        try:
            text: str = data["choices"][0]["message"]["content"]
            usage = data.get("usage", {})
        except (KeyError, IndexError, TypeError) as exc:
            raise ProviderError("Unexpected model response shape.") from exc

        return ProviderResult(
            text=text or "",
            input_tokens=int(usage.get("prompt_tokens", 0) or 0),
            output_tokens=int(usage.get("completion_tokens", 0) or 0),
            model=data.get("model", self.model),
        )


def build_provider(model: Optional[str], api_key: str) -> BaseProvider:
    """Factory: v1 ships OpenAI only. New providers plug in here."""
    if not api_key:
        raise ProviderError("AI is not configured: set OPENAI_API_KEY on the backend.")
    return OpenAIProvider(model=model or "gpt-4o-mini", api_key=api_key)
