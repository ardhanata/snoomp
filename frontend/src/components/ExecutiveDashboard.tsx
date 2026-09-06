import React, { useMemo } from 'react';
import { Activity, CheckCircle2, Server, Database, Globe, Cpu, ChevronRight, Printer } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine } from 'recharts';

export interface SlaTrendBucket {
  period: string;
  label: string;
  uptime_pct: number | null;
  checks: number;
  avg_response_ms: number | null;
}

export interface SlaTrend {
  months: number;
  buckets: SlaTrendBucket[];
  first_heartbeat_at: string | null;
  covered_months: number;
  mttr: { minutes: number | null; sample_size: number };
}

interface ExecutiveDashboardProps {
  targets: any[];
  slaConfig?: { normal: number; warning: number; critical: number };
  /** From GET /api/dashboard/sla-trend. `null` while loading. */
  slaTrend: SlaTrend | null;
  slaTrendLoading: boolean;
  /** Drill-down: jump to the dashboard filtered by a domain tag. */
  onSelectDomain?: (tag: string) => void;
  /** Render a print action in the header. Omitted on screens that can't print. */
  onPrint?: () => void;
}

const numberFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

function domainIcon(domain: string) {
  if (domain.includes('DB')) return <Database size={16} style={{ color: 'var(--accent)' }} aria-hidden="true" />;
  if (domain.includes('HTTP')) return <Globe size={16} style={{ color: 'var(--accent)' }} aria-hidden="true" />;
  if (domain.includes('SERVER')) return <Server size={16} style={{ color: 'var(--accent)' }} aria-hidden="true" />;
  return <Cpu size={16} style={{ color: 'var(--accent)' }} aria-hidden="true" />;
}

const ExecutiveDashboard: React.FC<ExecutiveDashboardProps> = ({
  targets, slaConfig, slaTrend, slaTrendLoading, onSelectDomain, onPrint,
}) => {
  const slaNormal = slaConfig?.normal ?? 99.9;
  const slaWarning = slaConfig?.warning ?? 99.0;

  /* One pass over targets instead of four separate filter/map/forEach walks.
     `targets` is the live monitor list, so this recomputes on every WebSocket
     heartbeat — memoised to keep the charts below from re-rendering with it. */
  const summary = useMemo(() => {
    const domains: Record<string, { total: number; up: number; tag: string }> = {};
    let up = 0;
    let down = 0;

    for (const t of targets) {
      const isUp = t.status === 'up';
      if (isUp) up++;
      else if (t.status === 'down') down++;

      const rawTag = t.tags?.length ? t.tags[0] : 'core';
      const key = rawTag.toUpperCase();
      const bucket = domains[key] ?? (domains[key] = { total: 0, up: 0, tag: rawTag });
      bucket.total++;
      if (isUp) bucket.up++;
    }

    const total = targets.length;
    return {
      total,
      up,
      down,
      domains,
      domainCount: Object.keys(domains).length,
      currentUptime: total > 0 ? (up / total) * 100 : 100,
    };
  }, [targets]);

  const slaColor = summary.currentUptime >= slaNormal
    ? 'var(--color-up)'
    : summary.currentUptime >= slaWarning
      ? 'var(--color-warning)'
      : 'var(--color-down)';

  /* Recharts skips null points, so months predating the deployment render as a
     gap rather than a plunge to zero. */
  const chartData = useMemo(
    () => (slaTrend?.buckets ?? []).map(b => ({
      label: b.label,
      uptime: b.uptime_pct,
      checks: b.checks,
      avgMs: b.avg_response_ms,
    })),
    [slaTrend]
  );

  /* Zoom the axis to the observed range — at a full 0–100 scale every bar in a
     healthy month is visually identical. Floor is always drawn on the axis. */
  const yDomain = useMemo<[number, number]>(() => {
    const seen = chartData.map(d => d.uptime).filter((v): v is number => v != null);
    if (seen.length === 0) return [99, 100];
    const lowest = Math.min(...seen, slaNormal);
    return [Math.max(0, Math.floor(lowest * 10) / 10 - 0.1), 100];
  }, [chartData, slaNormal]);

  const mttrMinutes = slaTrend?.mttr?.minutes ?? null;
  const mttrSample = slaTrend?.mttr?.sample_size ?? 0;
  const coverage = slaTrend?.covered_months ?? 0;
  const requested = slaTrend?.months ?? 6;
  const partialCoverage = slaTrend != null && coverage > 0 && coverage < requested;

  return (
    <div className="exec-dashboard">

      <div className="exec-header">
        <div>
          <div className="exec-eyebrow">Operations Overview</div>
          <h1 className="exec-title">Executive Command Center</h1>
        </div>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          {onPrint && (
            <button
              className="secondary"
              onClick={onPrint}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Printer size={14} aria-hidden="true" /> Print Report
            </button>
          )}
          <div className="exec-live-badge">
            <span
              className="exec-live-dot"
              style={{ background: summary.down > 0 ? 'var(--color-down)' : 'var(--color-up)' }}
            />
            <span>{summary.down > 0 ? `${summary.down} Active Incidents` : 'All Systems Operational'}</span>
          </div>
        </div>
      </div>

      {/* ── KPI row ── */}
      <div className="exec-kpi-grid">
        <div className="double-bezel-outer">
          <div className="double-bezel-inner exec-card">
            <div className="exec-card-head">
              <span className="exec-card-label">Monitored Infrastructure</span>
              <div className="exec-card-icon accent"><Server size={20} aria-hidden="true" /></div>
            </div>
            <div className="exec-card-value">
              {numberFmt.format(summary.total)} <span className="exec-card-unit">endpoints</span>
            </div>
            <div className="exec-card-foot accent">
              <Globe size={16} aria-hidden="true" /> Across {summary.domainCount} service domains
            </div>
          </div>
        </div>

        <div className="double-bezel-outer">
          <div className="double-bezel-inner exec-card">
            <div className="exec-card-head">
              <span className="exec-card-label">Current Availability</span>
              <div className="exec-card-icon up"><CheckCircle2 size={20} aria-hidden="true" /></div>
            </div>
            <div className="exec-card-value" style={{ color: slaColor }}>
              {summary.currentUptime.toFixed(2)}%
            </div>
            <div className="exec-card-foot">
              Target SLA <strong>{slaNormal}%</strong> · {summary.up}/{summary.total} healthy right now
            </div>
          </div>
        </div>

        {/* Previously hardcoded "< 45s detection" labelled as MTTR. Now the real
            figure from resolved incidents, or an explicit no-data state. */}
        <div className="double-bezel-outer">
          <div className="double-bezel-inner exec-card">
            <div className="exec-card-head">
              <span className="exec-card-label">Mean Time To Recovery</span>
              <div className="exec-card-icon warn"><Activity size={20} aria-hidden="true" /></div>
            </div>
            <div className="exec-card-value">
              {slaTrendLoading ? (
                <span className="exec-card-muted">—</span>
              ) : mttrMinutes != null ? (
                <>{numberFmt.format(mttrMinutes)} <span className="exec-card-unit">min</span></>
              ) : (
                <span className="exec-card-muted">No data</span>
              )}
            </div>
            <div className="exec-card-foot">
              {mttrMinutes != null
                ? `Across ${mttrSample} resolved incident${mttrSample === 1 ? '' : 's'}`
                : 'No incidents have resolved in this period'}
            </div>
          </div>
        </div>
      </div>

      {/* ── Trend + domain breakdown ── */}
      <div className="exec-lower-grid">
        <div className="double-bezel-outer">
          <div className="double-bezel-inner" style={{ height: '100%' }}>
            <div className="exec-panel-head">
              <h2 className="exec-panel-title">
                Availability Trend ({requested} Months)
              </h2>
              {partialCoverage && (
                <span className="exec-panel-note">
                  {coverage} month{coverage === 1 ? '' : 's'} of recorded data
                </span>
              )}
            </div>

            <div style={{ width: '100%', height: 300 }}>
              {slaTrendLoading ? (
                <div className="exec-chart-placeholder">Loading trend…</div>
              ) : coverage === 0 ? (
                <div className="exec-chart-placeholder">
                  No heartbeat history recorded yet. The trend appears once monitors
                  have been running for a full calendar month.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="slaGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="var(--accent)" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="label" stroke="var(--text-muted)" fontSize={12} />
                    <YAxis
                      domain={yDomain}
                      stroke="var(--text-muted)"
                      fontSize={12}
                      tickFormatter={(v: number) => `${v.toFixed(2)}%`}
                      width={62}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                        color: 'var(--text-primary)',
                      }}
                      formatter={(value: any, _n: any, entry: any) => {
                        if (value == null) return ['No data', 'Availability'];
                        const checks = entry?.payload?.checks ?? 0;
                        return [`${Number(value).toFixed(3)}% · ${numberFmt.format(checks)} checks`, 'Availability'];
                      }}
                    />
                    <ReferenceLine
                      y={slaNormal}
                      stroke="var(--color-warning)"
                      strokeDasharray="5 3"
                      label={{ value: `SLA ${slaNormal}%`, position: 'insideTopRight', fill: 'var(--color-warning)', fontSize: 11 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="uptime"
                      stroke="var(--accent)"
                      strokeWidth={3}
                      fillOpacity={1}
                      fill="url(#slaGradient)"
                      connectNulls={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        <div className="double-bezel-outer">
          <div className="double-bezel-inner exec-domain-panel">
            <h2 className="exec-panel-title">Domain Health Breakdown</h2>

            <div className="exec-domain-list">
              {Object.keys(summary.domains).length > 0 ? (
                Object.entries(summary.domains).map(([domain, data]) => {
                  const pct = (data.up / data.total) * 100;
                  return (
                    <button
                      key={domain}
                      type="button"
                      className="exec-domain-row"
                      onClick={() => onSelectDomain?.(data.tag)}
                      aria-label={`View ${domain} monitors, ${data.up} of ${data.total} healthy`}
                    >
                      <span className="exec-domain-name">
                        {domainIcon(domain)}
                        {domain}
                      </span>
                      <span className="exec-domain-stats">
                        <span className="exec-domain-count">{data.up}/{data.total}</span>
                        <span
                          className="exec-domain-pct"
                          style={{ color: pct >= slaWarning ? 'var(--color-up)' : 'var(--color-down)' }}
                        >
                          {pct.toFixed(1)}%
                        </span>
                        <ChevronRight size={14} aria-hidden="true" className="exec-domain-chevron" />
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="exec-chart-placeholder">No active targets configured.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/* Memoised: App re-renders on every WebSocket message, and this subtree carries
   two Recharts surfaces. Props are compared shallowly, so `targets` identity
   still gates it — but the common case (a re-render from unrelated App state)
   is skipped entirely. */
export default React.memo(ExecutiveDashboard);
export { ExecutiveDashboard };
