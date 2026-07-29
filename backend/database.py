"""
Database connection and session management for FastAPI + SQLAlchemy (async).

Uses MySQL with aiomysql driver. All API endpoints depend on the `get_db()` generator
which yields an AsyncSession that is automatically closed after the request.
"""

from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    create_async_engine,
)
from sqlalchemy.orm import sessionmaker

from .config import database_url as _resolve_database_url
from .models import Base  # Relative import for package mode

# Resolve the database URL via the central config loader (config.py), which pulls
# credentials from the environment only (IPD 1.11 — no secrets in the repo).
# When no cloud credentials are present we fall back to a local SQLite file,
# honouring the offline-first principle (BSD Ch1.11): the app stays usable with
# no cloud connection.
try:
    DATABASE_URL = _resolve_database_url()
except (RuntimeError, FileNotFoundError):
    DATABASE_URL = "sqlite+aiosqlite:///./finch_local.db"

# Engine is created lazily on first use so that importing this module never
# forces the async DB driver to load (which would fail in environments where
# the driver isn't installed). The dialect/driver is only imported when the
# engine is actually instantiated — at runtime, inside the container/podman
# compose stack where the driver is present.
_engine: AsyncEngine | None = None


def get_engine() -> AsyncEngine:
    """Return the shared async engine, creating it on first call."""
    global _engine
    if _engine is None:
        # echo=False: enable only for debugging; never log sensitive data.
        _engine = create_async_engine(DATABASE_URL, echo=False)
    return _engine


def get_sessionmaker() -> sessionmaker:
    """Build a request-scoped async session factory (expire_on_commit=False)."""
    return sessionmaker(get_engine(), class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency generator for FastAPI.

    Yields a single `AsyncSession` and ensures it is always closed – even if an
    exception occurs. This pattern enables request‑scoped database access.
    """
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        try:
            yield session
            await session.commit()  # auto‑commit on successful response
        except Exception:
            await session.rollback()  # rollback on error – caller may re‑raise
            raise
        finally:
            await session.close()


async def init_db() -> None:
    """Initialise the database with our ORM models (run once at startup).

    In a production‑grade app this would be: Alembic migrations. For Phase 1
    we run the `CREATE TABLE IF NOT EXISTS …` statements directly via
    Base.metadata.create_all().
    """
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


# Optional cleanup hook – not required for this phase but useful for tests.
async def dispose_db() -> None:
    """Close all connections and release resources. Call on app shutdown."""
    global _engine
    if _engine is not None:
        await _engine.dispose()
        _engine = None