import React, { useState, useEffect } from 'react';

interface MonitorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: any) => void;
  editingMonitor?: any;
  token: string | null;
  existingTags: string[];
}

const MonitorModal: React.FC<MonitorModalProps> = ({ 
  isOpen, 
  onClose, 
  onSave, 
  editingMonitor,
  token,
  existingTags
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
  
  // Alerts config
  const [alertType, setAlertType] = useState('none'); // none, discord, telegram, slack
  const [alertWebhook, setAlertWebhook] = useState('');
  const [alertBotToken, setAlertBotToken] = useState('');
  const [alertChatId, setAlertChatId] = useState('');

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
      
      // Load notifications if exists
      const alerts = cfg.notifications || [];
      if (alerts.length > 0) {
        const primary = alerts[0];
        setAlertType(primary.type || 'none');
        const alertCfg = primary.config || {};
        setAlertWebhook(alertCfg.webhook_url || '');
        setAlertBotToken(alertCfg.bot_token || '');
        setAlertChatId(alertCfg.chat_id || '');
      } else {
        setAlertType('none');
        setAlertWebhook('');
        setAlertBotToken('');
        setAlertChatId('');
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
      setAlertType('none');
      setAlertWebhook('');
      setAlertBotToken('');
      setAlertChatId('');
    }

    // Reset test connection state & CSV state
    setTestStatus('idle');
    setTestMessage('');
    setCsvMonitors([]);
    setCsvLoadedInfo(null);
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
    if (alertType !== 'none') {
      const config: any = {};
      if (alertType === 'discord' || alertType === 'slack' || alertType === 'webhook') {
        config.webhook_url = alertWebhook;
      } else if (alertType === 'telegram') {
        config.bot_token = alertBotToken;
        config.chat_id = alertChatId;
      }
      notifications.push({ type: alertType, config });
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
    if (alertType !== 'none') {
      const config: any = {};
      if (alertType === 'discord' || alertType === 'slack' || alertType === 'webhook') {
        config.webhook_url = alertWebhook;
      } else if (alertType === 'telegram') {
        config.bot_token = alertBotToken;
        config.chat_id = alertChatId;
      }
      notifications.push({ type: alertType, config });
    }
    const base_config_json: any = { notifications };
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
        alert(`Bulk Import completed:\n${successes} monitor(s) created successfully.\n${failures} failed.`);
        handleClearCsv();
        onClose();
      }).catch(() => alert('An error occurred during bulk import.'));
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

  // Focus Trap Hook
  const modalRef = React.useRef<HTMLDivElement>(null);
  const prevIsOpenRef = React.useRef(false);

  React.useEffect(() => {
    if (!isOpen || !modalRef.current) {
      prevIsOpenRef.current = false;
      return;
    }

    // ponytail: focus initial input only once when modal transitions from closed to open, with preventScroll: true
    if (!prevIsOpenRef.current) {
      prevIsOpenRef.current = true;
      const targetInput = modalRef.current.querySelector<HTMLElement>('input:not([disabled])');
      if (targetInput) {
        targetInput.focus({ preventScroll: true });
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab') return;
      const currentFocusable = modalRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!currentFocusable || currentFocusable.length === 0) return;
      const first = currentFocusable[0];
      const last = currentFocusable[currentFocusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  // ponytail: early return guard must be after all hooks to prevent conditional hook crash
  if (!isOpen) return null;

  return (
    <div 
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        ref={modalRef}
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="monitor-modal-title"
      >
        <div className="modal-header">
          <h3 id="monitor-modal-title">{editingMonitor ? 'Edit Monitor Target' : 'Create Monitor Target'}</h3>
          <button type="button" aria-label="Close modal" className="secondary" style={{ padding: '4px 10px' }} onClick={onClose}>✕</button>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label>Target Name *</label>
              <input 
                type="text" 
                required={csvMonitors.length === 0} 
                disabled={csvMonitors.length > 0}
                placeholder={csvMonitors.length > 0 ? "Bulk CSV loaded" : "e.g. My Website API"}
                value={name} 
                onChange={(e) => setName(e.target.value)} 
              />
            </div>
            
            <div className="form-group">
              <label>Monitor Type *</label>
              <select value={type} onChange={(e) => handleTypeChange(e.target.value)}>
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
              background: 'rgba(255,255,255,0.02)',
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
                    style={{ fontSize: '11px', padding: '4px 10px', background: 'rgba(59,130,246,0.1)', color: 'var(--accent)', border: '1px solid rgba(59,130,246,0.2)' }}
                    onClick={handleDownloadSampleCsv}
                  >
                    Download Template
                  </button>
                  {csvMonitors.length > 0 ? (
                    <button
                      type="button"
                      className="secondary"
                      style={{ fontSize: '11px', padding: '4px 10px', background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}
                      onClick={handleClearCsv}
                    >
                      ✕ Clear CSV
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="secondary"
                      style={{ fontSize: '11px', padding: '4px 10px' }}
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
                  padding: '6px 10px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: '600',
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  color: '#34d399',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <span>ℹ️ {csvLoadedInfo}</span>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 'normal' }}>
                    Single-target inputs disabled during bulk import
                  </span>
                </div>
              ) : (
                <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
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
              <label>Hostname / IP / URL *</label>
              <input 
                type="text" 
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
                <label>Port (Optional)</label>
                <input 
                  type="number" 
                  disabled={csvMonitors.length > 0}
                  placeholder={csvMonitors.length > 0 ? "Specified in CSV" : (type === 'ssh' ? '22' : type === 'snmp' ? '161' : 'Leave empty')} 
                  value={csvMonitors.length > 0 ? '' : port} 
                  onChange={(e) => setPort(e.target.value === '' ? '' : Number(e.target.value))} 
                />
              </div>
            )}
            
            <div className="form-group">
              <label>Check Interval (seconds)</label>
              <input 
                type="number" 
                min="10" 
                max="86400" 
                value={checkInterval} 
                onChange={(e) => setCheckInterval(Number(e.target.value))} 
              />
            </div>
          </div>

          {/* Conditional Checker Fields */}
          {type === 'http' && (
            <div className="form-row" style={{ padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', marginBottom: '18px', opacity: csvMonitors.length > 0 ? 0.6 : 1 }}>
              <div className="form-group">
                <label>Scheme</label>
                <select value={scheme} disabled={csvMonitors.length > 0} onChange={(e) => setScheme(e.target.value)}>
                  <option value="http">http://</option>
                  <option value="https">https://</option>
                </select>
              </div>
              <div className="form-group">
                <label>HTTP Method</label>
                <select value={method} disabled={csvMonitors.length > 0} onChange={(e) => setMethod(e.target.value)}>
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
            <div className="form-group" style={{ padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', marginBottom: '18px', opacity: csvMonitors.length > 0 ? 0.6 : 1 }}>
              <label>SNMP Community String</label>
              <input 
                type="text" 
                disabled={csvMonitors.length > 0}
                placeholder={csvMonitors.length > 0 ? "Specified in CSV" : "public"}
                value={csvMonitors.length > 0 ? "" : snmpCommunity} 
                onChange={(e) => setSnmpCommunity(e.target.value)} 
              />
            </div>
          )}

          {type === 'ssh' && (
            <div style={{ padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', marginBottom: '18px', opacity: csvMonitors.length > 0 ? 0.6 : 1 }}>
              <div className="form-row">
                <div className="form-group">
                  <label>SSH Username</label>
                  <input 
                    type="text" 
                    disabled={csvMonitors.length > 0}
                    placeholder={csvMonitors.length > 0 ? "Specified in CSV" : "root"}
                    value={csvMonitors.length > 0 ? "" : sshUser} 
                    onChange={(e) => setSshUser(e.target.value)} 
                  />
                </div>
                <div className="form-group">
                  <label>SSH Password</label>
                  <input 
                    type="password" 
                    disabled={csvMonitors.length > 0}
                    placeholder={csvMonitors.length > 0 ? "Specified in CSV" : "Optional if using SSH Key"} 
                    value={csvMonitors.length > 0 ? "" : sshPassword} 
                    onChange={(e) => setSshPassword(e.target.value)} 
                  />
                </div>
              </div>
              <div className="form-group">
                <label>SSH Private Key (PEM format)</label>
                <textarea 
                  rows={3} 
                  disabled={csvMonitors.length > 0}
                  placeholder={csvMonitors.length > 0 ? "Specified in CSV" : "-----BEGIN OPENSSH PRIVATE KEY-----"} 
                  value={csvMonitors.length > 0 ? "" : sshKey} 
                  onChange={(e) => setSshKey(e.target.value)} 
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}
                />
              </div>
            </div>
          )}

          {type === 'dns' && (
            <div className="form-row" style={{ padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', marginBottom: '18px', opacity: csvMonitors.length > 0 ? 0.6 : 1 }}>
              <div className="form-group">
                <label>Resolve Type</label>
                <select value={dnsType} disabled={csvMonitors.length > 0} onChange={(e) => setDnsType(e.target.value)}>
                  <option value="A">A (IPv4)</option>
                  <option value="AAAA">AAAA (IPv6)</option>
                  <option value="CNAME">CNAME</option>
                  <option value="MX">MX</option>
                  <option value="TXT">TXT</option>
                </select>
              </div>
              <div className="form-group">
                <label>DNS Server IP (Optional)</label>
                <input 
                  type="text" 
                  disabled={csvMonitors.length > 0}
                  placeholder={csvMonitors.length > 0 ? "Specified in CSV" : "e.g. 8.8.8.8"}
                  value={csvMonitors.length > 0 ? "" : dnsServer} 
                  onChange={(e) => setDnsServer(e.target.value)} 
                />
              </div>
            </div>
          )}

          {(type === 'db' || type === 'mongodb' || type === 'redis') && (
            <div style={{ padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', marginBottom: '18px', opacity: csvMonitors.length > 0 ? 0.6 : 1 }}>
              <div className="form-group">
                <label>
                  {type === 'db' ? 'PostgreSQL Connection URI *' : type === 'mongodb' ? 'MongoDB Connection URI *' : 'Redis Connection URI *'}
                </label>
                <input 
                  type="text" 
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
                  <label>Verification Query</label>
                  <input 
                    type="text" 
                    disabled={csvMonitors.length > 0}
                    placeholder={csvMonitors.length > 0 ? "Specified in CSV" : "SELECT 1"}
                    value={csvMonitors.length > 0 ? "" : dbQuery} 
                    onChange={(e) => setDbQuery(e.target.value)} 
                  />
                </div>
              )}
            </div>
          )}

          <div className="form-row">
            <div className="form-group" style={{ flex: 1 }}>
              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Tags (System Group &amp; Environment)</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 'normal' }}>Comma separated</span>
              </label>
              <input 
                type="text" 
                placeholder="e.g. SOA, prod, Server" 
                value={tagsStr} 
                onChange={(e) => setTagsStr(e.target.value)} 
              />

              {/* Environment Tag Quick Add */}
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)' }}>
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
                          fontSize: '11px',
                          padding: '3px 10px',
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
                  <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)' }}>
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
                            fontSize: '11px',
                            padding: '3px 10px',
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
              <label>Path / Endpoint Path</label>
              <input 
                type="text" 
                disabled={csvMonitors.length > 0}
                placeholder={csvMonitors.length > 0 ? "Specified in CSV" : "e.g. /healthz or /api/ping"} 
                value={csvMonitors.length > 0 ? "" : path} 
                onChange={(e) => setPath(e.target.value)} 
              />
            </div>
          </div>

          {/* Alert Notification Configuration */}
          <div style={{ padding: '12px', background: 'rgba(59, 130, 246, 0.05)', border: '1px solid rgba(59, 130, 246, 0.15)', borderRadius: '8px', marginBottom: '20px' }}>
            <div className="form-group">
              <label style={{ color: 'var(--accent)', fontWeight: '600' }}>🔔 Alert Notifications (Apprise Integration)</label>
              <select value={alertType} onChange={(e) => setAlertType(e.target.value)} style={{ border: '1px solid rgba(59,130,246,0.3)' }}>
                <option value="none">No Alerts Configured</option>
                <option value="discord">Discord Webhook</option>
                <option value="telegram">Telegram Bot Alert</option>
                <option value="slack">Slack Webhook</option>
              </select>
            </div>

            {(alertType === 'discord' || alertType === 'slack') && (
              <div className="form-group">
                <label>Webhook URL *</label>
                <input 
                  type="text" 
                  required 
                  placeholder={alertType === 'discord' ? 'https://discord.com/api/webhooks/...' : 'https://hooks.slack.com/services/...'} 
                  value={alertWebhook} 
                  onChange={(e) => setAlertWebhook(e.target.value)} 
                />
              </div>
            )}

            {alertType === 'telegram' && (
              <div className="form-row">
                <div className="form-group">
                  <label>Bot Token *</label>
                  <input 
                    type="text" 
                    required 
                    placeholder="123456789:ABCdefGhI..." 
                    value={alertBotToken} 
                    onChange={(e) => setAlertBotToken(e.target.value)} 
                  />
                </div>
                <div className="form-group">
                  <label>Chat ID *</label>
                  <input 
                    type="text" 
                    required 
                    placeholder="e.g. -10012345678" 
                    value={alertChatId} 
                    onChange={(e) => setAlertChatId(e.target.value)} 
                  />
                </div>
              </div>
            )}
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
              padding: '10px 12px',
              borderRadius: '6px',
              marginBottom: '15px',
              fontSize: '13px',
              fontWeight: '500',
              background: testStatus === 'testing' ? 'rgba(59, 130, 246, 0.1)' : testStatus === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              border: `1px solid ${testStatus === 'testing' ? '#3b82f6' : testStatus === 'success' ? '#10b981' : '#ef4444'}`,
              color: testStatus === 'testing' ? '#93c5fd' : testStatus === 'success' ? '#34d399' : '#f87171'
            }}>
              {testStatus === 'testing' && 'Testing connection... Please wait.'}
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
                padding: '10px 18px',
                borderRadius: '6px',
                cursor: (testStatus === 'testing' || !getEffectiveHost() || csvMonitors.length > 0) ? 'not-allowed' : 'pointer',
                opacity: (testStatus === 'testing' || !getEffectiveHost() || csvMonitors.length > 0) ? 0.5 : 1,
                fontWeight: '600'
              }}
            >
              {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
            </button>
            
            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="button" className="secondary" onClick={onClose}>Cancel</button>
              <button type="submit" disabled={testStatus === 'testing'}>Save Monitor</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default MonitorModal;
