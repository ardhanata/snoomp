
import {
  INK, MUTED, RULE, ZEBRA, GREEN, AMBER, RED, OFF,
  numberFmt, th, td, Kpi, SectionTitle, PrintDocument, DistributionBar,
} from './printKit';
import type { SlaTrend } from '../ExecutiveDashboard';

/**
 * Executive summary for print.
 *
 * Written for someone who did not open the tool: the question is "are we
 * meeting the commitment, and where is the risk", not "what is every host
 * doing". So it leads with the SLA verdict, shows the trend that justifies it,
 * and names the domains dragging the number down — then stops.
 */

interface Props {
  targets: any[];
  slaTrend: SlaTrend | null;
  slaConfig?: { normal: number; warning: number; critical: number };
}

/** Availability by month. Bars, because the reader compares periods. */
function TrendBars({ buckets, slaTarget }: { buckets: SlaTrend['buckets']; slaTarget: number }) {
  const W = 720, H = 190;
  const padL = 34, padR = 8, padT = 12, padB = 32;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const observed = buckets.filter(b => b.uptime_pct !== null).map(b => b.uptime_pct as number);
  const lowest = observed.length ? Math.min(...observed) : 100;
  // Zoom the floor when everything is healthy — on a 0–100 axis a 99.5% bar and
  // a 100% bar are the same bar. The floor is always labelled so it is explicit.
  const floor = lowest >= 99 ? 99 : lowest >= 90 ? 90 : 0;
  const span = 100 - floor;

  const gap = 8;
  const barW = Math.max(6, (plotW - gap * (buckets.length - 1)) / Math.max(1, buckets.length));
  const yFor = (p: number) => padT + plotH - ((p - floor) / span) * plotH;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }} role="img"
      aria-label="Availability by month">
      {[floor, floor + span / 2, 100].map(t => (
        <g key={t}>
          <line x1={padL} y1={yFor(t)} x2={W - padR} y2={yFor(t)} stroke={RULE} strokeWidth="1" />
          <text x={padL - 6} y={yFor(t) + 3} textAnchor="end" fontSize="9" fill={MUTED}
            style={{ fontVariantNumeric: 'tabular-nums' }}>{t.toFixed(t % 1 ? 1 : 0)}%</text>
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

      {buckets.map((b, i) => {
        const x = padL + i * (barW + gap);
        if (b.uptime_pct === null) {
          return <rect key={i} x={x} y={padT} width={barW} height={plotH} fill="#f0f2f5" />;
        }
        const y = yFor(b.uptime_pct);
        const fill = b.uptime_pct >= slaTarget ? GREEN : b.uptime_pct >= slaTarget - 1 ? AMBER : RED;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={padT + plotH - y} fill={fill} />
            <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize="8" fill={INK}
              style={{ fontVariantNumeric: 'tabular-nums' }}>{b.uptime_pct.toFixed(2)}</text>
          </g>
        );
      })}

      <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke={INK} strokeWidth="1" />
      {buckets.map((b, i) => (
        <text key={i} x={padL + i * (barW + gap) + barW / 2} y={H - 12} textAnchor="middle" fontSize="8.5" fill={MUTED}>
          {b.label}
        </text>
      ))}
    </svg>
  );
}

export default function PrintExecutiveReport({ targets, slaTrend, slaConfig }: Props) {
  const slaTarget = slaConfig?.normal ?? 99.9;
  const list = Array.isArray(targets) ? targets : [];

  const up = list.filter(t => (t?.status || '').toLowerCase() === 'up').length;
  const down = list.filter(t => ['down', 'critical'].includes((t?.status || '').toLowerCase())).length;
  const warn = list.filter(t => ['warning', 'warn'].includes((t?.status || '').toLowerCase())).length;
  const off = Math.max(0, list.length - up - down - warn);

  const currentAvailability = list.length ? (up / list.length) * 100 : 100;
  const meets = currentAvailability >= slaTarget;

  // Domain = first tag. Same grouping the Executive view uses on screen, so the
  // printed document and the dashboard agree.
  const domains: Record<string, { total: number; up: number }> = {};
  for (const t of list) {
    const key = (t?.tags?.length ? t.tags[0] : 'core').toUpperCase();
    if (!domains[key]) domains[key] = { total: 0, up: 0 };
    domains[key].total += 1;
    if ((t?.status || '').toLowerCase() === 'up') domains[key].up += 1;
  }
  const domainRows = Object.entries(domains)
    .map(([name, d]) => ({ name, ...d, pct: d.total ? (d.up / d.total) * 100 : 100 }))
    .sort((a, b) => a.pct - b.pct);

  const buckets = slaTrend?.buckets ?? [];
  const withData = buckets.filter(b => b.uptime_pct !== null);
  const periodAvg = withData.length
    ? withData.reduce((a, b) => a + (b.uptime_pct as number), 0) / withData.length
    : null;
  const mttr = slaTrend?.mttr?.minutes ?? null;

  return (
    <PrintDocument
      kind="Executive Summary"
      title="Service Availability"
      subtitle={`${list.length} monitored ${list.length === 1 ? 'endpoint' : 'endpoints'} across ${domainRows.length} ${domainRows.length === 1 ? 'domain' : 'domains'}`}
      status={{
        label: meets ? 'Meets SLA' : currentAvailability >= slaTarget - 1 ? 'At Risk' : 'SLA Breached',
        color: meets ? GREEN : currentAvailability >= slaTarget - 1 ? AMBER : RED,
      }}
      meta={slaTrend ? `${slaTrend.covered_months} of ${slaTrend.months} months recorded` : undefined}
      footNote={`SLA target ${slaTarget}% · ${list.length} endpoints`}
    >
      <section style={{ marginBottom: '6mm', breakInside: 'avoid' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '3mm' }}>
          <Kpi
            label="Current Availability"
            value={`${currentAvailability.toFixed(2)}%`}
            sub={`Target ${slaTarget}% · ${up}/${list.length} healthy`}
            color={meets ? GREEN : currentAvailability >= slaTarget - 1 ? AMBER : RED}
          />
          <Kpi
            label="Period Average"
            value={periodAvg != null ? `${periodAvg.toFixed(2)}%` : '—'}
            sub={withData.length ? `${withData.length} months with data` : 'No recorded history'}
            color={periodAvg == null ? undefined : periodAvg >= slaTarget ? GREEN : AMBER}
          />
          <Kpi
            label="Mean Time to Recovery"
            value={mttr != null ? `${numberFmt.format(mttr)} min` : '—'}
            sub={slaTrend?.mttr?.sample_size ? `${slaTrend.mttr.sample_size} incidents` : 'No incidents sampled'}
          />
          <Kpi
            label="Currently Impaired"
            value={numberFmt.format(down + warn)}
            sub={down > 0 ? `${down} down · ${warn} degraded` : warn > 0 ? `${warn} degraded` : 'None'}
            color={down > 0 ? RED : warn > 0 ? AMBER : undefined}
          />
        </div>
      </section>

      <section style={{ marginBottom: '6mm', breakInside: 'avoid' }}>
        <SectionTitle>Fleet Composition</SectionTitle>
        <DistributionBar segments={[
          { n: up, c: GREEN, label: 'Operational' },
          { n: warn, c: AMBER, label: 'Degraded' },
          { n: down, c: RED, label: 'Down' },
          { n: off, c: OFF, label: 'Paused' },
        ]} />
      </section>

      <section style={{ marginBottom: '6mm', breakInside: 'avoid' }}>
        <SectionTitle note={buckets.length ? `${buckets.length}-month window` : undefined}>
          Availability Trend
        </SectionTitle>
        {buckets.length === 0 ? (
          <p style={{ color: MUTED, margin: 0 }}>
            No recorded history yet. The trend appears once a full period of heartbeats has accumulated.
          </p>
        ) : (
          <TrendBars buckets={buckets} slaTarget={slaTarget} />
        )}
      </section>

      <section>
        <SectionTitle note="Lowest availability first">Domain Breakdown</SectionTitle>
        {domainRows.length === 0 ? (
          <p style={{ color: MUTED, margin: 0 }}>No monitors configured.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8.5pt' }}>
            <thead style={{ display: 'table-header-group' }}>
              <tr>
                <th scope="col" style={th}>Domain</th>
                <th scope="col" style={{ ...th, textAlign: 'right' }}>Healthy</th>
                <th scope="col" style={{ ...th, textAlign: 'right' }}>Total</th>
                <th scope="col" style={{ ...th, textAlign: 'right', paddingRight: 0 }}>Availability</th>
              </tr>
            </thead>
            <tbody>
              {domainRows.map((d, i) => (
                <tr key={d.name} style={{ breakInside: 'avoid', background: i % 2 ? ZEBRA : 'transparent' }}>
                  <td style={{ ...td, fontWeight: 600 }}>{d.name}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{d.up}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: MUTED }}>{d.total}</td>
                  <td style={{
                    ...td, textAlign: 'right', paddingRight: 0, fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    color: d.pct >= slaTarget ? GREEN : d.pct >= slaTarget - 1 ? AMBER : RED,
                  }}>
                    {d.pct.toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </PrintDocument>
  );
}
