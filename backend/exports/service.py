"""Export service (Reports phase, Pass 5).

One entry point: render a ReportData (already computed by the reporting
engine — the same data the screen shows) into the requested format.
"""
from __future__ import annotations

from typing import Tuple

from ..reports.service import ReportData
from .renderers import render_csv, render_pdf, render_xlsx


class ExportError(ValueError):
    """Unknown/unsupported export format."""


FORMATS = ("csv", "xlsx", "pdf")


def export_report(report: ReportData, fmt: str) -> Tuple[bytes, str, str]:
    """Return (content_bytes, filename, media_type) for the report."""
    fmt = (fmt or "csv").strip().lower()
    safe_title = (
        "".join(c if c.isalnum() or c in " -" else "" for c in report.title)
        .strip()
        .replace(" ", "_")
        or "report"
    )
    period = report.period_label.replace(" – ", "_to_").replace(",", "").replace(" ", "")
    base = f"coop_{safe_title}_{period}"
    if fmt == "csv":
        return render_csv(report), f"{base}.csv", "text/csv; charset=utf-8"
    if fmt == "xlsx":
        return (
            render_xlsx(report),
            f"{base}.xlsx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    if fmt == "pdf":
        return render_pdf(report), f"{base}.pdf", "application/pdf"
    raise ExportError(f"format must be one of: {', '.join(FORMATS)}")
