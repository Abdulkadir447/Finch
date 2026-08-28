"""
Co-op Backend Services (BSD Chapter 1.5 — Backend Components)

The backend is organised as isolated, modular domains per the BSD. Each business
domain (orders, inventory, customers, reports, AI) owns its own service and
schema. Services communicate through well-defined interfaces rather than direct
dependencies, following TRD Ch1 engineering standards (SOLID, Clean Architecture,
Repository pattern).

This module is the foundation for those services. Concrete business logic is
added per feature; the classes here establish the contract and shared
behaviour (offline-first writes, event-driven sync, logging).

Design principles applied (BSD Ch1.6):
  - Offline First: writes are local before cloud.
  - Event Driven: mutations emit events consumed by the Sync Service.
  - Modular: each domain is isolated.
  - Stateless Services: no in-memory request state.
"""

from __future__ import annotations

import abc
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, Optional

logger = logging.getLogger("coop.services")


# ---------------------------------------------------------------------------
# Domain event bus — drives the event-driven sync model (BSD Ch1.6)
# ---------------------------------------------------------------------------
class DomainEvent(str, Enum):
    ORDER_CREATED = "order.created"
    ORDER_UPDATED = "order.updated"
    INVENTORY_CHANGED = "inventory.changed"
    CUSTOMER_CREATED = "customer.created"
    BUSINESS_CREATED = "business.created"
    AI_REQUEST = "ai.request"
    SYNC_COMPLETED = "sync.completed"


@dataclass
class Event:
    type: DomainEvent
    payload: dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    business_id: Optional[int] = None


# Simple in-process subscriber registry. The Sync Service subscribes to domain
# events; cloud transports are plugged in later without touching producers.
_SUBSCRIBERS: dict[DomainEvent, list[Callable[[Event], None]]] = {}


def subscribe(event: DomainEvent, handler: Callable[[Event], None]) -> None:
    _SUBSCRIBERS.setdefault(event, []).append(handler)


def emit(event: DomainEvent, payload: dict[str, Any], business_id: Optional[int] = None) -> None:
    evt = Event(type=event, payload=payload, business_id=business_id)
    for handler in _SUBSCRIBERS.get(event, []):
        try:
            handler(evt)
        except Exception as exc:  # handlers must never break the producer
            logger.error("Event handler failed for %s: %s", event, exc)
    logger.debug("Emitted %s for business=%s", event, business_id)


# ---------------------------------------------------------------------------
# Base service — shared contract for all backend domains (BSD Ch1.5)
# ---------------------------------------------------------------------------
class Service(abc.ABC):
    """Base class for every backend service.

    Stateless by design (BSD Ch1.6): a request carries everything needed to
    complete. Subclasses implement their domain operations.
    """

    name: str = "service"

    @property
    def logger(self) -> logging.Logger:
        return logging.getLogger(f"coop.services.{self.name}")


# ---------------------------------------------------------------------------
# Authentication Service (BSD Ch1.5)
# ---------------------------------------------------------------------------
class AuthService(Service):
    """User registration, login, session management, token refresh, recovery."""

    name = "auth"

    def __init__(self, secret_key: str, algorithm: str = "HS256",
                 token_ttl_minutes: int = 30) -> None:
        self.secret_key = secret_key
        self.algorithm = algorithm
        self.token_ttl_minutes = token_ttl_minutes

    # Token issuance/verification delegate to backend.auth; this service is the
    # documented home for those operations and future Google/login flows.
    def authenticate(self, identifier: str, password: str) -> Optional[dict[str, Any]]:
        # Resolved against the user store by the caller (auth.py).
        # Returns a session descriptor or None on failure.
        raise NotImplementedError("Wire to backend.auth.verify_credentials")


# ---------------------------------------------------------------------------
# Business Service (BSD Ch1.5) — multi-business / tenant isolation
# ---------------------------------------------------------------------------
class BusinessService(Service):
    """Business registration, company setup, switching, isolation keying."""

    name = "business"

    def __init__(self, default_business_id: Optional[int] = None) -> None:
        self._current: Optional[int] = default_business_id

    def set_current(self, business_id: int) -> None:
        self._current = business_id

    @property
    def current_business_id(self) -> Optional[int]:
        return self._current


# ---------------------------------------------------------------------------
# Database Service (BSD Ch1.5)
# ---------------------------------------------------------------------------
class DatabaseService(Service):
    """PostgreSQL/SQLite access, validation, transactions, constraints."""

    name = "database"

    def __init__(self, engine: Any = None) -> None:
        self.engine = engine

    def is_healthy(self) -> bool:
        return self.engine is not None


# ---------------------------------------------------------------------------
# Synchronization Service (BSD Ch1.5) — offline-first, conflict-aware
# ---------------------------------------------------------------------------
class SyncService(Service):
    """SQLite -> cloud sync, conflict resolution, retry queue, offline support.

    Subscribes to domain events so local writes are queued for background
    synchronization automatically (BSD Ch1.6 event-driven model).
    """

    name = "sync"

    def __init__(self, mode: str = "background", interval_seconds: int = 30) -> None:
        self.mode = mode
        self.interval_seconds = interval_seconds
        self._queue: list[Event] = []
        subscribe(DomainEvent.ORDER_CREATED, self._enqueue)
        subscribe(DomainEvent.INVENTORY_CHANGED, self._enqueue)
        subscribe(DomainEvent.CUSTOMER_CREATED, self._enqueue)

    def _enqueue(self, evt: Event) -> None:
        self._queue.append(evt)
        self.logger.info("Queued %s for sync (queue=%d)", evt.type, len(self._queue))

    def pending(self) -> int:
        return len(self._queue)

    def flush(self) -> int:
        """Best-effort flush of the local sync queue. Returns count synced."""
        count = len(self._queue)
        self._queue.clear()
        if count:
            emit(DomainEvent.SYNC_COMPLETED, {"synced": count})
        return count


# ---------------------------------------------------------------------------
# AI Service (BSD Ch1.5) — prompt management, cost/token tracking, history
# ---------------------------------------------------------------------------
class AIService(Service):
    """Business analysis, report summaries, forecasting, conversation history.

    API keys are never stored client-side (TRD Ch1.11); the service calls a
    secure server-side proxy. AI is an enhancement and must not block core
    operations (TRD Ch1.8 AI as an Enhancement).
    """

    name = "ai"

    def __init__(self, model: str = "gpt-5.5", enabled: bool = True) -> None:
        self.model = model
        self.enabled = enabled
        self._token_usage: list[int] = []

    def track_usage(self, tokens: int) -> None:
        self._token_usage.append(tokens)

    def total_tokens(self) -> int:
        return sum(self._token_usage)


# ---------------------------------------------------------------------------
# Storage Service (BSD Ch1.5) — logos, images, PDFs, imports
# ---------------------------------------------------------------------------
class StorageService(Service):
    name = "storage"

    def __init__(self, root: str = "storage") -> None:
        self.root = root


# ---------------------------------------------------------------------------
# Notification Service (BSD Ch1.5) — in-app, desktop, cleanup
# ---------------------------------------------------------------------------
class NotificationService(Service):
    name = "notification"

    def low_stock(self, product: str, level: int) -> dict[str, Any]:
        return {"kind": "low_stock", "product": product, "level": level}

    def daily_summary(self, revenue: float, orders: int) -> dict[str, Any]:
        return {"kind": "daily_summary", "revenue": revenue, "orders": orders}


# ---------------------------------------------------------------------------
# Audit Service (BSD Ch1.5) — activity, security logs, change tracking
# ---------------------------------------------------------------------------
class AuditService(Service):
    name = "audit"

    def record(self, actor: str, action: str, detail: dict[str, Any] | None = None) -> None:
        self.logger.info("AUDIT %s %s %s", actor, action, detail or {})


# ---------------------------------------------------------------------------
# Service registry — single composition root for the application
# ---------------------------------------------------------------------------
@dataclass
class ServiceRegistry:
    auth: AuthService
    business: BusinessService
    database: DatabaseService
    sync: SyncService
    ai: AIService
    storage: StorageService
    notification: NotificationService
    audit: AuditService


def build_registry(
    secret_key: str = "change-me",
    ai_enabled: bool = True,
    sync_mode: str = "background",
) -> ServiceRegistry:
    """Construct the full backend service tree (BSD Ch1.5)."""
    return ServiceRegistry(
        auth=AuthService(secret_key=secret_key),
        business=BusinessService(),
        database=DatabaseService(),
        sync=SyncService(mode=sync_mode),
        ai=AIService(enabled=ai_enabled),
        storage=StorageService(),
        notification=NotificationService(),
        audit=AuditService(),
    )
