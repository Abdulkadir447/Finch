"""
Runtime configuration loader (IPD Chapter 1.11 — Configuration Management).

Environment-specific, non-secret values live in ``config/<env>.json`` at the
repository root. Secrets (DB passwords, JWT secret, API keys) are NEVER stored
in those files — they are resolved from environment variables at runtime.

Selection order:
    1. ``FINCH_ENV`` env var (development | testing | production)
    2. ``APP_ENV`` env var
    3. default: ``development``
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

VALID_ENVS = ("development", "testing", "production")
DEFAULT_ENV = "development"

# Repository root = parent of the backend package directory.
_REPO_ROOT = Path(__file__).resolve().parent.parent
_CONFIG_DIR = _REPO_ROOT / "config"


def _resolve_env() -> str:
    env = os.getenv("FINCH_ENV") or os.getenv("APP_ENV") or DEFAULT_ENV
    return env if env in VALID_ENVS else DEFAULT_ENV


@lru_cache(maxsize=1)
def load_config(env: str | None = None) -> dict[str, Any]:
    """Load the merged configuration for the given (or active) environment.

    The returned dict is the static, non-secret configuration. Secrets must be
    fetched separately via :func:`secret` so they never persist in the dict.
    """
    env = env or _resolve_env()
    # Validate the resolved env against the allow-list. Without this, a caller
    # passing an arbitrary `env` could traverse the filesystem (e.g. "../secrets").
    if env not in VALID_ENVS:
        env = DEFAULT_ENV
    path = _CONFIG_DIR / f"{env}.json"
    if not path.exists():
        raise FileNotFoundError(
            f"Config file not found: {path}. Expected one of {VALID_ENVS}."
        )
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def get_env() -> str:
    """Return the active environment name."""
    return _resolve_env()


def secret(name: str, default: str | None = None) -> str | None:
    """Resolve a secret from the environment (IPD 1.11 — no secrets in repo)."""
    return os.getenv(name, default)


def get(key: str, default: Any = None) -> Any:
    """Convenience accessor for a top-level config key."""
    return load_config().get(key, default)


# Commonly referenced settings exposed as module-level helpers.
def database_url() -> str:
    """Build the SQLAlchemy database URL, preferring ``DATABASE_URL`` secret."""
    explicit = secret("DATABASE_URL")
    if explicit:
        # Canonical postgres URLs need the async driver scheme for SQLAlchemy.
        if explicit.startswith("postgres://"):
            explicit = "postgresql+asyncpg://" + explicit[len("postgres://"):]
        elif explicit.startswith("postgresql://"):
            explicit = "postgresql+asyncpg://" + explicit[len("postgresql://"):]
        return explicit
    cfg = load_config().get("database", {})
    driver = cfg.get("driver", "mysql+aiomysql")
    host = cfg.get("host", "localhost")
    port = cfg.get("port", 3306)
    name = cfg.get("name", "erp_business_db")
    user = secret("DB_USER", "erp")
    # No hardcoded default password: secrets come from the environment (IPD 1.11).
    # Local dev supplies this via podman-compose's DB_PASSWORD env var.
    password = secret("DB_PASSWORD")
    if password is None:
        raise RuntimeError(
            "DB_PASSWORD environment variable is not set. "
            "Supply it (e.g. via podman-compose) rather than a hardcoded value."
        )
    return f"{driver}://{user}:{password}@{host}:{port}/{name}"
