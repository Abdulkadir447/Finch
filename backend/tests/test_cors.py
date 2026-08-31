"""CORS origin resolution (hardening backlog: no open CORS in production)."""

from __future__ import annotations

from backend import main


def test_env_var_wins_in_every_environment(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "https://a.example, https://b.example")
    assert main.cors_allowlist() == ["https://a.example", "https://b.example"]


def test_non_production_defaults_to_open(monkeypatch):
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    monkeypatch.setattr(main, "get_env", lambda: "development")
    assert main.cors_allowlist() == ["*"]

    monkeypatch.setattr(main, "get_env", lambda: "testing")
    assert main.cors_allowlist() == ["*"]


def test_production_uses_config_origins_when_env_unset(monkeypatch):
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    monkeypatch.setattr(main, "get_env", lambda: "production")
    monkeypatch.setattr(
        main,
        "load_config",
        lambda: {"cors": {"origins": ["https://app.coop.example", ""]}},
    )
    assert main.cors_allowlist() == ["https://app.coop.example"]


def test_production_fails_fast_when_nothing_is_configured(monkeypatch):
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    monkeypatch.setattr(main, "get_env", lambda: "production")
    monkeypatch.setattr(main, "load_config", lambda: {"cors": {"origins": []}})
    try:
        main.cors_allowlist()
        raise AssertionError("expected RuntimeError")
    except RuntimeError as e:
        assert "CORS_ORIGINS" in str(e)
