import React, { useState } from 'react';
import { X, Sliders, Shield, Palette, Bell, Settings, CheckCircle2, AlertTriangle, AlertCircle, Save, Volume2, VolumeX, Moon, Sun, Info, Tag, Plus, Edit2, Trash2 } from 'lucide-react';

export interface SlaConfig {
  normal: number;
  warning: number;
  critical: number;
}

export interface UserPreferences {
  sla: SlaConfig;
  theme: string;
  accent: string;
  soundAlerts: boolean;
  browserNotifications: boolean;
  defaultCheckInterval: number;
  timeFormat: '24h' | '12h';
}

interface UserPreferencesModalProps {
  isOpen: boolean;
  onClose: () => void;
  preferences: UserPreferences;
  onSave: (newPreferences: UserPreferences) => void;
  monitors?: any[];
  allTags?: string[];
  onRenameTag?: (oldTag: string, newTag: string) => void;
  onDeleteTag?: (tagToDelete: string) => void;
  onAddTag?: (newTag: string) => void;
}

export const UserPreferencesModal: React.FC<UserPreferencesModalProps> = ({
  isOpen,
  onClose,
  preferences,
  onSave,
  monitors = [],
  allTags = [],
  onRenameTag,
  onDeleteTag,
  onAddTag,
}) => {
  const [activeTab, setActiveTab] = useState<'sla' | 'appearance' | 'notifications' | 'defaults' | 'tags'>('sla');
  
  // Local Tag Management State
  const [customTags, setCustomTags] = useState<string[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [editingTagKey, setEditingTagKey] = useState<string | null>(null);
  const [editingTagValue, setEditingTagValue] = useState('');
  
  // Tab 1: SLA
  const [normal, setNormal] = useState<number>(preferences.sla.normal);
  const [warning, setWarning] = useState<number>(preferences.sla.warning);
  const [critical, setCritical] = useState<number>(preferences.sla.critical);

  // Tab 2: Appearance
  const [theme, setTheme] = useState<string>(preferences.theme);
  const [accent, setAccent] = useState<string>(preferences.accent);

  // Tab 3: Notifications
  const [soundAlerts, setSoundAlerts] = useState<boolean>(preferences.soundAlerts);
  const [browserNotifications, setBrowserNotifications] = useState<boolean>(preferences.browserNotifications);

  // Tab 4: Defaults
  const [defaultCheckInterval, setDefaultCheckInterval] = useState<number>(preferences.defaultCheckInterval);
  const [timeFormat, setTimeFormat] = useState<'24h' | '12h'>(preferences.timeFormat);

  // Resync local state ONLY when modal opens
  React.useEffect(() => {
    if (!isOpen) return;
    setNormal(preferences.sla.normal);
    setWarning(preferences.sla.warning);
    setCritical(preferences.sla.critical);
    setTheme(preferences.theme);
    setAccent(preferences.accent);
    setSoundAlerts(preferences.soundAlerts);
    setBrowserNotifications(preferences.browserNotifications);
    setDefaultCheckInterval(preferences.defaultCheckInterval);
    setTimeFormat(preferences.timeFormat);
  }, [isOpen]);

  const modalRef = React.useRef<HTMLDivElement>(null);

  // Focus Trap & Keyboard Navigation Hook
  React.useEffect(() => {
    if (!isOpen || !modalRef.current) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = modalRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length > 0) focusable[0].focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab') return;
      const currentFocusable = modalRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!currentFocusable || currentFocusable.length === 0) return;
      const first = currentFocusable[0];
      const last = currentFocusable[currentFocusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (warning >= normal) {
      alert('For Availability SLA (%), Normal Target (e.g. 99.9%) must be greater than Warning Threshold (e.g. 99.0%). Higher % means higher availability!');
      return;
    }
    if (critical >= warning) {
      alert('For Availability SLA (%), Warning Threshold (e.g. 99.0%) must be greater than Critical Threshold (e.g. 95.0%).');
      return;
    }

    onSave({
      sla: { normal, warning, critical },
      theme,
      accent,
      soundAlerts,
      browserNotifications,
      defaultCheckInterval,
      timeFormat
    });
    onClose();
  };

  return (
    <div 
      role="dialog"
      aria-modal="true"
      aria-labelledby="pref-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
        padding: '24px'
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div ref={modalRef} className="double-bezel-outer" style={{ maxWidth: '640px', width: '100%', maxHeight: '90vh', overflowY: 'auto', animation: 'fade-in 0.2s ease-out' }}>
        <div className="double-bezel-inner" style={{ padding: '24px' }}>
          
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ padding: '8px', borderRadius: '10px', background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                <Sliders size={20} />
              </div>
              <div>
                <h3 id="pref-modal-title" style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>Preferences</h3>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Customize SLA thresholds, notifications &amp; system defaults</span>
              </div>
            </div>
            
            <button 
              type="button"
              onClick={onClose}
              aria-label="Close preferences modal"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: '4px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <X size={20} />
            </button>
          </div>

          {/* Navigation Tabs */}
          <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-void)', padding: '4px', borderRadius: '10px', border: '1px solid var(--border)', marginBottom: '24px', overflowX: 'auto' }}>
            {[
              { id: 'sla', label: 'SLA', icon: Shield },
              { id: 'appearance', label: 'Appearance', icon: Palette },
              { id: 'notifications', label: 'Notifications', icon: Bell },
              { id: 'defaults', label: 'Defaults', icon: Settings },
              { id: 'tags', label: 'Tags', icon: Tag },
            ].map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id as any)}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '7px 8px',
                    borderRadius: '7px',
                    fontSize: '11.5px',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                    border: 'none',
                    background: isActive ? 'var(--bg-secondary)' : 'transparent',
                    color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                    boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <Icon size={13} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          <form onSubmit={handleSave}>
            
            {/* TAB 1: SLA THRESHOLDS */}
            {activeTab === 'sla' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
                
                {/* Guidance Banner */}
                <div style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: '10px', padding: '12px 14px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  <strong style={{ color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <Info size={14} /> Service Level Agreement (SLA) Targets
                  </strong>
                  Higher percentage numbers represent better availability. Set your targets in descending order:
                  <div style={{ marginTop: '6px', fontFamily: 'var(--font-mono)', fontSize: '11px', display: 'flex', gap: '12px' }}>
                    <span style={{ color: 'var(--color-up)' }}>[Normal Target (e.g. 99.9%)]</span> &gt; <span style={{ color: 'var(--color-warning)' }}>[Warning (e.g. 99.0%)]</span> &gt; <span style={{ color: 'var(--color-down)' }}>[Critical (e.g. 95.0%)]</span>
                  </div>
                </div>

                {/* Normal SLA */}
                <div style={{ background: 'var(--bg-void)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <label htmlFor="pref-sla-normal" style={{ fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-up)' }}>
                      <CheckCircle2 size={16} /> Normal SLA Target (%)
                    </label>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Target Operational Uptime (e.g. 99.9%)</span>
                  </div>
                  <input
                    id="pref-sla-normal"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={normal}
                    onChange={e => setNormal(parseFloat(e.target.value) || 0)}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '15px',
                      fontWeight: 700
                    }}
                    required
                  />
                </div>

                {/* Warning SLA */}
                <div style={{ background: 'var(--bg-void)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <label htmlFor="pref-sla-warning" style={{ fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-warning)' }}>
                      <AlertTriangle size={16} /> Warning SLA Threshold (%)
                    </label>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Degraded Service Alert (e.g. 99.0%)</span>
                  </div>
                  <input
                    id="pref-sla-warning"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={warning}
                    onChange={e => setWarning(parseFloat(e.target.value) || 0)}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '15px',
                      fontWeight: 700
                    }}
                    required
                  />
                </div>

                {/* Critical SLA */}
                <div style={{ background: 'var(--bg-void)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-down)' }}>
                      <AlertCircle size={16} /> Critical SLA Threshold (%)
                    </label>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Severe Outage & Breach (e.g. 95.0%)</span>
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={critical}
                    onChange={e => setCritical(parseFloat(e.target.value) || 0)}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '15px',
                      fontWeight: 700
                    }}
                    required
                  />
                </div>

                {/* Classification Summary */}
                <div style={{ padding: '12px 16px', background: 'var(--bg-void)', borderRadius: '10px', border: '1px solid var(--border)', fontSize: '11px' }}>
                  <div style={{ fontWeight: 700, marginBottom: '6px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontSize: '10px' }}>Threshold Range Evaluation</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)' }}>
                    <span style={{ color: 'var(--color-up)', display: 'flex', alignItems: 'center', gap: '4px' }}><CheckCircle2 size={12} /> Normal: &ge; {normal}%</span>
                    <span style={{ color: 'var(--color-warning)', display: 'flex', alignItems: 'center', gap: '4px' }}><AlertTriangle size={12} /> Warning: {warning}% – {Math.max(warning, normal - 0.01).toFixed(2)}%</span>
                    <span style={{ color: 'var(--color-down)', display: 'flex', alignItems: 'center', gap: '4px' }}><AlertCircle size={12} /> Critical: &lt; {warning}% (Breach: &lt; {critical}%)</span>
                  </div>
                </div>

              </div>
            )}

            {/* TAB 2: APPEARANCE */}
            {activeTab === 'appearance' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', marginBottom: '24px' }}>
                
                {/* Theme mode */}
                <div style={{ background: 'var(--bg-void)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border)' }}>
                  <label style={{ fontSize: '13px', fontWeight: 700, display: 'block', marginBottom: '10px' }}>Interface Theme</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <button
                      type="button"
                      onClick={() => setTheme('dark')}
                      style={{
                        padding: '12px',
                        borderRadius: '8px',
                        background: theme === 'dark' ? 'var(--accent-dim)' : 'var(--bg-secondary)',
                        border: `1px solid ${theme === 'dark' ? 'var(--accent)' : 'var(--border)'}`,
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        fontWeight: 600
                      }}
                    >
                      <Moon size={16} /> Dark Mode
                    </button>
                    <button
                      type="button"
                      onClick={() => setTheme('light')}
                      style={{
                        padding: '12px',
                        borderRadius: '8px',
                        background: theme === 'light' ? 'var(--accent-dim)' : 'var(--bg-secondary)',
                        border: `1px solid ${theme === 'light' ? 'var(--accent)' : 'var(--border)'}`,
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        fontWeight: 600
                      }}
                    >
                      <Sun size={16} /> Light Mode
                    </button>
                  </div>
                </div>

                {/* Accent Palette */}
                <div style={{ background: 'var(--bg-void)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border)' }}>
                  <label style={{ fontSize: '13px', fontWeight: 700, display: 'block', marginBottom: '10px' }}>Primary Accent Palette</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                    {[
                      { hex: '#3b82f6', name: 'Azure Blue' },
                      { hex: '#34a853', name: 'Emerald Green' },
                      { hex: '#06b6d4', name: 'Cyan Tech' },
                      { hex: '#8b5cf6', name: 'Purple Ray' },
                    ].map(opt => (
                      <button
                        key={opt.hex}
                        type="button"
                        onClick={() => setAccent(opt.hex)}
                        style={{
                          padding: '10px',
                          borderRadius: '8px',
                          background: 'var(--bg-secondary)',
                          border: `1px solid ${accent === opt.hex ? opt.hex : 'var(--border)'}`,
                          color: 'var(--text-primary)',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '11px',
                          fontWeight: 600
                        }}
                      >
                        <div style={{ width: '16px', height: '16px', borderRadius: '50%', background: opt.hex }} />
                        <span>{opt.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

              </div>
            )}

            {/* TAB 3: NOTIFICATIONS */}
            {activeTab === 'notifications' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', marginBottom: '24px' }}>
                
                <div style={{ background: 'var(--bg-void)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>Audible Outage Siren</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Play sound alert when an endpoint transitions to DOWN status</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSoundAlerts(!soundAlerts)}
                    style={{
                      padding: '8px 14px',
                      borderRadius: '8px',
                      background: soundAlerts ? 'var(--accent-dim)' : 'var(--bg-secondary)',
                      border: `1px solid ${soundAlerts ? 'var(--accent)' : 'var(--border)'}`,
                      color: soundAlerts ? 'var(--accent)' : 'var(--text-muted)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontWeight: 600,
                      fontSize: '12px'
                    }}
                  >
                    {soundAlerts ? <Volume2 size={16} /> : <VolumeX size={16} />}
                    {soundAlerts ? 'Enabled' : 'Disabled'}
                  </button>
                </div>

                <div style={{ background: 'var(--bg-void)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>Desktop Notifications</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Send native OS browser notifications on status changes</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setBrowserNotifications(!browserNotifications)}
                    style={{
                      padding: '8px 14px',
                      borderRadius: '8px',
                      background: browserNotifications ? 'var(--accent-dim)' : 'var(--bg-secondary)',
                      border: `1px solid ${browserNotifications ? 'var(--accent)' : 'var(--border)'}`,
                      color: browserNotifications ? 'var(--accent)' : 'var(--text-muted)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontWeight: 600,
                      fontSize: '12px'
                    }}
                  >
                    <Bell size={16} />
                    {browserNotifications ? 'Enabled' : 'Disabled'}
                  </button>
                </div>

              </div>
            )}

            {/* TAB 4: MONITORING DEFAULTS */}
            {activeTab === 'defaults' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', marginBottom: '24px' }}>
                
                <div style={{ background: 'var(--bg-void)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border)' }}>
                  <label style={{ fontSize: '13px', fontWeight: 700, display: 'block', marginBottom: '8px' }}>Default Check Interval (Seconds)</label>
                  <select
                    value={defaultCheckInterval}
                    onChange={e => setDefaultCheckInterval(parseInt(e.target.value, 10))}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      color: 'var(--text-primary)',
                      fontSize: '13px',
                      fontWeight: 600
                    }}
                  >
                    <option value={10}>10 Seconds (High-Frequency)</option>
                    <option value={30}>30 Seconds (Fast)</option>
                    <option value={60}>60 Seconds (Standard Default)</option>
                    <option value={300}>300 Seconds (5 Minutes)</option>
                  </select>
                </div>

                <div style={{ background: 'var(--bg-void)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border)' }}>
                  <label style={{ fontSize: '13px', fontWeight: 700, display: 'block', marginBottom: '8px' }}>Time Display Format</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <button
                      type="button"
                      onClick={() => setTimeFormat('24h')}
                      style={{
                        padding: '10px',
                        borderRadius: '8px',
                        background: timeFormat === '24h' ? 'var(--accent-dim)' : 'var(--bg-secondary)',
                        border: `1px solid ${timeFormat === '24h' ? 'var(--accent)' : 'var(--border)'}`,
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontSize: '12px'
                      }}
                    >
                      24-Hour (14:30:00)
                    </button>
                    <button
                      type="button"
                      onClick={() => setTimeFormat('12h')}
                      style={{
                        padding: '10px',
                        borderRadius: '8px',
                        background: timeFormat === '12h' ? 'var(--accent-dim)' : 'var(--bg-secondary)',
                        border: `1px solid ${timeFormat === '12h' ? 'var(--accent)' : 'var(--border)'}`,
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontSize: '12px'
                      }}
                    >
                      12-Hour (02:30:00 PM)
                    </button>
                  </div>
                </div>

              </div>
            )}

            {/* TAB 5: TAG MANAGEMENT */}
            {activeTab === 'tags' && (() => {
              const ENV_KEYWORDS = ['prod', 'production', 'staging', 'stag', 'dev', 'development', 'test', 'uat'];
              const isEnvTagHelper = (t: string) => ENV_KEYWORDS.includes(t.toLowerCase());
              
              const normalizeTags = (tags: any): string[] => {
                if (!tags) return [];
                if (Array.isArray(tags)) {
                  return tags.flatMap(t => typeof t === 'string' ? t.split(',') : []).map(t => t.trim()).filter(Boolean);
                }
                if (typeof tags === 'string') {
                  return tags.split(',').map(t => t.trim()).filter(Boolean);
                }
                return [];
              };

              const allTagNames = Array.from(
                new Set([
                  ...(allTags || []),
                  ...monitors.flatMap(m => normalizeTags(m.tags)),
                  ...customTags
                ])
              ) as string[];

              const tagSummaryList = allTagNames.map(tagName => {
                const count = monitors.filter(m => {
                  const targetTags = normalizeTags(m.tags);
                  return targetTags.some((t: string) => t.toLowerCase() === tagName.toLowerCase());
                }).length;
                return { name: tagName, count, isEnv: isEnvTagHelper(tagName) };
              }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

              const handleAddTagSubmit = () => {
                if (!newTagName.trim()) return;
                const tagToAdd = newTagName.trim();
                setCustomTags(prev => Array.from(new Set([...prev, tagToAdd])));
                if (onAddTag) onAddTag(tagToAdd);
                setNewTagName('');
              };

              const handleSaveRename = (oldName: string) => {
                if (!editingTagValue.trim() || editingTagValue.trim() === oldName) {
                  setEditingTagKey(null);
                  return;
                }
                if (onRenameTag) onRenameTag(oldName, editingTagValue.trim());
                setEditingTagKey(null);
              };

              const handleDeleteClick = (tagName: string, count: number) => {
                if (window.confirm(`Delete tag "${tagName}" from all ${count} associated monitor(s)?`)) {
                  if (onDeleteTag) onDeleteTag(tagName);
                }
              };

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
                  
                  {/* Guidance Banner */}
                  <div style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: '10px', padding: '12px 14px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                    <strong style={{ color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      <Tag size={14} /> System &amp; Environment Tag Management
                    </strong>
                    Manage platform tags across your monitor fleet. Renaming or deleting a tag automatically updates all associated targets in real-time.
                  </div>

                  {/* Add Tag Row */}
                  <div style={{ background: 'var(--bg-void)', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--border)', display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <input
                      type="text"
                      placeholder="Add new tag (e.g. Oracle, Production, DMZ)..."
                      value={newTagName}
                      onChange={e => setNewTagName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddTagSubmit();
                        }
                      }}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        color: 'var(--text-primary)',
                        fontSize: '12.5px'
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleAddTagSubmit}
                      disabled={!newTagName.trim()}
                      style={{
                        padding: '8px 14px',
                        borderRadius: '6px',
                        background: 'var(--accent)',
                        color: '#fff',
                        border: 'none',
                        cursor: newTagName.trim() ? 'pointer' : 'not-allowed',
                        fontSize: '12px',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <Plus size={14} /> Add Tag
                    </button>
                  </div>

                  {/* Tag List */}
                  <div style={{ background: 'var(--bg-void)', padding: '16px', borderRadius: '10px', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>Active Fleet Tags ({tagSummaryList.length})</span>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Usage Count</span>
                    </div>

                    {tagSummaryList.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '12px' }}>
                        No tags found in system monitors. Use the input above to create a tag!
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '240px', overflowY: 'auto', paddingRight: '4px' }}>
                        {tagSummaryList.map((tagItem) => {
                          const isEditing = editingTagKey === tagItem.name;
                          return (
                            <div 
                              key={tagItem.name} 
                              style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'space-between', 
                                padding: '8px 12px', 
                                background: 'var(--bg-secondary)', 
                                borderRadius: '8px', 
                                border: '1px solid var(--border)' 
                              }}
                            >
                              {isEditing ? (
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flex: 1 }}>
                                  <input
                                    type="text"
                                    value={editingTagValue}
                                    onChange={e => setEditingTagValue(e.target.value)}
                                    style={{
                                      padding: '4px 8px',
                                      background: 'var(--bg-void)',
                                      border: '1px solid var(--accent)',
                                      borderRadius: '6px',
                                      color: 'var(--text-primary)',
                                      fontSize: '12px',
                                      flex: 1
                                    }}
                                    autoFocus
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleSaveRename(tagItem.name);
                                      }
                                    }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleSaveRename(tagItem.name)}
                                    style={{ padding: '4px 10px', borderRadius: '6px', background: 'var(--color-up)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingTagKey(null)}
                                    style={{ padding: '4px 8px', borderRadius: '6px', background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: '11px' }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ fontSize: '11.5px', padding: '3px 10px', background: 'var(--accent-dim)', border: '1px solid var(--accent-glow)', borderRadius: '12px', color: 'var(--accent)', fontWeight: 600 }}>
                                      {tagItem.name}
                                    </span>
                                    {tagItem.isEnv && (
                                      <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)', fontWeight: 600 }}>
                                        ENV
                                      </span>
                                    )}
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <span style={{ fontSize: '11.5px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontWeight: 600 }}>
                                      {tagItem.count} {tagItem.count === 1 ? 'monitor' : 'monitors'}
                                    </span>
                                    <div style={{ display: 'flex', gap: '4px' }}>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingTagKey(tagItem.name);
                                          setEditingTagValue(tagItem.name);
                                        }}
                                        style={{ padding: '4px 8px', borderRadius: '6px', background: 'rgba(255,255,255,0.04)', color: 'var(--text-secondary)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                                      >
                                        <Edit2 size={12} /> Rename
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteClick(tagItem.name, tagItem.count)}
                                        style={{ padding: '4px 8px', borderRadius: '6px', background: 'rgba(239,68,68,0.1)', color: 'var(--color-down)', border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                                      >
                                        <Trash2 size={12} /> Delete
                                      </button>
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Modal Footer Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '10px 18px',
                  borderRadius: '8px',
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 600
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                style={{
                  padding: '10px 22px',
                  borderRadius: '8px',
                  background: 'var(--accent)',
                  border: 'none',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <Save size={16} /> Save Preferences
              </button>
            </div>

          </form>

        </div>
      </div>
    </div>
  );
};
export default UserPreferencesModal;
