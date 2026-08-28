"""Notifications — in-app daily summary (v1: no email, no push)."""
from .daily_summary import build_daily_summary
from .schemas import DailySummary

__all__ = ["build_daily_summary", "DailySummary"]
