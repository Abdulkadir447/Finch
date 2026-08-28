"""
Co-op API — FastAPI application with Clerk authentication and tenant-scoped
CRUD + Dashboard analytics.

Authentication model (this phase):
  * The frontend sends the Clerk **session token** as ``Authorization: Bearer``.
  * ``clerk_auth.verify_clerk_token`` validates it against Clerk's public JWKS
    (RS256) — no Clerk secret key exists in the backend.
  * Each Clerk user is auto-provisioned a ``Business`` tenant on first
    authenticated request (AFD Ch1.10 Company Setup); every query is scoped
    to that tenant via ``business_id`` (BSD Ch1.8 multi-tenant isolation).
"""

import os
from contextlib import asynccontextmanager
from datetime import date, datetime, time, timedelta
from typing import Any, Dict, List, Optional

from pydantic import BaseModel

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import case, func, or_, select, text
from sqlalchemy import update as sa_update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from . import briefing as briefing_mod
from . import importer
from .clerk_auth import ClerkUser, get_frontend_api, verify_clerk_token
from .database import dispose_db, get_db, init_db
from .models import Business, Customer, Order, OrderItem, Product, StockMovement, StockMovementReason
from .schemas import (
    ALLOWED_CURRENCIES,
    ALLOWED_TIMEZONES,
    AdjustStockRequest,
    AuthMeResponse,
    BusinessSettingsOut,
    BusinessSettingsUpdate,
    CategoryValue,
    CustomerCreate,
    CustomerListResponse,
    CustomerOut,
    CustomerUpdate,
    DashboardSummary,
    GrowthResponse,
    InventorySummary,
    MovementListResponse,
    OrderCreate,
    OrderListResponse,
    OrderOut,
    OrderUpdate,
    ProductCreate,
    ProductListResponse,
    ProductOut,
    ProductUpdate,
    RevenueMonthResponse,
    RevenueTodayResponse,
    StockMovementOut,
    TimeseriesPoint,
    TopProductItem,
)

# ---------------------------------------------------------------------------
# FastAPI Application
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Fail fast in production when Clerk is not configured (Task 11 / audit
    # H5): get_frontend_api raises unless CLERK_FRONTEND_API is set there.
    get_frontend_api()
    # Additive dev bootstrap: CREATE TABLE IF NOT EXISTS via the ORM. Alembic
    # migrations (backend/alembic) are the real migration path; this never
    # alters existing tables.
    await init_db()
    yield
    await dispose_db()


app = FastAPI(
    title="Co-op",
    openapi_url="/docs/openapi.json",
    docs_url="/docs",
    lifespan=lifespan,
)

# CORS: Bearer-token auth (no cookies), so '*' without credentials is a safe
# dev default. Set CORS_ORIGINS to a comma-separated allow-list to tighten it
# (e.g. https://app.coop.example) (Task 12 polish).
_cors_origins = [
    o.strip()
    for o in os.getenv("CORS_ORIGINS", "*").split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Order statuses that count toward revenue/profit (not pending/cancelled).
_ACTIVE_STATUSES = ["shipped", "delivered"]


# ---------------------------------------------------------------------------
# Shared "low stock" definition (Task 12 / M9).
#
# ONE definition used by every dashboard/inventory surface, mutually exclusive
# with out-of-stock so a product is never double-counted:
#   low = in stock (current_stock > 0) but at/below the reorder level
#   out = current_stock == 0
# ---------------------------------------------------------------------------
def _strictly_low_stock_case():
    return case(
        (Product.current_stock == 0, 0),
        (Product.current_stock <= Product.reorder_level, 1),
        else_=0,
    )


def _out_of_stock_case():
    return case((Product.current_stock == 0, 1), else_=0)


# ---------------------------------------------------------------------------
# Tenant dependency — Clerk user -> auto-provisioned Business
# ---------------------------------------------------------------------------

async def get_current_business(
    user: ClerkUser = Depends(verify_clerk_token),
    db: AsyncSession = Depends(get_db),
) -> Business:
    """Resolve the caller's business, creating it on first use."""
    stmt = select(Business).where(
        Business.owner_id == user.user_id,
        Business.deleted_at.is_(None),
    ).order_by(Business.id).limit(1)
    business = (await db.execute(stmt)).scalars().first()

    if business is None:
        business = Business(
            name="My Business",
            owner_id=user.user_id,
            currency="USD",
            created_by=user.user_id,
        )
        db.add(business)
        await db.flush()

    return business


def _scoped(model):
    """Base filter: only live rows belonging to the caller's tenant."""
    return [model.business_id == Business.id, model.deleted_at.is_(None)]


# ---------------------------------------------------------------------------
# Health / Root (public)
# ---------------------------------------------------------------------------

@app.get("/healthcheck", tags=["Health"])
async def healthcheck(db: AsyncSession = Depends(get_db)) -> dict:
    """Liveness + database readiness (Task 12 polish).

    Returns 200 when the API and its database are reachable, 503 otherwise.
    """
    try:
        await db.execute(text("SELECT 1"))
    except Exception:
        raise HTTPException(status_code=503, detail="database unavailable")
    return {"status": "healthy", "database": "up"}


@app.get("/", tags=["Root"])
async def read_root() -> dict:
    return {"message": "Welcome to Co-op API"}


# ---------------------------------------------------------------------------
# Authentication info
# ---------------------------------------------------------------------------

@app.get("/auth/me", response_model=AuthMeResponse, tags=["Authentication"])
async def auth_me(business: Business = Depends(get_current_business)) -> AuthMeResponse:
    """Identity + tenant for the signed-in user (Clerk-verified)."""
    return AuthMeResponse(
        user_id=business.owner_id or "",
        business_id=business.id,
        business_name=business.name,
        currency=business.currency or "USD",
    )


# ---------------------------------------------------------------------------
# Settings — Company Settings (tenant-scoped, Task 9, UXDS 15.6)
# ---------------------------------------------------------------------------

@app.get("/business/settings", response_model=BusinessSettingsOut, tags=["Settings"])
async def get_business_settings(
    business: Business = Depends(get_current_business),
) -> Business:
    """Company settings for the caller's tenant (auto-provisioned)."""
    return business


@app.patch("/business/settings", response_model=BusinessSettingsOut, tags=["Settings"])
async def update_business_settings(
    updates: BusinessSettingsUpdate,
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> Business:
    """Update whitelisted company settings. Identity fields are immutable."""
    data = updates.model_dump(exclude_unset=True)

    # Explicit enum validation beyond Pydantic length checks.
    if "currency" in data and data["currency"] is not None:
        code = data["currency"].upper()
        if code not in ALLOWED_CURRENCIES:
            raise HTTPException(
                status_code=422,
                detail=f"Unsupported currency '{data['currency']}'. "
                       f"Allowed: {', '.join(sorted(ALLOWED_CURRENCIES))}",
            )
        data["currency"] = code
    if "timezone" in data and data["timezone"] is not None:
        if data["timezone"] not in ALLOWED_TIMEZONES:
            raise HTTPException(
                status_code=422,
                detail=f"Unsupported timezone '{data['timezone']}'.",
            )

    # Only schema-whitelisted fields can ever be set here (owner_id, id,
    # timestamps, version are not part of BusinessSettingsUpdate).
    for field, value in data.items():
        setattr(business, field, value)
    business.updated_by = business.owner_id

    await db.flush()
    await db.refresh(business)
    return business


# ---------------------------------------------------------------------------
# Products CRUD (tenant-scoped)
# ---------------------------------------------------------------------------

def _log_movement(
    db: AsyncSession,
    business_id: int,
    product_id: int,
    change: int,
    reason: StockMovementReason,
    actor: Optional[str],
    note: Optional[str] = None,
    order_id: Optional[int] = None,
) -> None:
    """Append one immutable row to the stock ledger (Task 8)."""
    db.add(
        StockMovement(
            business_id=business_id,
            product_id=product_id,
            change=change,
            reason=reason,
            note=note,
            order_id=order_id,
            actor=actor,
        )
    )


async def _change_stock(
    db: AsyncSession,
    business_id: int,
    product: Product,
    delta: int,
    reason: StockMovementReason,
    actor: Optional[str],
    note: Optional[str] = None,
    order_id: Optional[int] = None,
) -> None:
    """Apply a signed stock change under the optimistic-lock guard.

    This is the SINGLE choke point for every stock mutation (Task 11 / audit
    H1): manual adjustments, order creation (deduct), cancellation and
    deletion (restore). The version-guarded UPDATE means a caller holding a
    stale ``product.version`` (a concurrent writer already changed the row)
    matches 0 rows and aborts with 409, so no write is ever lost and stock can
    never be double-deducted or double-restored.
    """
    if delta == 0:
        raise HTTPException(status_code=422, detail="Stock change must be non-zero")

    current = product.current_stock or 0
    new_level = current + delta
    if new_level < 0:
        raise HTTPException(
            status_code=409,
            detail=f"Insufficient stock: {current} available, {-delta} requested",
        )

    result = await db.execute(
        sa_update(Product)
        .where(Product.id == product.id, Product.version == product.version)
        .values(
            current_stock=new_level,
            version=product.version + 1,
            updated_by=actor,
        )
        .execution_options(synchronize_session=False)
    )
    if result.rowcount == 0:
        raise HTTPException(
            status_code=409, detail="Stock changed concurrently — please retry"
        )

    # Keep the in-session object consistent with the row we just wrote.
    product.current_stock = new_level
    product.version = product.version + 1
    product.updated_by = actor

    _log_movement(
        db, business_id, product.id, delta, reason, actor,
        note=note, order_id=order_id,
    )


@app.post("/products", response_model=ProductOut, status_code=status.HTTP_201_CREATED, tags=["Products"])
async def create_product(
    product: ProductCreate,
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> ProductOut:
    # Duplicate check: live rows only — a soft-deleted product's SKU is
    # reusable (Task 10). The partial unique index enforces the same rule
    # at the database level.
    stmt = select(Product).where(
        Product.sku == product.sku,
        Product.business_id == business.id,
        Product.deleted_at.is_(None),
    )
    if (await db.execute(stmt)).scalars().first():
        raise HTTPException(status_code=409, detail="SKU already exists")

    new_product = Product(**product.model_dump(), business_id=business.id, created_by=business.owner_id)
    db.add(new_product)
    try:
        await db.flush()
    except IntegrityError:
        # Safety net: any uniqueness collision (e.g. race) surfaces as a
        # clean 409 instead of an unhandled 500 (Task 10 / audit fix B-1).
        raise HTTPException(status_code=409, detail="SKU already exists")
    # Initial stock (if any) is the first ledger entry (UXDS 11.9).
    if new_product.current_stock:
        _log_movement(
            db, business.id, new_product.id, new_product.current_stock,
            StockMovementReason.initial, business.owner_id,
        )
    await db.refresh(new_product)
    return new_product


@app.get("/products", response_model=ProductListResponse, tags=["Products"])
async def list_products(
    search: Optional[str] = Query(None, min_length=1),
    low_stock: bool = Query(False, description="Only products in stock but at/below their reorder level"),
    stock: Optional[str] = Query(
        None, description="Stock status filter: in | low | out (Task 8)"
    ),
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> ProductListResponse:
    """Paginated, searchable product listing (Task 5 envelope)."""
    base = select(Product).where(Product.business_id == business.id, Product.deleted_at.is_(None))
    if low_stock:
        # Shared definition: strictly low (in stock but at/below reorder).
        base = base.where(Product.current_stock > 0, Product.current_stock <= Product.reorder_level)
    if stock is not None:
        if stock not in {"in", "low", "out"}:
            raise HTTPException(status_code=422, detail="stock must be one of: in, low, out")
        if stock == "out":
            base = base.where(Product.current_stock == 0)
        elif stock == "low":
            base = base.where(Product.current_stock > 0, Product.current_stock <= Product.reorder_level)
        else:  # "in"
            base = base.where(Product.current_stock > Product.reorder_level)
    if search:
        like = f"%{search.lower()}%"
        base = base.where(
            or_(Product.name.ilike(like), Product.sku.ilike(like), Product.category.ilike(like))
        )

    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    rows = (await db.execute(
        base.order_by(Product.id.desc()).offset((page - 1) * limit).limit(limit)
    )).scalars().all()

    return ProductListResponse(items=rows, total=total, page=page, limit=limit)


@app.get("/products/{id}", response_model=ProductOut, tags=["Products"])
async def get_product(
    id: int,
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> ProductOut:
    stmt = select(Product).where(Product.id == id, Product.business_id == business.id, Product.deleted_at.is_(None))
    product = (await db.execute(stmt)).scalars().first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


@app.put("/products/{id}", response_model=ProductOut, tags=["Products"])
async def update_product(
    id: int,
    updates: ProductUpdate,
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> ProductOut:
    product = await get_product(id, business, db)
    for field, value in updates.model_dump(exclude_unset=True).items():
        setattr(product, field, value)
    product.updated_by = business.owner_id
    await db.flush()
    await db.refresh(product)
    return product


@app.delete("/products/{id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Products"])
async def delete_product(
    id: int,
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> None:
    product = await get_product(id, business, db)
    # Soft delete (BSD Ch1.17 / Ch2.12).
    product.deleted_at = datetime.utcnow()
    product.deleted_by = business.owner_id
    await db.flush()


# ---------------------------------------------------------------------------
# Inventory (tenant-scoped) — Task 8: stock adjustments, movement ledger,
# module summary. After creation, stock changes ONLY through /adjust here.
# ---------------------------------------------------------------------------

@app.post("/products/{id}/adjust", response_model=ProductOut, tags=["Inventory"])
async def adjust_stock(
    id: int,
    req: AdjustStockRequest,
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> ProductOut:
    """Apply a signed stock adjustment and log it to the ledger (UXDS 11.11)."""
    if req.change == 0:
        raise HTTPException(status_code=422, detail="Adjustment change must be non-zero")

    product = await get_product(id, business, db)
    await _change_stock(
        db, business.id, product, req.change,
        StockMovementReason(req.reason.value), business.owner_id, note=req.note,
    )
    await db.flush()
    await db.refresh(product)
    return product


@app.get("/products/{id}/movements", response_model=MovementListResponse, tags=["Inventory"])
async def list_movements(
    id: int,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> MovementListResponse:
    """Immutable stock-movement ledger for one product, newest first (UXDS 11.12)."""
    await get_product(id, business, db)  # 404 for unknown/cross-tenant products
    base = select(StockMovement).where(
        StockMovement.business_id == business.id, StockMovement.product_id == id
    )
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    rows = (await db.execute(
        base.order_by(StockMovement.id.desc()).offset((page - 1) * limit).limit(limit)
    )).scalars().all()
    return MovementListResponse(items=rows, total=total, page=page, limit=limit)


@app.get("/inventory/summary", response_model=InventorySummary, tags=["Inventory"])
async def inventory_summary(
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> InventorySummary:
    """Inventory KPI row (UXDS 11.5): products, value, low, out, categories."""
    scope = [Product.business_id == business.id, Product.deleted_at.is_(None)]
    row = (await db.execute(
        select(
            func.count(Product.id),
            func.coalesce(func.sum(Product.current_stock * func.coalesce(Product.cost_price, Product.unit_price)), 0.0),
            func.coalesce(func.sum(_strictly_low_stock_case()), 0),
            func.coalesce(func.sum(_out_of_stock_case()), 0),
        ).where(*scope)
    )).one()
    categories = (await db.execute(
        select(func.count(func.distinct(Product.category))).where(*scope, Product.category.is_not(None))
    )).scalar() or 0
    return InventorySummary(
        products_count=row[0],
        inventory_value=row[1],
        low_stock_count=row[2],
        out_of_stock_count=row[3],
        categories_count=categories,
    )


# ---------------------------------------------------------------------------
# Customers CRUD (tenant-scoped)
# ---------------------------------------------------------------------------

@app.post("/customers", response_model=CustomerOut, status_code=status.HTTP_201_CREATED, tags=["Customers"])
async def create_customer(
    customer: CustomerCreate,
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> CustomerOut:
    # Duplicate guard covers LIVE rows only (Task 11 / audit H2): a
    # soft-deleted customer's email is reusable, matching the partial unique
    # index on (business_id, email) WHERE deleted_at IS NULL.
    stmt = select(Customer).where(
        Customer.email == customer.email,
        Customer.business_id == business.id,
        Customer.deleted_at.is_(None),
    )
    if (await db.execute(stmt)).scalars().first():
        raise HTTPException(status_code=409, detail="Email already exists")

    new_customer = Customer(**customer.model_dump(), business_id=business.id, created_by=business.owner_id)
    db.add(new_customer)
    await db.flush()
    await db.refresh(new_customer)
    return new_customer


@app.get("/customers", response_model=CustomerListResponse, tags=["Customers"])
async def list_customers(
    search: Optional[str] = Query(None, min_length=1),
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> CustomerListResponse:
    """Paginated, searchable customer listing (Task 6 envelope)."""
    base = select(Customer).where(Customer.business_id == business.id, Customer.deleted_at.is_(None))
    if search:
        like = f"%{search.lower()}%"
        base = base.where(
            or_(Customer.full_name.ilike(like), Customer.email.ilike(like), Customer.company.ilike(like))
        )

    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    rows = (await db.execute(
        base.order_by(Customer.id.desc()).offset((page - 1) * limit).limit(limit)
    )).scalars().all()

    return CustomerListResponse(items=rows, total=total, page=page, limit=limit)


@app.get("/customers/{id}", response_model=CustomerOut, tags=["Customers"])
async def get_customer(
    id: int,
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> CustomerOut:
    stmt = select(Customer).where(Customer.id == id, Customer.business_id == business.id, Customer.deleted_at.is_(None))
    customer = (await db.execute(stmt)).scalars().first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer


@app.put("/customers/{id}", response_model=CustomerOut, tags=["Customers"])
async def update_customer(
    id: int,
    updates: CustomerUpdate,
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> CustomerOut:
    customer = await get_customer(id, business, db)

    # Per-tenant email duplicate guard (excluding the record being updated).
    if updates.email is not None and updates.email != customer.email:
        stmt = select(Customer).where(
            Customer.business_id == business.id,
            Customer.email == updates.email,
            Customer.id != id,
            Customer.deleted_at.is_(None),
        )
        if (await db.execute(stmt)).scalars().first():
            raise HTTPException(status_code=409, detail="Email already exists")

    for field, value in updates.model_dump(exclude_unset=True).items():
        setattr(customer, field, value)
    customer.updated_by = business.owner_id
    await db.flush()
    await db.refresh(customer)
    return customer


@app.delete("/customers/{id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Customers"])
async def delete_customer(
    id: int,
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> None:
    customer = await get_customer(id, business, db)
    customer.deleted_at = datetime.utcnow()
    customer.deleted_by = business.owner_id
    await db.flush()


# ---------------------------------------------------------------------------
# Orders (tenant-scoped) — Task 7: transactional stock handling,
# guarded status transitions, pagination envelope.
#
# Inventory policy:
#   * Stock is deducted exactly once, at order creation, after ALL items
#     validate. Any failure raises before the order is added, and get_db's
#     request-scoped rollback guarantees inventory is left unchanged.
#   * Stock is restored exactly once — on cancellation, or on deletion of an
#     order that was not already cancelled.
#   * Prices are snapshots: the submitted unit_price is stored as-is.
# ---------------------------------------------------------------------------

# Legal status transitions (MVP): shipped cannot be cancelled; delivered and
# cancelled are terminal.
ALLOWED_ORDER_TRANSITIONS: dict[str, set[str]] = {
    "pending": {"confirmed", "cancelled"},
    "confirmed": {"shipped", "cancelled"},
    "shipped": {"delivered"},
    "delivered": set(),
    "cancelled": set(),
}


async def _load_order(id: int, business: Business, db: AsyncSession) -> Order:
    """Tenant-scoped ORM fetch with relationships; 404 when absent."""
    stmt = (
        select(Order)
        .options(
            selectinload(Order.customer),
            selectinload(Order.items).selectinload(OrderItem.product),
        )
        .where(Order.id == id, Order.business_id == business.id, Order.deleted_at.is_(None))
    )
    order = (await db.execute(stmt)).scalars().first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


def _serialize_order(order: Order) -> OrderOut:
    from .schemas import OrderItemOut, OrderStatus as SchemaOrderStatus  # local import: avoids cycle at module load

    current = order.status.value if hasattr(order.status, "value") else str(order.status)
    allowed = [
        SchemaOrderStatus(s)
        for s in sorted(ALLOWED_ORDER_TRANSITIONS.get(current, set()))
    ]

    return OrderOut(
        id=order.id,
        customer_id=order.customer_id,
        customer=order.customer,
        status=order.status,
        allowed_transitions=allowed,
        total_amount=order.total_amount,
        order_date=order.order_date,
        created_at=order.created_at,
        items=[
            OrderItemOut(
                id=item.id,
                product_id=item.product_id,
                product_name=item.product.name if item.product is not None else None,
                quantity=item.quantity,
                unit_price=item.unit_price,
                total_price=item.total_price,
            )
            for item in order.items
        ],
    )


async def _restore_stock(
    db: AsyncSession, order: Order, actor: Optional[str], reason: StockMovementReason
) -> None:
    """Return each line's quantity to its product's stock and log it.

    Goes through ``_change_stock`` so restoration is subject to the same
    optimistic-lock guard as deduction — no lost or duplicated restores.
    """
    for item in order.items:
        if item.product is not None:
            await _change_stock(
                db, order.business_id, item.product, item.quantity,
                reason, actor, order_id=order.id,
            )


@app.post("/orders", response_model=OrderOut, status_code=status.HTTP_201_CREATED, tags=["Orders"])
async def create_order(
    order: OrderCreate,
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> OrderOut:
    customer = await get_customer(order.customer_id, business, db)

    # ---- Validation phase (SELECTs only; nothing written yet) -------------
    seen_product_ids: set[int] = set()
    lines: list[tuple[Product, type(order.items[0])]] = []
    for item in order.items:
        if item.product_id in seen_product_ids:
            raise HTTPException(
                status_code=422,
                detail=f"Duplicate order line for product id {item.product_id}",
            )
        seen_product_ids.add(item.product_id)
        product = await get_product(item.product_id, business, db)  # 404 cross-tenant
        if (product.current_stock or 0) < item.quantity:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Insufficient stock for '{product.name}': "
                    f"{product.current_stock or 0} available, {item.quantity} requested"
                ),
            )
        lines.append((product, item))

    # ---- Application phase (single request transaction; rollback-safe) ----
    total = 0.0
    item_models: List[OrderItem] = []
    for product, item in lines:
        line_total = round(item.unit_price * item.quantity, 2)
        total += line_total
        item_models.append(
            OrderItem(
                business_id=business.id,
                product_id=product.id,
                quantity=item.quantity,
                unit_price=item.unit_price,  # snapshot price (Task 7 policy)
                total_price=line_total,
                created_by=business.owner_id,
            )
        )

    new_order = Order(
        business_id=business.id,
        customer_id=customer.id,
        status=order.status or "pending",
        total_amount=round(total, 2),
        created_by=business.owner_id,
        items=item_models,
    )
    db.add(new_order)
    # Flush assigns new_order.id, needed as the ledger reference below.
    await db.flush()

    # Deduct one line at a time under the optimistic lock (Task 11 / audit H1).
    # A stale version on ANY line aborts the whole request; get_db rolls back,
    # leaving both the order and all stock untouched.
    for product, item in lines:
        await _change_stock(
            db, business.id, product, -item.quantity,
            StockMovementReason.order, business.owner_id, order_id=new_order.id,
        )
    return _serialize_order(await _load_order(new_order.id, business, db))


def _parse_order_id(term: str) -> Optional[int]:
    """Parse an order id out of a search term (Task 12 / M7).

    Accepts the forms the UI shows and users type: ``12``, ``0012``,
    ``#ORD-0012`` and ``ORD-0012`` all resolve to order id 12. Returns None
    when the term does not look like an order reference (so it can still match
    a customer name via ILIKE).
    """
    t = term.strip().upper()
    if t.startswith("#"):
        t = t[1:]
    if t.startswith("ORD-"):
        t = t[len("ORD-"):]
    t = t.lstrip("0") or "0"
    if t.isdigit():
        return int(t)
    return None


@app.get("/orders", response_model=OrderListResponse, tags=["Orders"])
async def list_orders(
    status_filter: Optional[str] = Query(None, alias="status"),
    search: Optional[str] = Query(None, min_length=1),
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> OrderListResponse:
    base = (
        select(Order)
        .options(selectinload(Order.customer), selectinload(Order.items).selectinload(OrderItem.product))
        .where(Order.business_id == business.id, Order.deleted_at.is_(None))
    )
    if status_filter:
        base = base.where(Order.status == status_filter)
    if search:
        like = f"%{search.strip().lower()}%"
        conditions = [Customer.full_name.ilike(like)]
        order_id = _parse_order_id(search)
        if order_id is not None:
            conditions.append(Order.id == order_id)
        base = base.join(Customer, Order.customer_id == Customer.id).where(or_(*conditions))
    if start_date:
        base = base.where(Order.created_at >= start_date)
    if end_date:
        base = base.where(Order.created_at <= end_date)

    total = (await db.execute(select(func.count()).select_from(base.order_by(None).subquery()))).scalar() or 0
    rows = (await db.execute(
        base.order_by(Order.id.desc()).offset((page - 1) * limit).limit(limit)
    )).scalars().all()

    return OrderListResponse(
        items=[_serialize_order(o) for o in rows], total=total, page=page, limit=limit
    )


@app.get("/orders/{id}", response_model=OrderOut, tags=["Orders"])
async def get_order(
    id: int,
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> OrderOut:
    return _serialize_order(await _load_order(id, business, db))


@app.put("/orders/{id}/status", response_model=OrderOut, tags=["Orders"])
async def update_order_status(
    id: int,
    updates: OrderUpdate,
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> OrderOut:
    order = await _load_order(id, business, db)
    if updates.status is None:
        return _serialize_order(order)

    current = order.status.value if hasattr(order.status, "value") else str(order.status)
    requested = updates.status.value if hasattr(updates.status, "value") else str(updates.status)

    if requested not in ALLOWED_ORDER_TRANSITIONS.get(current, set()):
        raise HTTPException(
            status_code=409,
            detail=f"Cannot transition order from '{current}' to '{requested}'",
        )

    # Cancellation restores stock exactly once (Task 7 policy) and logs it.
    if requested == "cancelled":
        await _restore_stock(db, order, business.owner_id, StockMovementReason.order_cancelled)

    order.status = updates.status
    order.updated_by = business.owner_id
    await db.flush()
    await db.refresh(order)
    # Re-load relationships refreshed by the stock restore.
    return _serialize_order(await _load_order(id, business, db))


@app.delete("/orders/{id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Orders"])
async def delete_order(
    id: int,
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> None:
    order = await _load_order(id, business, db)
    # Restore stock unless already cancelled (which already restored once).
    current = order.status.value if hasattr(order.status, "value") else str(order.status)
    if current != "cancelled":
        await _restore_stock(db, order, business.owner_id, StockMovementReason.order_deleted)
    order.deleted_at = datetime.utcnow()
    order.deleted_by = business.owner_id
    await db.flush()


# ---------------------------------------------------------------------------
# Dashboard Analytics (tenant-scoped)
# ---------------------------------------------------------------------------

def _first_day_of_month(dt: date) -> date:
    return dt.replace(day=1)


def _next_month_start(dt: date) -> date:
    return date(dt.year + 1, 1, 1) if dt.month == 12 else date(dt.year, dt.month + 1, 1)


@app.get("/dashboard/summary", response_model=DashboardSummary, tags=["Dashboard"])
async def dashboard_summary(
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> DashboardSummary:
    """One round-trip KPI bundle for the Dashboard."""
    today = date.today()
    first_this = _first_day_of_month(today)
    first_next = _next_month_start(today)
    first_last = date(today.year, today.month - 1, 1) if today.month > 1 else date(today.year - 1, 12, 1)

    bid = business.id
    order_scope = [Order.business_id == bid, Order.deleted_at.is_(None)]

    # Revenue/orders today (delivered).
    today_row = (await db.execute(
        select(func.coalesce(func.sum(Order.total_amount), 0.0), func.count(Order.id))
        .where(*order_scope, Order.status == "delivered", Order.order_date >= datetime.combine(today, time.min))
    )).one()

    # Revenue/orders this month (shipped + delivered).
    month_row = (await db.execute(
        select(func.coalesce(func.sum(Order.total_amount), 0.0), func.count(Order.id))
        .where(*order_scope, Order.status.in_(_ACTIVE_STATUSES),
               Order.order_date >= datetime.combine(first_this, time.min),
               Order.order_date < datetime.combine(first_next, time.min))
    )).one()

    # Last month revenue -> growth %.
    last_rev = (await db.execute(
        select(func.coalesce(func.sum(Order.total_amount), 0.0))
        .where(*order_scope, Order.status.in_(_ACTIVE_STATUSES),
               Order.order_date >= datetime.combine(first_last, time.min),
               Order.order_date < datetime.combine(first_this, time.min))
    )).scalar() or 0.0
    growth = round(((month_row[0] - last_rev) / last_rev) * 100, 2) if last_rev else None

    # Profit this month: sum((unit_price - cost_price) * qty) over order items.
    profit = (await db.execute(
        select(func.coalesce(
            func.sum((OrderItem.unit_price - func.coalesce(Product.cost_price, 0.0)) * OrderItem.quantity),
            0.0,
        ))
        .join(Order, Order.id == OrderItem.order_id)
        .join(Product, Product.id == OrderItem.product_id)
        .where(Order.business_id == bid, Order.deleted_at.is_(None),
               Order.status.in_(_ACTIVE_STATUSES),
               Order.order_date >= datetime.combine(first_this, time.min),
               Order.order_date < datetime.combine(first_next, time.min))
    )).scalar() or 0.0

    # Inventory metrics (low/out use the shared mutually-exclusive definition).
    inv_row = (await db.execute(
        select(
            func.count(Product.id),
            func.coalesce(func.sum(Product.current_stock * func.coalesce(Product.cost_price, Product.unit_price)), 0.0),
            func.coalesce(func.sum(_strictly_low_stock_case()), 0),
            func.coalesce(func.sum(_out_of_stock_case()), 0),
        ).where(Product.business_id == bid, Product.deleted_at.is_(None))
    )).one()

    # Customers.
    cust_total = (await db.execute(
        select(func.count(Customer.id)).where(Customer.business_id == bid, Customer.deleted_at.is_(None))
    )).scalar() or 0
    cust_new = (await db.execute(
        select(func.count(Customer.id)).where(
            Customer.business_id == bid, Customer.deleted_at.is_(None),
            Customer.created_at >= datetime.combine(first_this, time.min))
    )).scalar() or 0

    return DashboardSummary(
        revenue_today=today_row[0],
        orders_today=today_row[1],
        revenue_month=month_row[0],
        orders_month=month_row[1],
        revenue_growth_percent=growth,
        profit_month=round(profit, 2),
        products_count=inv_row[0],
        inventory_value=inv_row[1],
        low_stock_count=inv_row[2],
        out_of_stock_count=inv_row[3],
        customers_total=cust_total,
        customers_new_month=cust_new,
    )


@app.get("/dashboard/revenue/timeseries", response_model=List[TimeseriesPoint], tags=["Dashboard"])
async def revenue_timeseries(
    days: int = Query(30, ge=7, le=365),
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> List[TimeseriesPoint]:
    """Daily revenue/orders for the Revenue chart (missing days are omitted;
    the frontend fills gaps with zeros rather than inventing data)."""
    since = datetime.combine(date.today() - timedelta(days=days - 1), time.min)
    day = func.date(Order.order_date).label("day")
    rows = (await db.execute(
        select(day, func.coalesce(func.sum(Order.total_amount), 0.0), func.count(Order.id))
        .where(Order.business_id == business.id, Order.deleted_at.is_(None),
               Order.status.in_(_ACTIVE_STATUSES), Order.order_date >= since)
        .group_by(day)
        .order_by(day)
    )).all()
    return [
        TimeseriesPoint(date=str(row[0]), revenue=row[1], orders=row[2])
        for row in rows
    ]


@app.get("/dashboard/inventory/by-category", response_model=List[CategoryValue], tags=["Dashboard"])
async def inventory_by_category(
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> List[CategoryValue]:
    """Inventory value grouped by category for the donut chart."""
    category = func.coalesce(Product.category, "Uncategorized").label("category")
    value = func.sum(Product.current_stock * func.coalesce(Product.cost_price, Product.unit_price)).label("value")
    rows = (await db.execute(
        select(category, value)
        .where(Product.business_id == business.id, Product.deleted_at.is_(None))
        .group_by(category)
        .order_by(value.desc())
    )).all()
    return [CategoryValue(category=row[0], value=row[1] or 0.0) for row in rows]


@app.get("/dashboard/revenue/today", response_model=RevenueTodayResponse, tags=["Dashboard"])
async def revenue_today(
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> RevenueTodayResponse:
    row = (await db.execute(
        select(func.coalesce(func.sum(Order.total_amount), 0.0), func.count(Order.id))
        .where(Order.business_id == business.id, Order.deleted_at.is_(None),
               Order.status == "delivered",
               Order.order_date >= datetime.combine(date.today(), time.min))
    )).one()
    return RevenueTodayResponse(total_revenue=row[0], delivered_orders=row[1])


@app.get("/dashboard/revenue/month", response_model=RevenueMonthResponse, tags=["Dashboard"])
async def revenue_current_month(
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> RevenueMonthResponse:
    today = date.today()
    row = (await db.execute(
        select(func.coalesce(func.sum(Order.total_amount), 0.0), func.count(Order.id))
        .where(Order.business_id == business.id, Order.deleted_at.is_(None),
               Order.status.in_(_ACTIVE_STATUSES),
               Order.order_date >= datetime.combine(_first_day_of_month(today), time.min),
               Order.order_date < datetime.combine(_next_month_start(today), time.min))
    )).one()
    return RevenueMonthResponse(total_revenue=row[0], total_orders=row[1])


@app.get("/dashboard/growth", response_model=GrowthResponse, tags=["Dashboard"])
async def growth_monthly_revenue(
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> GrowthResponse:
    today = date.today()
    first_this = _first_day_of_month(today)
    first_last = date(today.year, today.month - 1, 1) if today.month > 1 else date(today.year - 1, 12, 1)
    scope = [Order.business_id == business.id, Order.deleted_at.is_(None), Order.status.in_(_ACTIVE_STATUSES)]

    this_rev = (await db.execute(
        select(func.coalesce(func.sum(Order.total_amount), 0.0)).where(
            *scope,
            Order.order_date >= datetime.combine(first_this, time.min),
            Order.order_date < datetime.combine(_next_month_start(today), time.min))
    )).scalar() or 0.0
    last_rev = (await db.execute(
        select(func.coalesce(func.sum(Order.total_amount), 0.0)).where(
            *scope,
            Order.order_date >= datetime.combine(first_last, time.min),
            Order.order_date < datetime.combine(first_this, time.min))
    )).scalar() or 0.0

    growth = round(((this_rev - last_rev) / last_rev) * 100, 2) if last_rev else None
    return GrowthResponse(this_month_revenue=this_rev, last_month_revenue=last_rev, growth_percent=growth)


@app.get("/dashboard/low-stock", response_model=int, tags=["Dashboard"])
async def low_stock_items(
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> int:
    # Same definition as dashboard/inventory summaries (strictly low: in stock
    # but at/below the reorder level, excluding out-of-stock products).
    stmt = select(func.count(Product.id)).where(
        Product.business_id == business.id, Product.deleted_at.is_(None),
        Product.current_stock > 0,
        Product.current_stock <= Product.reorder_level,
    )
    return (await db.execute(stmt)).scalar() or 0


@app.get("/dashboard/top-products", response_model=List[TopProductItem], tags=["Dashboard"])
async def top_products(
    limit: int = Query(5, ge=1, le=20),
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> List[TopProductItem]:
    stmt = (
        select(
            Product.id,
            Product.name,
            func.sum(OrderItem.quantity).label("total_quantity"),
            func.sum(OrderItem.quantity * OrderItem.unit_price).label("total_revenue"),
        )
        .join(OrderItem, OrderItem.product_id == Product.id)
        .where(Product.business_id == business.id)
        .group_by(Product.id, Product.name)
        .order_by(func.sum(OrderItem.quantity).desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).all()
    return [
        TopProductItem(product_id=row.id, product_name=row.name,
                       total_quantity=row.total_quantity, total_revenue=row.total_revenue)
        for row in rows
    ]

# ---------------------------------------------------------------------------
# Intelligent Import (v1 Instant Onboarding)
#
# API design (spec item 14):
#   GET  /imports/schema    — the strict Co-op schema (mapper + UI targets)
#   POST /imports/preview   — parse + detect dataset (file)
#   POST /imports/map       — SUGGEST mapping from headers + sample rows only
#                             (never the full file; LLM seam, spec item 2)
#   POST /imports/validate  — read-only validation pass (NO writes, item 6)
#   POST /imports/commit    — the ONLY endpoint that mutates (one transaction,
#                             stamped with an ImportBatch, spec items 7/9)
#
# Trust model: the mapper only suggests; the user reviews and confirms;
# validate proves what would happen; commit executes.
# ---------------------------------------------------------------------------

MAX_IMPORT_BYTES = 5 * 1024 * 1024  # 5 MB
MAX_SAMPLE_ROWS = 50


async def _read_upload(file: UploadFile) -> bytes:
    data = await file.read()
    if len(data) > MAX_IMPORT_BYTES:
        raise HTTPException(status_code=400, detail="File is too large (max 5 MB).")
    return data


def _parsed_or_400(filename: str, data: bytes) -> importer.ParsedFile:
    parsed = importer.parse_file(filename, data)
    if parsed.error:
        raise HTTPException(status_code=400, detail=parsed.error)
    if not parsed.headers:
        raise HTTPException(status_code=400, detail="No columns found in the file.")
    return parsed


@app.get("/imports/schema", tags=["Import"])
async def imports_schema(
    business: Business = Depends(get_current_business),
) -> dict:
    """The strict Co-op import schema — the only target fields the mapper
    (human or LLM) may choose from (spec item 4)."""
    return importer.mapping_schemas_payload()


@app.post("/imports/preview", tags=["Import"])
async def imports_preview(
    file: UploadFile = File(...),
    business: Business = Depends(get_current_business),
) -> dict:
    """Parse the file and detect its dataset. No mapping yet, no writes."""
    data = await _read_upload(file)
    parsed = _parsed_or_400(file.filename or "upload", data)
    dataset_key, confidence = importer.detect_dataset(parsed)
    return {
        "filename": parsed.filename,
        "fmt": parsed.fmt,
        "row_count": len(parsed.rows),
        "columns": parsed.headers,
        "sample_rows": parsed.rows[:MAX_SAMPLE_ROWS],
        "entity": dataset_key,
        "entity_confidence": round(confidence, 2),
    }


class ImportMapRequest(BaseModel):
    entity: str
    headers: List[str]
    sample_rows: List[List[Any]] = []


@app.post("/imports/map", tags=["Import"])
async def imports_map(
    payload: ImportMapRequest,
    business: Business = Depends(get_current_business),
) -> dict:
    """Suggest a column mapping from headers + sample rows ONLY.

    This is the LLM seam: v1 runs a deterministic alias + sample-shape
    engine; a model can be dropped in here with the identical input/output
    contract and would only ever see headers + a 50-row sample (spec item 2).
    It may only target fields from /imports/schema — it cannot invent them.
    """
    if payload.entity not in importer.DATASETS:
        raise HTTPException(status_code=400, detail=f"Unknown entity: {payload.entity}")
    parsed = importer.ParsedFile(
        filename="upload",
        fmt="csv",
        headers=list(payload.headers),
        rows=[list(r)[: len(payload.headers)] for r in payload.sample_rows[:MAX_SAMPLE_ROWS]],
    )
    suggested = importer.suggest_mapping(parsed, payload.entity)
    return {
        "entity": payload.entity,
        "mappings": [
            {
                "column": m.column,
                "field": m.target,
                "confidence": m.confidence,
                "label": m.label,
                "hints": m.hints,
            }
            for m in suggested
        ],
    }


class ImportRunRequest(BaseModel):
    entity: str
    mapping: Dict[str, Optional[str]]  # {source_column: field_key_or_null}


async def _run_import_payload(
    payload: ImportRunRequest,
    data: bytes,
    filename: str,
    business: Business,
    db: AsyncSession,
):
    if payload.entity not in importer.DATASETS:
        raise HTTPException(status_code=400, detail=f"Unknown entity: {payload.entity}")
    for col, target in payload.mapping.items():
        if target is not None and target not in importer.DATASETS[payload.entity].fields:
            raise HTTPException(status_code=400, detail=f"Unknown target field: {target}")
    parsed = _parsed_or_400(filename, data)
    if not parsed.rows:
        raise HTTPException(status_code=400, detail="The file contains no data rows.")
    return parsed


@app.post("/imports/validate", tags=["Import"])
async def imports_validate(
    file: UploadFile = File(...),
    entity: str = Form("products"),
    mapping: str = Form("{}"),
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Read-only validation pass BEFORE any database writes (spec item 6):
    "1,248 rows received — 1,201 valid, 23 duplicates, 7 missing dates…"."""
    import json as _json
    try:
        mapping_dict = _json.loads(mapping or "{}")
    except _json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid mapping JSON.")
    data = await _read_upload(file)
    parsed = await _run_import_payload(
        ImportRunRequest(entity=entity, mapping=mapping_dict), data, file.filename or "upload", business, db
    )
    v = await importer.validate_import(db, business.id, parsed, entity, mapping_dict)
    return {
        "entity": v.dataset,
        "total_rows": v.total_rows,
        "valid_rows": v.valid_rows,
        "duplicates": v.duplicates,
        "unknown_refs": v.unknown_refs,
        "would_create": v.would_create,
        "errors": v.errors,
        "error_fields": v.error_fields,
        "ambiguous": v.ambiguous,
        "warnings": v.warnings,
    }


@app.post("/imports/commit", tags=["Import"])
async def imports_commit(
    file: UploadFile = File(...),
    entity: str = Form("products"),
    mapping: str = Form("{}"),
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """The ONLY mutating import endpoint (spec item 7): one transaction,
    all-or-nothing, every created row stamped with its ImportBatch (item 9)."""
    import json as _json
    try:
        mapping_dict = _json.loads(mapping or "{}")
    except _json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid mapping JSON.")
    data = await _read_upload(file)
    parsed = await _run_import_payload(
        ImportRunRequest(entity=entity, mapping=mapping_dict), data, file.filename or "upload", business, db
    )
    try:
        result = await importer.execute_import(db, business.id, parsed, entity, mapping_dict)
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=400, detail="The import failed and was rolled back. No data was written.")
    return {
        "entity": result.dataset,
        "batch_id": result.batch_id,
        "total_rows": result.total_rows,
        "created": result.created,
        "skipped": result.skipped,
        "errors": result.errors,
        "warnings": result.warnings,
    }


@app.get("/dashboard/briefing", tags=["Dashboard"])
async def dashboard_briefing(
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Day 1 Morning Briefing — verified, deterministic business intelligence
    over the business's real (imported + live) data (spec items 9/10/11)."""
    return await briefing_mod.build_briefing(db, business.id)


# ---------------------------------------------------------------------------
# First-run onboarding (v1 Instant Onboarding)
# ---------------------------------------------------------------------------

@app.get("/onboarding/state", tags=["Onboarding"])
async def onboarding_state(
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Whether the tenant has any business data yet — drives the first-run
    "Welcome to Co-op" screen. A tenant counts as onboarded when it has at
    least one product, customer or order (imported or created live)."""
    scope = lambda m: m.business_id == business.id, m.deleted_at.is_(None)  # noqa: E731
    prod = (await db.execute(select(func.count()).select_from(Product).where(*scope(Product)))).scalar() or 0
    cust = (await db.execute(select(func.count()).select_from(Customer).where(*scope(Customer)))).scalar() or 0
    orders = (await db.execute(select(func.count()).select_from(Order).where(*scope(Order)))).scalar() or 0
    return {
        "has_data": (prod + cust + orders) > 0,
        "products": prod,
        "customers": cust,
        "orders": orders,
    }
