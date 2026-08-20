"""
Finch API — FastAPI application with Clerk authentication and tenant-scoped
CRUD + Dashboard analytics.

Authentication model (this phase):
  * The frontend sends the Clerk **session token** as ``Authorization: Bearer``.
  * ``clerk_auth.verify_clerk_token`` validates it against Clerk's public JWKS
    (RS256) — no Clerk secret key exists in the backend.
  * Each Clerk user is auto-provisioned a ``Business`` tenant on first
    authenticated request (AFD Ch1.10 Company Setup); every query is scoped
    to that tenant via ``business_id`` (BSD Ch1.8 multi-tenant isolation).
"""

from datetime import date, datetime, time, timedelta
from typing import List, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import case, func, or_, select
from sqlalchemy import update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .clerk_auth import ClerkUser, verify_clerk_token
from .database import get_db, init_db
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

app = FastAPI(title="Finch", openapi_url="/docs/openapi.json", docs_url="/docs")

# CORS: Bearer-token auth (no cookies), so '*' without credentials is the
# correct dev posture; tighten to known origins for production deployments.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Order statuses that count toward revenue/profit (not pending/cancelled).
_ACTIVE_STATUSES = ["shipped", "delivered"]


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
async def healthcheck() -> dict:
    return {"status": "healthy"}


@app.get("/", tags=["Root"])
async def read_root() -> dict:
    return {"message": "Welcome to Finch API"}


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


@app.post("/products", response_model=ProductOut, status_code=status.HTTP_201_CREATED, tags=["Products"])
async def create_product(
    product: ProductCreate,
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> ProductOut:
    stmt = select(Product).where(Product.sku == product.sku, Product.business_id == business.id)
    if (await db.execute(stmt)).scalars().first():
        raise HTTPException(status_code=409, detail="SKU already exists")

    new_product = Product(**product.model_dump(), business_id=business.id, created_by=business.owner_id)
    db.add(new_product)
    await db.flush()
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
    low_stock: bool = Query(False, description="Only products at/below their reorder level"),
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
        base = base.where(Product.current_stock <= Product.reorder_level)
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
    current = product.current_stock or 0
    new_level = current + req.change
    if new_level < 0:
        raise HTTPException(
            status_code=409,
            detail=f"Insufficient stock to remove: {current} available, {-req.change} requested",
        )

    # Optimistic-concurrency guard (BSD Ch2.9): apply only if the version we
    # read is still current; bump it atomically. A concurrent writer wins ->
    # 0 rows matched -> 409 so the caller retries with fresh data.
    result = await db.execute(
        sa_update(Product)
        .where(Product.id == id, Product.version == product.version)
        .values(current_stock=new_level, version=product.version + 1, updated_by=business.owner_id)
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=409, detail="Stock changed concurrently — please retry")

    _log_movement(
        db, business.id, id, req.change,
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
            # Low = strictly low but still in stock (0 < stock <= reorder),
            # so Low and Out cards never double-count a product.
            func.coalesce(func.sum(case((Product.current_stock == 0, 0), (Product.current_stock <= Product.reorder_level, 1), else_=0)), 0),
            func.coalesce(func.sum(case((Product.current_stock == 0, 1), else_=0)), 0),
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
    stmt = select(Customer).where(Customer.email == customer.email, Customer.business_id == business.id)
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
    from .schemas import OrderItemOut  # local import: avoids cycle at module load

    return OrderOut(
        id=order.id,
        customer_id=order.customer_id,
        customer=order.customer,
        status=order.status,
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


def _restore_stock(
    db: AsyncSession, order: Order, actor: Optional[str], reason: StockMovementReason
) -> None:
    """Return each line's quantity to its product's stock and log it."""
    for item in order.items:
        if item.product is not None:
            item.product.current_stock = (item.product.current_stock or 0) + item.quantity
            item.product.updated_by = actor
            _log_movement(
                db, order.business_id, item.product_id, item.quantity,
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
        product.current_stock = (product.current_stock or 0) - item.quantity
        product.updated_by = business.owner_id
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
    await db.flush()
    # One ledger row per deducted line, referencing the new order (Task 8).
    for product, item in lines:
        _log_movement(
            db, business.id, product.id, -item.quantity,
            StockMovementReason.order, business.owner_id, order_id=new_order.id,
        )
    return _serialize_order(await _load_order(new_order.id, business, db))


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
        if search.strip().isdigit():
            conditions.append(Order.id == int(search.strip()))
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
        _restore_stock(db, order, business.owner_id, StockMovementReason.order_cancelled)

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
        _restore_stock(db, order, business.owner_id, StockMovementReason.order_deleted)
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

    # Inventory metrics.
    inv_row = (await db.execute(
        select(
            func.count(Product.id),
            func.coalesce(func.sum(Product.current_stock * func.coalesce(Product.cost_price, Product.unit_price)), 0.0),
            func.coalesce(func.sum(case((Product.current_stock <= Product.reorder_level, 1), else_=0)), 0),
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
    stmt = select(func.count(Product.id)).where(
        Product.business_id == business.id, Product.deleted_at.is_(None),
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
# Startup / Shutdown hooks
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def startup_event():
    # Phase 1 schema bootstrap: CREATE TABLE IF NOT EXISTS via the ORM.
    # Alembic migrations replace this once the schema stabilises.
    await init_db()


@app.on_event("shutdown")
async def shutdown_event():
    pass
