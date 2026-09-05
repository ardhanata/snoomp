import { useMemo } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';

/**
 * Engine-specific charts for database monitors.
 *
 * These used to render through the generic CPU / Memory / Disk chart, which
 * required the checkers to squeeze unrelated values into those three fields:
 *
 *     Postgres   disk_percent := cache hit ratio    mem_percent := connections
 *     MongoDB    disk_percent := op counter scaled  mem_percent := connections
 *     Redis      disk_percent := ops/sec scaled     mem_percent := clients
 *
 * The result was a "Disk" line that was really a cache hit ratio, and a
 * "Memory %" axis showing a connection count. Every engine already reports its
 * real values under honest names in `details_json`; this component reads those
 * directly, so nothing is renamed or rescaled on the way to the screen.
 */

export type DbEngine = 'db' | 'mongodb' | 'redis';

interface Series {
  /** Key inside details_json. */
  key: string;
  label: string;
  unit: string;
  color: string;
  /** Ratio-style series get a fixed 0–100 axis; counters scale to the data. */
  domain?: [number, number];
  /** Rendered as a line rather than a filled area — for rates and ratios. */
  line?: boolean;
}

interface Panel {
  title: string;
  series: Series[];
}

const C1 = 'var(--chart-1)';
const C2 = 'var(--chart-2)';
const C3 = 'var(--chart-3)';

/**
 * What each engine actually exposes. Kept in sync with the `details` dicts in
 * app/checkers/{db_check,mongodb,redis_check}.py.
 */
const PANELS: Record<DbEngine, Panel[]> = {
  db: [
    {
      title: 'Connections & Cache',
      series: [
        { key: 'connections_current', label: 'Active connections', unit: '', color: C2 },
        { key: 'cache_hit_ratio', label: 'Cache hit ratio', unit: '%', color: C1, domain: [0, 100], line: true },
      ],
    },
    {
      title: 'Total Database Size',
      series: [
        // The checker calls this mem_resident_mb, but the query behind it is
        // sum(pg_database_size(...)) — it is on-disk size, not resident memory.
        { key: 'mem_resident_mb', label: 'Database size', unit: ' MB', color: C3 },
      ],
    },
  ],
  mongodb: [
    {
      title: 'Operations & Connections',
      series: [
        { key: 'ops_total', label: 'Operations', unit: '', color: C1, line: true },
        { key: 'connections_current', label: 'Current connections', unit: '', color: C2 },
      ],
    },
    {
      title: 'Memory',
      series: [
        { key: 'mem_resident_mb', label: 'Resident', unit: ' MB', color: C3 },
        { key: 'mem_virtual_mb', label: 'Virtual', unit: ' MB', color: C2, line: true },
      ],
    },
  ],
  redis: [
    {
      title: 'Throughput & Clients',
      series: [
        { key: 'ops_per_sec', label: 'Operations/sec', unit: '', color: C1, line: true },
        { key: 'connections_current', label: 'Connected clients', unit: '', color: C2 },
      ],
    },
    {
      title: 'Memory & Keyspace',
      series: [
        { key: 'mem_resident_mb', label: 'Used memory', unit: ' MB', color: C3 },
        { key: 'total_keys', label: 'Keys', unit: '', color: C2, line: true },
      ],
    },
  ],
};

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

interface DatabaseMetricsChartProps {
  engine: DbEngine;
  metrics: any[];
  rangeHours: number;
}

export default function DatabaseMetricsChart({ engine, metrics, rangeHours }: DatabaseMetricsChartProps) {
  const panels = PANELS[engine] ?? PANELS.db;

  const data = useMemo(() => metrics.map(m => {
    const d = m.details_json || {};
    const row: Record<string, number | null> = { timestamp: new Date(m.checked_at).getTime() };
    for (const panel of panels) {
      for (const s of panel.series) {
        const v = d[s.key];
        row[s.key] = typeof v === 'number' && Number.isFinite(v) ? v : null;
      }
    }
    return row;
  }), [metrics, panels]);

  const tickFormatter = (ts: number) => {
    const dt = new Date(ts);
    return rangeHours > 24
      ? dt.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit' })
      : dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  if (data.length === 0) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '24px 0', textAlign: 'center' }}>
        No metric history for this timeframe.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--space-4)' }}>
      {panels.map(panel => {
        // A panel is only worth drawing if at least one of its series has data;
        // an older Redis or Mongo may not report every field.
        const present = panel.series.filter(s => data.some(row => row[s.key] !== null));
        if (present.length === 0) return null;

        // Mixed units on one axis would be misleading, so a panel gets a fixed
        // 0–100 axis only when every series in it is a ratio.
        const allRatios = present.every(s => s.domain);

        return (
          <div key={panel.title} className="chart-section">
            <div className="section-title" style={{ marginBottom: 'var(--space-2)' }}>
              <h3 style={{ fontSize: '13px', margin: 0, fontWeight: 600 }}>{panel.title}</h3>
            </div>

            <div className="chart-legend">
              {present.map(s => (
                <span key={s.key} className="legend-item">
                  <span className="legend-dot" style={{ background: s.color }} />
                  {s.label}{s.unit ? ` (${s.unit.trim()})` : ''}
                </span>
              ))}
            </div>

            <ResponsiveContainer width="100%" height={170}>
              {present.every(s => s.line) ? (
                <LineChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="timestamp" type="number" scale="time"
                    domain={['dataMin', 'dataMax']} stroke="var(--text-muted)" fontSize={10}
                    tick={{ fill: 'var(--text-muted)' }} interval="preserveStartEnd"
                    minTickGap={45} tickFormatter={tickFormatter} />
                  <YAxis stroke="var(--text-muted)" fontSize={10} tick={{ fill: 'var(--text-muted)' }}
                    domain={allRatios ? [0, 100] : ['auto', 'auto']}
                    tickFormatter={(v: number) => compact.format(v)} width={44} />
                  <Tooltip
                    labelFormatter={(ts: any) => new Date(Number(ts)).toLocaleString()}
                    formatter={(v: any, name: string) => {
                      const s = present.find(x => x.label === name);
                      return [`${plain.format(Number(v))}${s?.unit ?? ''}`, name];
                    }}
                    contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '12px' }} />
                  {present.map(s => (
                    <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
                      stroke={s.color} strokeWidth={1.6} dot={false} connectNulls />
                  ))}
                </LineChart>
              ) : (
                <AreaChart data={data}>
                  <defs>
                    {present.map(s => (
                      <linearGradient key={s.key} id={`grad-${engine}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={s.color} stopOpacity={0.25} />
                        <stop offset="95%" stopColor={s.color} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="timestamp" type="number" scale="time"
                    domain={['dataMin', 'dataMax']} stroke="var(--text-muted)" fontSize={10}
                    tick={{ fill: 'var(--text-muted)' }} interval="preserveStartEnd"
                    minTickGap={45} tickFormatter={tickFormatter} />
                  <YAxis stroke="var(--text-muted)" fontSize={10} tick={{ fill: 'var(--text-muted)' }}
                    domain={allRatios ? [0, 100] : [0, 'auto']}
                    tickFormatter={(v: number) => compact.format(v)} width={44} />
                  <Tooltip
                    labelFormatter={(ts: any) => new Date(Number(ts)).toLocaleString()}
                    formatter={(v: any, name: string) => {
                      const s = present.find(x => x.label === name);
                      return [`${plain.format(Number(v))}${s?.unit ?? ''}`, name];
                    }}
                    contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '12px' }} />
                  {present.map(s => (
                    s.line
                      ? <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
                          stroke={s.color} strokeWidth={1.6} dot={false} connectNulls />
                      : <Area key={s.key} type="monotone" dataKey={s.key} name={s.label}
                          stroke={s.color} fill={`url(#grad-${engine}-${s.key})`}
                          strokeWidth={1.5} dot={false} connectNulls />
                  ))}
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>
        );
      })}
    </div>
  );
}
