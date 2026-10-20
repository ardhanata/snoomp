import React, { useState, useEffect } from 'react';
import { Database, X, Check, Warning, ShieldCheck, ShieldWarning, CircleNotch } from '@phosphor-icons/react';
import Dialog from './Dialog';
import { SITE_TAGS } from '../utils/tags';

export interface HcpTenantData {
  id?: string;
  name: string;
  host: string;
  port: number;
  tenant_name: string;
  is_cluster?: boolean;
  username: string;
  password?: string;
  ignore_tls: boolean;
  site?: string | null;
  enabled: boolean;
  check_interval: number;
}

export function deriveTenantHost(tName: string, clusterHost?: string): string {
  if (!tName || !clusterHost) return '';
  const cleanHost = clusterHost.trim();
  const lower = cleanHost.toLowerCase();
  if (lower.startsWith('admin.')) {
    return `${tName.trim()}.${cleanHost.slice(6)}`;
  }
  return `${tName.trim()}.${cleanHost}`;
}

interface HcpTenantModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingTenant: any | null;
  onSaved: (savedTenant: any) => void;
  token: string | null;
  apiUrl: string;
  discoveredTenants?: string[];
  clusterHost?: string;
  clusterPort?: number;
  initialPrefill?: {
    tenantName?: string;
    host?: string;
    port?: number;
    name?: string;
  } | null;
}

export const HcpTenantModal: React.FC<HcpTenantModalProps> = ({
  isOpen,
  onClose,
  editingTenant,
  onSaved,
  token,
  apiUrl,
  discoveredTenants,
  clusterHost,
  clusterPort,
  initialPrefill,
}) => {
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(9090);
  const [isCluster, setIsCluster] = useState(false);
  const [tenantName, setTenantName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [ignoreTls, setIgnoreTls] = useState(false);
  const [site, setSite] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [checkInterval, setCheckInterval] = useState(300);

  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Test connection state
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    status: 'ok' | 'down' | 'idle';
    message?: string;
    error?: string;
  }>({ status: 'idle' });

  useEffect(() => {
    if (editingTenant) {
      setName(editingTenant.name || '');
      setHost(editingTenant.host || '');
      setPort(editingTenant.port || 9090);
      setIsCluster(Boolean(editingTenant.is_cluster));
      setTenantName(editingTenant.tenant_name || '');
      setUsername(editingTenant.username || '');
      setPassword(editingTenant.password || '');
      setIgnoreTls(!!editingTenant.ignore_tls);
      setSite(editingTenant.site || null);
      setEnabled(editingTenant.enabled !== false);
      setCheckInterval(editingTenant.check_interval || 300);
    } else if (initialPrefill) {
      const derived = initialPrefill.host || (clusterHost && initialPrefill.tenantName ? deriveTenantHost(initialPrefill.tenantName, clusterHost) : '');
      setName(initialPrefill.name || (initialPrefill.tenantName ? `HCP - ${initialPrefill.tenantName}` : ''));
      setHost(derived);
      setPort(initialPrefill.port || clusterPort || 9090);
      setIsCluster(false);
      setTenantName(initialPrefill.tenantName || '');
      setUsername('');
      setPassword('');
      setIgnoreTls(false);
      setSite(null);
      setEnabled(true);
      setCheckInterval(300);
    } else {
      setName('');
      setHost('');
      setPort(clusterPort || 9090);
      setIsCluster(false);
      setTenantName('');
      setUsername('');
      setPassword('');
      setIgnoreTls(false);
      setSite(null);
      setEnabled(true);
      setCheckInterval(300);
    }
    setErrorMessage(null);
    setTestResult({ status: 'idle' });
  }, [editingTenant, initialPrefill, isOpen, clusterHost, clusterPort]);

  const handleTestConnection = async () => {
    if (!host.trim() || (!isCluster && !tenantName.trim()) || !username.trim()) {
      setTestResult({
        status: 'down',
        error: isCluster
          ? 'Please fill in Admin Host and Username before testing cluster connection.'
          : 'Please fill in Host, Tenant Name, and Username before testing.'
      });
      return;
    }

    setTesting(true);
    setTestResult({ status: 'idle' });
    setErrorMessage(null);

    try {
      const res = await fetch(`${apiUrl}/api/hcp/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          host: host.trim(),
          port: Number(port) || 9090,
          tenant_name: isCluster ? '*' : tenantName.trim(),
          is_cluster: isCluster,
          username: username.trim(),
          password: password,
          ignore_tls: ignoreTls,
          existing_tenant_id: editingTenant?.id || null
        })
      });

      const text = await res.text();
      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text || `Server error (${res.status} ${res.statusText})` };
      }

      if (res.ok && data.status === 'ok') {
        setTestResult({
          status: 'ok',
          message: data.message
        });
      } else {
        setTestResult({
          status: 'down',
          error: data.error || data.detail || 'Connection test failed. Check host, port, or credentials.'
        });
      }
    } catch (err: any) {
      setTestResult({
        status: 'down',
        error: `Network error reaching Snoomp API: ${err.message}`
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMessage('Endpoint name is required.');
      return;
    }
    if (!host.trim()) {
      setErrorMessage('Admin host is required.');
      return;
    }
    if (!isCluster && !tenantName.trim()) {
      setErrorMessage('Tenant name is required when not in cluster auto-discovery mode.');
      return;
    }
    if (!username.trim()) {
      setErrorMessage('Username is required.');
      return;
    }
    if (!editingTenant && !password) {
      setErrorMessage('Password is required for new HCP tenant endpoints.');
      return;
    }

    setSaving(true);
    setErrorMessage(null);

    const payload = {
      name: name.trim(),
      host: host.trim(),
      port: Number(port) || 9090,
      tenant_name: isCluster ? '*' : tenantName.trim(),
      is_cluster: isCluster,
      username: username.trim(),
      password: password,
      ignore_tls: ignoreTls,
      site: site || null,
      enabled,
      check_interval: Number(checkInterval) || 300
    };

    try {
      const endpoint = editingTenant
        ? `${apiUrl}/api/hcp/tenants/${encodeURIComponent(editingTenant.id)}`
        : `${apiUrl}/api/hcp/tenants`;
      const method = editingTenant ? 'PUT' : 'POST';

      const res = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });

      const resText = await res.text();
      let resData: any = {};
      try {
        resData = JSON.parse(resText);
      } catch {
        throw new Error(resText || `Server error (${res.status} ${res.statusText})`);
      }

      if (!res.ok) {
        throw new Error(resData.detail || resData.error || 'Failed to save HCP tenant.');
      }

      onSaved(resData);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      aria-labelledby="hcp-modal-title"
      style={{
        maxWidth: '560px',
        width: '94%',
        padding: 0,
        borderRadius: 'var(--radius-xl)',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-lg)',
        color: 'var(--text-primary)'
      }}
    >
      <div style={{ padding: '24px 24px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                background: 'rgba(59, 130, 246, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent)'
              }}
            >
              <Database size={20} aria-hidden="true" />
            </div>
            <div>
              <h2 id="hcp-modal-title" style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
                {editingTenant ? 'Edit HCP Tenant Endpoint' : 'Add HCP Tenant Endpoint'}
              </h2>
              <p style={{ margin: '3px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                Hitachi Content Platform Management REST API (MAPI) Configuration
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ padding: '20px 24px 24px' }}>
        {errorMessage && (
          <div
            role="alert"
            style={{
              padding: '10px 14px',
              borderRadius: '8px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid var(--color-down)',
              color: 'var(--color-down)',
              fontSize: '13px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <Warning size={16} aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div className="form-group">
            <label htmlFor="hcp-name" style={{ fontSize: '13px', fontWeight: 500, display: 'block', marginBottom: '6px' }}>
              Display Label *
            </label>
            <input
              id="hcp-name"
              type="text"
              placeholder="e.g. Primary DC Object Storage"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: '12px' }}>
            <div className="form-group">
              <label htmlFor="hcp-host" style={{ fontSize: '13px', fontWeight: 500, display: 'block', marginBottom: '6px' }}>
                Admin Host / IP *
              </label>
              <input
                id="hcp-host"
                type="text"
                placeholder="admin.hcp.example.com"
                value={host}
                onChange={e => setHost(e.target.value)}
                required
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
            </div>
            <div className="form-group">
              <label htmlFor="hcp-port" style={{ fontSize: '13px', fontWeight: 500, display: 'block', marginBottom: '6px' }}>
                MAPI Port *
              </label>
              <input
                id="hcp-port"
                type="number"
                value={port}
                onChange={e => setPort(Number(e.target.value))}
                min={1}
                max={65535}
                required
                style={{ width: '100%', boxSizing: 'border-box', fontVariantNumeric: 'tabular-nums' }}
              />
            </div>
          </div>

          <div
            style={{
              padding: '12px 14px',
              borderRadius: '8px',
              background: isCluster ? 'rgba(59, 130, 246, 0.08)' : 'var(--bg-elevated)',
              border: isCluster ? '1px solid var(--accent)' : '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              transition: 'all 0.15s ease'
            }}
          >
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Cluster-Wide Mode (Auto-Discover All Tenants)
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                Enumerate and monitor all tenants and their namespaces using system admin credentials.
              </div>
            </div>
            <label className="switch" style={{ margin: 0, flexShrink: 0 }}>
              <input
                type="checkbox"
                checked={isCluster}
                onChange={e => setIsCluster(e.target.checked)}
              />
              <span className="slider round"></span>
            </label>
          </div>

          {!isCluster ? (
            <div className="form-group">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <label htmlFor="hcp-tenant" style={{ fontSize: '13px', fontWeight: 500 }}>
                  HCP Tenant Name *
                </label>
                {discoveredTenants && discoveredTenants.length > 0 && (
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {discoveredTenants.length} discovered tenants
                  </span>
                )}
              </div>
              {discoveredTenants && discoveredTenants.length > 0 && (
                <div style={{ marginBottom: '8px' }}>
                  <select
                    id="hcp-discovered-tenant-select"
                    value={discoveredTenants.includes(tenantName) ? tenantName : ''}
                    onChange={e => {
                      const selected = e.target.value;
                      if (!selected) return;
                      setTenantName(selected);
                      if (!name || name.startsWith('HCP - ')) {
                        setName(`HCP - ${selected}`);
                      }
                      if (clusterHost) {
                        setHost(deriveTenantHost(selected, clusterHost));
                      }
                    }}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      fontSize: '12px',
                      padding: '7px 10px',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      color: 'var(--text-primary)'
                    }}
                  >
                    <option value="">Quick select from discovered tenants ({discoveredTenants.length})...</option>
                    {discoveredTenants.map(t => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <input
                id="hcp-tenant"
                type="text"
                placeholder="e.g. finance, backup, or default"
                value={tenantName}
                onChange={e => {
                  const val = e.target.value;
                  setTenantName(val);
                  if (clusterHost && (!host || host.endsWith(clusterHost.replace(/^admin\./i, '')))) {
                    setHost(deriveTenantHost(val, clusterHost));
                  }
                }}
                required={!isCluster}
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
            </div>
          ) : (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '6px',
                background: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                fontSize: '12px',
                color: 'var(--color-up)'
              }}
            >
              Multi-tenant auto-discovery enabled: All tenants will be monitored via <code>GET /mapi/tenants</code>.
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div className="form-group">
              <label htmlFor="hcp-username" style={{ fontSize: '13px', fontWeight: 500, display: 'block', marginBottom: '6px' }}>
                Username / Access Key ID *
              </label>
              <input
                id="hcp-username"
                type="text"
                autoComplete="off"
                placeholder="e.g. aditindro or AccessKey"
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
            </div>
            <div className="form-group">
              <label htmlFor="hcp-password" style={{ fontSize: '13px', fontWeight: 500, display: 'block', marginBottom: '6px' }}>
                Password / Auth Token / Secret Key {editingTenant ? '(Blank to keep)' : '*'}
              </label>
              <input
                id="hcp-password"
                type="password"
                autoComplete="new-password"
                placeholder={editingTenant ? '••••••••' : 'Password or Secret Key'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required={!editingTenant}
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                Accepts raw password, HCP Auth Token, or MD5 Secret Key.
              </span>
            </div>
          </div>

          {/* Site Tag Assignment */}
          <div className="form-group">
            <label style={{ fontSize: '13px', fontWeight: 500, display: 'block', marginBottom: '6px' }}>
              Site Location:
            </label>
            <div style={{ display: 'flex', gap: '8px' }} role="group" aria-label="Site location">
              <button
                type="button"
                className={`tag-badge-btn ${site === null ? 'active' : ''}`}
                onClick={() => setSite(null)}
                style={{
                  fontSize: '12px',
                  padding: '4px 12px',
                  background: site === null ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                  border: site === null ? '1px solid var(--accent)' : '1px solid var(--border)',
                  borderRadius: '12px',
                  color: site === null ? 'var(--accent)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontWeight: site === null ? '600' : 'normal'
                }}
              >
                None
              </button>
              {SITE_TAGS.map(s => {
                const isActive = site === s;
                return (
                  <button
                    key={s}
                    type="button"
                    className={`tag-badge-btn ${isActive ? 'active' : ''}`}
                    onClick={() => setSite(isActive ? null : s)}
                    style={{
                      fontSize: '12px',
                      padding: '4px 12px',
                      background: isActive ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                      border: isActive ? '1px solid var(--accent)' : '1px solid var(--border)',
                      borderRadius: '12px',
                      color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontWeight: isActive ? '600' : 'normal'
                    }}
                  >
                    {isActive ? `✓ ${s.toUpperCase()}` : s.toUpperCase()}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
            <label htmlFor="hcp-tls" style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                id="hcp-tls"
                type="checkbox"
                checked={ignoreTls}
                onChange={e => setIgnoreTls(e.target.checked)}
              />
              <span>Ignore TLS / Self-Signed Certificate errors</span>
            </label>

            <label htmlFor="hcp-enabled" style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                id="hcp-enabled"
                type="checkbox"
                checked={enabled}
                onChange={e => setEnabled(e.target.checked)}
              />
              <span>Enabled</span>
            </label>
          </div>

          {/* Test Connection Result Box */}
          {testResult.status !== 'idle' && (
            <div
              role="status"
              aria-live="polite"
              style={{
                padding: '12px 14px',
                borderRadius: '8px',
                background: testResult.status === 'ok' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                border: `1px solid ${testResult.status === 'ok' ? 'var(--color-up)' : 'var(--color-down)'}`,
                color: testResult.status === 'ok' ? 'var(--color-up)' : 'var(--color-down)',
                fontSize: '13px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px'
              }}
            >
              {testResult.status === 'ok' ? (
                <ShieldCheck size={18} style={{ flexShrink: 0, marginTop: '2px' }} aria-hidden="true" />
              ) : (
                <ShieldWarning size={18} style={{ flexShrink: 0, marginTop: '2px' }} aria-hidden="true" />
              )}
              <div style={{ lineHeight: '1.4' }}>
                {testResult.status === 'ok' ? testResult.message : testResult.error}
              </div>
            </div>
          )}
        </div>

        {/* Dialog Actions */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
          <button
            type="button"
            className="secondary"
            onClick={handleTestConnection}
            disabled={testing || saving}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            {testing ? <CircleNotch size={14} className="spin" /> : <ShieldCheck size={14} />}
            <span>{testing ? 'Testing...' : 'Test Connection'}</span>
          </button>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              className="secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="primary"
              disabled={saving || testing}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              {saving ? <CircleNotch size={14} className="spin" /> : <Check size={14} />}
              <span>{saving ? 'Saving...' : editingTenant ? 'Update Tenant' : 'Save Tenant'}</span>
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
};

export default HcpTenantModal;
