import React from 'react';
import { SlaConfig } from './UserPreferencesModal';

export interface MonitorRowProps {
  monitor: any;
  isActive: boolean;
  isBatchMode: boolean;
  isSelected: boolean;
  slaConfig?: SlaConfig;
  onSelect: (m: any) => void;
  onToggleSelect: (id: string) => void;
}

export function uptimeBadgeClass(pct: number, slaConfig?: SlaConfig): string {
  const normal = slaConfig?.normal ?? 99.9;
  const warning = slaConfig?.warning ?? 99.0;
  const critical = slaConfig?.critical ?? 95.0;
  if (pct >= normal) return 'excellent';
  if (pct >= warning) return 'good';
  if (pct >= critical) return 'warning';
  if (pct > 0) return 'critical';
  return 'unknown';
}

export const MonitorRow: React.FC<MonitorRowProps> = React.memo(({
  monitor: m,
  isActive,
  isBatchMode,
  isSelected,
  slaConfig,
  onSelect,
  onToggleSelect,
}) => {
  const uptime = m.uptime_24h ?? 0;
  const recentHbs = m.recent_heartbeats || [];

  const upHbs = recentHbs.filter((h: any) => h.status === 'up').length;
  const downHbs = recentHbs.filter((h: any) => h.status === 'down' || h.status === 'critical').length;
  const hbSummary = recentHbs.length > 0 ? `Last ${recentHbs.length} checks: ${upHbs} up, ${downHbs} down` : 'No recent checks';

  return (
    <button
      key={m.id}
      type="button"
      className={`monitor-row ${isActive ? 'active' : ''}`}
      aria-current={isActive ? 'page' : undefined}
      aria-pressed={isBatchMode ? isSelected : undefined}
      aria-label={`${m.name}, status ${m.status || 'unknown'}, uptime ${uptime.toFixed(1)}%`}
      onClick={() => {
        if (isBatchMode) {
          onToggleSelect(String(m.id));
        } else {
          onSelect(m);
        }
      }}
      style={{
        width: '100%',
        font: 'inherit',
        textAlign: 'left',
        background: isSelected ? 'var(--accent-dim)' : 'transparent',
        border: isSelected ? '1px solid var(--accent-glow)' : '1px solid transparent'
      }}
    >
      <div className="monitor-row-top" style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
        {isBatchMode && (
          <div style={{ width: '14px', height: '14px', border: '1px solid ' + (isSelected ? 'var(--accent)' : 'var(--border)'), borderRadius: '3px', background: isSelected ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {isSelected && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>}
          </div>
        )}
        <span className="monitor-row-label" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {m.name}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
        <span className={`uptime-badge ${uptimeBadgeClass(uptime, slaConfig)}`} style={{ flexShrink: 0, fontSize: '11px' }} title="24-hour average uptime">
          {recentHbs.length > 0 ? `${uptime.toFixed(1)}%` : '—'}
        </span>
        <div className="mini-hb-row" style={{ flex: 1, minWidth: 0 }} role="img" aria-label={hbSummary} title={hbSummary}>
          {recentHbs.length > 0
            ? recentHbs.map((hb: any, i: number) => (
              <div key={i} className={`mini-hb-bar ${hb.status || 'unknown'}`} aria-hidden="true" />
            ))
            : Array(20).fill(null).map((_, i) => (
              <div key={i} className="mini-hb-bar unknown" aria-hidden="true" />
            ))
          }
        </div>
        {m.response_time_ms > 0 && (
          <span style={{
            fontSize: '11px',
            fontFamily: 'var(--font-mono)',
            color: m.response_time_ms >= 1000 ? 'var(--color-warning)' : 'var(--text-muted)',
            fontWeight: m.response_time_ms >= 1000 ? 600 : 400,
            flexShrink: 0
          }}>
            {m.response_time_ms.toFixed(0)}ms
          </span>
        )}
      </div>
    </button>
  );
});

export default MonitorRow;
