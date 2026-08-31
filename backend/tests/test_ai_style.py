"""AI response style preference (Settings — AI Preferences): persisted on the
tenant, validated against the allow-list, and reflected in the system prompt."""

from __future__ import annotations

import pytest

from backend.ai.prompts import ALLOWED_AI_RESPONSE_STYLES, build_system_prompt


@pytest.mark.asyncio
async def test_default_style_is_standard(api):
    resp = await api.client.get("/business/settings")
    assert resp.status_code == 200
    assert resp.json()["ai_response_style"] == "standard"


@pytest.mark.asyncio
async def test_style_can_be_changed_and_persists(api):
    resp = await api.client.patch(
        "/business/settings", json={"ai_response_style": "detailed"}
    )
    assert resp.status_code == 200
    assert resp.json()["ai_response_style"] == "detailed"

    resp = await api.client.get("/business/settings")
    assert resp.json()["ai_response_style"] == "detailed"


@pytest.mark.asyncio
async def test_invalid_style_is_rejected(api):
    resp = await api.client.patch(
        "/business/settings", json={"ai_response_style": "shouty"}
    )
    assert resp.status_code == 422
    assert "AI response style" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_every_allow_listed_style_is_accepted(api):
    for style in ALLOWED_AI_RESPONSE_STYLES:
        resp = await api.client.patch(
            "/business/settings", json={"ai_response_style": style}
        )
        assert resp.status_code == 200, style
        assert resp.json()["ai_response_style"] == style


def test_prompt_reflects_the_style():
    assert "STYLE PREFERENCE" not in build_system_prompt("standard")
    assert "extra concise" in build_system_prompt("concise")
    assert "step by step" in build_system_prompt("detailed")
    # Unknown values degrade to standard (no injected guidance).
    assert "STYLE PREFERENCE" not in build_system_prompt("bogus")
