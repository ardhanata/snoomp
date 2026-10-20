import React from 'react';
import { Check } from '@phosphor-icons/react';
import { Icon } from './Icon';
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
        background: isSelected ? 'var(--accent-dim)' : 'transparent',
        border: isSelected ? '1px solid var(--accent-glow)' : '1px solid transparent'
      }}
    >
      <div className="monitor-row-top" style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
        {isBatchMode && (
          <div style={{ width: '14px', height: '14px', border: '1px solid ' + (isSelected ? 'var(--accent)' : 'var(--border)'), borderRadius: 'var(--radius-sm)', background: isSelected ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {isSelected && <Icon icon={Check} size={10} weight="bold" color="#fff" />}
          </div>
        )}
        <div className={`status-dot ${m.status || 'off'}`} style={{ width: '7px', height: '7px', flexShrink: 0 }} />
        <span className="monitor-row-label" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '13px', fontWeight: 500 }}>
          {m.name}
        </span>
        {m.response_time_ms > 0 ? (
          <span style={{
            fontSize: '11px',
            fontFamily: 'var(--font-mono)',
            color: m.response_time_ms >= 1000 ? 'var(--color-warning)' : 'var(--text-muted)',
            fontWeight: m.response_time_ms >= 1000 ? 600 : 400,
            flexShrink: 0
          }}>
            {m.response_time_ms.toFixed(0)}ms
          </span>
        ) : (
          <span className={`uptime-badge ${uptimeBadgeClass(uptime, slaConfig)}`} style={{ flexShrink: 0, fontSize: '11px' }}>
            {recentHbs.length > 0 ? `${uptime.toFixed(1)}%` : 'n/a'}
          </span>
        )}
      </div>
    </button>
  );
});

export default MonitorRow;
