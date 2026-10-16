"""
Hitachi Content Platform (HCP) PDF report generation.

Server-generated, print-native A4 documents for HCP object storage observability.
Strictly adheres to the anti-slop standard: ink-on-white, zero em dashes,
luminance-separated status indicators, tabular numerals, and data-dense infographic cards.
"""

from __future__ import annotations

import datetime
from typing import Any, Dict, List, Optional, Sequence

from reportlab.lib import colors
from reportlab.platypus import Flowable, Paragraph, Spacer, Table, TableStyle

from app.reports.pdf import (
    CONTENT_W,
    FONT,
    FONT_B,
    GREEN,
    AMBER,
    RED,
    OFF,
    INK,
    MUTED,
    RULE,
    ZEBRA,
    S_BODY,
    S_SMALL,
    Rule,
    _cell,
    _masthead,
    _render,
    _section,
    _style,
    _table,
)

BLUE = colors.HexColor("#2563eb")
BLUE_DARK = colors.HexColor("#1e40af")
SURFACE = colors.HexColor("#f8fafc")
TRACK = colors.HexColor("#e2e8f0")


def _status_color(status: Optional[str]) -> colors.HexColor:
    s = (status or "").lower()
    if s == "ok":
        return GREEN
    if s in ("warning", "warn"):
        return AMBER
    if s in ("critical", "down"):
        return RED
    return OFF


def _format_objects(count: Optional[int]) -> str:
    if count is None:
        return "0"
    return f"{count:,}"


class CapacityHeroGauge(Flowable):
    """
    Infographic hero block showing total capacity allocation, physical usage,
    and a visual quota saturation gauge with an 85% soft quota ceiling marker.
    """

    def __init__(
        self,
        used_str: str,
        hard_str: str,
        used_pct: float,
        free_str: str,
        objects_str: str,
        status: str,
        width: float,
        is_cluster: bool = True,
        tenant_count: int = 0,
        ns_count: int = 0,
    ):
        super().__init__()
        self.used_str = used_str
        self.hard_str = hard_str
        self.used_pct = min(100.0, max(0.0, used_pct))
        self.free_str = free_str
        self.objects_str = objects_str
        self.status = status.lower()
        self.width = width
        self.is_cluster = is_cluster
        self.tenant_count = tenant_count
        self.ns_count = ns_count
        self.height = 100.0

    def wrap(self, availWidth: float, availHeight: float) -> tuple[float, float]:
        return self.width, self.height

    def draw(self) -> None:
        c = self.canv
        stat_col = _status_color(self.status)

        # 1. Outer Card Box
        c.setStrokeColor(RULE)
        c.setLineWidth(0.6)
        c.setFillColor(SURFACE)
        c.roundRect(0, 0, self.width, self.height, 4, stroke=1, fill=1)

        # 2. Top Kicker and Verdict Badge
        c.setFont(FONT_B, 7.0)
        c.setFillColor(MUTED)
        c.drawString(12, self.height - 14, "CAPACITY ALLOCATION & QUOTA SATURATION")

        verdict_text = "FLEET OPTIMAL" if self.status == "ok" else "ELEVATED QUOTA" if self.status in ("warning", "warn") else "QUOTA EXCEEDED"
        badge_w = c.stringWidth(verdict_text, FONT_B, 7.5) + 12
        badge_x = self.width - badge_w - 12
        badge_y = self.height - 18

        bg_tint = colors.HexColor("#ecfdf5") if self.status == "ok" else (colors.HexColor("#fffbeb") if self.status in ("warning", "warn") else colors.HexColor("#fef2f2"))
        c.setStrokeColor(stat_col)
        c.setLineWidth(0.8)
        c.setFillColor(bg_tint)
        c.roundRect(badge_x, badge_y, badge_w, 12, 2.5, stroke=1, fill=1)
        c.setFillColor(stat_col)
        c.setFont(FONT_B, 7.5)
        c.drawCentredString(badge_x + (badge_w / 2.0), badge_y + 3.0, verdict_text)

        # 3. Main Metrics Headline
        c.setFont(FONT_B, 18)
        c.setFillColor(INK)
        c.drawString(12, self.height - 35, self.used_str)
        used_w = c.stringWidth(self.used_str, FONT_B, 18)

        c.setFont(FONT, 8.5)
        c.setFillColor(MUTED)
        sub_desc = f"physical used of {self.hard_str} hard quota" if self.hard_str.lower() != "unlimited" else "physical used (dynamic multi-tenant capacity)"
        c.drawString(12 + used_w + 6, self.height - 33, sub_desc)

        # Large Percentage on Right
        pct_label = f"{self.used_pct:.1f}%"
        c.setFont(FONT_B, 18)
        c.setFillColor(stat_col)
        c.drawRightString(self.width - 12, self.height - 35, pct_label)

        c.setFont(FONT, 6.8)
        c.setFillColor(MUTED)
        c.drawRightString(self.width - 12, self.height - 43, "Saturation")

        # 4. Horizontal Gauge Bar
        bar_x = 12.0
        bar_y = 26.0
        bar_w = self.width - 24.0
        bar_h = 9.0

        # Track
        c.setFillColor(TRACK)
        c.roundRect(bar_x, bar_y, bar_w, bar_h, 2.0, stroke=0, fill=1)

        # Fill
        fill_w = (self.used_pct / 100.0) * bar_w
        if fill_w > 0:
            c.setFillColor(BLUE_DARK if self.status == "ok" else stat_col)
            c.roundRect(bar_x, bar_y, fill_w, bar_h, 2.0, stroke=0, fill=1)

        # Soft Quota Needle (85% marker)
        needle_x = bar_x + (0.85 * bar_w)
        c.setStrokeColor(AMBER)
        c.setLineWidth(1.0)
        c.line(needle_x, bar_y - 2, needle_x, bar_y + bar_h + 3)

        c.setFont(FONT_B, 6.2)
        c.setFillColor(AMBER)
        c.drawString(needle_x - 18, bar_y + bar_h + 4.5, "85% Soft Quota")

        # 5. Key Metrics Footline
        c.setStrokeColor(RULE)
        c.setLineWidth(0.4)
        c.line(12, 17, self.width - 12, 17)

        y_foot = 6.0
        col_w = (self.width - 24.0) / 4.0

        metrics = [
            ("SCOPE", f"{self.tenant_count} Tenants / {self.ns_count} Buckets" if self.is_cluster else f"{self.ns_count} Provisioned Buckets"),
            ("AVAILABLE", self.free_str),
            ("STORED OBJECTS", self.objects_str),
            ("ALERT CEILING", "85.0% Soft Quota"),
        ]

        for i, (m_lbl, m_val) in enumerate(metrics):
            cur_x = bar_x + (i * col_w)
            c.setFont(FONT, 6.2)
            c.setFillColor(MUTED)
            c.drawString(cur_x, y_foot + 4.5, m_lbl)
            c.setFont(FONT_B, 7.5)
            c.setFillColor(INK)
            c.drawString(cur_x, y_foot - 2.0, m_val)


class FleetHealthDistribution(Flowable):
    """
    Infographic health distribution bar detailing the ratio of OK vs Warning vs Critical
    entities across the storage fleet.
    """

    def __init__(self, healthy: int, warning: int, critical: int, width: float, label: str = "FLEET STATUS & THRESHOLD COMPLIANCE"):
        super().__init__()
        self.healthy = max(0, healthy)
        self.warning = max(0, warning)
        self.critical = max(0, critical)
        self.total = max(1, self.healthy + self.warning + self.critical)
        self.width = width
        self.label = label
        self.height = 44.0

    def wrap(self, availWidth: float, availHeight: float) -> tuple[float, float]:
        return self.width, self.height

    def draw(self) -> None:
        c = self.canv

        # Title
        c.setFont(FONT_B, 7.2)
        c.setFillColor(MUTED)
        c.drawString(0, self.height - 8, self.label)

        # Proportional segmented bar
        bar_y = self.height - 20
        bar_h = 7.0

        x = 0.0
        segments = [
            (self.healthy, GREEN),
            (self.warning, AMBER),
            (self.critical, RED),
        ]

        for count, col in segments:
            if count <= 0:
                continue
            seg_w = (count / self.total) * self.width
            c.setFillColor(col)
            c.rect(x, bar_y, seg_w + 0.3, bar_h, stroke=0, fill=1)
            x += seg_w

        c.setStrokeColor(RULE)
        c.setLineWidth(0.6)
        c.rect(0, bar_y, self.width, bar_h, stroke=1, fill=0)

        # Legend items
        leg_y = 6.0
        h_pct = (self.healthy / self.total) * 100.0
        w_pct = (self.warning / self.total) * 100.0
        c_pct = (self.critical / self.total) * 100.0

        legend_items = [
            (f"Healthy: {self.healthy} ({h_pct:.1f}%)", GREEN),
            (f"Soft Quota Alert (>85%): {self.warning} ({w_pct:.1f}%)", AMBER),
            (f"Critical Saturated (>100%): {self.critical} ({c_pct:.1f}%)", RED),
        ]

        leg_x = 0.0
        for text, dot_col in legend_items:
            c.setFillColor(dot_col)
            c.circle(leg_x + 3.0, leg_y + 3.0, 2.5, stroke=0, fill=1)
            c.setFont(FONT, 7.2)
            c.setFillColor(INK)
            c.drawString(leg_x + 8.5, leg_y + 0.5, text)
            leg_x += c.stringWidth(text, FONT, 7.2) + 20.0


class TopConsumersInfographic(Flowable):
    """
    Infographic ranking of the top storage consumers (tenants or buckets),
    complete with proportional bar visualization and formatted metrics.
    """

    def __init__(self, items: List[Dict[str, Any]], width: float, label: str = "TOP STORAGE CONSUMERS"):
        super().__init__()
        self.items = items[:5]
        self.width = width
        self.label = label
        row_count = max(1, len(self.items))
        self.height = 16.0 + (row_count * 15.0) + 4.0

    def wrap(self, availWidth: float, availHeight: float) -> tuple[float, float]:
        return self.width, self.height

    def draw(self) -> None:
        c = self.canv

        # Section Header
        c.setFont(FONT_B, 7.2)
        c.setFillColor(MUTED)
        c.drawString(0, self.height - 8, self.label)

        if not self.items:
            c.setFont(FONT, 7.5)
            c.setFillColor(MUTED)
            c.drawString(0, self.height - 24, "No consumers recorded in this scope.")
            return

        max_bytes = max(item.get("bytes", 0) for item in self.items) or 1

        label_w = 140.0
        stat_w = 110.0
        bar_start_x = label_w
        bar_avail_w = self.width - label_w - stat_w

        y = self.height - 22

        for i, item in enumerate(self.items):
            rank_str = f"#{i+1}"
            name = item.get("name", "unknown")
            bytes_val = item.get("bytes", 0)
            fmt_size = item.get("formatted", "0 B")
            pct_val = item.get("pct", 0.0)
            stat = item.get("status", "ok")
            stat_col = _status_color(stat)

            # Rank and Name
            c.setFont(FONT_B, 7.2)
            c.setFillColor(MUTED)
            c.drawString(0, y + 1.5, rank_str)

            c.setFont(FONT_B, 7.8)
            c.setFillColor(INK)
            truncated_name = name[:24] + "..." if len(name) > 26 else name
            c.drawString(16, y + 1.5, truncated_name)

            # Proportional Bar
            c.setFillColor(colors.HexColor("#f1f5f9"))
            c.roundRect(bar_start_x, y, bar_avail_w, 6.0, 1.5, stroke=0, fill=1)

            fill_w = (bytes_val / max_bytes) * bar_avail_w
            if fill_w > 0:
                c.setFillColor(BLUE if stat == "ok" else stat_col)
                c.roundRect(bar_start_x, y, max(3.0, fill_w), 6.0, 1.5, stroke=0, fill=1)

            # Metrics and Badge
            metric_x = bar_start_x + bar_avail_w + 10.0
            c.setFont(FONT_B, 7.5)
            c.setFillColor(INK)
            c.drawString(metric_x, y + 1.5, fmt_size)

            pct_str = f"({pct_val:.1f}%)"
            c.setFont(FONT, 7.0)
            c.setFillColor(MUTED)
            c.drawString(metric_x + 46.0, y + 1.5, pct_str)

            badge_text = "[CRIT]" if stat == "critical" else "[WARN]" if stat in ("warning", "warn") else "[OK]"
            c.setFont(FONT_B, 7.0)
            c.setFillColor(stat_col)
            c.drawRightString(self.width, y + 1.5, badge_text)

            y -= 15.0


class InlineUsageCell(Flowable):
    """
    Infographic table cell with an inline progress bar and tabular percentage label.
    """

    def __init__(self, pct: float, width: float = 75, height: float = 12, col: colors.HexColor = GREEN):
        super().__init__()
        self.pct = min(100.0, max(0.0, pct))
        self.width = width
        self.height = height
        self.col = col

    def wrap(self, availWidth: float, availHeight: float) -> tuple[float, float]:
        return self.width, self.height

    def draw(self) -> None:
        c = self.canv
        bar_w = 40.0
        bar_h = 5.0
        y = (self.height - bar_h) / 2.0

        # Track
        c.setFillColor(TRACK)
        c.roundRect(0, y, bar_w, bar_h, 1.5, stroke=0, fill=1)

        # Fill
        fill_w = (self.pct / 100.0) * bar_w
        if fill_w > 0:
            c.setFillColor(self.col)
            c.roundRect(0, y, fill_w, bar_h, 1.5, stroke=0, fill=1)

        # Text
        c.setFont(FONT_B, 7.5)
        c.setFillColor(self.col)
        text_str = f"{self.pct:.1f}%"
        c.drawRightString(self.width, y + 0.5, text_str)


def build_hcp_cluster_report(hcp: Any, cluster_data: Dict[str, Any]) -> bytes:
    """
    Builds the Cluster-Wide Capacity & Fleet Infographic Report.
    Summarizes all tenants, cluster-wide used capacity, total S3 objects,
    visual quota saturation gauge, quota threshold watchlist (>85%),
    and the complete tenant directory.
    """
    now = datetime.datetime.now()
    timestamp_str = now.strftime("%d %b %Y, %H:%M:%S")

    cluster = cluster_data.get("cluster", {})
    tenants = cluster_data.get("tenants", [])
    namespaces = cluster_data.get("namespaces", [])
    status = (cluster_data.get("status") or "ok").lower()
    overall_color = _status_color(status)

    host_display = f"{getattr(hcp, 'host', 'HCP Cluster')}:{getattr(hcp, 'port', 9090)}"
    site_tag = getattr(hcp, "site", None)

    right_meta = [
        f"<b>Generated:</b> {timestamp_str}",
        f"<b>Cluster Host:</b> {host_display}",
    ]
    if site_tag:
        right_meta.append(f"<b>Site:</b> {site_tag.upper()}")

    status_label = "OK" if status == "ok" else "WARNING" if status in ("warning", "warn") else "CRITICAL"
    right_meta.append(f"<b>Overall Status:</b> <font color='#{overall_color.hexval()[2:]}'><b>[{status_label}]</b></font>")

    story = _masthead(
        kind="HCP Cluster Report",
        title="Hitachi Content Platform: Storage & Quota Fleet",
        subtitle=f"Enterprise capacity breakdown across {len(tenants)} tenants and {len(namespaces)} S3 namespaces",
        right=right_meta,
    )

    # 1. Executive Capacity Utilization Hero Card
    used_fmt = cluster.get("storage_used_formatted") or cluster.get("total_storage_used_formatted", "0 B")
    hard_fmt = cluster.get("hard_quota_formatted", "Unlimited")
    free_fmt = cluster.get("storage_free_formatted", "Dynamic Allocation")
    used_pct = float(cluster.get("used_percent") or 0.0)
    obj_count = _format_objects(cluster.get("object_count") if cluster.get("object_count") is not None else cluster.get("total_object_count"))

    story += [
        CapacityHeroGauge(
            used_str=used_fmt,
            hard_str=hard_fmt,
            used_pct=used_pct,
            free_str=free_fmt,
            objects_str=obj_count,
            status=status,
            width=CONTENT_W,
            is_cluster=True,
            tenant_count=len(tenants),
            ns_count=len(namespaces),
        ),
        Spacer(1, 12),
    ]

    # 2. Fleet Quota Health Breakdown Bar
    t_summary = cluster_data.get("tenants_summary", {})
    warn_count = t_summary.get("warning_count", cluster.get("warning_count", 0))
    crit_count = t_summary.get("critical_count", cluster.get("critical_count", 0))
    healthy_count = t_summary.get("healthy_count", cluster.get("healthy_count", len(tenants)))

    story += [
        FleetHealthDistribution(
            healthy=healthy_count,
            warning=warn_count,
            critical=crit_count,
            width=CONTENT_W,
            label="FLEET HEALTH & QUOTA RISK DISTRIBUTION",
        ),
        Spacer(1, 10),
    ]

    # 3. Top Storage Consumers Infographic
    sorted_by_usage = sorted(tenants, key=lambda t: t.get("storage_used_bytes", 0), reverse=True)
    top_consumers_data = []
    for t in sorted_by_usage[:5]:
        top_consumers_data.append({
            "name": t.get("name") or "unknown",
            "bytes": t.get("storage_used_bytes", 0),
            "formatted": t.get("storage_used_formatted", "0 B"),
            "pct": t.get("used_percent", 0.0),
            "status": t.get("status", "ok"),
        })

    story += [
        TopConsumersInfographic(
            items=top_consumers_data,
            width=CONTENT_W,
            label="TOP STORAGE CONSUMERS (RANKED BY PHYSICAL FOOTPRINT)",
        ),
        Spacer(1, 12),
    ]

    # 4. Quota Threshold Watchlist (>85% Soft Quota)
    breaches = [
        ns for ns in namespaces
        if (ns.get("used_percent") or 0) >= (ns.get("soft_quota_pct") or 85.0)
        or (ns.get("status") or "").lower() in ("warning", "critical")
    ]
    breaches.sort(key=lambda x: (x.get("used_percent") or 0), reverse=True)

    story += _section(
        label="Capacity Threshold Watchlist",
        note=f"{len(breaches)} buckets nearing or exceeding quota" if breaches else "No threshold breaches",
    )

    if not breaches:
        story += [
            Paragraph("No quota threshold breaches (>85%) detected.", S_BODY),
            Spacer(1, 12),
        ]
    else:
        rows = []
        for ns in breaches:
            ns_status = (ns.get("status") or "ok").lower()
            col = _status_color(ns_status)
            badge_text = "CRIT" if ns_status == "critical" else "WARN" if ns_status in ("warning", "warn") else "OK"
            u_pct = float(ns.get("used_percent", 0))

            rows.append([
                _cell(ns.get("tenant_name") or "default", bold=True),
                _cell(ns.get("name") or "unknown"),
                _cell(ns.get("storage_used_formatted") or "0 B"),
                _cell(ns.get("hard_quota_formatted") or "Unlimited"),
                InlineUsageCell(u_pct, width=65, col=col),
                _cell(f"[{badge_text}]", colour=col, bold=True),
            ])

        story += [
            _table(
                ["Tenant", "Namespace / Bucket", "Used Space", "Hard Quota", "Utilization", "Status"],
                rows,
                [CONTENT_W * 0.22, CONTENT_W * 0.28, CONTENT_W * 0.16, CONTENT_W * 0.16, CONTENT_W * 0.11, CONTENT_W * 0.07],
                {2: "RIGHT", 3: "RIGHT", 4: "RIGHT", 5: "CENTER"},
            ),
            Spacer(1, 14),
        ]

    # 5. All Monitored Tenants Directory Table with Inline Visual Bars
    story += _section(
        label="All Monitored Tenants",
        note=f"{len(tenants)} total tenants",
    )

    sorted_tenants = sorted(tenants, key=lambda t: t.get("name", "").lower())
    tenant_rows = []
    for t in sorted_tenants:
        t_status = (t.get("status") or "ok").lower()
        col = _status_color(t_status)
        badge_text = "CRIT" if t_status == "critical" else "WARN" if t_status in ("warning", "warn") else "OK"
        delegated = "Delegated" if t.get("namespaces_accessible") else "Restricted"
        t_pct = float(t.get("used_percent", 0))

        tenant_rows.append([
            _cell(t.get("name") or "unknown", bold=True),
            _cell(t.get("storage_used_formatted") or "0 B"),
            _cell(t.get("hard_quota_formatted") or "Unlimited"),
            InlineUsageCell(t_pct, width=65, col=col),
            _cell(_format_objects(t.get("object_count"))),
            _cell(delegated, size=7.5, colour=MUTED),
            _cell(f"[{badge_text}]", colour=col, bold=True),
        ])

    story += [
        _table(
            ["Tenant Name", "Used Space", "Hard Quota", "Utilization", "Objects", "Access", "Status"],
            tenant_rows,
            [CONTENT_W * 0.25, CONTENT_W * 0.16, CONTENT_W * 0.16, CONTENT_W * 0.12, CONTENT_W * 0.14, CONTENT_W * 0.10, CONTENT_W * 0.07],
            {1: "RIGHT", 2: "RIGHT", 3: "RIGHT", 4: "RIGHT", 5: "CENTER", 6: "CENTER"},
        ),
    ]

    return _render(story, "Cluster Report", f"HCP Cluster: {getattr(hcp, 'name', 'Storage')}")


def build_hcp_tenant_report(hcp: Any, tenant_name: str, tenant_data: Dict[str, Any]) -> bytes:
    """
    Builds the Tenant S3 Quota & Namespace Audit Infographic Report.
    Details an individual tenant's quota envelope, physical storage used,
    remaining free capacity, top storage buckets, and a comprehensive breakdown
    of all S3 namespaces with inline progress bars.
    """
    now = datetime.datetime.now()
    timestamp_str = now.strftime("%d %b %Y, %H:%M:%S")

    tenant_info = tenant_data.get("tenant", {})
    namespaces = tenant_data.get("namespaces", [])
    status = (tenant_data.get("status") or tenant_info.get("status") or "ok").lower()
    overall_color = _status_color(status)

    cluster_host = getattr(hcp, "host", "")
    tenant_host = f"{tenant_name}.{cluster_host.replace('admin.', '')}" if cluster_host else tenant_name
    site_tag = getattr(hcp, "site", None)

    right_meta = [
        f"<b>Generated:</b> {timestamp_str}",
        f"<b>Tenant Host:</b> {tenant_host}:9090",
    ]
    if site_tag:
        right_meta.append(f"<b>Site:</b> {site_tag.upper()}")

    status_label = "OK" if status == "ok" else "WARNING" if status in ("warning", "warn") else "CRITICAL"
    right_meta.append(f"<b>Overall Status:</b> <font color='#{overall_color.hexval()[2:]}'><b>[{status_label}]</b></font>")

    story = _masthead(
        kind="Tenant S3 Audit",
        title=f"HCP Tenant Audit: {tenant_name}",
        subtitle="S3 namespace storage breakdown, quota thresholds, and object statistics",
        right=right_meta,
    )

    # 1. Tenant Quota Envelope Hero Card
    hard_fmt = tenant_info.get("hard_quota_formatted", "Unlimited")
    used_fmt = tenant_info.get("storage_used_formatted", "0 B")
    free_fmt = tenant_info.get("storage_free_formatted", "Unlimited")
    used_pct = float(tenant_info.get("used_percent") or 0.0)
    obj_count = _format_objects(tenant_info.get("object_count"))

    story += [
        CapacityHeroGauge(
            used_str=used_fmt,
            hard_str=hard_fmt,
            used_pct=used_pct,
            free_str=free_fmt,
            objects_str=obj_count,
            status=status,
            width=CONTENT_W,
            is_cluster=False,
            tenant_count=1,
            ns_count=len(namespaces),
        ),
        Spacer(1, 12),
    ]

    # 2. Namespace Health Breakdown Bar
    ns_warn = sum(1 for ns in namespaces if (ns.get("status") or "").lower() in ("warning", "warn"))
    ns_crit = sum(1 for ns in namespaces if (ns.get("status") or "").lower() in ("critical", "down"))
    ns_ok = max(0, len(namespaces) - (ns_warn + ns_crit))

    story += [
        FleetHealthDistribution(
            healthy=ns_ok,
            warning=ns_warn,
            critical=ns_crit,
            width=CONTENT_W,
            label="BUCKET HEALTH & QUOTA RISK DISTRIBUTION",
        ),
        Spacer(1, 10),
    ]

    # 3. Top S3 Buckets / Namespaces Infographic
    sorted_by_usage = sorted(namespaces, key=lambda n: n.get("storage_used_bytes", 0), reverse=True)
    top_buckets_data = []
    for ns in sorted_by_usage[:5]:
        top_buckets_data.append({
            "name": ns.get("name") or "unknown",
            "bytes": ns.get("storage_used_bytes", 0),
            "formatted": ns.get("storage_used_formatted", "0 B"),
            "pct": ns.get("used_percent", 0.0),
            "status": ns.get("status", "ok"),
        })

    story += [
        TopConsumersInfographic(
            items=top_buckets_data,
            width=CONTENT_W,
            label="TOP S3 BUCKETS (RANKED BY PHYSICAL FOOTPRINT)",
        ),
        Spacer(1, 12),
    ]

    # 4. Provisioned Namespaces & S3 Buckets Table
    story += _section(
        label="Provisioned Namespaces & S3 Buckets",
        note=f"{len(namespaces)} total namespaces" if namespaces else "No namespaces found",
    )

    if not namespaces:
        story += [
            Paragraph("0 namespaces currently provisioned for this tenant.", S_BODY),
            Spacer(1, 12),
        ]
    else:
        ns_rows = []
        for ns in namespaces:
            ns_status = (ns.get("status") or "ok").lower()
            col = _status_color(ns_status)
            badge_text = "CRIT" if ns_status == "critical" else "WARN" if ns_status in ("warning", "warn") else "OK"
            u_pct = float(ns.get("used_percent", 0))

            ns_rows.append([
                _cell(ns.get("name") or "unknown", bold=True),
                _cell(ns.get("storage_used_formatted") or "0 B"),
                _cell(ns.get("hard_quota_formatted") or "Unlimited"),
                InlineUsageCell(u_pct, width=65, col=col),
                _cell(f"{ns.get('soft_quota_pct', 85):.0f}%", colour=MUTED),
                _cell(_format_objects(ns.get("object_count"))),
                _cell(f"[{badge_text}]", colour=col, bold=True),
            ])

        story += [
            _table(
                ["Namespace / Bucket", "Used Space", "Hard Quota", "Utilization", "Soft Quota", "Objects", "Status"],
                ns_rows,
                [CONTENT_W * 0.28, CONTENT_W * 0.16, CONTENT_W * 0.16, CONTENT_W * 0.12, CONTENT_W * 0.09, CONTENT_W * 0.12, CONTENT_W * 0.07],
                {1: "RIGHT", 2: "RIGHT", 3: "RIGHT", 4: "RIGHT", 5: "RIGHT", 6: "CENTER"},
            ),
        ]

    return _render(story, "Tenant Audit", f"HCP Tenant: {tenant_name}")
