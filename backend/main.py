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
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .clerk_auth import ClerkUser, verify_clerk_token
from .database import get_db, init_db
from .models import Business, Customer, Order, OrderItem, Product
from .schemas import (
    AuthMeResponse,
    CategoryValue,
    CustomerCreate,
    CustomerOut,
    CustomerUpdate,
    DashboardSummary,
    GrowthResponse,
    OrderCreate,
    OrderOut,
    OrderUpdate,
    ProductCreate,
    ProductOut,
    ProductUpdate,
    RevenueMonthResponse,
    RevenueTodayResponse,
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
# Products CRUD (tenant-scoped)
# ---------------------------------------------------------------------------

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
    await db.refresh(new_product)
    return new_product


@app.get("/products", response_model=List[ProductOut], tags=["Products"])
async def list_products(
    search: Optional[str] = Query(None, min_length=1),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> List[ProductOut]:
    query = select(Product).where(Product.business_id == business.id, Product.deleted_at.is_(None))
    if search:
        like = f"%{search.lower()}%"
        query = query.where(
            or_(Product.name.ilike(like), Product.sku.ilike(like), Product.category.ilike(like))
        )
    query = query.order_by(Product.id.desc()).offset((page - 1) * limit).limit(limit)
    return (await db.execute(query)).scalars().all()


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


@app.get("/customers", response_model=List[CustomerOut], tags=["Customers"])
async def list_customers(
    search: Optional[str] = Query(None, min_length=1),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> List[CustomerOut]:
    query = select(Customer).where(Customer.business_id == business.id, Customer.deleted_at.is_(None))
    if search:
        like = f"%{search.lower()}%"
        query = query.where(
            or_(Customer.full_name.ilike(like), Customer.email.ilike(like), Customer.company.ilike(like))
        )
    query = query.order_by(Customer.id.desc()).offset((page - 1) * limit).limit(limit)
    return (await db.execute(query)).scalars().all()


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
# Orders CRUD (tenant-scoped)
# ---------------------------------------------------------------------------

@app.post("/orders", response_model=OrderOut, status_code=status.HTTP_201_CREATED, tags=["Orders"])
async def create_order(
    order: OrderCreate,
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> OrderOut:
    customer = await get_customer(order.customer_id, business, db)

    total = 0.0
    item_models: List[OrderItem] = []
    for item in order.items:
        product = await get_product(item.product_id, business, db)
        line_total = round(item.unit_price * item.quantity, 2)
        total += line_total
        item_models.append(
            OrderItem(
                business_id=business.id,
                product_id=product.id,
                quantity=item.quantity,
                unit_price=item.unit_price,
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
    # Re-fetch with relationships for the response shape.
    return await get_order(new_order.id, business, db)


@app.get("/orders", response_model=List[OrderOut], tags=["Orders"])
async def list_orders(
    status_filter: Optional[str] = Query(None, alias="status"),
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> List[OrderOut]:
    query = (
        select(Order)
        .options(selectinload(Order.customer), selectinload(Order.items))
        .where(Order.business_id == business.id, Order.deleted_at.is_(None))
    )
    if status_filter:
        query = query.where(Order.status == status_filter)
    if start_date:
        query = query.where(Order.created_at >= start_date)
    if end_date:
        query = query.where(Order.created_at <= end_date)
    query = query.order_by(Order.id.desc()).offset((page - 1) * limit).limit(limit)
    return (await db.execute(query)).scalars().all()


@app.get("/orders/{id}", response_model=OrderOut, tags=["Orders"])
async def get_order(
    id: int,
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> OrderOut:
    stmt = (
        select(Order)
        .options(selectinload(Order.customer), selectinload(Order.items))
        .where(Order.id == id, Order.business_id == business.id, Order.deleted_at.is_(None))
    )
    order = (await db.execute(stmt)).scalars().first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@app.put("/orders/{id}/status", response_model=OrderOut, tags=["Orders"])
async def update_order_status(
    id: int,
    updates: OrderUpdate,
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> OrderOut:
    order = await get_order(id, business, db)
    if updates.status is not None:
        order.status = updates.status
        order.updated_by = business.owner_id
    await db.flush()
    await db.refresh(order)
    return order


@app.delete("/orders/{id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Orders"])
async def delete_order(
    id: int,
    business: Business = Depends(get_current_business),
    db: AsyncSession = Depends(get_db),
) -> None:
    order = await get_order(id, business, db)
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
