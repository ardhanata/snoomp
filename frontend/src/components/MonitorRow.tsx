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
export const MonitorRow: React.FC<MonitorRowProps> = React.memo(({
  monitor: m,
  isActive,
  isBatchMode,
  isSelected,
  onSelect,
  onToggleSelect,
}) => {
  const latency = typeof m.response_time_ms === 'number' && m.response_time_ms > 0
    ? Math.round(m.response_time_ms)
    : null;

  return (
    <button
      key={m.id}
      type="button"
      className={`monitor-row ${isActive ? 'active' : ''}`}
      aria-current={isActive ? 'page' : undefined}
      aria-pressed={isBatchMode ? isSelected : undefined}
      aria-label={`${m.name}, status ${m.status || 'unknown'}${latency !== null ? `, latency ${latency}ms` : ''}`}
      onClick={() => {
        if (isBatchMode) {
          onToggleSelect(String(m.id));
        } else {
          onSelect(m);
        }
      }}
      style={{
        background: isSelected ? 'var(--accent-dim)' : isActive ? 'var(--panel2)' : 'transparent',
        border: isSelected ? '1px solid var(--accent)' : '1px solid transparent',
        fontWeight: isActive ? 600 : 500
      }}
    >
      <div className="monitor-row-top" style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
        {isBatchMode && (
          <div
            style={{
              width: '14px',
              height: '14px',
              border: '1px solid ' + (isSelected ? 'var(--accent)' : 'var(--field)'),
              borderRadius: '4px',
              background: isSelected ? 'var(--accent)' : 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            {isSelected && <Icon icon={Check} size={10} weight="bold" color="#ffffff" />}
          </div>
        )}
        <div
          className={`status-dot ${m.status || 'off'}`}
          style={{ width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0 }}
        />
        <span
          className="monitor-row-label"
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: '13px',
            fontWeight: isActive ? 600 : 500,
            color: 'var(--text)'
          }}
        >
          {m.name}
        </span>
        {latency !== null && (
          <span
            style={{
              fontSize: '12px',
              fontFamily: 'Noto Sans Mono, monospace',
              fontVariantNumeric: 'tabular-nums',
              color: latency >= 1000 ? 'var(--warn)' : 'var(--muted)',
              fontWeight: 400,
              flexShrink: 0
            }}
          >
            {latency}ms
          </span>
        )}
      </div>
    </button>
  );
});

export default MonitorRow;
