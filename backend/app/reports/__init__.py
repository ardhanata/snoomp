"""Server-generated PDF reports."""

from app.reports.pdf import (
    build_monitor_report,
    build_fleet_report,
    build_executive_report,
)

__all__ = ["build_monitor_report", "build_fleet_report", "build_executive_report"]
