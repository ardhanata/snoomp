import React, { useEffect, useMemo, useState } from 'react';
import {
  X, Sliders, Shield, Palette, Bell, Settings, Tag,
  CheckCircle2, AlertTriangle, AlertCircle, Save, Info, Send, Loader2,
  Plus, Edit3
} from 'lucide-react';
import Dialog from './Dialog';
import PreferencesTagsTab from './PreferencesTagsTab';
import { NotificationDialog, NotificationItem } from './NotificationDialog';
import {
  DEFAULT_SETTINGS, InstanceSettings, REDACTED,
  fetchSettings, saveSettings, testDiscord, parseDecimal,
} from '../lib/settings';

export interface SlaConfig {
  normal: number;
  warning: number;
  critical: number;
}

interface UserPreferencesModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiUrl: string;
  token: string | null;
  /** Writes are admin-only; other roles get a read-only view. */
  role: string | null;
  /** Bubbles the saved settings up so the dashboard can re-colour immediately. */
  onSaved: (settings: InstanceSettings) => void;
  /** Accent is a personal choice, not an instance one — applied immediately. */
  accent: string;
  onAccentChange: (color: string) => void;
  monitors?: any[];
  allTags?: string[];
  onRenameTag?: (oldTag: string, newTag: string) => void;
  onDeleteTag?: (tagToDelete: string) => void;
  onAddTag?: (newTag: string) => void;
}

type TabId = 'sla' | 'appearance' | 'notifications' | 'defaults' | 'tags';

const TABS: { id: TabId; label: string; icon: typeof Shield }[] = [
  { id: 'sla', label: 'SLA', icon: Shield },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'defaults', label: 'Defaults', icon: Settings },
  { id: 'tags', label: 'Tags', icon: Tag },
];

/** Percentages are entered as text so a half-typed "99." isn't clobbered. */
type SlaDraft = { normal: string; warning: string; critical: string };
type ThresholdDraft = Record<string, string>;

const pct = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

function toDraft(n: number | null | undefined): string {
  return n === null || n === undefined ? '' : String(n);
}

export const UserPreferencesModal: React.FC<UserPreferencesModalProps> = ({
  isOpen, onClose, apiUrl, token, role, onSaved, accent, onAccentChange,
  monitors = [], allTags = [], onRenameTag, onDeleteTag, onAddTag,
}) => {
  const [activeTab, setActiveTab] = useState<TabId>('sla');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const canEdit = role === 'admin';

  // Drafts, so a partially typed value is never coerced mid-keystroke.
  const [sla, setSla] = useState<SlaDraft>({ normal: '', warning: '', critical: '' });
  const [thresholds, setThresholds] = useState<ThresholdDraft>({});
  const [discord, setDiscord] = useState(DEFAULT_SETTINGS.discord);
  const [defaults, setDefaults] = useState(DEFAULT_SETTINGS.defaults);
  const [appearance, setAppearance] = useState(DEFAULT_SETTINGS.appearance);
  const [testing, setTesting] = useState(false);

  // Uptime Kuma notification channels state
  const [notificationsList, setNotificationsList] = useState<NotificationItem[]>([]);
  const [selectedNotification, setSelectedNotification] = useState<NotificationItem | null>(null);
  const [isNotifDialogOpen, setIsNotifDialogOpen] = useState(false);

  const loadNotifications = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/notifications`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setNotificationsList(data);
      }
    } catch (e) {
      console.error('Failed fetching notification channels:', e);
    }
  };

  const hydrate = (s: InstanceSettings) => {
    setSla({
      normal: toDraft(s.sla.normal),
      warning: toDraft(s.sla.warning),
      critical: toDraft(s.sla.critical),
    });
    setThresholds(Object.fromEntries(
      Object.entries(s.thresholds).map(([k, v]) => [k, toDraft(v)]),
    ));
    setDiscord(s.discord);
    setDefaults(s.defaults);
    setAppearance(s.appearance);
  };

  // Load on open — settings are instance-wide, so another admin may have
  // changed them since this tab was last opened.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setError('');
    setNotice('');
    setLoading(true);
    fetchSettings(apiUrl, token)
      .then(s => { if (!cancelled) hydrate(s); })
      .catch(e => { if (!cancelled) setError(e.message || 'Could not load settings'); })
      .finally(() => { if (!cancelled) setLoading(false); });

    loadNotifications();
    return () => { cancelled = true; };
  }, [isOpen, apiUrl, token]);

  // ── Live SLA validation ──
  // Runs on every keystroke rather than on submit. The old modal validated only
  // on save, which is how warning=90 / critical=95 got stored and then rendered
  // as the self-contradicting summary "Critical: < 90% (Breach: < 95%)".
  const slaNums = useMemo(() => ({
    normal: parseDecimal(sla.normal),
    warning: parseDecimal(sla.warning),
    critical: parseDecimal(sla.critical),
  }), [sla]);

  const slaError = useMemo(() => {
    const { normal, warning, critical } = slaNums;
    if (normal === null || warning === null || critical === null) return 'All three SLA targets are required.';
    for (const [label, v] of [['Normal', normal], ['Warning', warning], ['Critical', critical]] as const) {
      if (v < 0 || v > 100) return `${label} must be between 0 and 100.`;
    }
    if (!(normal > warning)) return `Normal (${pct.format(normal)}%) must be above Warning (${pct.format(warning)}%).`;
    if (!(warning > critical)) return `Warning (${pct.format(warning)}%) must be above Critical (${pct.format(critical)}%).`;
    return '';
  }, [slaNums]);

  const thresholdError = useMemo(() => {
    const pairs: [string, string, string][] = [
      ['cpu_warn', 'cpu_crit', 'CPU'],
      ['mem_warn', 'mem_crit', 'Memory'],
      ['disk_warn', 'disk_crit', 'Disk'],
      ['latency_warn', 'latency_crit', 'Latency'],
    ];
    for (const [wk, ck, label] of pairs) {
      const w = parseDecimal(thresholds[wk] ?? '');
      const c = parseDecimal(thresholds[ck] ?? '');
      if (w !== null && c !== null && c < w) {
        return `${label} critical (${c}) must be at or above its warning (${w}).`;
      }
    }
    return '';
  }, [thresholds]);

  const blockingError = activeTab === 'sla' ? slaError
    : activeTab === 'defaults' ? thresholdError
      : '';

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    if (slaError) { setActiveTab('sla'); setError(slaError); return; }
    if (thresholdError) { setActiveTab('defaults'); setError(thresholdError); return; }

    setSaving(true);
    setError('');
    setNotice('');
    try {
      const numeric = (v: string) => parseDecimal(v);
      const saved = await saveSettings(apiUrl, token, {
        sla: {
          normal: slaNums.normal as number,
          warning: slaNums.warning as number,
          critical: slaNums.critical as number,
        },
        thresholds: Object.fromEntries(
          Object.entries(thresholds).map(([k, v]) => [k, numeric(v)]),
        ) as any,
        discord,
        defaults,
        appearance,
      });
      hydrate(saved);
      onSaved(saved);
      setNotice('Settings saved for everyone on this instance.');
    } catch (err: any) {
      setError(err.message || 'Could not save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleTestDiscord = async () => {
    setTesting(true);
    setError('');
    setNotice('');
    try {
      const res = await testDiscord(apiUrl, token);
      setNotice(res.detail || 'Test alert sent.');
    } catch (err: any) {
      setError(err.message || 'Test alert failed');
    } finally {
      setTesting(false);
    }
  };

  const field: React.CSSProperties = {
    width: '100%', padding: '10px 12px', background: 'var(--bg-secondary)',
    border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    color: 'var(--text-primary)', fontSize: '13px',
  };
  const card: React.CSSProperties = {
    background: 'var(--bg-void)', padding: 'var(--space-4)',
    borderRadius: 'var(--radius-md)', border: '1px solid var(--border)',
  };
  const legend: React.CSSProperties = {
    fontSize: '13px', fontWeight: 700, display: 'flex',
    alignItems: 'center', gap: '6px', marginBottom: 'var(--space-2)',
  };

  const numberField = (
    id: string, label: string, value: string, onChange: (v: string) => void,
    opts: { suffix?: string; placeholder?: string; hint?: string } = {},
  ) => (
    <div>
      <label htmlFor={id} style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
        {label}{opts.suffix ? ` (${opts.suffix})` : ''}
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        disabled={!canEdit}
        value={value}
        placeholder={opts.placeholder}
        onChange={e => onChange(e.target.value)}
        style={{ ...field, fontFamily: 'var(--font-mono)' }}
      />
      {opts.hint && (
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>{opts.hint}</div>
      )}
    </div>
  );

  return (
    <>
      <Dialog
        isOpen={isOpen}
        onClose={onClose}
      aria-labelledby="pref-modal-title"
      className="pref-modal-dialog"
      style={{ padding: 0, margin: 'auto', background: 'transparent', border: 'none', maxWidth: '660px', width: '100%' }}
    >
      <div className="double-bezel-outer" style={{ width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="double-bezel-inner" style={{ padding: 'var(--space-5)' }}>

          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-4)', gap: 'var(--space-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '11px', minWidth: 0 }}>
              <div style={{ padding: '8px', borderRadius: 'var(--radius-md)', background: 'var(--accent-dim)', color: 'var(--accent)', flexShrink: 0 }}>
                <Sliders size={20} aria-hidden="true" />
              </div>
              <div style={{ minWidth: 0 }}>
                <h3 id="pref-modal-title" style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Preferences
                </h3>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Instance-wide — these apply to every operator
                </span>
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close preferences"
              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px', flexShrink: 0 }}>
              <X size={20} aria-hidden="true" />
            </button>
          </div>

          {!canEdit && (
            <div role="status" style={{ ...card, borderColor: 'var(--border)', marginBottom: 'var(--space-3)', fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Info size={14} aria-hidden="true" />
              These settings are instance-wide. Only an admin can change them.
            </div>
          )}

          {/* Tabs */}
          <div role="tablist" aria-label="Preference sections"
            style={{ display: 'flex', gap: '4px', background: 'var(--bg-void)', padding: '4px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', marginBottom: 'var(--space-4)', overflowX: 'auto' }}>
            {TABS.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  id={`pref-tab-${tab.id}`}
                  aria-selected={isActive}
                  aria-controls={`pref-panel-${tab.id}`}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    padding: '7px 8px', borderRadius: 'var(--radius-sm)', fontSize: '11.5px', fontWeight: 600,
                    whiteSpace: 'nowrap', cursor: 'pointer', border: 'none',
                    background: isActive ? 'var(--bg-secondary)' : 'transparent',
                    color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                    transition: 'background-color var(--t-fast), color var(--t-fast)',
                  }}
                >
                  <Icon size={13} aria-hidden="true" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Async feedback. aria-live so a save result is announced, not just
              shown — the button that triggered it may be off-screen. */}
          {(error || notice) && (
            <div
              role="status"
              aria-live="polite"
              style={{
                ...card,
                marginBottom: 'var(--space-3)',
                borderColor: error ? 'var(--color-down)' : 'var(--color-up)',
                color: error ? 'var(--color-down)' : 'var(--color-up)',
                fontSize: '12px', display: 'flex', gap: '8px', alignItems: 'flex-start',
              }}
            >
              {error ? <AlertCircle size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
                : <CheckCircle2 size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />}
              <span>{error || notice}</span>
            </div>
          )}

          <form onSubmit={handleSave}>

            {/* ── SLA ── */}
            {activeTab === 'sla' && (
              <div id="pref-panel-sla" role="tabpanel" aria-labelledby="pref-tab-sla"
                style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>

                <div style={{ ...card, background: 'var(--accent-dim)', borderColor: 'var(--accent-glow)' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--accent)', display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '6px' }}>
                    <Info size={14} aria-hidden="true" /> Global availability targets
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                    Higher is better, so these must descend: Normal &gt; Warning &gt; Critical.
                    Individual monitors can override them under Alarm Thresholds when you edit a monitor.
                  </p>
                </div>

                <fieldset style={{ ...card, border: `1px solid ${slaError ? 'var(--color-down)' : 'var(--border)'}` }}>
                  <legend style={{ ...legend, color: 'var(--text-primary)', padding: '0 6px' }}>
                    Availability thresholds (%)
                  </legend>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-3)' }}>
                    {numberField('pref-sla-normal', 'Normal target', sla.normal,
                      v => setSla(s => ({ ...s, normal: v })), { placeholder: '99.9', hint: 'Meeting the SLA' })}
                    {numberField('pref-sla-warning', 'Warning threshold', sla.warning,
                      v => setSla(s => ({ ...s, warning: v })), { placeholder: '99.0', hint: 'Degraded' })}
                    {numberField('pref-sla-critical', 'Critical threshold', sla.critical,
                      v => setSla(s => ({ ...s, critical: v })), { placeholder: '95.0', hint: 'Breached' })}
                  </div>

                  {slaError ? (
                    <div style={{ marginTop: 'var(--space-3)', fontSize: '12px', color: 'var(--color-down)', display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <AlertCircle size={13} aria-hidden="true" /> {slaError}
                    </div>
                  ) : (
                    /* Derived from the same parsed numbers as the validator, so
                       it can never contradict the fields above it. */
                    <div style={{ marginTop: 'var(--space-3)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--border)', fontSize: '11.5px', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', fontFamily: 'var(--font-mono)' }}>
                      <span style={{ color: 'var(--color-up)' }}>
                        <CheckCircle2 size={11} aria-hidden="true" style={{ verticalAlign: -1 }} /> Normal ≥ {pct.format(slaNums.normal!)}%
                      </span>
                      <span style={{ color: 'var(--color-warning)' }}>
                        <AlertTriangle size={11} aria-hidden="true" style={{ verticalAlign: -1 }} /> Warning {pct.format(slaNums.critical!)}–{pct.format(slaNums.normal!)}%
                      </span>
                      <span style={{ color: 'var(--color-down)' }}>
                        <AlertCircle size={11} aria-hidden="true" style={{ verticalAlign: -1 }} /> Critical &lt; {pct.format(slaNums.critical!)}%
                      </span>
                    </div>
                  )}
                </fieldset>
              </div>
            )}

            {/* ── Appearance ── */}
            {activeTab === 'appearance' && (
              <div id="pref-panel-appearance" role="tabpanel" aria-labelledby="pref-tab-appearance"
                style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
                <fieldset style={card}>
                  <legend style={{ ...legend, color: 'var(--text-primary)', padding: '0 6px' }}>
                    <Palette size={14} aria-hidden="true" /> Chart series colours
                  </legend>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: 0, marginBottom: 'var(--space-3)' }}>
                    Applied to the CPU, memory and disk series on every resource chart.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    {([
                      ['chart_1', 'CPU series'],
                      ['chart_2', 'Memory series'],
                      ['chart_3', 'Disk series'],
                    ] as const).map(([key, label]) => (
                      <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                        <input
                          id={`pref-${key}`}
                          type="color"
                          disabled={!canEdit}
                          value={appearance[key]}
                          onChange={e => setAppearance(a => ({ ...a, [key]: e.target.value }))}
                          style={{ width: '44px', height: '32px', padding: '2px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg-secondary)', cursor: canEdit ? 'pointer' : 'not-allowed', flexShrink: 0 }}
                        />
                        <label htmlFor={`pref-${key}`} style={{ fontSize: '13px', color: 'var(--text-primary)', flex: 1 }}>
                          {label}
                        </label>
                        {/* Hex is editable too — colour pickers are awkward for
                            matching an existing brand palette. */}
                        <input
                          aria-label={`${label} hex value`}
                          type="text"
                          disabled={!canEdit}
                          value={appearance[key]}
                          spellCheck={false}
                          onChange={e => setAppearance(a => ({ ...a, [key]: e.target.value }))}
                          style={{ ...field, width: '110px', fontFamily: 'var(--font-mono)', textTransform: 'lowercase' }}
                        />
                      </div>
                    ))}
                  </div>

                  <div style={{ marginTop: 'var(--space-4)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Preview</div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '48px' }} role="img" aria-label="Preview of the three selected chart colours">
                      {[26, 42, 34, 48, 30, 44, 38].map((h, i) => (
                        <React.Fragment key={i}>
                          <div style={{ flex: 1, height: `${h}%`, background: appearance.chart_1, borderRadius: '2px 2px 0 0' }} />
                          <div style={{ flex: 1, height: `${h * 1.6}%`, background: appearance.chart_2, borderRadius: '2px 2px 0 0' }} />
                          <div style={{ flex: 1, height: `${h * 1.2}%`, background: appearance.chart_3, borderRadius: '2px 2px 0 0' }} />
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                </fieldset>

                <fieldset style={card}>
                  <legend style={{ ...legend, color: 'var(--text-primary)', padding: '0 6px' }}>
                    Your accent colour
                  </legend>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: 0, marginBottom: 'var(--space-3)' }}>
                    Stored in this browser only — it does not change what anyone else sees, and
                    applies as soon as you pick it.
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                    {['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#06b6d4'].map(c => (
                      <button
                        key={c}
                        type="button"
                        aria-label={`Use accent colour ${c}`}
                        aria-pressed={accent.toLowerCase() === c}
                        onClick={() => onAccentChange(c)}
                        style={{
                          width: '30px', height: '30px', borderRadius: '50%', background: c,
                          cursor: 'pointer', flexShrink: 0,
                          border: accent.toLowerCase() === c
                            ? '2px solid var(--text-primary)'
                            : '2px solid transparent',
                          outlineOffset: '2px',
                        }}
                      />
                    ))}
                    <input
                      aria-label="Custom accent colour"
                      type="color"
                      value={accent}
                      onChange={e => onAccentChange(e.target.value)}
                      style={{ width: '44px', height: '32px', padding: '2px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg-secondary)', cursor: 'pointer' }}
                    />
                  </div>
                </fieldset>
              </div>
            )}

            {/* ── Notifications ── */}
            {activeTab === 'notifications' && (
              <div id="pref-panel-notifications" role="tabpanel" aria-labelledby="pref-tab-notifications"
                style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>

                {/* ── Uptime Kuma Style Notification Channels ── */}
                <fieldset style={card}>
                  <legend style={{ ...legend, color: 'var(--text-primary)', padding: '0 6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Bell size={14} aria-hidden="true" /> Notification Channels
                  </legend>

                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: 0, marginBottom: 'var(--space-3)' }}>
                    Set up notification channels (Discord, Telegram, Slack, Email / SMTP, Webhooks, Teams, etc.) to receive instant alerts when monitors change state.
                  </p>

                  {notificationsList.length === 0 ? (
                    <div style={{
                      padding: '16px',
                      borderRadius: 'var(--radius-sm, 6px)',
                      background: 'var(--bg-secondary)',
                      border: '1px dashed var(--border)',
                      textAlign: 'center',
                      color: 'var(--text-muted)',
                      fontSize: '13px',
                      marginBottom: 'var(--space-3)',
                    }}>
                      No notification channels configured yet. Click "Setup Notification" below to add one.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: 'var(--space-3)' }}>
                      {notificationsList.map(n => (
                        <div
                          key={n.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '10px 14px',
                            borderRadius: 'var(--radius-sm, 6px)',
                            background: 'var(--bg-secondary)',
                            border: '1px solid var(--border)',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div style={{
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              background: n.active !== false ? '#10b981' : '#6b7280',
                            }} />
                            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                              {n.name}
                            </span>
                            <span style={{
                              fontSize: '11px',
                              padding: '2px 8px',
                              borderRadius: '10px',
                              background: 'rgba(59, 130, 246, 0.15)',
                              color: 'var(--color-brand, #3b82f6)',
                              textTransform: 'uppercase',
                              fontWeight: 700,
                              letterSpacing: '0.04em',
                            }}>
                              {n.type}
                            </span>
                            {n.is_default && (
                              <span style={{
                                fontSize: '10px',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                background: 'rgba(16, 185, 129, 0.15)',
                                color: '#10b981',
                                fontWeight: 600,
                              }}>
                                DEFAULT
                              </span>
                            )}
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedNotification(n);
                                setIsNotifDialogOpen(true);
                              }}
                              disabled={!canEdit}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '4px 10px',
                                borderRadius: '4px',
                                border: '1px solid var(--border)',
                                background: 'var(--bg-card)',
                                color: 'var(--text-primary)',
                                fontSize: '12px',
                                cursor: canEdit ? 'pointer' : 'not-allowed',
                              }}
                            >
                              <Edit3 size={12} />
                              Edit
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => {
                      setSelectedNotification(null);
                      setIsNotifDialogOpen(true);
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '8px 16px',
                      borderRadius: 'var(--radius-sm, 6px)',
                      border: 'none',
                      background: 'var(--color-brand, #3b82f6)',
                      color: '#fff',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: canEdit ? 'pointer' : 'not-allowed',
                      opacity: canEdit ? 1 : 0.6,
                    }}
                  >
                    <Plus size={14} />
                    Setup Notification
                  </button>
                </fieldset>

                {/* ── Global Discord Relay (Optional) ── */}
                <fieldset style={card}>
                  <legend style={{ ...legend, color: 'var(--text-primary)', padding: '0 6px' }}>
                    <Bell size={14} aria-hidden="true" /> Global Discord Relay (Instance-wide)
                  </legend>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: canEdit ? 'pointer' : 'not-allowed', marginBottom: 'var(--space-3)' }}>
                    <input
                      type="checkbox"
                      disabled={!canEdit}
                      checked={discord.enabled}
                      onChange={e => setDiscord(d => ({ ...d, enabled: e.target.checked }))}
                      style={{ width: '16px', height: '16px', flexShrink: 0 }}
                    />
                    <span style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 600 }}>
                      Send an alert when a monitor changes state
                    </span>
                  </label>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', opacity: discord.enabled ? 1 : 0.55 }}>
                    <div>
                      <label htmlFor="pref-webhook-critical" style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                        Critical channel webhook — down transitions, pings the on-call role
                      </label>
                      <input
                        id="pref-webhook-critical"
                        type="url"
                        inputMode="url"
                        spellCheck={false}
                        autoComplete="off"
                        disabled={!canEdit || !discord.enabled}
                        value={discord.webhook_critical}
                        placeholder="Incoming webhook URL"
                        onChange={e => setDiscord(d => ({ ...d, webhook_critical: e.target.value }))}
                        style={{ ...field, fontFamily: 'var(--font-mono)', fontSize: '12px' }}
                      />
                    </div>
                    <div>
                      <label htmlFor="pref-webhook-warning" style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                        Warning channel webhook — degraded and threshold breaches, never pings
                      </label>
                      <input
                        id="pref-webhook-warning"
                        type="url"
                        inputMode="url"
                        spellCheck={false}
                        autoComplete="off"
                        disabled={!canEdit || !discord.enabled}
                        value={discord.webhook_warning}
                        placeholder="Falls back to the critical channel if empty"
                        onChange={e => setDiscord(d => ({ ...d, webhook_warning: e.target.value }))}
                        style={{ ...field, fontFamily: 'var(--font-mono)', fontSize: '12px' }}
                      />
                    </div>
                    <div style={{ maxWidth: '260px' }}>
                      {numberField('pref-oncall-role', 'On-call group ID', discord.oncall_role_id,
                        v => setDiscord(d => ({ ...d, oncall_role_id: v })),
                        { placeholder: '123456789012345678', hint: 'Mentioned once per critical batch' })}
                    </div>
                  </div>

                  {(discord.webhook_critical === REDACTED || discord.webhook_warning === REDACTED) && (
                    <p style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: 'var(--space-3)', marginBottom: 0 }}>
                      A stored webhook is shown as {REDACTED}. Leave it as-is to keep it, or paste a new URL to replace it.
                    </p>
                  )}

                  <div style={{ marginTop: 'var(--space-4)', display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={handleTestDiscord}
                      disabled={!canEdit || !discord.enabled || testing}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '6px',
                        padding: '8px 14px', borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border)', background: 'var(--bg-secondary)',
                        color: 'var(--text-primary)', fontSize: '12px', fontWeight: 600,
                        cursor: (!canEdit || !discord.enabled || testing) ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {testing
                        ? <><Loader2 size={13} className="spin" aria-hidden="true" /> Sending…</>
                        : <><Send size={13} aria-hidden="true" /> Send test alert</>}
                    </button>
                    <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                      Save first — the test uses the stored webhook.
                    </span>
                  </div>
                </fieldset>

                <p style={{ fontSize: '11.5px', color: 'var(--text-muted)', margin: 0 }}>
                  Snoomp posts alerts to any endpoint that accepts a Discord-compatible
                  webhook payload. Per-monitor destinations are configured on the monitor
                  itself and are unaffected by this section. Environment variables still act
                  as the fallback when a field here is blank.
                </p>
              </div>
            )}

            {/* ── Defaults ── */}
            {activeTab === 'defaults' && (
              <div id="pref-panel-defaults" role="tabpanel" aria-labelledby="pref-tab-defaults"
                style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>

                <fieldset style={card}>
                  <legend style={{ ...legend, color: 'var(--text-primary)', padding: '0 6px' }}>
                    New monitor defaults
                  </legend>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: 0, marginBottom: 'var(--space-3)' }}>
                    Pre-filled when you add a monitor. Changing them never touches existing monitors.
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--space-3)' }}>
                    {numberField('pref-def-interval', 'Check interval', String(defaults.check_interval),
                      v => setDefaults(d => ({ ...d, check_interval: Number(parseDecimal(v) ?? 0) })), { suffix: 'seconds', placeholder: '60' })}
                    {numberField('pref-def-timeout', 'Request timeout', String(defaults.request_timeout),
                      v => setDefaults(d => ({ ...d, request_timeout: Number(parseDecimal(v) ?? 0) })), { suffix: 'seconds', placeholder: '10' })}
                    {numberField('pref-def-retries', 'Retries before down', String(defaults.retries),
                      v => setDefaults(d => ({ ...d, retries: Number(parseDecimal(v) ?? 0) })), { placeholder: '0', hint: '0 alerts on the first failure' })}
                    <div>
                      <label htmlFor="pref-def-type" style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                        Default monitor type
                      </label>
                      <select id="pref-def-type" disabled={!canEdit} value={defaults.monitor_type}
                        onChange={e => setDefaults(d => ({ ...d, monitor_type: e.target.value }))} style={field}>
                        <option value="http">HTTP / HTTPS</option>
                        <option value="ping">ICMP Ping</option>
                        <option value="tcp">TCP Port</option>
                        <option value="dns">DNS Query</option>
                        <option value="snmp">SNMP Metrics</option>
                        <option value="ssh">SSH System Metrics</option>
                        <option value="db">PostgreSQL</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="pref-def-env" style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                        Default environment tag
                      </label>
                      <select id="pref-def-env" disabled={!canEdit} value={defaults.environment_tag}
                        onChange={e => setDefaults(d => ({ ...d, environment_tag: e.target.value }))} style={field}>
                        <option value="">None</option>
                        <option value="prod">prod</option>
                        <option value="staging">staging</option>
                        <option value="dev">dev</option>
                      </select>
                    </div>
                    {numberField('pref-def-retention', 'Heartbeat retention', String(defaults.retention_days),
                      v => setDefaults(d => ({ ...d, retention_days: Number(parseDecimal(v) ?? 0) })), { suffix: 'days', placeholder: '90' })}
                  </div>
                </fieldset>

                <fieldset style={{ ...card, border: `1px solid ${thresholdError ? 'var(--color-down)' : 'var(--border)'}` }}>
                  <legend style={{ ...legend, color: 'var(--text-primary)', padding: '0 6px' }}>
                    <AlertTriangle size={14} aria-hidden="true" /> Fleet alarm thresholds
                  </legend>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: 0, marginBottom: 'var(--space-3)' }}>
                    Applied to every monitor that has not set its own. Leave a field blank to disable
                    that check entirely.
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--space-3)' }}>
                    {([
                      ['cpu_warn', 'CPU warning', '%'], ['cpu_crit', 'CPU critical', '%'],
                      ['mem_warn', 'Memory warning', '%'], ['mem_crit', 'Memory critical', '%'],
                      ['disk_warn', 'Disk warning', '%'], ['disk_crit', 'Disk critical', '%'],
                      ['latency_warn', 'Latency warning', 'ms'], ['latency_crit', 'Latency critical', 'ms'],
                    ] as const).map(([key, label, unit]) =>
                      numberField(`pref-th-${key}`, label, thresholds[key] ?? '',
                        v => setThresholds(t => ({ ...t, [key]: v })), { suffix: unit, placeholder: 'off' }),
                    )}
                  </div>
                  {thresholdError && (
                    <div style={{ marginTop: 'var(--space-3)', fontSize: '12px', color: 'var(--color-down)', display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <AlertCircle size={13} aria-hidden="true" /> {thresholdError}
                    </div>
                  )}
                </fieldset>
              </div>
            )}

            {/* ── Tags ── */}
            {activeTab === 'tags' && (
              <div id="pref-panel-tags" role="tabpanel" aria-labelledby="pref-tab-tags" style={{ marginBottom: 'var(--space-4)' }}>
                <PreferencesTagsTab
                  monitors={monitors}
                  allTags={allTags}
                  onRenameTag={onRenameTag}
                  onDeleteTag={onDeleteTag}
                  onAddTag={onAddTag}
                />
              </div>
            )}

            {/* Footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', alignItems: 'center' }}>
              {loading && <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginRight: 'auto' }}>Loading…</span>}
              <button type="button" onClick={onClose}
                style={{ padding: '11px 18px', borderRadius: 'var(--radius-sm)', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
                {canEdit ? 'Cancel' : 'Close'}
              </button>
              {canEdit && activeTab !== 'tags' && (
                <button
                  type="submit"
                  /* Stays enabled while invalid so the message is reachable —
                     a disabled button gives no clue why it is disabled. */
                  aria-disabled={saving || Boolean(blockingError)}
                  style={{
                    padding: '11px 22px', borderRadius: 'var(--radius-sm)',
                    background: blockingError ? 'var(--surface-raised)' : 'var(--accent)',
                    border: blockingError ? '1px solid var(--border)' : 'none',
                    color: blockingError ? 'var(--text-muted)' : '#fff',
                    cursor: saving ? 'wait' : 'pointer',
                    fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px',
                  }}
                >
                  {saving
                    ? <><Loader2 size={16} className="spin" aria-hidden="true" /> Saving…</>
                    : <><Save size={16} aria-hidden="true" /> Save Preferences</>}
                </button>
              )}
            </div>

          </form>
        </div>
      </div>
    </Dialog>

    <NotificationDialog
      isOpen={isNotifDialogOpen}
      onClose={() => setIsNotifDialogOpen(false)}
      apiUrl={apiUrl}
      token={token}
      notification={selectedNotification}
      onSaved={() => {
        loadNotifications();
      }}
      onDeleted={() => {
        loadNotifications();
      }}
    />
  </>
  );
};

export default UserPreferencesModal;
