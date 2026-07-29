"""
Finch API – FastAPI application with full CRUD endpoints + Dashboard Analytics.
"""

from datetime import datetime, timedelta, date
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import or_, select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .database import get_db
from .models import Customer, Order, OrderItem, Product
from .schemas import (
    CustomerCreate,
    CustomerOut,
    CustomerUpdate,
    OrderCreate,
    OrderOut,
    OrderUpdate,
    ProductCreate,
    ProductOut,
    ProductUpdate,
    RevenueTodayResponse,
    RevenueMonthResponse,
    GrowthResponse,
    TopProductItem,
    LoginRequest,          # <-- NEW
)
import os

# ---------------------------------------------------------------------------
# JWT Configuration
# ---------------------------------------------------------------------------

SECRET_KEY = os.getenv("SECRET_KEY", "super-secret-key-change-in-prod")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(token: str) -> str:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str | None = payload.get("sub")
        if username is None:
            raise credentials_exception
        return username
    except JWTError:
        raise credentials_exception


def get_current_user(token: str = Depends(oauth2_scheme)) -> str:
    return verify_token(token)


# Temporary user store (plaintext for development)
fake_users_db = {
    "admin@example.com": {
        "username": "admin",
        "email": "admin@example.com",
        "password": "password",
        "full_name": "Admin User",
    }
}

# ---------------------------------------------------------------------------
# FastAPI Application
# ---------------------------------------------------------------------------

app = FastAPI(title="Finch", openapi_url="/docs/openapi.json", docs_url="/docs")

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Authentication endpoints (JSON payload)
# ---------------------------------------------------------------------------

@app.post("/auth/login", tags=["Authentication"])
async def login(login_data: LoginRequest):
    user = fake_users_db.get(login_data.username)
    if not user or user["password"] != login_data.password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user["email"]}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}


@app.get("/auth/me", tags=["Authentication"])
async def get_current_user_info(current_user: str = Depends(get_current_user)):
    user = fake_users_db.get(current_user)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "email": user["email"],
        "full_name": user["full_name"],
        "username": user["username"],
    }


# ---------------------------------------------------------------------------
# Health check & Root
# ---------------------------------------------------------------------------

@app.get("/healthcheck", tags=["Health"])
async def healthcheck() -> dict:
    return {"status": "healthy"}


@app.get("/", tags=["Root"])
async def read_root() -> dict:
    return {"message": "Welcome to Finch API"}


# ---------------------------------------------------------------------------
# Products CRUD
# ---------------------------------------------------------------------------

@app.post("/products", response_model=ProductOut, status_code=status.HTTP_201_CREATED, tags=["Products"])
async def create_product(
    product: ProductCreate,
    db: AsyncSession = Depends(get_db),
) -> ProductOut:
    stmt = select(Product).where(Product.sku == product.sku)
    result = await db.execute(stmt)
    if result.scalars().first():
        raise HTTPException(status_code=409, detail="SKU already exists")

    new_product = Product(**product.model_dump())
    db.add(new_product)
    await db.commit()
    await db.refresh(new_product)
    return new_product


@app.get("/products", response_model=List[ProductOut], tags=["Products"])
async def list_products(
    search: Optional[str] = Query(None, min_length=1),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> List[ProductOut]:
    offset = (page - 1) * limit
    query = select(Product)
    if search:
        search_lower = f"%{search.lower()}%"
        query = query.where(
            or_(
                Product.name.ilike(search_lower),
                Product.sku.ilike(search_lower),
                Product.category.ilike(search_lower),
            )
        )
    query = query.offset(offset).limit(limit)
    result = await db.execute(query)
    return result.scalars().all()


@app.get("/products/{id}", response_model=ProductOut, tags=["Products"])
async def get_product(id: int, db: AsyncSession = Depends(get_db)) -> ProductOut:
    stmt = select(Product).where(Product.id == id)
    result = await db.execute(stmt)
    product = result.scalars().first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


@app.put("/products/{id}", response_model=ProductOut, tags=["Products"])
async def update_product(
    id: int,
    updates: ProductUpdate,
    db: AsyncSession = Depends(get_db),
) -> ProductOut:
    stmt = select(Product).where(Product.id == id)
    result = await db.execute(stmt)
    product = result.scalars().first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    for field, value in updates.model_dump(exclude_unset=True).items():
        setattr(product, field, value)
    await db.commit()
    await db.refresh(product)
    return product


@app.delete("/products/{id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Products"])
async def delete_product(id: int, db: AsyncSession = Depends(get_db)) -> None:
    stmt = select(Product).where(Product.id == id)
    result = await db.execute(stmt)
    product = result.scalars().first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    await db.delete(product)
    await db.commit()


# ---------------------------------------------------------------------------
# Customers CRUD
# ---------------------------------------------------------------------------

@app.post("/customers", response_model=CustomerOut, status_code=status.HTTP_201_CREATED, tags=["Customers"])
async def create_customer(
    customer: CustomerCreate,
    db: AsyncSession = Depends(get_db),
) -> CustomerOut:
    stmt = select(Customer).where(Customer.email == customer.email)
    result = await db.execute(stmt)
    if result.scalars().first():
        raise HTTPException(status_code=409, detail="Email already exists")

    new_customer = Customer(**customer.model_dump())
    db.add(new_customer)
    await db.commit()
    await db.refresh(new_customer)
    return new_customer


@app.get("/customers", response_model=List[CustomerOut], tags=["Customers"])
async def list_customers(
    search: Optional[str] = Query(None, min_length=1),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> List[CustomerOut]:
    offset = (page - 1) * limit
    query = select(Customer)
    if search:
        search_lower = f"%{search.lower()}%"
        query = query.where(
            or_(
                Customer.full_name.ilike(search_lower),
                Customer.email.ilike(search_lower),
                Customer.company.ilike(search_lower),
            )
        )
    query = query.offset(offset).limit(limit)
    result = await db.execute(query)
    return result.scalars().all()


@app.get("/customers/{id}", response_model=CustomerOut, tags=["Customers"])
async def get_customer(id: int, db: AsyncSession = Depends(get_db)) -> CustomerOut:
    stmt = select(Customer).where(Customer.id == id)
    result = await db.execute(stmt)
    customer = result.scalars().first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer


@app.put("/customers/{id}", response_model=CustomerOut, tags=["Customers"])
async def update_customer(
    id: int,
    updates: CustomerUpdate,
    db: AsyncSession = Depends(get_db),
) -> CustomerOut:
    stmt = select(Customer).where(Customer.id == id)
    result = await db.execute(stmt)
    customer = result.scalars().first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    for field, value in updates.model_dump(exclude_unset=True).items():
        setattr(customer, field, value)
    await db.commit()
    await db.refresh(customer)
    return customer


@app.delete("/customers/{id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Customers"])
async def delete_customer(id: int, db: AsyncSession = Depends(get_db)) -> None:
    stmt = select(Customer).where(Customer.id == id)
    result = await db.execute(stmt)
    customer = result.scalars().first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    await db.delete(customer)
    await db.commit()


# ---------------------------------------------------------------------------
# Orders CRUD
# ---------------------------------------------------------------------------

@app.post("/orders", response_model=OrderOut, status_code=status.HTTP_201_CREATED, tags=["Orders"])
async def create_order(
    order: OrderCreate,
    db: AsyncSession = Depends(get_db),
) -> OrderOut:
    cust_stmt = select(Customer).where(Customer.id == order.customer_id)
    cust_result = await db.execute(cust_stmt)
    if not cust_result.scalars().first():
        raise HTTPException(status_code=404, detail="Customer not found")

    total = 0.0
    for item in order.items:
        prod_stmt = select(Product).where(Product.id == item.product_id)
        prod_result = await db.execute(prod_stmt)
        if not prod_result.scalars().first():
            raise HTTPException(
                status_code=404,
                detail=f"Product with id={item.product_id} not found",
            )
        total += item.unit_price * item.quantity

    new_order = Order(
        customer_id=order.customer_id,
        status=order.status or "pending",
        total_amount=total,
    )
    db.add(new_order)
    await db.flush()

    for item in order.items:
        order_item = OrderItem(
            order_id=new_order.id,
            product_id=item.product_id,
            quantity=item.quantity,
            unit_price=item.unit_price,
            total_price=item.unit_price * item.quantity,
        )
        db.add(order_item)

    await db.commit()
    await db.refresh(new_order)

    stmt = (
        select(Order)
        .where(Order.id == new_order.id)
        .options(selectinload(Order.items))
    )
    result = await db.execute(stmt)
    return result.scalars().first()


@app.get("/orders", response_model=List[OrderOut], tags=["Orders"])
async def list_orders(
    status_filter: Optional[str] = Query(None, alias="status"),
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> List[OrderOut]:
    query = select(Order).options(selectinload(Order.customer), selectinload(Order.items))

    if status_filter:
        query = query.where(Order.status == status_filter)
    if start_date:
        query = query.where(Order.created_at >= start_date)
    if end_date:
        query = query.where(Order.created_at <= end_date)

    query = query.offset((page - 1) * limit).limit(limit)
    result = await db.execute(query)
    return result.scalars().all()


@app.get("/orders/{id}", response_model=OrderOut, tags=["Orders"])
async def get_order(id: int, db: AsyncSession = Depends(get_db)) -> OrderOut:
    stmt = (
        select(Order)
        .where(Order.id == id)
        .options(selectinload(Order.customer), selectinload(Order.items))
    )
    result = await db.execute(stmt)
    order = result.scalars().first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@app.put("/orders/{id}/status", response_model=OrderOut, tags=["Orders"])
async def update_order_status(
    id: int,
    updates: OrderUpdate,
    db: AsyncSession = Depends(get_db),
) -> OrderOut:
    stmt = (
        select(Order)
        .where(Order.id == id)
        .options(selectinload(Order.customer), selectinload(Order.items))
    )
    result = await db.execute(stmt)
    order = result.scalars().first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if updates.status is not None:
        order.status = updates.status
    await db.commit()
    await db.refresh(order)
    return order


@app.delete("/orders/{id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Orders"])
async def delete_order(id: int, db: AsyncSession = Depends(get_db)) -> None:
    stmt = select(Order).where(Order.id == id)
    result = await db.execute(stmt)
    order = result.scalars().first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    await db.delete(order)
    await db.commit()


# ---------------------------------------------------------------------------
# Startup / Shutdown hooks
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def startup_event():
    pass

@app.on_event("shutdown")
async def shutdown_event():
    pass


# ---------------------------------------------------------------------------
# Dashboard Analytics
# ---------------------------------------------------------------------------

def first_day_of_month(dt: date) -> date:
    return dt.replace(day=1)


@app.get("/dashboard/revenue/today", response_model=RevenueTodayResponse, tags=["Dashboard"])
async def revenue_today(db: AsyncSession = Depends(get_db)) -> RevenueTodayResponse:
    today = date.today()
    stmt = select(func.sum(Order.total_amount)).where(
        Order.status == "delivered",
        Order.order_date == today
    )
    total_rev = (await db.execute(stmt)).scalar() or 0.0

    stmt_cnt = select(func.count(Order.id)).where(
        Order.status == "delivered",
        Order.order_date == today
    )
    count = (await db.execute(stmt_cnt)).scalar() or 0

    return RevenueTodayResponse(total_revenue=total_rev, delivered_orders=count)


@app.get("/dashboard/revenue/month", response_model=RevenueMonthResponse, tags=["Dashboard"])
async def revenue_current_month(db: AsyncSession = Depends(get_db)) -> RevenueMonthResponse:
    today = date.today()
    first = first_day_of_month(today)
    nxt = first_day_of_month(date(today.year, today.month + 1, 1) if today.month < 12 else date(today.year + 1, 1, 1))

    stmt = select(
        func.sum(Order.total_amount).label("total_rev"),
        func.count(Order.id).label("total_orders")
    ).where(
        Order.order_date >= first,
        Order.order_date < nxt,
        Order.status.in_(["delivered", "shipped"])
    )
    row = (await db.execute(stmt)).one_or_none()
    if row is None or row.total_rev is None:
        return RevenueMonthResponse(total_revenue=0.0, total_orders=0)

    return RevenueMonthResponse(total_revenue=row.total_rev, total_orders=row.total_orders)


@app.get("/dashboard/growth", response_model=GrowthResponse, tags=["Dashboard"])
async def growth_monthly_revenue(db: AsyncSession = Depends(get_db)) -> GrowthResponse:
    today = date.today()
    first_this = first_day_of_month(today)
    nxt_this = first_day_of_month(date(today.year, today.month + 1, 1) if today.month < 12 else date(today.year + 1, 1, 1))

    stmt_this = select(func.sum(Order.total_amount)).where(
        Order.order_date >= first_this,
        Order.order_date < nxt_this,
        Order.status.in_(["delivered", "shipped"])
    )
    this_rev = (await db.execute(stmt_this)).scalar() or 0.0

    last_month = date(today.year, today.month - 1, 1) if today.month > 1 else date(today.year - 1, 12, 1)
    first_last = first_day_of_month(last_month)
    nxt_last = first_this

    stmt_last = select(func.sum(Order.total_amount)).where(
        Order.order_date >= first_last,
        Order.order_date < nxt_last,
        Order.status.in_(["delivered", "shipped"])
    )
    last_rev = (await db.execute(stmt_last)).scalar() or 0.0

    growth_pct = None
    if last_rev and last_rev != 0:
        growth_pct = round(((this_rev - last_rev) / last_rev) * 100, 2)

    return GrowthResponse(
        this_month_revenue=this_rev,
        last_month_revenue=last_rev,
        growth_percent=growth_pct,
    )


@app.get("/dashboard/low-stock", response_model=int, tags=["Dashboard"])
async def low_stock_items(db: AsyncSession = Depends(get_db)) -> int:
    stmt = select(func.count(Product.id)).where(Product.current_stock <= Product.reorder_level)
    return (await db.execute(stmt)).scalar() or 0


@app.get("/dashboard/top-products", response_model=List[TopProductItem], tags=["Dashboard"])
async def top_products(
    limit: int = Query(5, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
) -> List[TopProductItem]:
    stmt = (
        select(
            Product.id,
            Product.name,
            func.sum(OrderItem.quantity).label("total_quantity"),
            func.sum(OrderItem.quantity * OrderItem.unit_price).label("total_revenue")
        )
        .join(OrderItem, OrderItem.product_id == Product.id)
        .group_by(Product.id)
        .order_by(func.sum(OrderItem.quantity).desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).all()
    return [
        TopProductItem(
            product_id=row.id,
            product_name=row.name,
            total_quantity=row.total_quantity,
            total_revenue=row.total_revenue
        ) for row in rows
    ]