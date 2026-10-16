"""Server-generated PDF reports."""

from app.reports.pdf import (
    build_monitor_report,
    build_utilization_report,
    build_fleet_report,
    build_executive_report,
)
from app.reports.hcp_pdf import (
    build_hcp_cluster_report,
    build_hcp_tenant_report,
)

__all__ = [
    "build_monitor_report",
    "build_utilization_report",
    "build_fleet_report",
    "build_executive_report",
    "build_hcp_cluster_report",
    "build_hcp_tenant_report",
]
