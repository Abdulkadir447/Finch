"""H3/H5 — configuration and auth hardening.

- DATABASE_URL is required outside testing (no silent SQLite fallback).
- CLERK_FRONTEND_API is required in production (no dev-instance fallback).
"""
from __future__ import annotations

import pytest

from backend import clerk_auth, config


@pytest.fixture
def clean_env(monkeypatch):
    for var in (
        "DATABASE_URL",
        "SUPABASE_DB_URL",
        "CLERK_FRONTEND_API",
        "FINCH_ENV",
        "APP_ENV",
    ):
        monkeypatch.delenv(var, raising=False)


def test_database_url_required_outside_testing(clean_env, monkeypatch):
    monkeypatch.setenv("FINCH_ENV", "production")
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        config.database_url()


def test_database_url_sqlite_only_in_testing(clean_env, monkeypatch):
    monkeypatch.setenv("FINCH_ENV", "testing")
    assert config.database_url().startswith("sqlite+aiosqlite")


def test_postgres_url_rewritten_to_asyncpg(clean_env, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgres://u:p@host:5432/finch")
    assert config.database_url() == "postgresql+asyncpg://u:p@host:5432/finch"


def test_supabase_db_url_alias(clean_env, monkeypatch):
    monkeypatch.setenv("SUPABASE_DB_URL", "postgresql://u:p@host:5432/postgres")
    assert config.database_url() == "postgresql+asyncpg://u:p@host:5432/postgres"


def test_clerk_frontend_api_required_in_production(clean_env, monkeypatch):
    monkeypatch.setenv("FINCH_ENV", "production")
    with pytest.raises(RuntimeError, match="CLERK_FRONTEND_API"):
        clerk_auth.get_frontend_api()


def test_clerk_frontend_api_dev_default(clean_env, monkeypatch):
    monkeypatch.setenv("FINCH_ENV", "development")
    assert clerk_auth.get_frontend_api() == clerk_auth.DEFAULT_FRONTEND_API


def test_clerk_frontend_api_explicit_wins(clean_env, monkeypatch):
    monkeypatch.setenv("FINCH_ENV", "production")
    monkeypatch.setenv("CLERK_FRONTEND_API", "prod.clerk.accounts.dev")
    assert clerk_auth.get_frontend_api() == "prod.clerk.accounts.dev"
