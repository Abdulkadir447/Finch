"""Daily Business Summary — response contract (PRD v1 daily notification).

The shape of what the in-app notification experience renders. Every number
is produced by the deterministic calculation layer (see daily_summary.py) —
never by an LLM.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class DailySummaryBusiness(BaseModel):
    name: str
    currency: str


class DailySummaryToday(BaseModel):
    revenue: float
    orders: int


class DailySummaryVsYesterday(BaseModel):
    revenue: float
    orders: int
    change_percent: Optional[float] = None


class DailySummaryMonthToDate(BaseModel):
    revenue: float
    orders: int
    # Same-length window of the previous month (1st -> same day). None when
    # today is the 1st (previous window is zero-length) or there is no data.
    previous_period_revenue: Optional[float] = None
    change_percent: Optional[float] = None


class DailySummaryComparison(BaseModel):
    vs_yesterday: DailySummaryVsYesterday
    month_to_date: DailySummaryMonthToDate


class DailySummaryNotableChange(BaseModel):
    direction: str  # up | down
    period: str  # yesterday | month_to_date
    message: str


class DailySummaryLowItem(BaseModel):
    name: str
    sku: str
    stock: int
    reorder_level: int


class DailySummaryOutItem(BaseModel):
    name: str
    sku: str


class DailySummaryInventory(BaseModel):
    low_count: int
    out_count: int
    low_items: list[DailySummaryLowItem]
    out_items: list[DailySummaryOutItem]


class DailySummaryCustomers(BaseModel):
    new_today: int
    new_names: list[str]


class DailySummaryInsight(BaseModel):
    severity: str  # info | warning | critical
    title: str
    evidence: str
    link: str


class DailySummary(BaseModel):
    date: str
    generated_at: str
    business: DailySummaryBusiness
    has_data: bool
    notable: bool
    empty_message: Optional[str] = None
    today: DailySummaryToday
    comparison: DailySummaryComparison
    notable_change: Optional[DailySummaryNotableChange] = None
    inventory: DailySummaryInventory
    customers: DailySummaryCustomers
    insights: list[DailySummaryInsight]
