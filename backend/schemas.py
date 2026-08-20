"""Pydantic schemas for request and response validation.

These mirror the ORM models defined in `backend/models.py` and are used by
FastAPI to validate incoming JSON payloads and to control the shape of
responses. Pydantic v2 style (`model_config = ConfigDict(from_attributes=True)`
replaces the removed v1 `orm_mode`).
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field


# ---------------------------------------------------------------------------
# Product schemas
# ---------------------------------------------------------------------------

class ProductBase(BaseModel):
    sku: str = Field(..., min_length=3, max_length=50, description="Unique product identifier")
    name: str = Field(..., min_length=1, max_length=255, description="Product name")
    description: Optional[str] = Field(None, max_length=1000)
    category: Optional[str] = Field(None, max_length=100)
    unit_price: float = Field(..., gt=0, description="Price must be greater than 0")
    cost_price: Optional[float] = Field(None, ge=0, description="Cost price, if applicable")
    current_stock: int = Field(default=0, ge=0, description="Current inventory level")
    reorder_level: int = Field(default=5, ge=0, description="Stock level that triggers reorder")

    model_config = ConfigDict(from_attributes=True)


class ProductCreate(ProductBase):
    pass


class ProductUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=1000)
    category: Optional[str] = Field(None, max_length=100)
    unit_price: Optional[float] = Field(None, gt=0)
    cost_price: Optional[float] = Field(None, ge=0)
    current_stock: Optional[int] = Field(None, ge=0)
    reorder_level: Optional[int] = Field(None, ge=0)


class ProductOut(ProductBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class ProductListResponse(BaseModel):
    """Paginated product listing envelope (Task 5)."""

    items: List[ProductOut]
    total: int
    page: int
    limit: int


# ---------------------------------------------------------------------------
# Customer schemas
# ---------------------------------------------------------------------------

class CustomerBase(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=255)
    email: EmailStr = Field(..., max_length=255)
    phone: Optional[str] = Field(None, max_length=20)
    address: Optional[str] = None
    company: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class CustomerCreate(CustomerBase):
    pass


class CustomerUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    company: Optional[str] = None


class CustomerOut(CustomerBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CustomerBrief(BaseModel):
    """Lightweight nested customer used inside order listings."""

    full_name: str

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Order schemas
# ---------------------------------------------------------------------------

class OrderStatus(str, Enum):
    pending = "pending"
    confirmed = "confirmed"
    shipped = "shipped"
    delivered = "delivered"
    cancelled = "cancelled"


class OrderItemBase(BaseModel):
    product_id: int
    quantity: int = Field(..., gt=0)
    unit_price: float = Field(..., gt=0)

    model_config = ConfigDict(from_attributes=True)


class OrderItemCreate(OrderItemBase):
    pass


class OrderItemOut(OrderItemBase):
    id: int
    total_price: float

    model_config = ConfigDict(from_attributes=True)


class OrderBase(BaseModel):
    customer_id: int
    status: Optional[OrderStatus] = OrderStatus.pending


class OrderCreate(OrderBase):
    items: List[OrderItemCreate]


class OrderUpdate(BaseModel):
    status: Optional[OrderStatus] = None
    # Updating items is out of scope for Phase 1 – they are immutable after creation.


class OrderOut(BaseModel):
    id: int
    customer_id: int
    customer: Optional[CustomerBrief] = None
    status: OrderStatus
    total_amount: float
    order_date: datetime
    created_at: datetime
    items: List[OrderItemOut]

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Dashboard schemas
# ---------------------------------------------------------------------------

class RevenueTodayResponse(BaseModel):
    total_revenue: float
    delivered_orders: int


class RevenueMonthResponse(BaseModel):
    total_revenue: float
    total_orders: int


class GrowthResponse(BaseModel):
    this_month_revenue: float
    last_month_revenue: float
    growth_percent: Optional[float] = None


class TopProductItem(BaseModel):
    product_id: int
    product_name: str
    total_quantity: int
    total_revenue: float

    model_config = ConfigDict(from_attributes=True)


class DashboardSummary(BaseModel):
    """Aggregated KPI payload for the Dashboard (one round-trip)."""

    revenue_today: float
    orders_today: int
    revenue_month: float
    orders_month: int
    revenue_growth_percent: Optional[float] = None
    profit_month: float
    products_count: int
    inventory_value: float
    low_stock_count: int
    customers_total: int
    customers_new_month: int


class TimeseriesPoint(BaseModel):
    """One day of revenue/orders for the Revenue chart."""

    date: str
    revenue: float
    orders: int


class CategoryValue(BaseModel):
    """Inventory value grouped by product category (donut chart)."""

    category: str
    value: float


class AuthMeResponse(BaseModel):
    """Identity + tenant info for the signed-in Finch user."""

    user_id: str
    business_id: int
    business_name: str
    currency: str
