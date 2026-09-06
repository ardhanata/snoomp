import React from 'react';

/**
 * Print-only fleet report for the dashboard view.
 *
 * Composed for paper rather than printed from the live DOM. The dashboard is a
 * set of fixed-height scrollers and live widgets; printing it produced one
 * clipped page with scrollbars drawn into the PDF. This renders the same data
 * as a paginating document instead.
 *
 * Shares the visual language of PrintableReport: ink on white, hairline rules,
 * uppercase letterspaced section labels, tabular figures, and a status palette
 * that separates by luminance so it survives greyscale.
 */

const INK = '#111418';
const MUTED = '#57606a';
const RULE = '#d8dee4';
const ZEBRA = '#f6f8fa';
const GREEN = '#1a7f37';
const AMBER = '#9a6700';
const RED = '#cf222e';
const OFF = '#8c959f';

const numberFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

export interface FleetReportProps {
  monitors: any[];
  incidents: any[];
  slaTarget?: number;
  scopeLabel?: string;
}

function statusColor(s: string): string {
  const v = (s || '').toLowerCase();
  if (v === 'up') return GREEN;
  if (v === 'down' || v === 'critical') return RED;
  if (v === 'warning' || v === 'warn') return AMBER;
  return OFF;
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

function SectionTitle({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <h2 style={{
      fontSize: '9pt', textTransform: 'uppercase', letterSpacing: '0.12em', color: MUTED,
      fontWeight: 700, margin: '0 0 2.5mm', paddingBottom: '1.5mm', borderBottom: `1px solid ${RULE}`,
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontFamily: 'inherit',
    }}>
      <span>{children}</span>
      {note && <span style={{ letterSpacing: 0, textTransform: 'none', fontWeight: 400 }}>{note}</span>}
    </h2>
  );
}

/**
 * Availability distribution across the fleet. A stacked bar rather than a pie:
 * at 51 monitors the interesting comparison is proportion, and a bar keeps its
 * segment labels readable when one slice is 98% of the total.
 */
function DistributionBar({ up, warn, down, off }: { up: number; warn: number; down: number; off: number }) {
  const total = Math.max(1, up + warn + down + off);
  const seg = [
    { n: up, c: GREEN, label: 'Up' },
    { n: warn, c: AMBER, label: 'Warning' },
    { n: down, c: RED, label: 'Down' },
    { n: off, c: OFF, label: 'Paused' },
  ].filter(s => s.n > 0);

  return (
    <div>
      <div style={{ display: 'flex', height: '7mm', borderRadius: '1mm', overflow: 'hidden', border: `1px solid ${RULE}` }}>
        {seg.map(s => (
          <div key={s.label} style={{ width: `${(s.n / total) * 100}%`, background: s.c }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: '5mm', marginTop: '2mm', fontSize: '8pt', flexWrap: 'wrap' }}>
        {seg.map(s => (
          <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '1.5mm' }}>
            <span style={{ width: '2.5mm', height: '2.5mm', background: s.c, borderRadius: '0.5mm', display: 'inline-block' }} />
            {s.label} · <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{s.n}</strong>
            <span style={{ color: MUTED }}>({((s.n / total) * 100).toFixed(1)}%)</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function PrintFleetReport({ monitors, incidents, slaTarget = 99.9, scopeLabel }: FleetReportProps) {
  const list = Array.isArray(monitors) ? monitors : [];
  const generatedAt = new Date();

  const enabled = list.filter(m => m?.enabled !== false);
  const up = list.filter(m => (m?.status || '').toLowerCase() === 'up').length;
  const down = list.filter(m => ['down', 'critical'].includes((m?.status || '').toLowerCase())).length;
  const warn = list.filter(m => ['warning', 'warn'].includes((m?.status || '').toLowerCase())).length;
  const off = Math.max(0, list.length - up - down - warn);

  const uptimes = enabled.map(m => (typeof m?.uptime_24h === 'number' ? m.uptime_24h : 100));
  const avgUptime = uptimes.length ? uptimes.reduce((a, b) => a + b, 0) / uptimes.length : 100;

  const latencies = list.map(m => m?.response_time_ms).filter((v: any) => typeof v === 'number' && v > 0) as number[];
  const avgLatency = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;

  const breaching = enabled
    .filter(m => (typeof m?.uptime_24h === 'number' ? m.uptime_24h : 100) < slaTarget)
    .sort((a, b) => (a.uptime_24h ?? 100) - (b.uptime_24h ?? 100));

  // Worst-first: a fleet report is read to find problems, so the table leads
  // with what is broken rather than with alphabetical order.
  const ordered = [...list].sort((a, b) => {
    const rank = (m: any) => {
      const s = (m?.status || '').toLowerCase();
      if (s === 'down' || s === 'critical') return 0;
      if (s === 'warning' || s === 'warn') return 1;
      if (s === 'up') return 3;
      return 2;
    };
    const r = rank(a) - rank(b);
    return r !== 0 ? r : (a.uptime_24h ?? 100) - (b.uptime_24h ?? 100);
  });

  const th: React.CSSProperties = {
    textAlign: 'left', padding: '2mm 2mm 2mm 0', borderBottom: `1.5px solid ${INK}`,
    whiteSpace: 'nowrap', fontSize: '8pt', textTransform: 'uppercase', letterSpacing: '0.06em',
  };
  const td: React.CSSProperties = { padding: '1.6mm 2mm 1.6mm 0', borderBottom: `1px solid ${RULE}`, verticalAlign: 'top' };

  return (
    <div className="print-report-container" style={{ color: INK, fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: '9pt', lineHeight: 1.45 }}>

      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8mm', borderBottom: `2px solid ${INK}`, paddingBottom: '3mm', marginBottom: '5mm' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '7.5pt', textTransform: 'uppercase', letterSpacing: '0.16em', color: MUTED, fontWeight: 700 }}>
            Snoomp · Fleet Report
          </div>
          <h1 style={{ margin: '1mm 0 0', fontSize: '19pt', fontWeight: 800, letterSpacing: '-0.02em', color: INK }}>
            System Health
          </h1>
          <div style={{ color: MUTED, marginTop: '1mm' }}>
            {scopeLabel || 'All monitors'} · {list.length} {list.length === 1 ? 'monitor' : 'monitors'}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{
            display: 'inline-block', border: `1.5px solid ${down > 0 ? RED : warn > 0 ? AMBER : GREEN}`,
            color: down > 0 ? RED : warn > 0 ? AMBER : GREEN,
            borderRadius: '99px', padding: '1mm 3mm', fontSize: '8pt', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            {down > 0 ? `${down} Down` : warn > 0 ? `${warn} Degraded` : 'All Operational'}
          </div>
          <div style={{ fontSize: '8pt', color: MUTED, marginTop: '2mm' }}>
            Generated {generatedAt.toLocaleString()}
          </div>
        </div>
      </header>

      <section style={{ marginBottom: '6mm', breakInside: 'avoid' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '3mm' }}>
          <Kpi label="Average Uptime (24h)" value={`${avgUptime.toFixed(2)}%`} sub={`Target ${slaTarget}%`}
            color={avgUptime >= slaTarget ? GREEN : avgUptime >= slaTarget - 1 ? AMBER : RED} />
          <Kpi label="Monitors" value={numberFmt.format(list.length)} sub={`${enabled.length} enabled · ${list.length - enabled.length} paused`} />
          <Kpi label="Currently Down" value={numberFmt.format(down)} sub={warn > 0 ? `${warn} degraded` : 'No degraded services'} color={down > 0 ? RED : undefined} />
          <Kpi label="Avg Response" value={avgLatency != null ? `${numberFmt.format(avgLatency)} ms` : '—'} sub={`${latencies.length} reporting`} />
        </div>
      </section>

      <section style={{ marginBottom: '6mm', breakInside: 'avoid' }}>
        <SectionTitle>Fleet Status Distribution</SectionTitle>
        <DistributionBar up={up} warn={warn} down={down} off={off} />
      </section>

      {breaching.length > 0 && (
        <section style={{ marginBottom: '6mm', breakInside: 'avoid' }}>
          <SectionTitle note={`${breaching.length} below ${slaTarget}%`}>Below SLA Target</SectionTitle>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8.5pt' }}>
            <thead style={{ display: 'table-header-group' }}>
              <tr>
                <th scope="col" style={th}>Monitor</th>
                <th scope="col" style={th}>Host</th>
                <th scope="col" style={{ ...th, textAlign: 'right' }}>Uptime 24h</th>
                <th scope="col" style={{ ...th, textAlign: 'right', paddingRight: 0 }}>Shortfall</th>
              </tr>
            </thead>
            <tbody>
              {breaching.map((m, i) => {
                const u = m.uptime_24h ?? 100;
                return (
                  <tr key={m.id || i} style={{ breakInside: 'avoid', background: i % 2 ? ZEBRA : 'transparent' }}>
                    <td style={{ ...td, fontWeight: 600 }}>{m.name}</td>
                    <td style={{ ...td, color: MUTED }}>{m.host}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: u < slaTarget - 1 ? RED : AMBER }}>
                      {u.toFixed(2)}%
                    </td>
                    <td style={{ ...td, textAlign: 'right', paddingRight: 0, fontVariantNumeric: 'tabular-nums', color: MUTED }}>
                      −{(slaTarget - u).toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <section style={{ marginBottom: '6mm' }}>
        <SectionTitle note="Worst first">All Monitors</SectionTitle>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8.5pt' }}>
          <thead style={{ display: 'table-header-group' }}>
            <tr>
              <th scope="col" style={th}>Monitor</th>
              <th scope="col" style={th}>Host</th>
              <th scope="col" style={th}>Type</th>
              <th scope="col" style={th}>Status</th>
              <th scope="col" style={{ ...th, textAlign: 'right' }}>Uptime 24h</th>
              <th scope="col" style={{ ...th, textAlign: 'right', paddingRight: 0 }}>Response</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((m, i) => (
              <tr key={m.id || i} style={{ breakInside: 'avoid', background: i % 2 ? ZEBRA : 'transparent' }}>
                <td style={{ ...td, fontWeight: 600 }}>{m.name}</td>
                <td style={{ ...td, color: MUTED, overflowWrap: 'anywhere' }}>{m.host}</td>
                <td style={{ ...td, color: MUTED, textTransform: 'uppercase', fontSize: '7.5pt' }}>{m.type}</td>
                <td style={{ ...td, fontWeight: 700, color: statusColor(m.status) }}>
                  {(m.status || 'unknown').toUpperCase()}
                </td>
                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {typeof m.uptime_24h === 'number' ? `${m.uptime_24h.toFixed(2)}%` : '—'}
                </td>
                <td style={{ ...td, textAlign: 'right', paddingRight: 0, fontVariantNumeric: 'tabular-nums' }}>
                  {m.response_time_ms > 0 ? `${numberFmt.format(m.response_time_ms)} ms` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <SectionTitle note={incidents.length ? `${incidents.length} most recent` : undefined}>Recent Incidents</SectionTitle>
        {incidents.length === 0 ? (
          <p style={{ color: MUTED, margin: 0 }}>No state changes recorded in the retained window.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8.5pt' }}>
            <thead style={{ display: 'table-header-group' }}>
              <tr>
                <th scope="col" style={th}>Monitor</th>
                <th scope="col" style={th}>Transition</th>
                <th scope="col" style={{ ...th, paddingRight: 0 }}>When</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((inc: any, i: number) => (
                <tr key={inc.id || i} style={{ breakInside: 'avoid', background: i % 2 ? ZEBRA : 'transparent' }}>
                  <td style={{ ...td, fontWeight: 600 }}>{inc.target_name}</td>
                  <td style={td}>
                    <span style={{ color: statusColor(inc.from_status) }}>{(inc.from_status || '?').toUpperCase()}</span>
                    <span style={{ color: MUTED }}> → </span>
                    <span style={{ color: statusColor(inc.to_status), fontWeight: 700 }}>{(inc.to_status || '?').toUpperCase()}</span>
                  </td>
                  <td style={{ ...td, paddingRight: 0, color: MUTED, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                    {inc.started_at ? new Date(inc.started_at).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <footer style={{ marginTop: '8mm', paddingTop: '2.5mm', borderTop: `1px solid ${RULE}`, fontSize: '7.5pt', color: MUTED, display: 'flex', justifyContent: 'space-between' }}>
        <span>Snoomp Enterprise · Health &amp; Resource Monitor</span>
        <span>{list.length} monitors · SLA target {slaTarget}% · {generatedAt.toLocaleDateString()}</span>
      </footer>
    </div>
  );
}
