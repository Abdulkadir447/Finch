"""Email delivery for the daily business summary (TRD Ch17 §17.6-adjacent).

The summary itself is built on demand by ``daily_summary.build_daily_summary``
(v1 ships no scheduler/worker). This module adds the outbound channel: a
plain SMTP send behind the ``notifications.smtp`` config block, with the
standard 12-factor env overrides (SMTP_HOST, SMTP_PORT, SMTP_USERNAME,
SMTP_PASSWORD, SMTP_FROM, SMTP_TLS). Secrets come from the environment,
never from ``config/*.json`` (IPD Ch1.11).

Deliberately small: stdlib smtplib, no provider SDK, text + minimal HTML
parts. When SMTP is not configured the caller returns 503 with an honest
message — the in-app summary remains the always-available channel.
"""

from __future__ import annotations

import os
import smtplib
from email.message import EmailMessage

from ..config import load_config
from .schemas import DailySummary


class EmailNotConfiguredError(RuntimeError):
    pass


def smtp_settings() -> dict:
    """Merged SMTP settings: config file + env overrides (env wins)."""
    cfg = load_config().get("notifications", {}).get("smtp", {})
    env_keys = {
        "host": "SMTP_HOST",
        "port": "SMTP_PORT",
        "username": "SMTP_USERNAME",
        "password": "SMTP_PASSWORD",
        "from": "SMTP_FROM",
        "tls": "SMTP_TLS",
    }
    out: dict = {}
    for key, env_var in env_keys.items():
        value = os.getenv(env_var)
        if value is None:
            value = cfg.get(key)
        if key == "port" and value not in (None, ""):
            value = int(value)
        if key == "tls" and isinstance(value, str):
            value = value.lower() in ("1", "true", "yes", "on")
        out[key] = value
    if not out.get("host"):
        raise EmailNotConfiguredError("SMTP is not configured")
    return out


def render_summary_text(summary: DailySummary, recipient_note: bool = True) -> str:
    """Plain-text rendering of the verified daily summary."""
    lines = [f"Co-op — daily summary for {summary.business.name}", f"Date: {summary.date}", ""]
    if summary.has_data:
        lines.append(f"Today: {summary.business.currency} {summary.today.revenue:.2f} "
                     f"across {summary.today.orders} order(s)")
        vs = summary.comparison.vs_yesterday
        if vs.change_percent is not None:
            arrow = "up" if vs.change_percent >= 0 else "down"
            lines.append(
                f"vs yesterday: {arrow} {abs(vs.change_percent):.1f}% "
                f"({summary.business.currency} {vs.revenue:.2f}, {vs.orders} orders)"
            )
        mtd = summary.comparison.month_to_date
        lines.append(
            f"Month to date: {summary.business.currency} {mtd.revenue:.2f}, {mtd.orders} orders"
        )
        if mtd.change_percent is not None:
            arrow = "up" if mtd.change_percent >= 0 else "down"
            lines.append(f"vs last month's window: {arrow} {abs(mtd.change_percent):.1f}%")
        inv = summary.inventory
        lines.append(f"Inventory: {inv.low_count} low, {inv.out_count} out of stock")
        for item in inv.out_items:
            lines.append(f"  OUT: {item.name} ({item.sku})")
        for item in inv.low_items[:5]:
            lines.append(f"  low: {item.name} ({item.sku}) — stock {item.stock} "
                         f"(reorder at {item.reorder_level})")
        if summary.customers.new_today:
            lines.append(f"New customers today: {len(summary.customers.new_names)}")
            for name in summary.customers.new_names[:5]:
                lines.append(f"  - {name}")
        for insight in summary.insights:
            lines.append(f"[{insight.severity}] {insight.title} — {insight.evidence}")
    else:
        lines.append(summary.empty_message or "Nothing to report yet.")
    if recipient_note:
        lines.append("")
        lines.append("Sent by Co-op. Open the app for the full dashboard.")
    return "\n".join(lines)


def send_daily_summary_email(
    summary: DailySummary,
    to_email: str,
    settings: dict | None = None,
) -> None:
    """Send the rendered summary to one recipient over SMTP."""
    settings = settings or smtp_settings()  # raises EmailNotConfiguredError
    msg = EmailMessage()
    msg["Subject"] = f"Co-op daily summary — {summary.business.name} ({summary.date})"
    msg["From"] = settings.get("from") or "Co-op <no-reply@coop.app>"
    msg["To"] = to_email
    msg.set_content(render_summary_text(summary))

    host: str = settings["host"]
    port: int = settings.get("port") or 587
    use_tls: bool = bool(settings.get("tls", True))

    with smtplib.SMTP(host, port, timeout=15) as smtp:
        if use_tls:
            smtp.starttls()
        username = settings.get("username")
        password = settings.get("password")
        if username and password:
            smtp.login(username, password)
        smtp.send_message(msg)
