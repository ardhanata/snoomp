"""
PDF report generation.

Documents are drawn here rather than printed from the browser. Print-to-PDF
inherited the app's dark canvas, the browser's page scaling and its scroll
containers; none of that is under our control and all of it showed up in the
output. Generating the file server-side means the artifact is identical for
every stakeholder regardless of their browser, and can later be attached to a
scheduled email without anyone opening the tool.

Design notes
------------
Ink on white, no surfaces. A printed page has no elevation, and background
fills are the first thing a printer drops.

Status colour separates by *luminance*, not hue, so a report still parses in
greyscale and for a reader with a red-green deficiency — for an availability
document that is not a marginal audience.

The signature element is the uptime ribbon: one continuous band across the
page where every time bucket is a vertical stripe coloured by availability.
It is the print translation of the heartbeat strip in the UI, and it answers
"when did this break" at a glance in a way a bar chart of daily averages
cannot. Everything else on the page is deliberately quiet so the ribbon is
the thing the reader's eye lands on.
"""

from __future__ import annotations

import datetime
from io import BytesIO
from typing import Any, Dict, List, Optional, Sequence

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate, Flowable, Frame, KeepTogether, PageTemplate,
    Paragraph, Spacer, Table, TableStyle,
)

# ── Palette ───────────────────────────────────────────────────────────────
INK = colors.HexColor("#111418")
MUTED = colors.HexColor("#57606a")
RULE = colors.HexColor("#d8dee4")
ZEBRA = colors.HexColor("#f6f8fa")
GREEN = colors.HexColor("#1a7f37")
AMBER = colors.HexColor("#9a6700")
RED = colors.HexColor("#cf222e")
OFF = colors.HexColor("#8c959f")
NODATA = colors.HexColor("#eceff2")

FONT = "Helvetica"
FONT_B = "Helvetica-Bold"

PAGE_W, PAGE_H = A4
MARGIN_X = 15 * mm
MARGIN_TOP = 16 * mm
MARGIN_BOT = 16 * mm
CONTENT_W = PAGE_W - 2 * MARGIN_X


def _style(name: str, size: float, leading: float, colour=INK, font=FONT,
           space_after: float = 0, align=TA_LEFT, tracking: float = 0) -> ParagraphStyle:
    return ParagraphStyle(
        name, fontName=font, fontSize=size, leading=leading, textColor=colour,
        spaceAfter=space_after, alignment=align, charSpace=tracking,
    )


S_TITLE = _style("title", 21, 24, INK, FONT_B)
S_KICKER = _style("kicker", 7.5, 10, MUTED, FONT_B, tracking=1.1)
S_SUB = _style("sub", 9, 12.5, MUTED)
S_SECTION = _style("section", 8.5, 11, MUTED, FONT_B, tracking=1.0, space_after=3)
S_BODY = _style("body", 9, 13, INK)
S_SMALL = _style("small", 7.5, 10, MUTED)
S_RIGHT = _style("right", 8, 11, MUTED, align=TA_RIGHT)


def status_colour(pct: Optional[float], target: float):
    """Verdict colour for an aggregate figure, judged against the SLA target."""
    if pct is None:
        return NODATA
    if pct >= target:
        return GREEN
    if pct >= target - 1:
        return AMBER
    return RED


def interval_colour(pct: Optional[float]):
    """
    Colour for a single interval in the ribbon.

    Deliberately *not* judged against the SLA target. An hourly bucket at
    99.4% is one missed check in sixty — ordinary noise — but against a 99.9%
    target it grades as "at risk", which painted the entire ribbon amber and
    buried the real outages. Fixed bands instead, so a healthy period reads as
    a continuous green field and an actual outage is the thing that stands out.
    """
    if pct is None:
        return NODATA
    if pct >= 99.5:
        return GREEN
    if pct >= 90.0:
        return AMBER
    return RED


def fmt_duration(total_sec: float) -> str:
    total_sec = int(max(0, total_sec))
    d, rem = divmod(total_sec, 86400)
    h, rem = divmod(rem, 3600)
    m, s = divmod(rem, 60)
    if d:
        return f"{d}d {h}h"
    if h:
        return f"{h}h {m}m"
    if m:
        return f"{m}m {s}s"
    return f"{s}s"


def fmt_num(v: Optional[float], suffix: str = "", dp: int = 0) -> str:
    if v is None:
        return "—"
    return f"{v:,.{dp}f}{suffix}"


def _parse(ts: Optional[str]) -> Optional[datetime.datetime]:
    if not ts:
        return None
    try:
        return datetime.datetime.fromisoformat(ts.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


# ── Flowables ─────────────────────────────────────────────────────────────

class Rule(Flowable):
    """Full-width hairline."""

    def __init__(self, width: float, thickness: float = 0.6, colour=RULE, space: float = 0):
        super().__init__()
        self.width, self.thickness, self.colour, self.space = width, thickness, colour, space
        self.height = thickness + space

    def draw(self):
        self.canv.setStrokeColor(self.colour)
        self.canv.setLineWidth(self.thickness)
        self.canv.line(0, self.space, self.width, self.space)


class UptimeRibbon(Flowable):
    """
    The signature element.

    Every bucket in the reporting window is one vertical stripe, coloured by
    that bucket's availability. Reading left to right is reading the period in
    order, so an outage is a visible dark band at the point in time it
    happened — the shape of the incident, not just its total.

    Buckets with no checks render in a pale neutral rather than being skipped,
    so a monitoring gap is visible as a gap instead of silently closing up.
    """

    def __init__(self, buckets: Sequence[Dict[str, Any]], width: float,
                 height: float = 13 * mm, target: float = 99.9):
        super().__init__()
        self.buckets = list(buckets)
        self.width = width
        self.height = height
        self.target = target

    def draw(self):
        c = self.canv
        n = max(1, len(self.buckets))
        w = self.width / n

        for i, b in enumerate(self.buckets):
            pct = b.get("uptime_pct")
            c.setFillColor(interval_colour(pct))
            # +0.35 overlap: at ~0.6pt per stripe, exact widths leave hairline
            # white seams that read as false gaps in the data.
            c.rect(i * w, 0, w + 0.35, self.height, stroke=0, fill=1)

        c.setStrokeColor(RULE)
        c.setLineWidth(0.6)
        c.rect(0, 0, self.width, self.height, stroke=1, fill=0)

    def wrap(self, *_):
        return self.width, self.height


class RibbonAxis(Flowable):
    """Start / midpoint / end labels beneath the ribbon."""

    def __init__(self, buckets: Sequence[Dict[str, Any]], width: float, span_hours: int):
        super().__init__()
        self.buckets = list(buckets)
        self.width = width
        self.height = 4.5 * mm
        self.span_hours = span_hours

    def draw(self):
        if not self.buckets:
            return
        c = self.canv
        c.setFont(FONT, 6.8)
        c.setFillColor(MUTED)

        fmt = "%d %b" if self.span_hours > 48 else "%H:%M"
        picks = [0, len(self.buckets) // 2, len(self.buckets) - 1]
        aligns = ["start", "middle", "end"]

        for idx, align in zip(picks, aligns):
            ts = _parse(self.buckets[idx].get("start"))
            if not ts:
                continue
            label = ts.strftime(fmt)
            x = (idx / max(1, len(self.buckets) - 1)) * self.width
            if align == "start":
                c.drawString(0, 0, label)
            elif align == "end":
                c.drawRightString(self.width, 0, label)
            else:
                c.drawCentredString(x, 0, label)

    def wrap(self, *_):
        return self.width, self.height


class Sparkline(Flowable):
    """Response-time trend. Area under a thin line; no axis furniture."""

    def __init__(self, values: Sequence[Optional[float]], width: float, height: float = 16 * mm):
        super().__init__()
        self.values = list(values)
        self.width = width
        self.height = height

    def draw(self):
        pts = [(i, v) for i, v in enumerate(self.values) if v is not None]
        if len(pts) < 2:
            c = self.canv
            c.setFont(FONT, 7.5)
            c.setFillColor(MUTED)
            c.drawString(0, self.height / 2, "Not enough latency samples in this window.")
            return

        c = self.canv
        n = max(1, len(self.values) - 1)
        hi = max(v for _, v in pts)
        ceiling = hi * 1.15 if hi > 0 else 1.0

        def X(i): return (i / n) * self.width
        def Y(v): return (v / ceiling) * (self.height - 2)

        path = c.beginPath()
        path.moveTo(X(pts[0][0]), 0)
        for i, v in pts:
            path.lineTo(X(i), Y(v))
        path.lineTo(X(pts[-1][0]), 0)
        path.close()
        c.setFillColor(colors.HexColor("#e8ebee"))
        c.drawPath(path, stroke=0, fill=1)

        c.setStrokeColor(INK)
        c.setLineWidth(0.9)
        line = c.beginPath()
        line.moveTo(X(pts[0][0]), Y(pts[0][1]))
        for i, v in pts[1:]:
            line.lineTo(X(i), Y(v))
        c.drawPath(line, stroke=1, fill=0)

        c.setFont(FONT, 6.8)
        c.setFillColor(MUTED)
        c.drawString(0, self.height - 6, f"peak {hi:,.0f} ms")

    def wrap(self, *_):
        return self.width, self.height


class VerdictBand(Flowable):
    """
    The hero. One number, its verdict, and the target it is judged against.

    A stakeholder who reads nothing else reads this, so it carries the whole
    finding: the figure, whether it passes, and what it was measured over.
    """

    def __init__(self, pct: float, target: float, period: str, width: float):
        super().__init__()
        self.pct, self.target, self.period, self.width = pct, target, period, width
        self.height = 26 * mm

    def draw(self):
        c = self.canv
        meets = self.pct >= self.target
        near = self.pct >= self.target - 1
        col = GREEN if meets else (AMBER if near else RED)
        verdict = "MEETS SLA" if meets else ("AT RISK" if near else "SLA BREACHED")

        c.setFillColor(col)
        c.rect(0, 0, 1.6 * mm, self.height, stroke=0, fill=1)

        c.setFillColor(INK)
        c.setFont(FONT_B, 34)
        c.drawString(6 * mm, self.height - 13 * mm, f"{self.pct:.2f}%")

        c.setFont(FONT, 8)
        c.setFillColor(MUTED)
        c.drawString(6 * mm, self.height - 18 * mm, f"availability over {self.period}")
        c.drawString(6 * mm, self.height - 22.5 * mm, f"measured against a {self.target}% target")

        label_w = c.stringWidth(verdict, FONT_B, 9) + 8 * mm
        x = self.width - label_w
        y = self.height - 11 * mm
        c.setStrokeColor(col)
        c.setLineWidth(1.1)
        c.roundRect(x, y, label_w, 7 * mm, 3.5 * mm, stroke=1, fill=0)
        c.setFillColor(col)
        c.setFont(FONT_B, 9)
        c.drawCentredString(x + label_w / 2, y + 2.4 * mm, verdict)

    def wrap(self, *_):
        return self.width, self.height


class DistBar(Flowable):
    """Proportional band for labelled counts."""

    def __init__(self, segments: Sequence[tuple], width: float, height: float = 6 * mm):
        super().__init__()
        self.segments = [s for s in segments if s[0] > 0]
        self.width, self.height = width, height

    def draw(self):
        total = max(1, sum(s[0] for s in self.segments))
        x = 0.0
        for n, col, _ in self.segments:
            w = (n / total) * self.width
            self.canv.setFillColor(col)
            self.canv.rect(x, 0, w + 0.3, self.height, stroke=0, fill=1)
            x += w
        self.canv.setStrokeColor(RULE)
        self.canv.setLineWidth(0.6)
        self.canv.rect(0, 0, self.width, self.height, stroke=1, fill=0)

    def wrap(self, *_):
        return self.width, self.height


# ── Document shell ────────────────────────────────────────────────────────

class _Doc(BaseDocTemplate):
    """Adds the running masthead and 'Page n of m' footer."""

    def __init__(self, buf, kind: str, title: str, **kw):
        super().__init__(buf, pagesize=A4,
                         leftMargin=MARGIN_X, rightMargin=MARGIN_X,
                         topMargin=MARGIN_TOP, bottomMargin=MARGIN_BOT,
                         title=title, author="Snoomp", subject=kind, **kw)
        self.kind = kind
        self.doc_title = title
        frame = Frame(MARGIN_X, MARGIN_BOT, CONTENT_W,
                      PAGE_H - MARGIN_TOP - MARGIN_BOT, id="body",
                      leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates([PageTemplate(id="std", frames=[frame], onPage=self._furniture)])

    def _furniture(self, canv, doc):
        canv.saveState()
        # Running head appears from page 2 — page 1 has the full masthead.
        if doc.page > 1:
            canv.setFont(FONT_B, 7)
            canv.setFillColor(MUTED)
            canv.drawString(MARGIN_X, PAGE_H - MARGIN_TOP + 6 * mm,
                            f"SNOOMP · {self.kind.upper()}")
            canv.setFont(FONT, 7)
            canv.drawRightString(PAGE_W - MARGIN_X, PAGE_H - MARGIN_TOP + 6 * mm, self.doc_title)
            canv.setStrokeColor(RULE)
            canv.setLineWidth(0.6)
            canv.line(MARGIN_X, PAGE_H - MARGIN_TOP + 4 * mm,
                      PAGE_W - MARGIN_X, PAGE_H - MARGIN_TOP + 4 * mm)

        canv.setStrokeColor(RULE)
        canv.setLineWidth(0.6)
        canv.line(MARGIN_X, MARGIN_BOT - 5 * mm, PAGE_W - MARGIN_X, MARGIN_BOT - 5 * mm)
        canv.setFont(FONT, 7)
        canv.setFillColor(MUTED)
        canv.drawString(MARGIN_X, MARGIN_BOT - 9 * mm,
                        "Snoomp Enterprise · Health & Resource Monitor")
        canv.drawRightString(PAGE_W - MARGIN_X, MARGIN_BOT - 9 * mm,
                             f"Page {doc.page} of {getattr(doc, '_total_pages', doc.page)}")
        canv.restoreState()


def _render(story: List, kind: str, title: str) -> bytes:
    """Two passes so the footer can say 'of N'."""
    probe = BytesIO()
    d1 = _Doc(probe, kind, title)
    d1.build(list(story))
    total = d1.page

    out = BytesIO()
    d2 = _Doc(out, kind, title)
    d2._total_pages = total
    d2.build(list(story))
    return out.getvalue()


def _masthead(kind: str, title: str, subtitle: str, right: List[str]) -> List:
    left = [
        Paragraph(f"SNOOMP · {kind.upper()}", S_KICKER),
        Spacer(1, 2),
        Paragraph(title, S_TITLE),
    ]
    if subtitle:
        left += [Spacer(1, 2), Paragraph(subtitle, S_SUB)]

    right_flow = [Paragraph(line, S_RIGHT) for line in right]
    t = Table([[left, right_flow]], colWidths=[CONTENT_W * 0.62, CONTENT_W * 0.38])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return [t, Spacer(1, 6), Rule(CONTENT_W, 1.2, INK), Spacer(1, 10)]


def _section(label: str, note: str = "") -> List:
    row = Table(
        [[Paragraph(label.upper(), S_SECTION), Paragraph(note, S_RIGHT)]],
        colWidths=[CONTENT_W * 0.6, CONTENT_W * 0.4],
    )
    row.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    return [row, Rule(CONTENT_W, 0.6), Spacer(1, 5)]


def _kpis(items: List[tuple]) -> Table:
    """items: (label, value, sub, colour|None) — laid out in one row."""
    cells = []
    for label, value, sub, col in items:
        cells.append([
            Paragraph(label.upper(), _style("k", 6.6, 9, MUTED, FONT_B, tracking=0.7)),
            Spacer(1, 3),
            Paragraph(value, _style("v", 15, 17, col or INK, FONT_B)),
            Spacer(1, 1.5),
            Paragraph(sub or "", S_SMALL),
        ])
    w = CONTENT_W / len(cells)
    t = Table([cells], colWidths=[w] * len(cells))
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.6, RULE),
        ("INNERGRID", (0, 0), (-1, -1), 0.6, RULE),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return t


def _table(header: List[str], rows: List[List], widths: List[float],
           aligns: Optional[Dict[int, str]] = None) -> Table:
    aligns = aligns or {}
    data = [[Paragraph(h.upper(), _style("th", 6.8, 9, INK, FONT_B, tracking=0.6)) for h in header]]
    data += rows
    t = Table(data, colWidths=widths, repeatRows=1)
    style = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, 0), 1.0, INK),
        ("LINEBELOW", (0, 1), (-1, -1), 0.5, RULE),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, ZEBRA]),
    ]
    for col, a in aligns.items():
        style.append(("ALIGN", (col, 0), (col, -1), a))
    t.setStyle(TableStyle(style))
    return t


def _cell(text: str, size: float = 8, colour=INK, bold: bool = False) -> Paragraph:
    return Paragraph(text, _style("c", size, size + 3.5, colour, FONT_B if bold else FONT))


# ── Reports ───────────────────────────────────────────────────────────────

def build_monitor_report(target: Any, report: Dict[str, Any], sla_target: float = 99.9) -> bytes:
    hours = report.get("range_hours", 168)
    period = ("last 24 hours" if hours <= 24 else
              f"last {round(hours / 24)} days" if hours < 24 * 45 else
              f"last {round(hours / 720)} months")
    uptime = float(report.get("uptime_pct") or 0.0)
    timeline = report.get("timeline") or []
    outages = report.get("outages") or []

    story: List = []
    story += _masthead(
        "Availability Report",
        getattr(target, "name", "Monitor"),
        f"{getattr(target, 'host', '')}"
        f"{':' + str(target.port) if getattr(target, 'port', None) else ''}"
        f" · {str(getattr(target, 'type', '')).upper()}",
        [f"{period.title()}", f"Generated {datetime.datetime.now():%d %b %Y, %H:%M}"],
    )

    story += [VerdictBand(uptime, sla_target, period, CONTENT_W), Spacer(1, 12)]

    story += [_kpis([
        ("Total downtime", fmt_duration(report.get("total_downtime_sec") or 0),
         f"{report.get('downtime_pct', 0):.2f}% of period", None),
        ("Outages", fmt_num(report.get("failures")),
         f"{fmt_num(report.get('total_checks'))} checks", RED if report.get("failures") else None),
        ("MTTR", f"{fmt_num(report.get('mttr_min'))} min", "Mean time to recovery", None),
        ("MTBF", f"{fmt_num(report.get('mtbf_hours'))} h", "Mean time between failures", None),
        ("Response", f"{fmt_num(report.get('avg_response_ms'), ' ms')}",
         f"p95 {fmt_num(report.get('p95_response_ms'), ' ms')}", None),
    ]), Spacer(1, 14)]

    if timeline:
        story += _section("Availability timeline", f"{len(timeline)} intervals · earliest to latest")
        story += [
            UptimeRibbon(timeline, CONTENT_W, 13 * mm, sla_target),
            Spacer(1, 2),
            RibbonAxis(timeline, CONTENT_W, hours),
            Spacer(1, 4),
            Paragraph(
                "Each stripe is one interval, coloured by its availability. "
                "Pale stripes are intervals with no recorded checks.",
                S_SMALL),
            Spacer(1, 12),
        ]

        lat = [b.get("avg_latency") for b in timeline]
        if any(v is not None for v in lat):
            story += _section("Response time", "average per interval")
            story += [Sparkline(lat, CONTENT_W), Spacer(1, 12)]

    story += _section("Outage log", f"{len(outages)} recorded" if outages else "")
    if not outages:
        story += [Paragraph("No downtime recorded during this period.", S_BODY)]
    else:
        rows = []
        for o in outages:
            start = _parse(o.get("started"))
            end = _parse(o.get("ended"))
            dur = (end - start).total_seconds() if (start and end) else None
            rows.append([
                _cell(start.strftime("%d %b %Y, %H:%M:%S") if start else "—"),
                _cell(end.strftime("%d %b %Y, %H:%M:%S") if end else "Ongoing", colour=INK if end else RED,
                      bold=not end),
                _cell(fmt_duration(dur) if dur is not None else "—", bold=True),
                _cell(o.get("error") or "Connection timeout", 7.5, MUTED),
            ])
        story += [_table(
            ["Started", "Recovered", "Duration", "Reported error"],
            rows,
            [CONTENT_W * 0.22, CONTENT_W * 0.22, CONTENT_W * 0.13, CONTENT_W * 0.43],
            {2: "RIGHT"},
        )]

    return _render(story, "Availability Report", getattr(target, "name", "Monitor"))


def build_fleet_report(monitors: List[Dict[str, Any]], incidents: List[Dict[str, Any]],
                       sla_target: float = 99.9, scope: str = "All monitors") -> bytes:
    mons = monitors or []
    up = sum(1 for m in mons if (m.get("status") or "").lower() == "up")
    down = sum(1 for m in mons if (m.get("status") or "").lower() in ("down", "critical"))
    warn = sum(1 for m in mons if (m.get("status") or "").lower() in ("warning", "warn"))
    off = max(0, len(mons) - up - down - warn)

    enabled = [m for m in mons if m.get("enabled") is not False]
    ups = [m.get("uptime_24h") if m.get("uptime_24h") is not None else 100 for m in enabled]
    avg_uptime = sum(ups) / len(ups) if ups else 100.0

    lats = [m.get("response_time_ms") for m in mons if (m.get("response_time_ms") or 0) > 0]
    avg_lat = sum(lats) / len(lats) if lats else None

    story: List = []
    story += _masthead(
        "Fleet Report", "System Health", scope,
        [f"{len(mons)} monitors", f"Generated {datetime.datetime.now():%d %b %Y, %H:%M}"],
    )

    story += [VerdictBand(avg_uptime, sla_target, "the last 24 hours", CONTENT_W), Spacer(1, 12)]

    story += [_kpis([
        ("Monitors", fmt_num(len(mons)), f"{len(enabled)} enabled · {len(mons) - len(enabled)} paused", None),
        ("Operational", fmt_num(up), f"{(up / len(mons) * 100 if mons else 100):.1f}% of fleet", GREEN),
        ("Impaired", fmt_num(down + warn),
         f"{down} down · {warn} degraded", RED if down else (AMBER if warn else None)),
        ("Avg response", fmt_num(avg_lat, " ms"), f"{len(lats)} reporting", None),
    ]), Spacer(1, 14)]

    story += _section("Fleet composition")
    story += [
        DistBar([(up, GREEN, "Up"), (warn, AMBER, "Degraded"),
                 (down, RED, "Down"), (off, OFF, "Paused")], CONTENT_W),
        Spacer(1, 3),
        Paragraph(
            f"Up {up} · Degraded {warn} · Down {down} · Paused {off}", S_SMALL),
        Spacer(1, 12),
    ]

    breaching = sorted(
        [m for m in enabled if (m.get("uptime_24h") if m.get("uptime_24h") is not None else 100) < sla_target],
        key=lambda m: m.get("uptime_24h") or 0,
    )
    if breaching:
        story += _section("Below SLA target", f"{len(breaching)} of {len(enabled)} enabled monitors")
        rows = [[
            _cell(m.get("name") or "—", bold=True),
            _cell(m.get("host") or "—", 7.5, MUTED),
            _cell(f"{(m.get('uptime_24h') or 0):.2f}%", bold=True,
                  colour=RED if (m.get("uptime_24h") or 0) < sla_target - 1 else AMBER),
            _cell(f"−{sla_target - (m.get('uptime_24h') or 0):.2f}", 7.5, MUTED),
        ] for m in breaching]
        story += [_table(["Monitor", "Host", "Uptime 24h", "Shortfall"], rows,
                         [CONTENT_W * 0.32, CONTENT_W * 0.38, CONTENT_W * 0.15, CONTENT_W * 0.15],
                         {2: "RIGHT", 3: "RIGHT"}), Spacer(1, 12)]

    def rank(m):
        s = (m.get("status") or "").lower()
        return (0 if s in ("down", "critical") else 1 if s in ("warning", "warn")
                else 3 if s == "up" else 2, m.get("uptime_24h") or 0)

    story += _section("All monitors", "worst first")
    rows = []
    for m in sorted(mons, key=rank):
        s = (m.get("status") or "unknown").lower()
        col = GREEN if s == "up" else RED if s in ("down", "critical") else AMBER if s in ("warning", "warn") else OFF
        rows.append([
            _cell(m.get("name") or "—", bold=True),
            _cell(m.get("host") or "—", 7.5, MUTED),
            _cell(str(m.get("type") or "").upper(), 7, MUTED),
            _cell(s.upper(), 7.5, col, bold=True),
            _cell(f"{m['uptime_24h']:.2f}%" if m.get("uptime_24h") is not None else "—"),
            _cell(f"{m['response_time_ms']:,.0f} ms" if (m.get("response_time_ms") or 0) > 0 else "—"),
        ])
    story += [_table(
        ["Monitor", "Host", "Type", "Status", "Uptime 24h", "Response"], rows,
        [CONTENT_W * 0.24, CONTENT_W * 0.26, CONTENT_W * 0.09, CONTENT_W * 0.12,
         CONTENT_W * 0.14, CONTENT_W * 0.15],
        {4: "RIGHT", 5: "RIGHT"},
    ), Spacer(1, 12)]

    story += _section("Recent incidents", f"{len(incidents)} most recent" if incidents else "")
    if not incidents:
        story += [Paragraph("No state changes recorded in the retained window.", S_BODY)]
    else:
        rows = []
        for inc in incidents:
            ts = _parse(inc.get("started_at"))
            to_s = (inc.get("to_status") or "").lower()
            col = GREEN if to_s == "up" else RED if to_s in ("down", "critical") else AMBER
            rows.append([
                _cell(inc.get("target_name") or "—", bold=True),
                # hexval() returns '0xrrggbb'; the inline markup parser wants
                # a CSS-style '#rrggbb' and raises on anything else.
                _cell(f"{(inc.get('from_status') or '?').upper()} → "
                      f"<font color='#{col.hexval()[2:]}'>{(inc.get('to_status') or '?').upper()}</font>", 7.5),
                _cell(ts.strftime("%d %b %Y, %H:%M:%S") if ts else "—", 7.5, MUTED),
            ])
        story += [_table(["Monitor", "Transition", "When"], rows,
                         [CONTENT_W * 0.38, CONTENT_W * 0.30, CONTENT_W * 0.32])]

    return _render(story, "Fleet Report", "System Health")


def build_executive_report(monitors: List[Dict[str, Any]], sla_trend: Optional[Dict[str, Any]],
                           sla_target: float = 99.9) -> bytes:
    mons = monitors or []
    up = sum(1 for m in mons if (m.get("status") or "").lower() == "up")
    down = sum(1 for m in mons if (m.get("status") or "").lower() in ("down", "critical"))
    warn = sum(1 for m in mons if (m.get("status") or "").lower() in ("warning", "warn"))
    off = max(0, len(mons) - up - down - warn)
    current = (up / len(mons) * 100) if mons else 100.0

    domains: Dict[str, Dict[str, int]] = {}
    for m in mons:
        tags = m.get("tags") or []
        key = (tags[0] if tags else "core").upper()
        d = domains.setdefault(key, {"total": 0, "up": 0})
        d["total"] += 1
        if (m.get("status") or "").lower() == "up":
            d["up"] += 1

    buckets = (sla_trend or {}).get("buckets") or []
    observed = [b for b in buckets if b.get("uptime_pct") is not None]
    period_avg = sum(b["uptime_pct"] for b in observed) / len(observed) if observed else None
    mttr = ((sla_trend or {}).get("mttr") or {}).get("minutes")

    story: List = []
    story += _masthead(
        "Executive Summary", "Service Availability",
        f"{len(mons)} monitored endpoints across {len(domains)} service domains",
        [
            f"{(sla_trend or {}).get('covered_months', 0)} of {(sla_trend or {}).get('months', 6)} months recorded",
            f"Generated {datetime.datetime.now():%d %b %Y, %H:%M}",
        ],
    )

    story += [VerdictBand(current, sla_target, "the current period", CONTENT_W), Spacer(1, 12)]

    story += [_kpis([
        ("Period average", f"{period_avg:.2f}%" if period_avg is not None else "—",
         f"{len(observed)} months with data" if observed else "No recorded history",
         None if period_avg is None else (GREEN if period_avg >= sla_target else AMBER)),
        ("Mean time to recovery", f"{fmt_num(mttr)} min" if mttr is not None else "—",
         f"{((sla_trend or {}).get('mttr') or {}).get('sample_size', 0)} incidents", None),
        ("Impaired now", fmt_num(down + warn), f"{down} down · {warn} degraded",
         RED if down else (AMBER if warn else None)),
        ("Service domains", fmt_num(len(domains)), f"{len(mons)} endpoints", None),
    ]), Spacer(1, 14)]

    story += _section("Fleet composition")
    story += [
        DistBar([(up, GREEN, "Operational"), (warn, AMBER, "Degraded"),
                 (down, RED, "Down"), (off, OFF, "Paused")], CONTENT_W),
        Spacer(1, 3),
        Paragraph(f"Operational {up} · Degraded {warn} · Down {down} · Paused {off}", S_SMALL),
        Spacer(1, 12),
    ]

    if buckets:
        story += _section("Availability trend", f"{len(buckets)}-month window")
        ribbon = [{"uptime_pct": b.get("uptime_pct"), "start": None} for b in buckets]
        story += [UptimeRibbon(ribbon, CONTENT_W, 11 * mm, sla_target), Spacer(1, 3)]
        labels = Table(
            [[Paragraph(b.get("label") or "", _style("m", 6.8, 9, MUTED, align=1))
              for b in buckets]],
            colWidths=[CONTENT_W / len(buckets)] * len(buckets),
        )
        labels.setStyle(TableStyle([
            ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        story += [labels, Spacer(1, 4)]
        rows = [[
            _cell(b.get("label") or "—", bold=True),
            _cell(f"{b['uptime_pct']:.3f}%" if b.get("uptime_pct") is not None else "No data",
                  colour=status_colour(b.get("uptime_pct"), sla_target), bold=True),
            _cell(f"{(b.get('checks') or 0):,}", 7.5, MUTED),
            _cell(f"{b['avg_response_ms']:,.0f} ms" if b.get("avg_response_ms") else "—", 7.5, MUTED),
        ] for b in buckets]
        story += [_table(["Month", "Availability", "Checks", "Avg response"], rows,
                         [CONTENT_W * 0.25, CONTENT_W * 0.25, CONTENT_W * 0.25, CONTENT_W * 0.25],
                         {1: "RIGHT", 2: "RIGHT", 3: "RIGHT"}), Spacer(1, 12)]

    story += _section("Domain breakdown", "lowest availability first")
    rows = []
    for name, d in sorted(domains.items(), key=lambda kv: kv[1]["up"] / max(1, kv[1]["total"])):
        pct = d["up"] / d["total"] * 100 if d["total"] else 100
        rows.append([
            _cell(name, bold=True),
            _cell(str(d["up"])),
            _cell(str(d["total"]), colour=MUTED),
            _cell(f"{pct:.2f}%", bold=True, colour=status_colour(pct, sla_target)),
        ])
    story += [_table(["Domain", "Healthy", "Total", "Availability"], rows,
                     [CONTENT_W * 0.40, CONTENT_W * 0.18, CONTENT_W * 0.18, CONTENT_W * 0.24],
                     {1: "RIGHT", 2: "RIGHT", 3: "RIGHT"})]

    return _render(story, "Executive Summary", "Service Availability")
