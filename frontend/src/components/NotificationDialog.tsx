import React, { useState, useEffect } from 'react';
import { X, Send, Save, Trash2, Loader2, CheckCircle2, AlertTriangle, Bell, ExternalLink } from 'lucide-react';
import Dialog from './Dialog';

export interface NotificationItem {
  id?: string;
  name: string;
  type: string;
  is_default?: boolean;
  active?: boolean;
  config?: Record<string, any>;
}

interface NotificationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  apiUrl: string;
  token: string | null;
  notification: NotificationItem | null;
  onSaved: () => void;
  onDeleted?: () => void;
}

const NOTIFICATION_TYPES = [
  {
    group: 'Universal',
    options: [
      { value: 'webhook', label: 'Webhook' },
      { value: 'apprise', label: 'Apprise (Universal Engine, 140+ Services)' },
    ],
  },
  {
    group: 'Chat Platforms',
    options: [
      { value: 'discord', label: 'Discord' },
      { value: 'telegram', label: 'Telegram' },
      { value: 'slack', label: 'Slack' },
      { value: 'teams', label: 'Microsoft Teams' },
    ],
  },
  {
    group: 'Email',
    options: [
      { value: 'smtp', label: 'Email (SMTP)' },
    ],
  },
  {
    group: 'Push Services',
    options: [
      { value: 'gotify', label: 'Gotify' },
      { value: 'ntfy', label: 'Ntfy' },
      { value: 'pushover', label: 'Pushover' },
    ],
  },
];

export const NotificationDialog: React.FC<NotificationDialogProps> = ({
  isOpen,
  onClose,
  apiUrl,
  token,
  notification,
  onSaved,
  onDeleted,
}) => {
  const [name, setName] = useState('');
  const [type, setType] = useState('discord');
  const [isDefault, setIsDefault] = useState(false);
  const [applyExisting, setApplyExisting] = useState(false);
  const [config, setConfig] = useState<Record<string, any>>({});

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [error, setError] = useState('');

  const isEditing = Boolean(notification && notification.id);

  const [validatingApprise, setValidatingApprise] = useState(false);
  const [appriseValidation, setAppriseValidation] = useState<{ valid: boolean; message: string; schemas?: string[] } | null>(null);

  const APPRISE_PRESETS = [
    { label: 'PagerDuty', template: 'pagerduty://apikey@routingkey' },
    { label: 'Opsgenie', template: 'opsgenie://apikey' },
    { label: 'Discord', template: 'discord://WebhookID/WebhookToken' },
    { label: 'Telegram', template: 'tgram://BotToken/ChatID' },
    { label: 'Slack', template: 'slack://TokenA/TokenB/TokenC' },
    { label: 'Matrix', template: 'matrixs://user:password@matrix.org/#room' },
    { label: 'Mattermost', template: 'mmosts://mattermost.example.com/token?channel=alerts' },
    { label: 'Twilio SMS', template: 'twilio://AccountSid:AuthToken@FromPhone/ToPhone' },
    { label: 'Pushover', template: 'pover://UserKey@AppToken' },
    { label: 'Gotify', template: 'gotifys://gotify.example.com/AppToken' },
    { label: 'Ntfy', template: 'ntfys://ntfy.sh/topic_name' },
  ];

  const applyApprisePreset = (template: string) => {
    const curr = (config.appriseURL || '').trim();
    if (!curr) {
      updateConfig('appriseURL', template);
    } else {
      updateConfig('appriseURL', `${curr}\n${template}`);
    }
  };

  const handleValidateApprise = async () => {
    const uriVal = (config.appriseURL || '').trim();
    if (!uriVal) {
      setAppriseValidation({ valid: false, message: 'Please enter an Apprise URI first.' });
      return;
    }
    setValidatingApprise(true);
    setAppriseValidation(null);
    try {
      const res = await fetch(`${apiUrl}/api/notifications/apprise/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ uris: uriVal }),
      });
      const data = await res.json();
      if (res.ok && data.valid) {
        setAppriseValidation({
          valid: true,
          message: data.message || `Valid syntax (${data.count} target(s) parsed)`,
          schemas: data.schemas || [],
        });
      } else {
        setAppriseValidation({
          valid: false,
          message: data.error || data.detail || 'Validation failed. Please verify syntax.',
        });
      }
    } catch (err: any) {
      setAppriseValidation({ valid: false, message: err.message || 'Validation request failed' });
    } finally {
      setValidatingApprise(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setError('');
      setTestResult(null);
      setAppriseValidation(null);
      if (notification) {
        setName(notification.name || '');
        setType(notification.type || 'discord');
        setIsDefault(Boolean(notification.is_default));
        setApplyExisting(false);
        setConfig(notification.config || {});
      } else {
        setName('');
        setType('discord');
        setIsDefault(false);
        setApplyExisting(false);
        setConfig({});
      }
    }
  }, [isOpen, notification]);

  const updateConfig = (field: string, value: any) => {
    setConfig(prev => ({ ...prev, [field]: value }));
  };

  const handleTest = async () => {
    if (!name.trim()) {
      setError('Please provide a Friendly Name first before testing.');
      return;
    }
    setError('');
    setTesting(true);
    setTestResult(null);

    try {
      const res = await fetch(`${apiUrl}/api/notifications/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: name.trim(),
          type,
          config,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setTestResult({ success: false, message: data.detail || 'Test alert delivery failed.' });
      } else {
        setTestResult({ success: true, message: data.message || 'Test alert sent successfully!' });
      }
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || 'Network error occurred while testing.' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Friendly Name is required.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const url = isEditing
        ? `${apiUrl}/api/notifications/${notification?.id}`
        : `${apiUrl}/api/notifications`;

      const method = isEditing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: name.trim(),
          type,
          config,
          is_default: isDefault,
          active: true,
          apply_existing: applyExisting,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to save notification channel');
      }

      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!notification?.id) return;
    if (!window.confirm(`Are you sure you want to delete notification channel "${name}"?`)) {
      return;
    }

    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/notifications/${notification.id}`, {
        method: 'DELETE',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to delete notification');
      }

      if (onDeleted) onDeleted();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const fieldStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    borderRadius: 'var(--radius-sm, 6px)',
    border: '1px solid var(--border)',
    background: 'var(--bg-secondary)',
    color: 'var(--text-primary)',
    fontSize: '13px',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '12px',
    fontWeight: 500,
    color: 'var(--text-secondary)',
    marginBottom: '4px',
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      aria-labelledby="notification-dialog-title"
      style={{
        width: '560px',
        maxWidth: '95vw',
        background: 'var(--bg-surface)',
        borderRadius: 'var(--radius-lg, 12px)',
        border: '1px solid var(--border)',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.45)',
        color: 'var(--text-primary)',
        padding: 0,
        overflow: 'hidden',
      }}
    >
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', height: '100%', maxHeight: '88vh' }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--bg-card)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Bell size={18} style={{ color: 'var(--color-brand, #3b82f6)' }} />
            <h3 id="notification-dialog-title" style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
              {isEditing ? `Edit Notification` : `Setup Notification`}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '4px',
            }}
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Body */}
        <div style={{ padding: '20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {error && (
            <div style={{
              padding: '10px 14px',
              borderRadius: '6px',
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#ef4444',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}>
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          )}

          {testResult && (
            <div style={{
              padding: '10px 14px',
              borderRadius: '6px',
              background: testResult.success ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              border: `1px solid ${testResult.success ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
              color: testResult.success ? '#10b981' : '#ef4444',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}>
              {testResult.success ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
              <span>{testResult.message}</span>
            </div>
          )}

          {/* Type Select */}
          <div>
            <label style={labelStyle}>Notification Type</label>
            <select
              value={type}
              onChange={e => setType(e.target.value)}
              style={fieldStyle}
            >
              {NOTIFICATION_TYPES.map(grp => (
                <optgroup key={grp.group} label={grp.group}>
                  {grp.options.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Friendly Name */}
          <div>
            <label style={labelStyle}>Friendly Name *</label>
            <input
              type="text"
              required
              placeholder="e.g. DevOps Alerts, SRE Discord, Telegram Group"
              value={name}
              onChange={e => setName(e.target.value)}
              style={fieldStyle}
            />
          </div>

          {/* ── Dynamic Provider Forms (Apprise Alert Engine) ── */}

          {/* Discord */}
          {type === 'discord' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={labelStyle}>Discord Webhook URL *</label>
                <input
                  type="url"
                  required
                  placeholder="https://discord.com/api/webhooks/..."
                  value={config.discordWebhookUrl || ''}
                  onChange={e => updateConfig('discordWebhookUrl', e.target.value)}
                  style={fieldStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Bot Username (Optional)</label>
                <input
                  type="text"
                  placeholder="Snoomp Bot"
                  value={config.discordUsername || ''}
                  onChange={e => updateConfig('discordUsername', e.target.value)}
                  style={fieldStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Prefix Message (Optional, e.g. role mention)</label>
                <input
                  type="text"
                  placeholder="<@&role_id>"
                  value={config.discordPrefixMessage || ''}
                  onChange={e => updateConfig('discordPrefixMessage', e.target.value)}
                  style={fieldStyle}
                />
              </div>
            </div>
          )}

          {/* Telegram */}
          {type === 'telegram' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={labelStyle}>Bot Token *</label>
                <input
                  type="text"
                  required
                  placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                  value={config.telegramBotToken || ''}
                  onChange={e => updateConfig('telegramBotToken', e.target.value)}
                  style={fieldStyle}
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  You can get a token from @BotFather on Telegram.
                </span>
              </div>
              <div>
                <label style={labelStyle}>Chat ID *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 123456789 or -100123456789"
                  value={config.telegramChatID || ''}
                  onChange={e => updateConfig('telegramChatID', e.target.value)}
                  style={fieldStyle}
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  You can get your chat ID by messaging @userinfobot or @getidsbot.
                </span>
              </div>
            </div>
          )}

          {/* Slack */}
          {type === 'slack' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={labelStyle}>Webhook URL *</label>
                <input
                  type="url"
                  required
                  placeholder="https://hooks.slack.com/services/..."
                  value={config.slackwebhookURL || ''}
                  onChange={e => updateConfig('slackwebhookURL', e.target.value)}
                  style={fieldStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Channel (Optional)</label>
                <input
                  type="text"
                  placeholder="#alerts"
                  value={config.slackchannel || ''}
                  onChange={e => updateConfig('slackchannel', e.target.value)}
                  style={fieldStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Bot Username (Optional)</label>
                <input
                  type="text"
                  placeholder="Snoomp"
                  value={config.slackusername || ''}
                  onChange={e => updateConfig('slackusername', e.target.value)}
                  style={fieldStyle}
                />
              </div>
            </div>
          )}

          {/* SMTP / Email */}
          {type === 'smtp' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px' }}>
                <div>
                  <label style={labelStyle}>Hostname *</label>
                  <input
                    type="text"
                    required
                    placeholder="smtp.example.com"
                    value={config.smtpHost || ''}
                    onChange={e => updateConfig('smtpHost', e.target.value)}
                    style={fieldStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Port *</label>
                  <input
                    type="number"
                    required
                    placeholder="587"
                    value={config.smtpPort || 587}
                    onChange={e => updateConfig('smtpPort', parseInt(e.target.value) || 587)}
                    style={fieldStyle}
                  />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={labelStyle}>Username</label>
                  <input
                    type="text"
                    placeholder="user@example.com"
                    value={config.smtpUsername || ''}
                    onChange={e => updateConfig('smtpUsername', e.target.value)}
                    style={fieldStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Password</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={config.smtpPassword || ''}
                    onChange={e => updateConfig('smtpPassword', e.target.value)}
                    style={fieldStyle}
                  />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={labelStyle}>From Email</label>
                  <input
                    type="email"
                    placeholder="snoomp-alerts@example.com"
                    value={config.smtpFrom || ''}
                    onChange={e => updateConfig('smtpFrom', e.target.value)}
                    style={fieldStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Recipient Email *</label>
                  <input
                    type="email"
                    required
                    placeholder="oncall@example.com"
                    value={config.smtpTo || ''}
                    onChange={e => updateConfig('smtpTo', e.target.value)}
                    style={fieldStyle}
                  />
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={Boolean(config.smtpSecure)}
                  onChange={e => updateConfig('smtpSecure', e.target.checked)}
                />
                Use Secure TLS / SSL
              </label>
            </div>
          )}

          {/* Webhook */}
          {type === 'webhook' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={labelStyle}>Post URL *</label>
                <input
                  type="url"
                  required
                  placeholder="https://api.example.com/alerts"
                  value={config.webhookURL || ''}
                  onChange={e => updateConfig('webhookURL', e.target.value)}
                  style={fieldStyle}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={labelStyle}>Method</label>
                  <select
                    value={config.httpMethod || 'POST'}
                    onChange={e => updateConfig('httpMethod', e.target.value)}
                    style={fieldStyle}
                  >
                    <option value="POST">POST</option>
                    <option value="GET">GET</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Encoding</label>
                  <select
                    value={config.webhookContentType || 'json'}
                    onChange={e => updateConfig('webhookContentType', e.target.value)}
                    style={fieldStyle}
                  >
                    <option value="json">JSON (Default)</option>
                    <option value="form-data">Multipart / Form-Data</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={labelStyle}>Additional Headers (JSON format)</label>
                <input
                  type="text"
                  placeholder='{"Authorization": "Bearer token"}'
                  value={config.webhookAdditionalHeaders || ''}
                  onChange={e => updateConfig('webhookAdditionalHeaders', e.target.value)}
                  style={{ ...fieldStyle, fontFamily: 'monospace' }}
                />
              </div>
            </div>
          )}

          {/* Teams */}
          {type === 'teams' && (
            <div>
              <label style={labelStyle}>Webhook URL *</label>
              <input
                type="url"
                required
                placeholder="https://outlook.office.com/webhook/..."
                value={config.teamsWebhookURL || ''}
                onChange={e => updateConfig('teamsWebhookURL', e.target.value)}
                style={fieldStyle}
              />
            </div>
          )}

          {/* Pushover */}
          {type === 'pushover' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={labelStyle}>User Key *</label>
                <input
                  type="text"
                  required
                  placeholder="Your 30-char user key"
                  value={config.pushoveruserkey || ''}
                  onChange={e => updateConfig('pushoveruserkey', e.target.value)}
                  style={fieldStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Application Token *</label>
                <input
                  type="text"
                  required
                  placeholder="Your 30-char API token"
                  value={config.pushoverapptoken || ''}
                  onChange={e => updateConfig('pushoverapptoken', e.target.value)}
                  style={fieldStyle}
                />
              </div>
            </div>
          )}

          {/* Gotify */}
          {type === 'gotify' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={labelStyle}>Server URL *</label>
                <input
                  type="url"
                  required
                  placeholder="https://gotify.example.com"
                  value={config.gotifyserverurl || ''}
                  onChange={e => updateConfig('gotifyserverurl', e.target.value)}
                  style={fieldStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Application Token *</label>
                <input
                  type="text"
                  required
                  placeholder="App token created in Gotify"
                  value={config.gotifyapplicationToken || ''}
                  onChange={e => updateConfig('gotifyapplicationToken', e.target.value)}
                  style={fieldStyle}
                />
              </div>
            </div>
          )}

          {/* Ntfy */}
          {type === 'ntfy' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={labelStyle}>Server URL</label>
                <input
                  type="url"
                  placeholder="https://ntfy.sh (default)"
                  value={config.ntfyserverurl || ''}
                  onChange={e => updateConfig('ntfyserverurl', e.target.value)}
                  style={fieldStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Topic *</label>
                <input
                  type="text"
                  required
                  placeholder="my_secret_alerts_topic"
                  value={config.ntfytopic || ''}
                  onChange={e => updateConfig('ntfytopic', e.target.value)}
                  style={fieldStyle}
                />
              </div>
            </div>
          )}

          {/* Apprise (Universal Engine) */}
          {type === 'apprise' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }}>Apprise Destination URI(s) *</label>
                  <button
                    type="button"
                    onClick={handleValidateApprise}
                    disabled={validatingApprise || !config.appriseURL}
                    style={{
                      background: 'none',
                      border: '1px solid var(--border)',
                      borderRadius: '4px',
                      padding: '2px 8px',
                      fontSize: '11px',
                      color: 'var(--accent)',
                      cursor: config.appriseURL ? 'pointer' : 'default',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      opacity: config.appriseURL ? 1 : 0.6
                    }}
                  >
                    {validatingApprise && <Loader2 size={12} className="spin" />}
                    <span>Validate Syntax</span>
                  </button>
                </div>

                {/* Quick-Select Provider Presets */}
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '5px', fontWeight: 500 }}>
                    Quick Presets (click to append template):
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                    {APPRISE_PRESETS.map(p => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => applyApprisePreset(p.template)}
                        style={{
                          fontSize: '11px',
                          padding: '3px 7px',
                          borderRadius: '4px',
                          border: '1px solid var(--border)',
                          background: 'var(--bg-secondary)',
                          color: 'var(--text-primary)',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        + {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <textarea
                  required
                  rows={3}
                  placeholder={`e.g. twilio://AccountSid:AuthToken@FromPhone/ToPhone\nor pagerduty://apikey@routingkey\n(one per line or comma-separated)`}
                  value={config.appriseURL || ''}
                  onChange={e => updateConfig('appriseURL', e.target.value)}
                  style={{ ...fieldStyle, fontFamily: 'monospace', fontSize: '12px', resize: 'vertical' }}
                />

                {/* Validation Feedback Banner */}
                {appriseValidation && (
                  <div style={{
                    marginTop: '6px',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: appriseValidation.valid ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                    border: `1px solid ${appriseValidation.valid ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                    color: appriseValidation.valid ? '#10b981' : '#ef4444'
                  }}>
                    {appriseValidation.valid ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                    <span>{appriseValidation.message}</span>
                    {appriseValidation.schemas && appriseValidation.schemas.length > 0 && (
                      <span style={{ marginLeft: 'auto', fontSize: '11px', opacity: 0.85 }}>
                        Schemas: {appriseValidation.schemas.join(', ')}
                      </span>
                    )}
                  </div>
                )}

                <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '6px', lineHeight: '1.4' }}>
                  <span>Apprise supports 140+ services. You can combine multiple URLs separated by newlines or commas.</span>
                  <div style={{ marginTop: '4px' }}>
                    <a
                      href="https://github.com/caronc/apprise/wiki#notification-services"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'var(--accent)', textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                    >
                      Apprise Notification Services Wiki (140+ Providers) <ExternalLink size={11} />
                    </a>
                  </div>
                </div>
              </div>

              <div>
                <label style={labelStyle}>Notification Title (Optional Prefix)</label>
                <input
                  type="text"
                  placeholder="e.g. Snoomp Production"
                  value={config.title || ''}
                  onChange={e => updateConfig('title', e.target.value)}
                  style={fieldStyle}
                />
              </div>

              <div style={{
                padding: '8px 12px',
                borderRadius: '6px',
                background: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '12px',
                color: '#10b981',
                fontWeight: 500
              }}>
                <CheckCircle2 size={15} />
                <span>Apprise Universal Engine active (in-process Python engine, 140+ providers supported)</span>
              </div>
            </div>
          )}

          {/* Channel Assignment Toggles */}
          <div style={{ marginTop: '8px', paddingTop: '16px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={isDefault}
                onChange={e => setIsDefault(e.target.checked)}
                style={{ width: '16px', height: '16px' }}
              />
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Default enabled</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Automatically enabled for all newly created monitors.
                </div>
              </div>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={applyExisting}
                onChange={e => setApplyExisting(e.target.checked)}
                style={{ width: '16px', height: '16px' }}
              />
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Apply on all existing monitors</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Enables this notification channel on every existing monitor immediately.
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* Footer Actions */}
        <div style={{
          padding: '14px 20px',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--bg-card)',
        }}>
          <div>
            {isEditing && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving || testing}
                style={{
                  padding: '7px 14px',
                  borderRadius: '6px',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  background: 'rgba(239, 68, 68, 0.1)',
                  color: '#ef4444',
                  fontSize: '13px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Trash2 size={14} />
                Delete
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              onClick={handleTest}
              disabled={testing || saving}
              style={{
                padding: '7px 14px',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Test
            </button>

            <button
              type="submit"
              disabled={saving || testing}
              style={{
                padding: '7px 18px',
                borderRadius: '6px',
                border: 'none',
                background: 'var(--color-brand, #3b82f6)',
                color: '#fff',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Save
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
};

export default NotificationDialog;
