import React from 'react';

/**
 * Print-only availability report.
 *
 * Everything here is sized in millimetres against an A4 page (@page margin is
 * declared in dashboard.css) and drawn with inline SVG rather than Recharts —
 * charts must be present in the DOM synchronously when window.print() fires,
 * and a ResponsiveContainer measuring a hidden element reports zero width.
 *
 * Colours are chosen to survive greyscale printing: the green/red pair differs
 * in luminance, not just hue.
 */

const INK = '#111418';
const MUTED = '#57606a';
const RULE = '#d8dee4';
const GREEN = '#1a7f37';
const AMBER = '#9a6700';
const RED = '#cf222e';

export interface TimelineBucket {
  start: Date;
  checks: number;
  uptimePct: number | null;
  avgLatency: number | null;
}

export interface ReportData {
  uptimePct: number;
  downtimePct: number;
  totalDowntimeSec: number;
  failures: number;
  mttrMin: number;
  mtbfHours: number;
  downtimeLogs: { started: Date; ended: Date | null; error?: string }[];
  totalChecks: number;
  timeline?: TimelineBucket[];
  bucketMs?: number;
  avgLatency?: number | null;
  p95Latency?: number | null;
}

interface PrintableReportProps {
  target: any;
  data: ReportData;
  rangeHours: number;
  slaTarget?: number;
}

const numberFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

function formatDuration(totalSec: number): string {
  if (totalSec <= 0) return '0m';
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function rangeLabel(hours: number): string {
  if (hours <= 24) return 'Last 24 Hours';
  if (hours === 168) return 'Last 7 Days';
  if (hours === 720) return 'Last 30 Days';
  return `Last ${Math.round(hours / 24)} Days`;
}

function statusFor(pct: number, slaTarget: number) {
  if (pct >= slaTarget) return { label: 'Meets SLA', color: GREEN };
  if (pct >= slaTarget - 1) return { label: 'At Risk', color: AMBER };
  return { label: 'SLA Breached', color: RED };
}

/** Donut showing the uptime / downtime split. */
function AvailabilityDonut({ uptimePct }: { uptimePct: number }) {
  const r = 54;
  const circumference = 2 * Math.PI * r;
  const upLength = (Math.min(100, Math.max(0, uptimePct)) / 100) * circumference;

  return (
    <svg viewBox="0 0 140 140" width="100%" style={{ maxWidth: '46mm', display: 'block' }} role="img"
      aria-label={`Availability ${uptimePct.toFixed(2)} percent`}>
      <circle cx="70" cy="70" r={r} fill="none" stroke={RED} strokeWidth="16" />
      <circle
        cx="70" cy="70" r={r} fill="none"
        stroke={GREEN} strokeWidth="16"
        strokeDasharray={`${upLength} ${circumference - upLength}`}
        strokeDashoffset={circumference * 0.25}
      />
      <text x="70" y="66" textAnchor="middle" fontSize="22" fontWeight="700" fill={INK}
        style={{ fontVariantNumeric: 'tabular-nums' }}>
        {uptimePct.toFixed(2)}%
      </text>
      <text x="70" y="84" textAnchor="middle" fontSize="9" fill={MUTED} letterSpacing="0.08em">
        AVAILABLE
      </text>
    </svg>
  );
}

/**
 * Availability per bucket. The y-axis floor zooms to 90% when every bucket is
 * healthy — at full 0–100 scale a 99.5% bar is visually identical to a 100%
 * one. The floor is always printed on the axis so the zoom is never implicit.
 */
function AvailabilityBars({ timeline, bucketMs, slaTarget }: {
  timeline: TimelineBucket[]; bucketMs: number; slaTarget: number;
}) {
  const W = 720, H = 200;
  const padL = 34, padR = 8, padT = 12, padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const observed = timeline.filter(b => b.uptimePct !== null).map(b => b.uptimePct as number);
  const lowest = observed.length ? Math.min(...observed) : 100;
  const floor = lowest >= 90 ? 90 : 0;
  const span = 100 - floor;

  const barGap = 6;
  const barW = Math.max(4, (plotW - barGap * (timeline.length - 1)) / timeline.length);
  const yFor = (pct: number) => padT + plotH - ((pct - floor) / span) * plotH;

  const showDayLabel = bucketMs >= 24 * 3600 * 1000;
  const labelEvery = Math.ceil(timeline.length / 8);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }} role="img"
      aria-label="Availability per period">
      {[floor, floor + span / 2, 100].map(tick => (
        <g key={tick}>
          <line x1={padL} y1={yFor(tick)} x2={W - padR} y2={yFor(tick)} stroke={RULE} strokeWidth="1" />
          <text x={padL - 6} y={yFor(tick) + 3} textAnchor="end" fontSize="9" fill={MUTED}
            style={{ fontVariantNumeric: 'tabular-nums' }}>
            {tick.toFixed(0)}%
          </text>
        </g>
      ))}

      {slaTarget > floor && slaTarget < 100 && (
        <>
          <line x1={padL} y1={yFor(slaTarget)} x2={W - padR} y2={yFor(slaTarget)}
            stroke={AMBER} strokeWidth="1.5" strokeDasharray="5 3" />
          <text x={W - padR} y={yFor(slaTarget) - 4} textAnchor="end" fontSize="9" fill={AMBER} fontWeight="600">
            SLA {slaTarget}%
          </text>
        </>
      )}

      {timeline.map((b, i) => {
        const x = padL + i * (barW + barGap);
        if (b.uptimePct === null) {
          return (
            <rect key={i} x={x} y={padT} width={barW} height={plotH} fill="#f0f2f5" />
          );
        }
        const y = yFor(b.uptimePct);
        const fill = b.uptimePct >= slaTarget ? GREEN : b.uptimePct >= slaTarget - 1 ? AMBER : RED;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={padT + plotH - y} fill={fill} />
            {b.uptimePct < 100 && (
              <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize="8" fill={INK}
                style={{ fontVariantNumeric: 'tabular-nums' }}>
                {b.uptimePct.toFixed(1)}
              </text>
            )}
          </g>
        );
      })}

      <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke={INK} strokeWidth="1" />

      {timeline.map((b, i) => {
        if (i % labelEvery !== 0) return null;
        const x = padL + i * (barW + barGap) + barW / 2;
        return (
          <text key={i} x={x} y={H - 14} textAnchor="middle" fontSize="8.5" fill={MUTED}>
            {showDayLabel
              ? b.start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
              : b.start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          </text>
        );
      })}
    </svg>
  );
}

/** Average response time per bucket, drawn as an area + line. */
function LatencyChart({ timeline, bucketMs }: { timeline: TimelineBucket[]; bucketMs: number }) {
  const points = timeline
    .map((b, i) => ({ i, v: b.avgLatency, start: b.start }))
    .filter(p => p.v !== null) as { i: number; v: number; start: Date }[];

  if (points.length < 2) return null;

  const W = 720, H = 150;
  const padL = 42, padR = 8, padT = 12, padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const max = Math.max(...points.map(p => p.v));
  const ceiling = max <= 0 ? 1 : max * 1.15;
  const xFor = (i: number) => padL + (i / Math.max(1, timeline.length - 1)) * plotW;
  const yFor = (v: number) => padT + plotH - (v / ceiling) * plotH;

  const line = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${xFor(p.i).toFixed(1)} ${yFor(p.v).toFixed(1)}`).join(' ');
  const area = `${line} L ${xFor(points[points.length - 1].i).toFixed(1)} ${padT + plotH} L ${xFor(points[0].i).toFixed(1)} ${padT + plotH} Z`;
  const showDayLabel = bucketMs >= 24 * 3600 * 1000;
  const labelEvery = Math.ceil(timeline.length / 8);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }} role="img"
      aria-label="Average response time per period">
      {[0, ceiling / 2, ceiling].map((tick, idx) => (
        <g key={idx}>
          <line x1={padL} y1={yFor(tick)} x2={W - padR} y2={yFor(tick)} stroke={RULE} strokeWidth="1" />
          <text x={padL - 6} y={yFor(tick) + 3} textAnchor="end" fontSize="9" fill={MUTED}
            style={{ fontVariantNumeric: 'tabular-nums' }}>
            {numberFmt.format(tick)}
          </text>
        </g>
      ))}

      <path d={area} fill="#111418" fillOpacity="0.07" />
      <path d={line} fill="none" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
      {points.map(p => (
        <circle key={p.i} cx={xFor(p.i)} cy={yFor(p.v)} r="2" fill={INK} />
      ))}

      {timeline.map((b, i) => {
        if (i % labelEvery !== 0) return null;
        return (
          <text key={i} x={xFor(i)} y={H - 10} textAnchor="middle" fontSize="8.5" fill={MUTED}>
            {showDayLabel
              ? b.start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
              : b.start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          </text>
        );
      })}
    </svg>
  );
}

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ border: `1px solid ${RULE}`, borderRadius: '2mm', padding: '3mm 3.5mm' }}>
      <div style={{ fontSize: '7.5pt', textTransform: 'uppercase', letterSpacing: '0.08em', color: MUTED, marginBottom: '1.5mm' }}>
        {label}
      </div>
      <div style={{ fontSize: '15pt', fontWeight: 700, color: color || INK, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '7.5pt', color: MUTED, marginTop: '1mm' }}>{sub}</div>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      fontSize: '9pt', textTransform: 'uppercase', letterSpacing: '0.12em', color: MUTED,
      fontWeight: 700, margin: '0 0 2.5mm', paddingBottom: '1.5mm', borderBottom: `1px solid ${RULE}`,
      fontFamily: 'inherit',
    }}>
      {children}
    </h2>
  );
}

export default function PrintableReport({ target, data, rangeHours, slaTarget = 99.9 }: PrintableReportProps) {
  const status = statusFor(data.uptimePct, slaTarget);
  const timeline = data.timeline ?? [];
  const generatedAt = new Date();

  return (
    <div className="print-report-container" style={{ color: INK, fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: '9pt', lineHeight: 1.45 }}>

      {/* ── Header ── */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8mm', borderBottom: `2px solid ${INK}`, paddingBottom: '3mm', marginBottom: '5mm' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '7.5pt', textTransform: 'uppercase', letterSpacing: '0.16em', color: MUTED, fontWeight: 700 }}>
            Snoomp · Availability Report
          </div>
          {/* Colour pinned explicitly — a bare `color: var(--text-primary)`
              rule elsewhere in the cascade would otherwise beat the inherited
              ink colour from the container and print this white. */}
          <h1 style={{ margin: '1mm 0 0', fontSize: '19pt', fontWeight: 800, letterSpacing: '-0.02em', overflowWrap: 'anywhere', color: INK }}>
            {target.name}
          </h1>
          <div style={{ color: MUTED, marginTop: '1mm' }}>
            {target.host}{target.port ? `:${target.port}` : ''} · {String(target.type || '').toUpperCase()}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{
            display: 'inline-block', border: `1.5px solid ${status.color}`, color: status.color,
            borderRadius: '99px', padding: '1mm 3mm', fontSize: '8pt', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            {status.label}
          </div>
          <div style={{ fontSize: '8pt', color: MUTED, marginTop: '2mm' }}>
            {rangeLabel(rangeHours)}
          </div>
          <div style={{ fontSize: '8pt', color: MUTED }}>
            Generated {generatedAt.toLocaleString()}
          </div>
        </div>
      </header>

      {/* ── KPI strip ── */}
      <section style={{ marginBottom: '6mm', breakInside: 'avoid' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '3mm' }}>
          <Kpi label="Availability" value={`${data.uptimePct.toFixed(2)}%`} sub={`Target ${slaTarget}%`} color={status.color} />
          <Kpi label="Total Downtime" value={formatDuration(data.totalDowntimeSec)} sub={`${data.downtimePct.toFixed(2)}% of period`} />
          <Kpi label="Outages" value={numberFmt.format(data.failures)} sub={`${numberFmt.format(data.totalChecks)} checks analysed`} />
          <Kpi label="MTTR" value={data.mttrMin > 0 ? `${numberFmt.format(data.mttrMin)} min` : '—'} sub="Mean time to recovery" />
          <Kpi label="MTBF" value={data.mtbfHours > 0 ? `${numberFmt.format(data.mtbfHours)} h` : '—'} sub="Mean time between failures" />
          <Kpi
            label="Response Time"
            value={data.avgLatency != null ? `${numberFmt.format(data.avgLatency)} ms` : '—'}
            sub={data.p95Latency != null ? `p95 ${numberFmt.format(data.p95Latency)} ms` : 'No latency samples'}
          />
        </div>
      </section>

      {/* ── Availability split + per-period bars ── */}
      {timeline.length > 0 && (
        <section style={{ marginBottom: '6mm', breakInside: 'avoid' }}>
          <SectionTitle>Availability Breakdown</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '46mm 1fr', gap: '6mm', alignItems: 'center' }}>
            <div>
              <AvailabilityDonut uptimePct={data.uptimePct} />
              <div style={{ marginTop: '2mm', fontSize: '8pt' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '2mm' }}>
                  <span style={{ width: '3mm', height: '3mm', background: GREEN, borderRadius: '0.5mm', display: 'inline-block' }} />
                  Up · {data.uptimePct.toFixed(2)}%
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '2mm', marginTop: '1mm' }}>
                  <span style={{ width: '3mm', height: '3mm', background: RED, borderRadius: '0.5mm', display: 'inline-block' }} />
                  Down · {data.downtimePct.toFixed(2)}%
                </div>
              </div>
            </div>
            <AvailabilityBars timeline={timeline} bucketMs={data.bucketMs ?? 3600000} slaTarget={slaTarget} />
          </div>
        </section>
      )}

      {/* ── Latency trend ── */}
      {timeline.length > 0 && (
        <section style={{ marginBottom: '6mm', breakInside: 'avoid' }}>
          <SectionTitle>Response Time Trend (ms)</SectionTitle>
          <LatencyChart timeline={timeline} bucketMs={data.bucketMs ?? 3600000} />
        </section>
      )}

      {/* ── Incident log ── */}
      <section>
        <SectionTitle>Incident Log</SectionTitle>
        {data.downtimeLogs.length === 0 ? (
          <p style={{ color: MUTED, margin: 0 }}>
            No downtime events recorded during this period.
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8.5pt' }}>
            <thead style={{ display: 'table-header-group' }}>
              <tr>
                <th scope="col" style={{ textAlign: 'left', padding: '2mm 2mm 2mm 0', borderBottom: `1.5px solid ${INK}`, whiteSpace: 'nowrap' }}>Started</th>
                <th scope="col" style={{ textAlign: 'left', padding: '2mm', borderBottom: `1.5px solid ${INK}`, whiteSpace: 'nowrap' }}>Recovered</th>
                <th scope="col" style={{ textAlign: 'right', padding: '2mm', borderBottom: `1.5px solid ${INK}`, whiteSpace: 'nowrap' }}>Duration</th>
                <th scope="col" style={{ textAlign: 'left', padding: '2mm 0 2mm 2mm', borderBottom: `1.5px solid ${INK}` }}>Reported Error</th>
              </tr>
            </thead>
            <tbody>
              {data.downtimeLogs.map((log, idx) => {
                const endMs = log.ended ? log.ended.getTime() : Date.now();
                const durationSec = Math.max(0, Math.round((endMs - log.started.getTime()) / 1000));
                return (
                  <tr key={idx} style={{ breakInside: 'avoid', background: idx % 2 ? '#f6f8fa' : 'transparent' }}>
                    <td style={{ padding: '1.8mm 2mm 1.8mm 0', borderBottom: `1px solid ${RULE}`, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {log.started.toLocaleString()}
                    </td>
                    <td style={{ padding: '1.8mm 2mm', borderBottom: `1px solid ${RULE}`, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {log.ended ? log.ended.toLocaleString() : <span style={{ color: RED, fontWeight: 700 }}>Ongoing</span>}
                    </td>
                    <td style={{ padding: '1.8mm 2mm', borderBottom: `1px solid ${RULE}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                      {formatDuration(durationSec)}
                    </td>
                    <td style={{ padding: '1.8mm 0 1.8mm 2mm', borderBottom: `1px solid ${RULE}`, color: MUTED, overflowWrap: 'anywhere' }}>
                      {log.error || 'Connection timeout'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* ── Footer ── */}
      <footer style={{ marginTop: '8mm', paddingTop: '2.5mm', borderTop: `1px solid ${RULE}`, fontSize: '7.5pt', color: MUTED, display: 'flex', justifyContent: 'space-between' }}>
        <span>Snoomp Enterprise · Health &amp; Resource Monitor</span>
        <span>
          {rangeLabel(rangeHours)} · {numberFmt.format(data.totalChecks)} checks · SLA target {slaTarget}%
        </span>
      </footer>
    </div>
  );
}
