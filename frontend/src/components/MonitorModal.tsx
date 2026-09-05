import React, { useState, useEffect } from 'react';
import { Bell, Plus } from 'lucide-react';
import Dialog from './Dialog';
import NotificationDialog, { NotificationItem } from './NotificationDialog';

interface MonitorModalProps {
  isOpen: boolean;
  /** Fleet-wide thresholds, shown as the placeholder for each blank field. */
  globalThresholds?: Partial<Record<string, number | null>>;
  onClose: () => void;
  onSave: (data: any) => void;
  editingMonitor?: any;
  token: string | null;
  existingTags: string[];
  onToast?: (msg: string) => void;
}

const MonitorModal: React.FC<MonitorModalProps> = ({ 
  isOpen, 
  globalThresholds = {},
  onClose, 
  onSave, 
  editingMonitor,
  token,
  existingTags,
  onToast
}) => {
  const [name, setName] = useState('');
  const [type, setType] = useState('http');
  const [host, setHost] = useState('');
  const [port, setPort] = useState<number | ''>('');
  const [path, setPath] = useState('');
  const [checkInterval, setCheckInterval] = useState(60);
  const [enabled, setEnabled] = useState(true);
  const [tagsStr, setTagsStr] = useState('');
  
  // Custom Config JSON parameters
  const [scheme, setScheme] = useState('http');
  const [method, setMethod] = useState('GET');
  const [ignoreTls, setIgnoreTls] = useState(false);
  const [sshUser, setSshUser] = useState('root');
  const [sshPassword, setSshPassword] = useState('');
  const [sshKey, setSshKey] = useState('');
  const [snmpCommunity, setSnmpCommunity] = useState('public');
  const [dnsType, setDnsType] = useState('A');
  const [dnsServer, setDnsServer] = useState('');
  const [dbConnStr, setDbConnStr] = useState('');
  const [dbQuery, setDbQuery] = useState('SELECT 1');
  /* Per-monitor alarm overrides. Kept as strings so "" reads as "inherit the
     fleet value" rather than being coerced to 0. */
  const [thresholds, setThresholds] = useState<Record<string, string>>({});
  
  // Alerts config
  const [appriseUri, setAppriseUri] = useState('');
  // Apprise Notification channels
  const [availableNotifications, setAvailableNotifications] = useState<NotificationItem[]>([]);
  const [selectedNotificationIds, setSelectedNotificationIds] = useState<string[]>([]);
  const [isNotifDialogOpen, setIsNotifDialogOpen] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState<NotificationItem | null>(null);
  const [showAdvancedApprise, setShowAdvancedApprise] = useState(false);

  // Test connection state
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [testMessage, setTestMessage] = useState('');
  
  // CSV Import State
  const csvFileRef = React.useRef<HTMLInputElement>(null);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvMonitors, setCsvMonitors] = useState<any[]>([]);
  const [csvLoadedInfo, setCsvLoadedInfo] = useState<string | null>(null);

  // ponytail: helper resolves effective host across standard host input and URI-based DB monitors
  const parseHostFromUri = (uri: string, defaultHost: string) => {
    try {
      const match = uri.match(/@([^/:]+)/) || uri.match(/:\/\/([^/:]+)/);
      return match ? match[1] : defaultHost;
    } catch {
      return defaultHost;
    }
  };

  const getEffectiveHost = () => {
    if (type === 'db' || type === 'mongodb' || type === 'redis') {
      return parseHostFromUri(dbConnStr, 'database-server');
    }
    return host.trim();
  };

  const handleClearCsv = () => {
    setCsvMonitors([]);
    setCsvLoadedInfo(null);
    if (csvFileRef.current) csvFileRef.current.value = '';
  };

  const handleTypeChange = (newType: string) => {
    setType(newType);
    handleClearCsv();
  };

  // ponytail: static CSV schema map replaces redundant switch statements
  const CSV_CONFIG: Record<string, { formatText: string; headers: string; sample: string }> = {
    snmp: { formatText: 'name, ip/hostname, port, snmp_community_string, check_interval', headers: 'name,host,port,community,check_interval', sample: 'Router SNMP,192.168.1.1,161,public,60' },
    ssh: { formatText: 'name, ip/hostname, port, ssh_username, ssh_password, check_interval', headers: 'name,host,port,username,password,check_interval', sample: 'Linux VM,10.0.0.5,22,root,secretpassword,60' },
    http: { formatText: 'name, ip/hostname, port, path, scheme(http/https), method(GET/POST/PUT), ignore_tls(true/false), check_interval', headers: 'name,host,port,path,scheme,method,ignore_tls,check_interval', sample: 'Google DNS API,google.com,,/,,GET,false,60' },
    ping: { formatText: 'name, ip/hostname, check_interval', headers: 'name,host,check_interval', sample: 'Google DNS Ping,8.8.8.8,60' },
    tcp: { formatText: 'name, ip/hostname, port, check_interval', headers: 'name,host,port,check_interval', sample: 'Web HTTP Port,127.0.0.1,80,60' },
    dns: { formatText: 'name, ip/hostname, resolve_type(A/AAAA/CNAME/MX/TXT), dns_server, check_interval', headers: 'name,host,resolve_type,dns_server,check_interval', sample: 'Cloudflare DNS Lookup,one.one.one.one,A,1.1.1.1,60' },
    db: { formatText: 'name, connection_string, verification_query, check_interval', headers: 'name,connection_string,query,check_interval', sample: 'App DB check,postgresql://postgres:postgres@localhost:5432/postgres,SELECT 1,60' },
    push: { formatText: 'name, check_interval', headers: 'name,check_interval', sample: 'Cron Backup Job,120' },
  };

  const getCsvFormatText = () => CSV_CONFIG[type]?.formatText || 'name, host, check_interval';

  const handleDownloadSampleCsv = () => {
    const cfg = CSV_CONFIG[type] || { headers: 'name,host,check_interval', sample: 'Default Monitor,localhost,60' };
    const csvContent = `${cfg.headers}\n${cfg.sample}`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `sample_${type}_monitor.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const loadNotifications = async (): Promise<NotificationItem[]> => {
    try {
      const apiOrigin = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
      const res = await fetch(`${apiOrigin}/api/notifications`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setAvailableNotifications(data);
        return data;
      }
    } catch (e) {
      console.error('Failed to load notifications:', e);
    }
    return [];
  };

  const handleToggleNotification = (id: string) => {
    setSelectedNotificationIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // Load editing monitor properties
  useEffect(() => {
    if (editingMonitor) {
      setName(editingMonitor.name || '');
      setType(editingMonitor.type || 'http');
      setHost(editingMonitor.host || '');
      setPort(editingMonitor.port || '');
      setPath(editingMonitor.path || '');
      setCheckInterval(editingMonitor.check_interval || 60);
      setEnabled(editingMonitor.enabled !== false);
      setTagsStr(editingMonitor.tags ? editingMonitor.tags.join(', ') : '');
      
      const cfg = editingMonitor.config_json || {};
      setScheme(cfg.scheme || 'http');
      setMethod(cfg.method || 'GET');
      setIgnoreTls(!!cfg.ignore_tls);
      setSshUser(cfg.username || 'root');
      setSshPassword(cfg.password || '');
      setSshKey(cfg.private_key || '');
      setSnmpCommunity(cfg.community || 'public');
      setDnsType(cfg.resolve_type || 'A');
      setDnsServer(cfg.dns_server || '');
      setDbConnStr(cfg.connection_string || '');
      setDbQuery(cfg.query || 'SELECT 1');
      setThresholds(
        Object.fromEntries(
          Object.entries(cfg.thresholds || {}).map(([k, v]) => [k, v === null || v === undefined ? '' : String(v)]),
        ),
      );
      
      // Load notifications if exists
      const alerts = cfg.notifications || [];
      if (alerts.length > 0) {
        const primary = alerts[0];
        setAppriseUri(primary.apprise_uri || '');
      } else {
        setAppriseUri('');
      }
    } else {
      // Clear inputs
      setName('');
      setType('http');
      setHost('');
      setPort('');
      setPath('');
      setCheckInterval(60);
      setEnabled(true);
      setTagsStr('');
      setScheme('http');
      setMethod('GET');
      setIgnoreTls(false);
      setSshUser('root');
      setSshPassword('');
      setSshKey('');
      setSnmpCommunity('public');
      setDnsType('A');
      setDnsServer('');
      setDbConnStr('');
      setDbQuery('SELECT 1');
      setAppriseUri('');
    }

    // Reset test connection state & CSV state
    setTestStatus('idle');
    setTestMessage('');
    setCsvMonitors([]);
    setCsvLoadedInfo(null);

    if (isOpen) {
      loadNotifications().then((notifs) => {
        if (editingMonitor) {
          const cfg = editingMonitor.config_json || {};
          if (Array.isArray(cfg.notification_ids)) {
            setSelectedNotificationIds(cfg.notification_ids);
          } else {
            // Default to channels with is_default == true
            setSelectedNotificationIds(notifs.filter(n => n.is_default && n.id).map(n => n.id!));
          }
        } else {
          // Brand new monitor: auto-select default channels
          setSelectedNotificationIds(notifs.filter(n => n.is_default && n.id).map(n => n.id!));
        }
      });
    }
  }, [editingMonitor, isOpen]);

  const handleCsvBulkImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvImporting(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      if (!text) { setCsvImporting(false); return; }
      const lines = text.split('\n');
      const startIdx = lines[0].toLowerCase().includes('name') ? 1 : 0;
      const parsed: any[] = [];

      for (let i = startIdx; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = line.split(',');
        if (cols.length < 2) continue;
        const nameVal = cols[0]?.trim();
        const hostVal = cols[1]?.trim();
        if (!nameVal || !hostVal) continue;
        const item: any = { name: nameVal, type, config_json: {} };

        if (type === 'snmp') {
          item.host = hostVal;
          item.port = cols[2]?.trim() ? parseInt(cols[2]) : 161;
          item.config_json.community = cols[3]?.trim() || 'public';
          item.check_interval = cols[4]?.trim() ? parseInt(cols[4]) : 60;
        } else if (type === 'ssh') {
          item.host = hostVal;
          item.port = cols[2]?.trim() ? parseInt(cols[2]) : 22;
          item.config_json.username = cols[3]?.trim() || 'root';
          item.config_json.password = cols[4]?.trim() || undefined;
          item.check_interval = cols[5]?.trim() ? parseInt(cols[5]) : 60;
        } else if (type === 'http') {
          let cleanHost = hostVal;
          let parsedScheme = cols[4]?.trim() || 'http';
          if (cleanHost.toLowerCase().startsWith('http://')) {
            cleanHost = cleanHost.substring(7);
            parsedScheme = 'http';
          } else if (cleanHost.toLowerCase().startsWith('https://')) {
            cleanHost = cleanHost.substring(8);
            parsedScheme = 'https';
          }
          let parsedPath = cols[3]?.trim() || '/';
          if (cleanHost.includes('/')) {
            const parts = cleanHost.split('/');
            cleanHost = parts[0];
            if (!cols[3]?.trim()) {
              parsedPath = '/' + parts.slice(1).join('/');
            }
          }
          item.host = cleanHost;
          item.port = cols[2]?.trim() ? parseInt(cols[2]) : null;
          item.path = parsedPath;
          item.config_json.scheme = parsedScheme;
          item.config_json.method = cols[5]?.trim() || 'GET';
          item.config_json.ignore_tls = cols[6]?.trim().toLowerCase() === 'true';
          item.check_interval = cols[7]?.trim() ? parseInt(cols[7]) : 60;
        } else if (type === 'ping') {
          item.host = hostVal;
          item.check_interval = cols[2]?.trim() ? parseInt(cols[2]) : 60;
        } else if (type === 'tcp') {
          item.host = hostVal;
          item.port = cols[2]?.trim() ? parseInt(cols[2]) : 80;
          item.check_interval = cols[3]?.trim() ? parseInt(cols[3]) : 60;
        } else if (type === 'dns') {
          item.host = hostVal;
          item.config_json.resolve_type = cols[2]?.trim() || 'A';
          item.config_json.dns_server = cols[3]?.trim() || undefined;
          item.check_interval = cols[4]?.trim() ? parseInt(cols[4]) : 60;
        } else if (type === 'db') {
          item.host = 'postgresql-db';
          item.config_json.connection_string = hostVal;
          item.config_json.query = cols[2]?.trim() || 'SELECT 1';
          item.check_interval = cols[3]?.trim() ? parseInt(cols[3]) : 60;
        } else if (type === 'push') {
          item.host = 'passive-push';
          item.check_interval = cols[2]?.trim() ? parseInt(cols[2]) : 60;
        }
        parsed.push(item);
      }
      setCsvMonitors(parsed);
      setCsvLoadedInfo(`Loaded ${parsed.length} monitor(s) from CSV!`);
      setCsvImporting(false);
      if (csvFileRef.current) csvFileRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const ENV_TAG_KEYWORDS = ['prod', 'production', 'staging', 'stag', 'dev', 'development', 'test', 'uat'];
  const isEnvTag = (t: string) => ENV_TAG_KEYWORDS.includes(t.toLowerCase());

  const getCurrentTagsList = () => tagsStr.split(',').map(t => t.trim()).filter(Boolean);

  const handleToggleEnvTag = (envName: string) => {
    let list = getCurrentTagsList();
    const existingIdx = list.findIndex(t => t.toLowerCase() === envName.toLowerCase() || (envName === 'staging' && t.toLowerCase() === 'stag'));
    if (existingIdx >= 0) {
      list.splice(existingIdx, 1);
    } else {
      list.push(envName);
    }
    setTagsStr(list.join(', '));
  };

  const handleToggleGroupTag = (groupTag: string) => {
    let list = getCurrentTagsList();
    const existingIdx = list.findIndex(t => t.toLowerCase() === groupTag.toLowerCase());
    if (existingIdx >= 0) {
      list.splice(existingIdx, 1);
    } else {
      list.push(groupTag);
    }
    setTagsStr(list.join(', '));
  };

  const handleTestConnection = async () => {
    setTestStatus('testing');
    setTestMessage('');
    const notifications: any[] = [];
    if (appriseUri.trim() !== '') {
      notifications.push({ apprise_uri: appriseUri.trim() });
    }
    const config_json: any = { notifications };
    if (type === 'http') {
      config_json.scheme = scheme;
      config_json.method = method;
      config_json.ignore_tls = ignoreTls;
    } else if (type === 'snmp') {
      config_json.community = snmpCommunity;
    } else if (type === 'ssh') {
      config_json.username = sshUser;
      config_json.password = sshPassword || undefined;
      config_json.private_key = sshKey || undefined;
    } else if (type === 'dns') {
      config_json.resolve_type = dnsType;
      config_json.dns_server = dnsServer || undefined;
    } else if (type === 'db' || type === 'mongodb' || type === 'redis') {
      config_json.connection_string = dbConnStr;
      config_json.query = dbQuery;
    }
    // ponytail: getEffectiveHost extracts host string even for URI-based database monitors
    const effectiveHost = getEffectiveHost();
    const payload = {
      name,
      type,
      host: effectiveHost,
      port: port === '' ? null : Number(port),
      path: path.trim() || null,
      check_interval: Number(checkInterval),
      enabled,
      tags: tagsStr.split(',').map((t: string) => t.trim()).filter(Boolean),
      config_json
    };
    try {
      const apiOrigin = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
      const testUrl = `${apiOrigin}/api/targets/test${editingMonitor?.id ? `?target_id=${editingMonitor.id}` : ''}`;
      const response = await fetch(testUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (response.ok && data.status !== 'down') {
        setTestStatus('success');
        setTestMessage(`UP! Response: ${data.response_time_ms ? data.response_time_ms.toFixed(1) : 0} ms`);
      } else {
        setTestStatus('failed');
        setTestMessage(data.error || 'Connection failed');
      }
    } catch (err: any) {
      setTestStatus('failed');
      setTestMessage(err.message || 'Network error');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const notifications: any[] = [];
    if (appriseUri.trim() !== '') {
      notifications.push({ apprise_uri: appriseUri.trim() });
    }
    const base_config_json: any = { 
      notifications,
      notification_ids: selectedNotificationIds
    };

    // Only send keys the user actually filled in. An empty string here would
    // be stored as a real override and silently disable the fleet default.
    const thresholdOverrides = Object.fromEntries(
      Object.entries(thresholds)
        .map(([k, v]) => [k, v.trim().replace(',', '.')])
        .filter(([, v]) => v !== '' && Number.isFinite(Number(v)))
        .map(([k, v]) => [k, Number(v)]),
    );
    if (Object.keys(thresholdOverrides).length > 0) {
      base_config_json.thresholds = thresholdOverrides;
    }
    if (type === 'http') {
      base_config_json.scheme = scheme;
      base_config_json.method = method;
      base_config_json.ignore_tls = ignoreTls;
    } else if (type === 'snmp') {
      base_config_json.community = snmpCommunity;
    } else if (type === 'ssh') {
      base_config_json.username = sshUser;
      base_config_json.password = sshPassword || undefined;
      base_config_json.private_key = sshKey || undefined;
    } else if (type === 'dns') {
      base_config_json.resolve_type = dnsType;
      base_config_json.dns_server = dnsServer || undefined;
    } else if (type === 'db' || type === 'mongodb' || type === 'redis') {
      base_config_json.connection_string = dbConnStr;
      if (type === 'db') base_config_json.query = dbQuery;
    }
    const sharedTags = tagsStr.split(',').map(t => t.trim()).filter(Boolean);
    if (csvMonitors.length > 0) {
      const apiOrigin = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
      Promise.all(csvMonitors.map(m => {
        const payload = {
          name: m.name,
          type: m.type || type,
          host: m.host,
          port: m.port ?? null,
          path: m.path ?? null,
          check_interval: m.check_interval ?? Number(checkInterval),
          enabled,
          tags: sharedTags,
          config_json: { ...base_config_json, ...m.config_json, notifications }
        };
        return fetch(`${apiOrigin}/api/targets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload)
        });
      })).then((results) => {
        const successes = results.filter(r => r.ok).length;
        const failures = results.length - successes;
        const msg = `Bulk Import completed:\n${successes} monitor(s) created successfully.\n${failures} failed.`;
        if (onToast) onToast(msg); else alert(msg);
        handleClearCsv();
        onClose();
        if (successes > 0) onSave(null);
      }).catch(() => {
        const msg = 'An error occurred during bulk import.';
        if (onToast) onToast(msg); else alert(msg);
      });
    } else {
      const resolvedHost = getEffectiveHost();
      const payload = {
        name,
        type,
        host: resolvedHost,
        port: port === '' ? null : Number(port),
        path: path.trim() || null,
        check_interval: Number(checkInterval),
        enabled,
        tags: sharedTags,
        config_json: base_config_json
      };
      onSave(payload);
    }
  };

  // ponytail: early return guard must be after all hooks to prevent conditional hook crash
  if (!isOpen) return null;

  return (
    <Dialog isOpen={isOpen} onClose={onClose} aria-labelledby="monitor-modal-title" className="modal-content">
        <div className="modal-header">
          <h3 id="monitor-modal-title">{editingMonitor ? 'Edit Monitor Target' : 'Create Monitor Target'}</h3>
          <button type="button" aria-label="Close modal" className="secondary" style={{ padding: '4px 11px' }} onClick={onClose}>✕</button>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="monitor-name">Target Name *</label>
              <input 
                id="monitor-name"
                type="text" 
                required={csvMonitors.length === 0} 
                disabled={csvMonitors.length > 0}
                placeholder={csvMonitors.length > 0 ? "Bulk CSV loaded" : "e.g. My Website API"}
                value={name} 
                onChange={(e) => setName(e.target.value)} 
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="monitor-type">Monitor Type *</label>
              <select id="monitor-type" value={type} onChange={(e) => handleTypeChange(e.target.value)}>
                <option value="http">HTTP / HTTPS</option>
                <option value="ping">ICMP Ping</option>
                <option value="tcp">TCP Port</option>
                <option value="dns">DNS Query</option>
                <option value="snmp">SNMP Metrics</option>
                <option value="ssh">SSH System Metrics</option>
                <option value="db">PostgreSQL Database</option>
                <option value="mongodb">MongoDB Database</option>
                <option value="redis">Redis Cache Server</option>
                <option value="push">Push Heartbeat (Passive)</option>
              </select>
            </div>
          </div>

          {/* CSV Bulk Upload Panel for selected type */}
          {!editingMonitor && (
            <div style={{
              background: 'var(--surface-raised)',
              border: '1px dashed var(--border)',
              borderRadius: '8px',
              padding: '12px 14px',
              marginBottom: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>
                  Bulk Import {type.toUpperCase()} Monitors via CSV
                </span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    className="secondary"
                    style={{ fontSize: '12px', padding: '4px 11px', background: 'rgba(59,130,246,0.1)', color: 'var(--accent)', border: '1px solid rgba(59,130,246,0.2)' }}
                    onClick={handleDownloadSampleCsv}
                  >
                    Download Template
                  </button>
                  {csvMonitors.length > 0 ? (
                    <button
                      type="button"
                      className="secondary"
                      style={{ fontSize: '12px', padding: '4px 11px', background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}
                      onClick={handleClearCsv}
                    >
                      ✕ Clear CSV
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="secondary"
                      style={{ fontSize: '12px', padding: '4px 11px' }}
                      onClick={() => csvFileRef.current?.click()}
                      disabled={csvImporting}
                    >
                      {csvImporting ? 'Importing…' : 'Select CSV File'}
                    </button>
                  )}
                </div>
                <input
                  ref={csvFileRef}
                  type="file"
                  accept=".csv"
                  style={{ display: 'none' }}
                  onChange={handleCsvBulkImport}
                />
              </div>
              {csvLoadedInfo ? (
                <div style={{
                  padding: '6px 11px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: '600',
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  color: '#34d399',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <span>ℹ️ {csvLoadedInfo}</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 'normal' }}>
                    Single-target inputs disabled during bulk import
                  </span>
                </div>
              ) : (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                  <span style={{ fontWeight: '600' }}>Expected format (no headers):</span>
                  <code style={{ display: 'block', background: 'rgba(0,0,0,0.2)', padding: '4px 8px', borderRadius: '4px', marginTop: '4px', fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                    {getCsvFormatText()}
                  </code>
                  <span style={{ display: 'block', marginTop: '4px', color: 'var(--text-muted)' }}>
                    Monitors will automatically receive the tags written below.
                  </span>
                </div>
              )}
            </div>
          )}

          {!(type === 'db' || type === 'mongodb' || type === 'redis') && (
            <div className="form-group">
              <label htmlFor="monitor-host">Hostname / IP / URL *</label>
              <input 
                id="monitor-host"
                type="text" 
                autoComplete="off"
                spellCheck="false"
                required={csvMonitors.length === 0} 
                disabled={csvMonitors.length > 0}
                placeholder={csvMonitors.length > 0 ? "Bulk CSV loaded" : (type === 'http' ? 'example.com' : '192.168.1.100')} 
                value={host} 
                onChange={(e) => setHost(e.target.value)} 
              />
            </div>
          )}

          <div className="form-row">
            {!(type === 'db' || type === 'mongodb' || type === 'redis') && (
              <div className="form-group">
                <label htmlFor="monitor-port">Port (Optional)</label>
                <input 
                  id="monitor-port"
                  type="number" 
                  inputMode="numeric"
                  disabled={csvMonitors.length > 0}
                  placeholder={csvMonitors.length > 0 ? "Specified in CSV" : (type === 'ssh' ? '22' : type === 'snmp' ? '161' : 'Leave empty')} 
                  value={csvMonitors.length > 0 ? '' : port} 
                  onChange={(e) => setPort(e.target.value === '' ? '' : Number(e.target.value))} 
                />
              </div>
            )}
            
            <div className="form-group">
              <label htmlFor="monitor-interval">Check Interval (seconds)</label>
              <input 
                id="monitor-interval"
                type="number" 
                inputMode="numeric"
                min="10" 
                max="86400" 
                value={checkInterval} 
                onChange={(e) => setCheckInterval(Number(e.target.value))} 
              />
            </div>
          </div>

          {/* Conditional Checker Fields */}
          {type === 'http' && (
            <div className="form-row" style={{ padding: '12px', background: 'var(--surface-raised)', borderRadius: '8px', marginBottom: '18px', opacity: csvMonitors.length > 0 ? 0.6 : 1 }}>
              <div className="form-group">
                <label htmlFor="monitor-scheme">Scheme</label>
                <select id="monitor-scheme" value={scheme} disabled={csvMonitors.length > 0} onChange={(e) => setScheme(e.target.value)}>
                  <option value="http">http://</option>
                  <option value="https">https://</option>
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="monitor-method">HTTP Method</label>
                <select id="monitor-method" value={method} disabled={csvMonitors.length > 0} onChange={(e) => setMethod(e.target.value)}>
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                </select>
              </div>
              <div className="form-group" style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                <input 
                  type="checkbox" 
                  disabled={csvMonitors.length > 0}
                  style={{ width: 'auto' }} 
                  id="ignoreTls" 
                  checked={ignoreTls} 
                  onChange={(e) => setIgnoreTls(e.target.checked)} 
                />
                <label htmlFor="ignoreTls" style={{ margin: 0, cursor: csvMonitors.length > 0 ? 'not-allowed' : 'pointer' }}>Ignore TLS/SSL Certificate errors</label>
              </div>
            </div>
          )}

          {type === 'snmp' && (
            <div className="form-group" style={{ padding: '12px', background: 'var(--surface-raised)', borderRadius: '8px', marginBottom: '18px', opacity: csvMonitors.length > 0 ? 0.6 : 1 }}>
              <label htmlFor="monitor-snmp">SNMP Community String</label>
              <input 
                id="monitor-snmp"
                type="text" 
                spellCheck="false"
                disabled={csvMonitors.length > 0}
                placeholder={csvMonitors.length > 0 ? "Specified in CSV" : "public"}
                value={csvMonitors.length > 0 ? "" : snmpCommunity} 
                onChange={(e) => setSnmpCommunity(e.target.value)} 
              />
            </div>
          )}

          {type === 'ssh' && (
            <div style={{ padding: '12px', background: 'var(--surface-raised)', borderRadius: '8px', marginBottom: '18px', opacity: csvMonitors.length > 0 ? 0.6 : 1 }}>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="monitor-ssh-user">SSH Username</label>
                  <input 
                    id="monitor-ssh-user"
                    type="text" 
                    spellCheck="false"
                    disabled={csvMonitors.length > 0}
                    placeholder={csvMonitors.length > 0 ? "Specified in CSV" : "root"}
                    value={csvMonitors.length > 0 ? "" : sshUser} 
                    onChange={(e) => setSshUser(e.target.value)} 
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="monitor-ssh-pass">SSH Password</label>
                  <input 
                    id="monitor-ssh-pass"
                    type="password" 
                    autoComplete="new-password"
                    disabled={csvMonitors.length > 0}
                    placeholder={csvMonitors.length > 0 ? "Specified in CSV" : "Optional if using SSH Key"} 
                    value={csvMonitors.length > 0 ? "" : sshPassword} 
                    onChange={(e) => setSshPassword(e.target.value)} 
                  />
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="monitor-ssh-key">SSH Private Key (PEM format)</label>
                <textarea 
                  id="monitor-ssh-key"
                  rows={3} 
                  spellCheck="false"
                  disabled={csvMonitors.length > 0}
                  placeholder={csvMonitors.length > 0 ? "Specified in CSV" : "-----BEGIN OPENSSH PRIVATE KEY-----"} 
                  value={csvMonitors.length > 0 ? "" : sshKey} 
                  onChange={(e) => setSshKey(e.target.value)} 
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}
                />
              </div>
            </div>
          )}

          {type === 'dns' && (
            <div className="form-row" style={{ padding: '12px', background: 'var(--surface-raised)', borderRadius: '8px', marginBottom: '18px', opacity: csvMonitors.length > 0 ? 0.6 : 1 }}>
              <div className="form-group">
                <label htmlFor="monitor-dns-type">Resolve Type</label>
                <select id="monitor-dns-type" value={dnsType} disabled={csvMonitors.length > 0} onChange={(e) => setDnsType(e.target.value)}>
                  <option value="A">A (IPv4)</option>
                  <option value="AAAA">AAAA (IPv6)</option>
                  <option value="CNAME">CNAME</option>
                  <option value="MX">MX</option>
                  <option value="TXT">TXT</option>
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="monitor-dns-server">DNS Server IP (Optional)</label>
                <input 
                  id="monitor-dns-server"
                  type="text" 
                  spellCheck="false"
                  disabled={csvMonitors.length > 0}
                  placeholder={csvMonitors.length > 0 ? "Specified in CSV" : "e.g. 8.8.8.8"}
                  value={csvMonitors.length > 0 ? "" : dnsServer} 
                  onChange={(e) => setDnsServer(e.target.value)} 
                />
              </div>
            </div>
          )}

          {(type === 'db' || type === 'mongodb' || type === 'redis') && (
            <div style={{ padding: '12px', background: 'var(--surface-raised)', borderRadius: '8px', marginBottom: '18px', opacity: csvMonitors.length > 0 ? 0.6 : 1 }}>
              <div className="form-group">
                <label htmlFor="monitor-db-uri">
                  {type === 'db' ? 'PostgreSQL Connection URI *' : type === 'mongodb' ? 'MongoDB Connection URI *' : 'Redis Connection URI *'}
                </label>
                <input 
                  id="monitor-db-uri"
                  type="text" 
                  spellCheck="false"
                  required={csvMonitors.length === 0} 
                  disabled={csvMonitors.length > 0}
                  placeholder={
                    csvMonitors.length > 0 ? "Specified in CSV" :
                    (type === 'db' ? 'postgresql://user:pass@host:5432/dbname' :
                     type === 'mongodb' ? 'mongodb://user:pass@host:27017/dbname' :
                     'redis://:password@host:6379/0')
                  } 
                  value={csvMonitors.length > 0 ? "" : dbConnStr} 
                  onChange={(e) => setDbConnStr(e.target.value)} 
                />
              </div>
              {type === 'db' && (
                <div className="form-group">
                  <label htmlFor="monitor-db-query">Verification Query</label>
                  <input 
                    id="monitor-db-query"
                    type="text" 
                    spellCheck="false"
                    disabled={csvMonitors.length > 0}
                    placeholder={csvMonitors.length > 0 ? "Specified in CSV" : "SELECT 1"}
                    value={csvMonitors.length > 0 ? "" : dbQuery} 
                    onChange={(e) => setDbQuery(e.target.value)} 
                  />
                </div>
              )}
            </div>
          )}

          {/* ── Per-monitor alarm thresholds ──
              Blank means inherit the fleet value shown in the placeholder, so
              the common case needs no input at all. Resource fields only appear
              for monitor types that actually report those metrics. */}
          {(() => {
            /* Must match RESOURCE_METRIC_TYPES in app/services/thresholds.py.
               Database checkers reuse cpu/mem/disk_percent for cache hit ratio
               and op counters, so utilisation ceilings are meaningless there —
               offering the fields would imply an alarm that never fires. */
            const reportsResources = ['snmp', 'ssh', 'push'].includes(type);
            const fields: [string, string, string][] = [
              ...(reportsResources ? [
                ['cpu_warn', 'CPU warning', '%'],
                ['cpu_crit', 'CPU critical', '%'],
                ['mem_warn', 'Memory warning', '%'],
                ['mem_crit', 'Memory critical', '%'],
                ['disk_warn', 'Disk warning', '%'],
                ['disk_crit', 'Disk critical', '%'],
              ] as [string, string, string][] : []),
              ['latency_warn', 'Latency warning', 'ms'],
              ['latency_crit', 'Latency critical', 'ms'],
            ];
            const overrideCount = Object.values(thresholds).filter(v => (v ?? '').trim() !== '').length;

            return (
              <details
                open={overrideCount > 0}
                style={{ marginBottom: '18px', background: 'var(--surface-raised)', borderRadius: '8px', border: '1px solid var(--border)' }}
              >
                <summary style={{ padding: '10px 12px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  Alarm Thresholds
                  <span style={{ fontSize: '11px', fontWeight: 500, color: overrideCount > 0 ? 'var(--accent)' : 'var(--text-muted)' }}>
                    {overrideCount > 0
                      ? `${overrideCount} override${overrideCount === 1 ? '' : 's'}`
                      : 'inheriting fleet defaults'}
                  </span>
                </summary>

                <div style={{ padding: '0 12px 12px' }}>
                  <p style={{ fontSize: '11.5px', color: 'var(--text-muted)', margin: '0 0 12px' }}>
                    Leave blank to use the fleet value from Preferences. Set a value here to override
                    it for this monitor only.
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px' }}>
                    {fields.map(([key, label, unit]) => {
                      const inherited = globalThresholds?.[key];
                      return (
                        <div key={key}>
                          <label
                            htmlFor={`monitor-th-${key}`}
                            style={{ fontSize: '11.5px', color: 'var(--text-secondary)', display: 'block', marginBottom: '3px' }}
                          >
                            {label} ({unit})
                          </label>
                          <input
                            id={`monitor-th-${key}`}
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            spellCheck={false}
                            disabled={csvMonitors.length > 0}
                            value={thresholds[key] ?? ''}
                            placeholder={inherited === null || inherited === undefined ? 'off' : String(inherited)}
                            onChange={e => setThresholds(t => ({ ...t, [key]: e.target.value }))}
                            style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  {!reportsResources && (
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '10px 0 0' }}>
                      {['db', 'mongodb', 'redis'].includes(type)
                        ? 'Database monitors report cache hit ratio and operation counts rather than host utilisation, so only latency ceilings apply here.'
                        : `${type.toUpperCase()} monitors do not report CPU, memory or disk, so only latency ceilings apply.`}
                    </p>
                  )}
                </div>
              </details>
            );
          })()}

          <div className="form-row">
            <div className="form-group" style={{ flex: 1 }}>
              <label htmlFor="monitor-tags" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'baseline' }}>
                <span>Tags (System Group &amp; Environment)</span>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 'normal', marginLeft: 'auto' }}>Comma separated</span>
              </label>
              <input 
                id="monitor-tags"
                type="text" 
                autoComplete="off"
                placeholder="e.g. SOA, prod, Server" 
                value={tagsStr} 
                onChange={(e) => setTagsStr(e.target.value)} 
              />

              {/* Environment Tag Quick Add */}
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>
                  Environment Tag:
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {['prod', 'staging', 'dev'].map(env => {
                    const currentList = getCurrentTagsList();
                    const isActive = currentList.some(t => t.toLowerCase() === env.toLowerCase() || (env === 'staging' && t.toLowerCase() === 'stag'));
                    return (
                      <button
                        type="button"
                        key={env}
                        className={`tag-badge-btn ${isActive ? 'active' : ''}`}
                        onClick={() => handleToggleEnvTag(env)}
                        style={{
                          fontSize: '12px',
                          padding: '3px 11px',
                          background: isActive ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.05)',
                          border: isActive ? '1px solid var(--accent)' : '1px solid var(--border)',
                          borderRadius: '12px',
                          color: isActive ? 'var(--accent)' : 'var(--text-primary)',
                          cursor: 'pointer',
                          fontWeight: isActive ? '600' : 'normal',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        {isActive ? `✓ ${env}` : `+ ${env}`}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* System / Application Group Tags */}
              {((existingTags && existingTags.length > 0) ? Array.from(new Set(existingTags.filter(t => !isEnvTag(t)))) : ['SOA', 'MIS', 'DB', 'HTTP', 'Server']).length > 0 && (
                <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>
                    Suggested System / Application Group Tags:
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {((existingTags && existingTags.length > 0) ? Array.from(new Set(existingTags.filter(t => !isEnvTag(t)))) : ['SOA', 'MIS', 'DB', 'HTTP', 'Server']).map(tag => {
                      const currentList = getCurrentTagsList();
                      const isActive = currentList.some(t => t.toLowerCase() === tag.toLowerCase());
                      return (
                        <button
                          type="button"
                          key={tag}
                          className={`tag-badge-btn ${isActive ? 'active' : ''}`}
                          onClick={() => handleToggleGroupTag(tag)}
                          style={{
                            fontSize: '12px',
                            padding: '3px 11px',
                            background: isActive ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.04)',
                            border: isActive ? '1px solid var(--accent)' : '1px solid var(--border)',
                            borderRadius: '12px',
                            color: isActive ? 'var(--accent)' : 'var(--text-primary)',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          {isActive ? `✓ ${tag}` : `+ ${tag}`}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            
            <div className="form-group">
              <label htmlFor="monitor-path">Path / Endpoint Path</label>
              <input 
                id="monitor-path"
                type="text" 
                disabled={csvMonitors.length > 0}
                placeholder={csvMonitors.length > 0 ? "Specified in CSV" : "e.g. /healthz or /api/ping"} 
                value={csvMonitors.length > 0 ? "" : path} 
                onChange={(e) => setPath(e.target.value)} 
              />
            </div>
          </div>

          {/* Apprise Notification Channels Section */}
          <div style={{
            padding: '14px',
            background: 'rgba(59, 130, 246, 0.04)',
            border: '1px solid rgba(59, 130, 246, 0.18)',
            borderRadius: '8px',
            marginBottom: '20px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Bell size={16} style={{ color: 'var(--accent)' }} />
                <span style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Notifications
                </span>
              </div>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setSelectedNotification(null);
                  setIsNotifDialogOpen(true);
                }}
                style={{
                  fontSize: '11.5px',
                  padding: '3px 9px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  cursor: 'pointer'
                }}
              >
                <Plus size={13} /> Setup Notification
              </button>
            </div>

            {availableNotifications.length === 0 ? (
              <div style={{
                padding: '10px 12px',
                fontSize: '12px',
                color: 'var(--text-muted)',
                background: 'var(--bg-secondary)',
                borderRadius: '6px',
                border: '1px dashed var(--border)'
              }}>
                Not available, please setup. Click "Setup Notification" to connect Discord, Telegram, Slack, Webhook, or Email.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {availableNotifications.map(n => {
                  const isChecked = selectedNotificationIds.includes(n.id!);
                  return (
                    <div
                      key={n.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        background: isChecked ? 'rgba(59, 130, 246, 0.08)' : 'var(--bg-secondary)',
                        border: isChecked ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid var(--border)',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0, cursor: 'pointer', flex: 1, minWidth: 0 }}>
                        <input
                          type="checkbox"
                          style={{ width: 'auto', margin: 0 }}
                          checked={isChecked}
                          onChange={() => handleToggleNotification(n.id!)}
                        />
                        <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {n.name}
                        </span>
                        <span style={{
                          fontSize: '10.5px',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          background: 'rgba(255, 255, 255, 0.06)',
                          color: 'var(--text-secondary)',
                          textTransform: 'uppercase',
                          fontWeight: 600
                        }}>
                          {n.type}
                        </span>
                        {n.is_default && (
                          <span style={{
                            fontSize: '10px',
                            padding: '1px 5px',
                            borderRadius: '3px',
                            background: 'rgba(16, 185, 129, 0.15)',
                            color: '#10b981',
                            fontWeight: 600
                          }}>
                            Default
                          </span>
                        )}
                      </label>

                      <button
                        type="button"
                        onClick={() => {
                          setSelectedNotification(n);
                          setIsNotifDialogOpen(true);
                        }}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--accent)',
                          fontSize: '11.5px',
                          cursor: 'pointer',
                          padding: '2px 6px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '3px'
                        }}
                      >
                        Edit
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Optional Advanced Custom Apprise URI toggle */}
            <div style={{ marginTop: '10px' }}>
              <button
                type="button"
                onClick={() => setShowAdvancedApprise(!showAdvancedApprise)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: '11px',
                  cursor: 'pointer',
                  padding: 0,
                  textDecoration: 'underline'
                }}
              >
                {showAdvancedApprise ? 'Hide custom Apprise URI' : '+ Add custom one-off Apprise URI'}
              </button>
              {showAdvancedApprise && (
                <div style={{ marginTop: '8px' }}>
                  <input
                    id="monitor-apprise"
                    type="text"
                    inputMode="url"
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="e.g. mailto://user:pass@host or slack://token/channel"
                    value={appriseUri}
                    onChange={(e) => setAppriseUri(e.target.value)}
                    style={{ fontSize: '12px', border: '1px solid rgba(59,130,246,0.3)' }}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px', display: 'block' }}>
                    Optional raw Apprise destination for this target only.
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input 
              type="checkbox" 
              style={{ width: 'auto' }} 
              id="monitorEnabled" 
              checked={enabled} 
              onChange={(e) => setEnabled(e.target.checked)} 
            />
            <label htmlFor="monitorEnabled" style={{ margin: 0, cursor: 'pointer' }}>Monitor target is active and running</label>
          </div>

          {testStatus !== 'idle' && (
            <div style={{
              padding: '11px 12px',
              borderRadius: '6px',
              marginBottom: '15px',
              fontSize: '13px',
              fontWeight: '500',
              background: testStatus === 'testing' ? 'rgba(59, 130, 246, 0.1)' : testStatus === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              border: `1px solid ${testStatus === 'testing' ? '#3b82f6' : testStatus === 'success' ? '#10b981' : '#ef4444'}`,
              color: testStatus === 'testing' ? '#93c5fd' : testStatus === 'success' ? '#34d399' : '#f87171'
            }}>
              {testStatus === 'testing' && 'Testing connection… Please wait.'}
              {testStatus === 'success' && `Connection Test Successful! ${testMessage}`}
              {testStatus === 'failed' && `Connection Test Failed: ${testMessage}`}
            </div>
          )}

          <div className="form-actions" style={{ justifyContent: 'space-between', display: 'flex' }}>
            <button 
              type="button" 
              className="accent-btn" 
              onClick={handleTestConnection} 
              disabled={testStatus === 'testing' || !getEffectiveHost() || csvMonitors.length > 0}
              title={csvMonitors.length > 0 ? "Test Connection is disabled during CSV bulk import mode" : ""}
              style={{
                background: 'rgba(59, 130, 246, 0.2)',
                border: '1px solid var(--accent)',
                color: 'var(--text-primary)',
                padding: '11px 18px',
                borderRadius: '6px',
                cursor: (testStatus === 'testing' || !getEffectiveHost() || csvMonitors.length > 0) ? 'not-allowed' : 'pointer',
                opacity: (testStatus === 'testing' || !getEffectiveHost() || csvMonitors.length > 0) ? 0.5 : 1,
              fontWeight: '600'
            }}
          >
            {testStatus === 'testing' ? 'Testing…' : 'Test Connection'}
          </button>
            
            <div style={{ display: 'flex', gap: '11px' }}>
              <button type="button" className="secondary" onClick={onClose}>Cancel</button>
              <button type="submit" disabled={testStatus === 'testing'}>Save Monitor</button>
            </div>
          </div>
        </form>

        {/* Apprise Notification Dialog */}
        <NotificationDialog
          isOpen={isNotifDialogOpen}
          onClose={() => setIsNotifDialogOpen(false)}
          apiUrl={(import.meta.env.VITE_API_URL || '').replace(/\/$/, '')}
          token={token}
          notification={selectedNotification}
          onSaved={async () => {
            const fresh = await loadNotifications();
            if (!selectedNotification && fresh.length > 0) {
              const newest = fresh[0];
              if (newest?.id && !selectedNotificationIds.includes(newest.id)) {
                setSelectedNotificationIds(prev => [...prev, newest.id!]);
              }
            }
          }}
          onDeleted={async () => {
            await loadNotifications();
            if (selectedNotification?.id) {
              setSelectedNotificationIds(prev => prev.filter(x => x !== selectedNotification.id));
            }
          }}
        />
    </Dialog>
  );
};

export default MonitorModal;
