"""Pydantic schemas for request and response validation.
These mirror the ORM models defined in `backend/models.py` and are used by FastAPI
to validate incoming JSON payloads and to control the shape of responses.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field, EmailStr, EmailStr

# ---------------------------------------------------------------------------
# Product schemas
# ---------------------------------------------------------------------------

class ProductBase(BaseModel):
    sku: str = Field(..., min_length=3, max_length=50, description="Unique product identifier")
    name: str = Field(..., min_length=1, max_length=255, description="Product name")
    description: Optional[str] = None
    category: Optional[str] = None
    unit_price: float = Field(..., gt=0, description="Price must be greater than 0")
    cost_price: Optional[float] = Field(None, ge=0, description="Cost price, if applicable")
    current_stock: int = Field(default=0, ge=0, description="Current inventory level")
    reorder_level: int = Field(default=5, ge=0, description="Stock level that triggers reorder")

    class Config:
        orm_mode = True

class ProductCreate(ProductBase):
    pass

class ProductUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    category: Optional[str] = None
    unit_price: Optional[float] = Field(None, gt=0)
    cost_price: Optional[float] = Field(None, ge=0)
    current_stock: Optional[int] = Field(None, ge=0)
    reorder_level: Optional[int] = Field(None, ge=0)

    class Config:
        orm_mode = True

class ProductOut(ProductBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        orm_mode = True

# ---------------------------------------------------------------------------
# Customer schemas
# ---------------------------------------------------------------------------

class CustomerBase(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=255)
    email: EmailStr = Field(..., max_length=255)
    phone: Optional[str] = Field(None, max_length=20)
    address: Optional[str] = None
    company: Optional[str] = None

    class Config:
        orm_mode = True

class CustomerCreate(CustomerBase):
    pass

class CustomerUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    company: Optional[str] = None

    class Config:
        orm_mode = True

class CustomerOut(CustomerBase):
    id: int
    created_at: datetime

    class Config:
        orm_mode = True

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

    class Config:
        orm_mode = True

class OrderItemCreate(OrderItemBase):
    pass

class OrderItemOut(OrderItemBase):
    id: int
    total_price: float

    class Config:
        orm_mode = True

class OrderBase(BaseModel):
    customer_id: int
    status: Optional[OrderStatus] = OrderStatus.pending

    class Config:
        orm_mode = True

class OrderCreate(OrderBase):
    items: List[OrderItemCreate]

class OrderUpdate(BaseModel):
    status: Optional[OrderStatus] = None
    # Updating items is out of scope for Phase 1 – they are immutable after creation.

    class Config:
        orm_mode = True

class OrderOut(BaseModel):
    id: int
    customer_id: int
    status: OrderStatus
    total_amount: float
    created_at: datetime
    updated_at: datetime
    items: List[OrderItemOut]

    class Config:
        orm_mode = True


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

    class Config:
        orm_mode = True


