import React, { useMemo } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

/*
 * The recharts bundle is roughly 110KB gzipped and none of it is needed until a
 * monitor detail view is open, so these charts live behind React.lazy in App.tsx
 * rather than in the entry chunk. Keeping every recharts import in this module
 * (and in ExecutiveDashboard / DatabaseMetricsChart, also lazy) is what holds
 * that split in place — a single top-level recharts import anywhere in App.tsx
 * pulls the whole library back into the initial load.
 */

const CHART_HEIGHT = 190;

const TOOLTIP_STYLE = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  color: 'var(--text-primary)',
  fontSize: '12px',
};

const AXIS_TICK = { fill: 'var(--text-muted)' };

interface ResourceHistoryChartProps {
  metricsHistory: any[];
  resourceHours: number;
}

function ResourceHistoryChartImpl({ metricsHistory, resourceHours }: ResourceHistoryChartProps) {
  const data = useMemo(
    () => metricsHistory.map((m: any) => ({
      timestamp: new Date(m.checked_at).getTime(),
      cpu: m.cpu_percent, mem: m.mem_percent, disk: m.disk_percent,
    })),
    [metricsHistory]
  );

  // Deliberately not memoized: the window is anchored to "now", so it has to be
  // recomputed whenever the chart actually renders.
  const now = Date.now();

  return (
    <>
      <div className="chart-legend">
        <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--chart-1)' }} />CPU</span>
        <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--chart-2)' }} />Memory</span>
        <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--chart-3)' }} />Disk</span>
      </div>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="gCpu" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.25} /><stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} /></linearGradient>
            <linearGradient id="gMem" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.25} /><stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0} /></linearGradient>
            <linearGradient id="gDisk" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--chart-3)" stopOpacity={0.25} /><stop offset="95%" stopColor="var(--chart-3)" stopOpacity={0} /></linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="timestamp"
            type="number"
            domain={[now - resourceHours * 3600 * 1000, now]}
            stroke="var(--text-muted)"
            fontSize={10}
            tick={AXIS_TICK}
            interval="preserveStartEnd"
            minTickGap={45}
            tickFormatter={(ts: number) => {
              const d = new Date(ts);
              return resourceHours > 24
                ? d.toLocaleDateString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }}
          />
          <YAxis stroke="var(--text-muted)" fontSize={10} unit="%" domain={[0, 100]} tick={AXIS_TICK} />
          <Tooltip
            labelFormatter={(ts: any) => new Date(Number(ts)).toLocaleString()}
            contentStyle={TOOLTIP_STYLE}
          />
          <Area type="monotone" dataKey="cpu" name="CPU" stroke="var(--chart-1)" fill="url(#gCpu)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Area type="monotone" dataKey="mem" name="Memory" stroke="var(--chart-2)" fill="url(#gMem)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Area type="monotone" dataKey="disk" name="Disk" stroke="var(--chart-3)" fill="url(#gDisk)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </>
  );
}

export const ResourceHistoryChart = React.memo(ResourceHistoryChartImpl);

/*
 * The two latency charts differ only in gradient id, stroke weight and tick
 * granularity. They render in mutually exclusive branches, but the gradient ids
 * are document-global, so each variant keeps the id it already had.
 */
const LATENCY_VARIANTS = {
  database: { gradientId: 'gLatency', stopOpacity: 0.25, strokeWidth: 1.5, withSeconds: false, clampZero: true },
  standard: { gradientId: 'gLat', stopOpacity: 0.3, strokeWidth: 2, withSeconds: true, clampZero: false },
};

interface LatencyChartProps {
  heartbeats: any[];
  variant: keyof typeof LATENCY_VARIANTS;
}

function LatencyChartImpl({ heartbeats, variant }: LatencyChartProps) {
  const v = LATENCY_VARIANTS[variant];

  const data = useMemo(
    () => heartbeats.map((h: any) => ({
      time: new Date(h.checked_at).toLocaleTimeString(
        [],
        v.withSeconds
          ? { hour: '2-digit', minute: '2-digit', second: '2-digit' }
          : { hour: '2-digit', minute: '2-digit' }
      ),
      latency: v.clampZero ? (h.response_time_ms || 0) : h.response_time_ms,
    })),
    [heartbeats, v]
  );

  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id={v.gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--accent)" stopOpacity={v.stopOpacity} />
            <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={10} tick={AXIS_TICK} interval="preserveStartEnd" minTickGap={40} />
        <YAxis
          stroke="var(--text-muted)"
          fontSize={10}
          unit="ms"
          tick={AXIS_TICK}
          {...(v.clampZero ? { domain: [0, 'auto'] as [number, string] } : {})}
        />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Area
          type="monotone"
          dataKey="latency"
          name="Latency"
          stroke="var(--accent)"
          fill={`url(#${v.gradientId})`}
          strokeWidth={v.strokeWidth}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export const LatencyChart = React.memo(LatencyChartImpl);
