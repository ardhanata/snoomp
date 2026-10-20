import React, { useState, useEffect, useMemo } from 'react';
import {
  Database,
  HardDrive,
  ArrowsClockwise,
  Plus,
  PencilSimple,
  Trash,
  Warning,
  MagnifyingGlass,
  HardDrives,
  Stack,
  Copy,
  Check,
  ArrowsDownUp,
  Lock,
  Info,
  FileText,
  Pulse
} from '@phosphor-icons/react';
import { HcpTenantModal, deriveTenantHost } from './HcpTenantModal';
import { HcpReportModal } from './HcpReportModal';
import { HcpDataStreamDashboard } from './HcpDataStreamDashboard';

interface HcpStorageDashboardProps {
  token: string | null;
  apiUrl: string;
}

export const HcpStorageDashboard: React.FC<HcpStorageDashboardProps> = ({
  token,
  apiUrl,
}) => {
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<any | null>(null);
  const [prefillData, setPrefillData] = useState<any | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'warning' | 'critical' | 'ok'>('all');
  const [selectedSubTenantFilter, setSelectedSubTenantFilter] = useState<string>('all');
  const [clusterTab, setClusterTab] = useState<'tenants' | 'namespaces'>('tenants');
  const [sortField, setSortField] = useState<'used' | 'name' | 'quota' | 'objects' | 'tenant'>('used');
  const [sortAsc, setSortAsc] = useState(false);
  const [copiedNamespace, setCopiedNamespace] = useState<string | null>(null);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportTenantName, setReportTenantName] = useState<string | undefined>(undefined);
  const [dashboardMode, setDashboardMode] = useState<'capacity' | 'stream'>('capacity');

  const fetchTenants = async (isManualRefresh: boolean = false) => {
    if (isManualRefresh) setRefreshing(true);
    try {
      const res = await fetch(`${apiUrl}/api/hcp/tenants`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (res.ok) {
        const data = await res.json();
        setTenants(data);
        if (data.length > 0 && !selectedTenantId) {
          setSelectedTenantId(data[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load HCP tenants:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchTenants();
  }, [apiUrl, token]);

  const activeTenant = useMemo(() => {
    if (!tenants || tenants.length === 0) return null;
    return tenants.find(t => t.id === selectedTenantId) || tenants[0];
  }, [tenants, selectedTenantId]);

  const isCluster = Boolean(activeTenant?.is_cluster || activeTenant?.metrics?.is_cluster);
  const clusterMetrics = activeTenant?.metrics?.cluster;
  const tenantMetrics = isCluster ? clusterMetrics : activeTenant?.metrics?.tenant;
  const rawNamespaces: any[] = activeTenant?.metrics?.namespaces || [];

  const subTenants = useMemo(() => {
    if (!isCluster) return [];
    if (activeTenant?.metrics?.tenants) {
      return activeTenant.metrics.tenants.map((t: any) => t.name).filter(Boolean);
    }
    const set = new Set<string>();
    rawNamespaces.forEach(ns => {
      if (ns.tenant_name) set.add(ns.tenant_name);
    });
    return Array.from(set).sort();
  }, [isCluster, activeTenant, rawNamespaces]);

  useEffect(() => {
    setSelectedSubTenantFilter('all');
  }, [selectedTenantId]);

  const handleManualSync = async () => {
    if (!activeTenant) return;
    setRefreshing(true);
    try {
      const res = await fetch(`${apiUrl}/api/hcp/tenants/${encodeURIComponent(activeTenant.id)}/sync`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (res.ok) {
        const updated = await res.json();
        setTenants(prev => prev.map(t => (t.id === updated.id ? updated : t)));
      }
    } catch (err) {
      console.error('Failed to sync HCP tenant:', err);
    } finally {
      setRefreshing(false);
    }
  };

  const handleDeleteTenant = async () => {
    if (!activeTenant) return;
    if (!window.confirm(`Are you sure you want to remove HCP Tenant monitor '${activeTenant.name}'?`)) {
      return;
    }

    try {
      const res = await fetch(`${apiUrl}/api/hcp/tenants/${encodeURIComponent(activeTenant.id)}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (res.ok) {
        setTenants(prev => {
          const next = prev.filter(t => t.id !== activeTenant.id);
          setSelectedTenantId(next.length > 0 ? next[0].id : null);
          return next;
        });
      }
    } catch (err) {
      console.error('Failed to delete HCP tenant:', err);
    }
  };

  const handleCopyS3Endpoint = (ns: any) => {
    if (!activeTenant) return;
    const tenantPart = ns.tenant_name || activeTenant.tenant_name;
    const s3Uri = `https://${ns.name}.${tenantPart}.${activeTenant.host}`;
    navigator.clipboard.writeText(s3Uri);
    setCopiedNamespace(ns.name);
    setTimeout(() => setCopiedNamespace(null), 2000);
  };

  const rawTenantsList: any[] = activeTenant?.metrics?.tenants || [];

  const selectedSubTenantData = useMemo(() => {
    if (!isCluster || selectedSubTenantFilter === 'all') return null;
    return rawTenantsList.find(t => t.name === selectedSubTenantFilter) || null;
  }, [isCluster, selectedSubTenantFilter, rawTenantsList]);

  // Filtered & sorted namespaces
  const filteredNamespaces = useMemo(() => {
    return rawNamespaces
      .filter(ns => {
        const matchSearch = ns.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (ns.tenant_name && ns.tenant_name.toLowerCase().includes(searchTerm.toLowerCase()));
        const matchStatus = statusFilter === 'all' || ns.status === statusFilter;
        const matchSubTenant = selectedSubTenantFilter === 'all' || ns.tenant_name === selectedSubTenantFilter;
        return matchSearch && matchStatus && matchSubTenant;
      })
      .sort((a, b) => {
        let diff = 0;
        if (sortField === 'used') {
          diff = (a.storage_used_bytes || 0) - (b.storage_used_bytes || 0);
        } else if (sortField === 'name') {
          diff = a.name.localeCompare(b.name);
        } else if (sortField === 'tenant') {
          diff = (a.tenant_name || '').localeCompare(b.tenant_name || '');
        } else if (sortField === 'quota') {
          diff = (a.used_percent || 0) - (b.used_percent || 0);
        } else if (sortField === 'objects') {
          diff = (a.object_count || 0) - (b.object_count || 0);
        }
        return sortAsc ? diff : -diff;
      });
  }, [rawNamespaces, searchTerm, statusFilter, selectedSubTenantFilter, sortField, sortAsc]);

  const filteredTenants = useMemo(() => {
    return rawTenantsList
      .filter(t => {
        const matchSearch = t.name.toLowerCase().includes(searchTerm.toLowerCase());
        const matchStatus = statusFilter === 'all' || t.status === statusFilter;
        return matchSearch && matchStatus;
      })
      .sort((a, b) => {
        let diff = 0;
        if (sortField === 'used') {
          diff = (a.storage_used_bytes || 0) - (b.storage_used_bytes || 0);
        } else if (sortField === 'name' || sortField === 'tenant') {
          diff = a.name.localeCompare(b.name);
        } else if (sortField === 'quota') {
          diff = (a.used_percent || 0) - (b.used_percent || 0);
        } else if (sortField === 'objects') {
          diff = (a.object_count || 0) - (b.object_count || 0);
        }
        return sortAsc ? diff : -diff;
      });
  }, [rawTenantsList, searchTerm, statusFilter, sortField, sortAsc]);

  const toggleSort = (field: 'used' | 'name' | 'quota' | 'objects' | 'tenant') => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
        <div style={{ height: '32px', width: '220px', background: 'var(--bg-elevated)', borderRadius: '6px', marginBottom: '16px' }} />
        <div style={{ height: '120px', background: 'var(--bg-elevated)', borderRadius: '16px', marginBottom: '24px' }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} style={{ height: '140px', background: 'var(--bg-elevated)', borderRadius: '16px' }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="hcp-dashboard anim-fade-in" style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* ── Top Header Bar ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '16px', marginBottom: '24px' }}>
        <div>
          <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: '4px' }}>
            Object Storage Observability
          </div>
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
            Hitachi Content Platform (HCP) S3 Quota &amp; Capacity
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
            Real-time tenant storage thresholds, namespace quotas, and S3 object metrics via HCP MAPI
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            type="button"
            className="secondary"
            onClick={() => handleManualSync()}
            disabled={refreshing || !activeTenant}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            title="Refresh capacity and quota metrics immediately"
          >
            <ArrowsClockwise size={14} className={refreshing ? 'spin' : ''} aria-hidden="true" />
            <span>{refreshing ? 'Syncing...' : 'Sync Now'}</span>
          </button>

          <button
            type="button"
            className="primary"
            onClick={() => {
              setEditingTenant(null);
              setPrefillData(null);
              setModalOpen(true);
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Plus size={15} aria-hidden="true" />
            <span>Add HCP Tenant</span>
          </button>
        </div>
      </div>

      {/* ── Empty State: No Tenants Configured ── */}
      {(!tenants || tenants.length === 0) ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
          <div style={{ maxWidth: '580px', margin: '0 auto', padding: '16px' }}>
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '16px',
                background: 'rgba(59, 130, 246, 0.1)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent)',
                marginBottom: '16px'
              }}
            >
              <Database size={28} aria-hidden="true" />
            </div>
            <h2 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 8px', color: 'var(--text-primary)' }}>
              No HCP Tenants Configured
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.5', margin: '0 0 24px' }}>
              Connect your Hitachi Content Platform MAPI endpoint (port 9090) to automatically discover and monitor tenant quotas, S3 namespace capacities, and object statistics across your environment.
            </p>
            <button
              type="button"
              className="primary"
              onClick={() => {
                setEditingTenant(null);
                setPrefillData(null);
                setModalOpen(true);
              }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
            >
              <Plus size={16} aria-hidden="true" />
              <span>Configure First HCP Tenant</span>
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ── Tenant Selector Strip ── */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }} role="tablist" aria-label="HCP Tenants">
              {tenants.map(t => {
                const isSelected = t.id === activeTenant?.id;
                const statusColor = t.last_status === 'ok' ? 'var(--color-up)' : t.last_status === 'warning' ? 'var(--color-warning)' : 'var(--color-down)';
                return (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={isSelected}
                    onClick={() => setSelectedTenantId(t.id)}
                    className={`filter-chip ${isSelected ? 'active' : ''}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 16px',
                      borderRadius: '10px',
                      fontWeight: isSelected ? 600 : 500,
                      fontSize: '13px'
                    }}
                  >
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: statusColor,
                        display: 'inline-block'
                      }}
                    />
                    <span>{t.name}</span>
                    {t.is_cluster && (
                      <span
                        style={{
                          fontSize: '9px',
                          padding: '1px 5px',
                          borderRadius: '4px',
                          background: 'rgba(16, 185, 129, 0.18)',
                          color: 'var(--color-up)',
                          fontWeight: 700
                        }}
                      >
                        CLUSTER
                      </span>
                    )}
                    {t.site && (
                      <span
                        style={{
                          fontSize: '10px',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          background: 'rgba(255, 255, 255, 0.08)',
                          color: 'var(--text-muted)',
                          textTransform: 'uppercase'
                        }}
                      >
                        {t.site}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Tenant Actions (Report, Edit, Delete) */}
            {activeTenant && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setReportTenantName(undefined);
                    setReportModalOpen(true);
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 12px' }}
                  title="Export PDF Report"
                >
                  <FileText size={14} aria-hidden="true" />
                  <span>Export PDF</span>
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setEditingTenant(activeTenant);
                    setPrefillData(null);
                    setModalOpen(true);
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 12px' }}
                >
                  <PencilSimple size={14} aria-hidden="true" />
                  <span>Edit Settings</span>
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={handleDeleteTenant}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 12px', color: 'var(--color-down)' }}
                >
                  <Trash size={14} aria-hidden="true" />
                  <span>Remove</span>
                </button>
              </div>
            )}
          </div>

          {/* Mode switcher: Capacity vs Data Stream */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
            <button
              type="button"
              onClick={() => setDashboardMode('capacity')}
              className={`filter-chip ${dashboardMode === 'capacity' ? 'active' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: dashboardMode === 'capacity' ? 600 : 500
              }}
            >
              <HardDrive size={15} />
              <span>Storage Quota &amp; Capacity</span>
            </button>
            <button
              type="button"
              onClick={() => setDashboardMode('stream')}
              className={`filter-chip ${dashboardMode === 'stream' ? 'active' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: dashboardMode === 'stream' ? 600 : 500
              }}
            >
              <Pulse size={15} />
              <span>Data Streams &amp; Node Health</span>
            </button>
          </div>

          {dashboardMode === 'stream' && activeTenant ? (
            <HcpDataStreamDashboard
              token={token}
              apiUrl={apiUrl}
              selectedHcpId={activeTenant.id}
              hcpEndpointName={activeTenant.name}
            />
          ) : (
            <>
              {/* ── Error Banner (If tenant check failed) ── */}
              {activeTenant?.last_error && (
            <div
              style={{
                marginBottom: '20px',
                border: '1px solid var(--color-down)',
                background: 'rgba(239, 68, 68, 0.08)',
                borderRadius: 'var(--radius-md)',
                padding: '16px 20px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px'
              }}
            >
              <Warning size={20} style={{ color: 'var(--color-down)', flexShrink: 0, marginTop: '2px' }} aria-hidden="true" />
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-down)', marginBottom: '4px' }}>
                  HCP MAPI Connection Error
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-primary)', lineHeight: '1.4' }}>
                  {activeTenant.last_error}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>
                  Target: https://{activeTenant.host}:{activeTenant.port}/mapi/tenants/{activeTenant.is_cluster ? '' : activeTenant.tenant_name} (Check firewall, MAPI port 9090, or credentials).
                </div>
              </div>
            </div>
          )}

          {/* ── KPI Summary Cards ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '24px' }}>
            {/* Card 1: Storage Capacity */}
            <div style={{ padding: '18px 20px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {isCluster ? 'Cluster Storage Used' : 'Tenant Storage Used'}
                </span>
                <div style={{ color: 'var(--accent)', background: 'rgba(59, 130, 246, 0.1)', padding: '6px', borderRadius: '8px' }}>
                  <HardDrive size={18} aria-hidden="true" />
                </div>
              </div>
              <div style={{ fontSize: '22px', fontWeight: 700, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)', marginBottom: '4px' }}>
                {tenantMetrics?.storage_used_formatted || '0 B'}
                <span style={{ fontSize: '14px', fontWeight: 400, color: 'var(--text-muted)', marginLeft: '6px' }}>
                  / {tenantMetrics?.hard_quota_formatted || 'Unlimited'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                <span>{isCluster ? `${activeTenant?.metrics?.cluster?.total_tenants ?? subTenants.length} tenants discovered` : `Free: ${tenantMetrics?.storage_free_formatted || 'Unlimited'}`}</span>
                <span style={{ fontWeight: 600, color: (tenantMetrics?.used_percent || 0) >= 90 ? 'var(--color-down)' : (tenantMetrics?.used_percent || 0) >= (tenantMetrics?.soft_quota_pct || 85) ? 'var(--color-warning)' : 'var(--color-up)' }}>
                  {tenantMetrics?.used_percent ?? 0}% Allocated
                </span>
              </div>
              {/* Progress bar */}
              <div style={{ width: '100%', height: '8px', background: 'var(--border)', borderRadius: '4px', overflow: 'hidden', position: 'relative' }}>
                <div
                  style={{
                    width: `${Math.min(100, tenantMetrics?.used_percent || 0)}%`,
                    height: '100%',
                    background: (tenantMetrics?.used_percent || 0) >= 95 ? 'var(--color-down)' : (tenantMetrics?.used_percent || 0) >= (tenantMetrics?.soft_quota_pct || 85) ? 'var(--color-warning)' : 'var(--color-up)',
                    borderRadius: '4px',
                    transition: 'width 0.3s ease'
                  }}
                />
              </div>
            </div>

            {/* Card 2: Quota & Alerting Threshold */}
            <div style={{ padding: '18px 20px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {isCluster ? 'Cluster Tenant Count' : 'Quota Thresholds'}
                </span>
                <div style={{ color: 'var(--accent)', background: 'rgba(59, 130, 246, 0.1)', padding: '6px', borderRadius: '8px' }}>
                  <Warning size={18} aria-hidden="true" />
                </div>
              </div>
              <div style={{ fontSize: '22px', fontWeight: 700, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)', marginBottom: '4px' }}>
                {isCluster ? `${activeTenant?.metrics?.cluster?.total_tenants ?? subTenants.length}` : `${tenantMetrics?.soft_quota_pct ?? 85}%`}
                <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-muted)', marginLeft: '6px' }}>
                  {isCluster ? 'Tenants Active' : 'Soft Quota Ceiling'}
                </span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px', lineHeight: '1.4' }}>
                {activeTenant?.metrics?.namespaces_summary?.warning_count > 0 ? (
                  <span style={{ color: 'var(--color-warning)', fontWeight: 600 }}>
                    ⚠ {activeTenant.metrics.namespaces_summary.warning_count} namespace(s) exceeding soft quota threshold
                  </span>
                ) : (
                  <span style={{ color: 'var(--color-up)', fontWeight: 500 }}>
                    ✓ All {isCluster ? 'tenants and namespaces' : 'namespaces'} operating below soft quota threshold
                  </span>
                )}
              </div>
            </div>

            {/* Card 3: Ingestion & Object Count */}
            <div style={{ padding: '18px 20px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Objects &amp; Ingestion
                </span>
                <div style={{ color: 'var(--accent)', background: 'rgba(59, 130, 246, 0.1)', padding: '6px', borderRadius: '8px' }}>
                  <Stack size={18} aria-hidden="true" />
                </div>
              </div>
              <div style={{ fontSize: '22px', fontWeight: 700, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)', marginBottom: '4px' }}>
                {(tenantMetrics?.object_count || 0).toLocaleString()}
                <span style={{ fontSize: '13px', fontWeight: 400, color: 'var(--text-muted)', marginLeft: '6px' }}>
                  objects
                </span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>
                Ingested Volume: <strong style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{tenantMetrics?.ingested_volume_formatted || '0 B'}</strong>
              </div>
            </div>

            {/* Card 4: Connectivity & MAPI Endpoint */}
            <div style={{ padding: '18px 20px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Endpoint &amp; Site
                </span>
                <div style={{ color: 'var(--accent)', background: 'rgba(59, 130, 246, 0.1)', padding: '6px', borderRadius: '8px' }}>
                  <HardDrives size={18} aria-hidden="true" />
                </div>
              </div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px', wordBreak: 'break-all' }}>
                {activeTenant?.host}:{activeTenant?.port}
              </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                  <span>
                    {isCluster ? (
                      <strong style={{ color: 'var(--color-up)' }}>All Tenants (Cluster Admin)</strong>
                    ) : (
                      <>Tenant: <strong>{activeTenant?.tenant_name}</strong></>
                    )}
                  </span>
                  {activeTenant?.last_response_time_ms != null && (
                    <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-up)' }}>
                      • {activeTenant.last_response_time_ms}ms
                    </span>
                  )}
                  {activeTenant?.site && (
                    <span style={{ padding: '1px 6px', borderRadius: '4px', background: 'rgba(59, 130, 246, 0.15)', color: 'var(--accent)', fontWeight: 600, textTransform: 'uppercase' }}>
                      {activeTenant.site}
                    </span>
                  )}
                </div>
              </div>
            </div>

          {/* ── Cluster View Tabs (When in Cluster-Wide Mode) ── */}
          {isCluster && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
              <button
                type="button"
                className={`filter-chip ${clusterTab === 'tenants' ? 'active' : ''}`}
                onClick={() => setClusterTab('tenants')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 18px',
                  borderRadius: '10px',
                  fontSize: '13px',
                  fontWeight: 600
                }}
              >
                <Database size={15} aria-hidden="true" />
                <span>All Tenants &amp; Quotas ({rawTenantsList.length})</span>
              </button>
              <button
                type="button"
                className={`filter-chip ${clusterTab === 'namespaces' ? 'active' : ''}`}
                onClick={() => setClusterTab('namespaces')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 18px',
                  borderRadius: '10px',
                  fontSize: '13px',
                  fontWeight: 600
                }}
              >
                <Stack size={15} aria-hidden="true" />
                <span>Discovered Namespaces ({rawNamespaces.length})</span>
              </button>
            </div>
          )}

          {/* ── Selected Sub-Tenant Focus Card (When filtering a specific tenant) ── */}
          {selectedSubTenantData && (
            <div style={{ marginBottom: '20px', padding: '20px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {selectedSubTenantData.name}
                      </span>
                      <span
                        style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '6px',
                          fontWeight: 600,
                          background: selectedSubTenantData.status === 'critical' ? 'rgba(239, 68, 68, 0.15)' : selectedSubTenantData.status === 'warning' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                          color: selectedSubTenantData.status === 'critical' ? 'var(--color-down)' : selectedSubTenantData.status === 'warning' ? 'var(--color-warning)' : 'var(--color-up)'
                        }}
                      >
                        {selectedSubTenantData.status.toUpperCase()}
                      </span>
                      {!selectedSubTenantData.namespaces_accessible && (
                        <span
                          style={{
                            fontSize: '11px',
                            padding: '2px 8px',
                            borderRadius: '6px',
                            fontWeight: 600,
                            background: 'rgba(148, 163, 184, 0.15)',
                            color: 'var(--text-muted)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <Lock size={12} aria-hidden="true" />
                          POLICY RESTRICTED
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Tenant FQDN: <code style={{ color: 'var(--accent)' }}>{selectedSubTenantData.name}.{activeTenant?.host}</code>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setSelectedSubTenantFilter('all')}
                    style={{ fontSize: '12px', padding: '6px 12px' }}
                  >
                    View All Tenants
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', background: 'var(--bg-elevated)', padding: '16px', borderRadius: '12px', marginBottom: '16px' }}>
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '4px' }}>
                      Storage Used / Hard Quota
                    </div>
                    <div style={{ fontSize: '18px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
                      {selectedSubTenantData.storage_used_formatted}
                      <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 400, marginLeft: '6px' }}>
                        / {selectedSubTenantData.hard_quota_formatted || 'Unlimited'}
                      </span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {selectedSubTenantData.used_percent}% Allocated (Soft Quota: {selectedSubTenantData.soft_quota_pct}%)
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '4px' }}>
                      Objects Stored
                    </div>
                    <div style={{ fontSize: '18px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
                      {Number(selectedSubTenantData.object_count || 0).toLocaleString()}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Ingested: {selectedSubTenantData.ingested_volume_formatted || selectedSubTenantData.storage_used_formatted}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '4px' }}>
                      Quota Free Space
                    </div>
                    <div style={{ fontSize: '18px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
                      {selectedSubTenantData.storage_free_formatted || 'Unlimited'}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Headroom before hard threshold
                    </div>
                  </div>
                </div>

                {/* Progress bar */}
                <div style={{ width: '100%', height: '8px', background: 'var(--border)', borderRadius: '4px', overflow: 'hidden', position: 'relative' }}>
                  <div
                    style={{
                      width: `${Math.min(100, selectedSubTenantData.used_percent || 0)}%`,
                      height: '100%',
                      background: (selectedSubTenantData.used_percent || 0) >= 95 ? 'var(--color-down)' : (selectedSubTenantData.used_percent || 0) >= (selectedSubTenantData.soft_quota_pct || 85) ? 'var(--color-warning)' : 'var(--color-up)',
                      borderRadius: '4px',
                      transition: 'width 0.3s ease'
                    }}
                  />
                </div>

                {!selectedSubTenantData.namespaces_accessible && (
                  <div
                    style={{
                      marginTop: '16px',
                      padding: '12px 16px',
                      borderRadius: '8px',
                      background: 'rgba(59, 130, 246, 0.08)',
                      border: '1px solid rgba(59, 130, 246, 0.2)',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px'
                    }}
                  >
                    <Info size={16} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: '2px' }} aria-hidden="true" />
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                      <strong>HCP Namespace Delegation Policy:</strong> Quota and capacity metrics for <strong>{selectedSubTenantData.name}</strong> are actively tracked ({selectedSubTenantData.storage_used_formatted} of {selectedSubTenantData.hard_quota_formatted}). Individual bucket listing is restricted because <em>"Allow system-level administration"</em> is disabled on this tenant in HCP. To view individual buckets, check <em>"Allow system-level administration"</em> in HCP Console under <code>Tenants &gt; {selectedSubTenantData.name} &gt; Edit</code>, or add this tenant directly to Snoomp with tenant credentials.
                    </div>
                  </div>
                )}
              </div>
          )}

          {/* ── Main Inventory Table: Tenants View OR Namespaces View ── */}
          <div style={{ padding: '20px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
            {isCluster && clusterTab === 'tenants' ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
                    <div>
                      <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        Cluster Tenants &amp; Quotas ({rawTenantsList.length})
                      </h2>
                      <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                        Storage utilization, hard quota enforcement, and namespace delegation status across all tenants
                      </p>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      {/* Search box */}
                      <div style={{ position: 'relative' }}>
                        <MagnifyingGlass size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} aria-hidden="true" />
                        <input
                          type="text"
                          placeholder="Filter tenant..."
                          value={searchTerm}
                          onChange={e => setSearchTerm(e.target.value)}
                          style={{
                            padding: '6px 12px 6px 30px',
                            fontSize: '12px',
                            borderRadius: '8px',
                            background: 'var(--bg-elevated)',
                            border: '1px solid var(--border)',
                            color: 'var(--text-primary)',
                            width: '180px'
                          }}
                        />
                      </div>

                      {/* Status filter chips */}
                      <div style={{ display: 'flex', gap: '4px' }} role="group" aria-label="Filter tenants by status">
                        <button
                          type="button"
                          className={`filter-chip ${statusFilter === 'all' ? 'active' : ''}`}
                          onClick={() => setStatusFilter('all')}
                          style={{ fontSize: '12px', padding: '4px 10px' }}
                        >
                          All ({rawTenantsList.length})
                        </button>
                        <button
                          type="button"
                          className={`filter-chip ${statusFilter === 'warning' ? 'active' : ''}`}
                          onClick={() => setStatusFilter(statusFilter === 'warning' ? 'all' : 'warning')}
                          style={{ fontSize: '12px', padding: '4px 10px', color: 'var(--color-warning)' }}
                        >
                          Warnings ({activeTenant?.metrics?.tenants_summary?.warning_count || 0})
                        </button>
                        <button
                          type="button"
                          className={`filter-chip ${statusFilter === 'ok' ? 'active' : ''}`}
                          onClick={() => setStatusFilter(statusFilter === 'ok' ? 'all' : 'ok')}
                          style={{ fontSize: '12px', padding: '4px 10px', color: 'var(--color-up)' }}
                        >
                          Healthy ({activeTenant?.metrics?.tenants_summary?.healthy_count || 0})
                        </button>
                      </div>
                    </div>
                  </div>

                  {filteredTenants.length === 0 ? (
                    <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                      No tenants matched the search criteria.
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: '12px', fontWeight: 600 }}>
                            <th style={{ padding: '10px 12px', cursor: 'pointer' }} onClick={() => toggleSort('name')}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span>Tenant Name</span>
                                <ArrowsDownUp size={12} aria-hidden="true" />
                              </div>
                            </th>
                            <th style={{ padding: '10px 12px', cursor: 'pointer', minWidth: '180px' }} onClick={() => toggleSort('quota')}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span>Storage &amp; Quota</span>
                                <ArrowsDownUp size={12} aria-hidden="true" />
                              </div>
                            </th>
                            <th style={{ padding: '10px 12px', cursor: 'pointer' }} onClick={() => toggleSort('objects')}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span>Objects</span>
                                <ArrowsDownUp size={12} aria-hidden="true" />
                              </div>
                            </th>
                            <th style={{ padding: '10px 12px' }}>Namespace Access</th>
                            <th style={{ padding: '10px 12px', textAlign: 'right' }}>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredTenants.map(t => {
                            const statusColor = t.status === 'critical' ? 'var(--color-down)' : t.status === 'warning' ? 'var(--color-warning)' : 'var(--color-up)';
                            const isSelected = selectedSubTenantFilter === t.name;
                            return (
                              <tr
                                key={t.name}
                                style={{
                                  borderBottom: '1px solid var(--border)',
                                  background: isSelected ? 'rgba(59, 130, 246, 0.08)' : 'transparent',
                                  transition: 'background 0.15s ease'
                                }}
                              >
                                <td style={{ padding: '12px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span
                                      style={{
                                        width: '8px',
                                        height: '8px',
                                        borderRadius: '50%',
                                        background: statusColor,
                                        flexShrink: 0
                                      }}
                                    />
                                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                                      {t.name}
                                    </span>
                                  </div>
                                </td>
                                <td style={{ padding: '12px', minWidth: '180px' }}>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontVariantNumeric: 'tabular-nums' }}>
                                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t.storage_used_formatted}</span>
                                      <span style={{ color: 'var(--text-muted)' }}>/ {t.hard_quota_formatted} ({t.used_percent ?? 0}%)</span>
                                    </div>
                                    <div style={{ width: '100%', height: '5px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                                      <div
                                        style={{
                                          width: `${Math.min(100, t.used_percent || 0)}%`,
                                          height: '100%',
                                          background: statusColor,
                                          borderRadius: '3px'
                                        }}
                                      />
                                    </div>
                                  </div>
                                </td>
                                <td style={{ padding: '12px', fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
                                  {(t?.object_count ?? 0).toLocaleString()}
                                </td>
                                <td style={{ padding: '12px' }}>
                                  {t.namespaces_accessible ? (
                                    <span
                                      style={{
                                        fontSize: '11px',
                                        padding: '2px 8px',
                                        borderRadius: '4px',
                                        background: 'rgba(16, 185, 129, 0.12)',
                                        color: 'var(--color-up)',
                                        fontWeight: 600
                                      }}
                                    >
                                      Delegated
                                    </span>
                                  ) : (
                                    <span
                                      style={{
                                        fontSize: '11px',
                                        padding: '2px 8px',
                                        borderRadius: '4px',
                                        background: 'rgba(148, 163, 184, 0.12)',
                                        color: 'var(--text-muted)',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px'
                                      }}
                                    >
                                      <Lock size={12} aria-hidden="true" />
                                      Restricted
                                    </span>
                                  )}
                                </td>
                                <td style={{ padding: '12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                    <button
                                      type="button"
                                      className="secondary"
                                      onClick={() => {
                                        setSelectedSubTenantFilter(t.name);
                                        if (t.namespaces_accessible) {
                                          setClusterTab('namespaces');
                                        }
                                      }}
                                      style={{ padding: '4px 10px', fontSize: '12px' }}
                                    >
                                      Inspect
                                    </button>
                                    <button
                                      type="button"
                                      className="secondary"
                                      onClick={() => {
                                        setReportTenantName(t.name);
                                        setReportModalOpen(true);
                                      }}
                                      title={`Export PDF audit report for ${t.name}`}
                                      style={{ padding: '4px 8px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                    >
                                      <FileText size={12} aria-hidden="true" />
                                      <span>Report</span>
                                    </button>
                                    <button
                                      type="button"
                                      className="secondary"
                                      onClick={() => {
                                        setEditingTenant(null);
                                        setPrefillData({
                                          tenantName: t.name,
                                          name: `HCP - ${t.name}`,
                                          host: deriveTenantHost(t.name, activeTenant?.host),
                                          port: activeTenant?.port || 9090
                                        });
                                        setModalOpen(true);
                                      }}
                                      title={`Add dedicated monitor for tenant '${t.name}'`}
                                      style={{
                                        padding: '4px 10px',
                                        fontSize: '11px',
                                        color: 'var(--accent)',
                                        borderColor: 'rgba(59, 130, 246, 0.3)'
                                      }}
                                    >
                                      + Monitor
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
                    <div>
                      <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        Namespaces / S3 Buckets ({filteredNamespaces.length})
                      </h2>
                      <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                        Storage utilization breakdown and quota enforcement across S3 buckets
                      </p>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      {/* Sub-Tenant dropdown in cluster mode */}
                      {isCluster && subTenants.length > 0 && (
                        <select
                          value={selectedSubTenantFilter}
                          onChange={e => setSelectedSubTenantFilter(e.target.value)}
                          style={{
                            padding: '6px 12px',
                            fontSize: '12px',
                            borderRadius: '8px',
                            background: 'var(--bg-elevated)',
                            border: '1px solid var(--border)',
                            color: 'var(--text-primary)'
                          }}
                          aria-label="Filter by Tenant"
                        >
                          <option value="all">All Tenants ({subTenants.length})</option>
                          {subTenants.map((tName: string) => (
                            <option key={tName} value={tName}>Tenant: {tName}</option>
                          ))}
                        </select>
                      )}

                      {/* Search box */}
                      <div style={{ position: 'relative' }}>
                        <MagnifyingGlass size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} aria-hidden="true" />
                        <input
                          type="text"
                          placeholder="Filter namespace..."
                          value={searchTerm}
                          onChange={e => setSearchTerm(e.target.value)}
                          style={{
                            padding: '6px 12px 6px 30px',
                            fontSize: '12px',
                            borderRadius: '8px',
                            background: 'var(--bg-elevated)',
                            border: '1px solid var(--border)',
                            color: 'var(--text-primary)',
                            width: '180px'
                          }}
                        />
                      </div>

                      {/* Status filter chips */}
                      <div style={{ display: 'flex', gap: '4px' }} role="group" aria-label="Filter by status">
                        <button
                          type="button"
                          className={`filter-chip ${statusFilter === 'all' ? 'active' : ''}`}
                          onClick={() => setStatusFilter('all')}
                          style={{ fontSize: '12px', padding: '4px 10px' }}
                        >
                          All ({rawNamespaces.length})
                        </button>
                        <button
                          type="button"
                          className={`filter-chip ${statusFilter === 'warning' ? 'active' : ''}`}
                          onClick={() => setStatusFilter(statusFilter === 'warning' ? 'all' : 'warning')}
                          style={{ fontSize: '12px', padding: '4px 10px', color: 'var(--color-warning)' }}
                        >
                          Warnings ({activeTenant?.metrics?.namespaces_summary?.warning_count || 0})
                        </button>
                        <button
                          type="button"
                          className={`filter-chip ${statusFilter === 'ok' ? 'active' : ''}`}
                          onClick={() => setStatusFilter(statusFilter === 'ok' ? 'all' : 'ok')}
                          style={{ fontSize: '12px', padding: '4px 10px', color: 'var(--color-up)' }}
                        >
                          Healthy ({activeTenant?.metrics?.namespaces_summary?.healthy_count || 0})
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Table */}
                  {filteredNamespaces.length === 0 ? (
                    selectedSubTenantData && !selectedSubTenantData.namespaces_accessible ? (
                      <div style={{ padding: '36px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        <Lock size={28} style={{ margin: '0 auto 12px', color: 'var(--text-muted)', opacity: 0.7 }} aria-hidden="true" />
                        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
                          Namespace Listing Restricted for {selectedSubTenantData.name}
                        </div>
                        <p style={{ fontSize: '12px', maxWidth: '540px', margin: '0 auto', lineHeight: '1.5' }}>
                          Tenant-level quota ({selectedSubTenantData.hard_quota_formatted}) and capacity utilization ({selectedSubTenantData.storage_used_formatted}, {selectedSubTenantData.used_percent}%) are monitored above. HCP security policy restricts individual bucket enumeration when <em>"Allow system-level administration"</em> is disabled.
                        </p>
                      </div>
                    ) : (
                      <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                        No namespaces matched the filter.
                      </div>
                    )
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: '12px', letterSpacing: '0.05em' }}>
                            <th style={{ padding: '10px 12px', cursor: 'pointer' }} onClick={() => toggleSort('name')}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span>Namespace</span>
                                <ArrowsDownUp size={12} aria-hidden="true" />
                              </div>
                            </th>
                            <th style={{ padding: '10px 12px', cursor: 'pointer', minWidth: '180px' }} onClick={() => toggleSort('quota')}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span>Storage &amp; Quota</span>
                                <ArrowsDownUp size={12} aria-hidden="true" />
                              </div>
                            </th>
                            <th style={{ padding: '10px 12px', cursor: 'pointer' }} onClick={() => toggleSort('objects')}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span>Objects</span>
                                <ArrowsDownUp size={12} aria-hidden="true" />
                              </div>
                            </th>
                            <th style={{ padding: '10px 12px' }}>Service Plan</th>
                            <th style={{ padding: '10px 12px', textAlign: 'right' }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredNamespaces.map(ns => {
                            const statusColor = ns.status === 'critical' ? 'var(--color-down)' : ns.status === 'warning' ? 'var(--color-warning)' : 'var(--color-up)';
                            return (
                              <tr
                                key={`${ns.tenant_name || ''}-${ns.name}`}
                                style={{
                                  borderBottom: '1px solid var(--border)',
                                  transition: 'background 0.15s ease'
                                }}
                              >
                                <td style={{ padding: '12px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span
                                      style={{
                                        width: '8px',
                                        height: '8px',
                                        borderRadius: '50%',
                                        background: statusColor,
                                        flexShrink: 0
                                      }}
                                    />
                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                                        {ns.name}
                                      </span>
                                      {isCluster && (
                                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                          {ns.tenant_name || 'default'}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </td>
                                <td style={{ padding: '12px' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px', fontSize: '12px' }}>
                                    <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                                      {ns.storage_used_formatted} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>/ {ns.hard_quota_formatted}</span>
                                    </span>
                                    <span style={{ fontSize: '11px', fontWeight: 600, color: statusColor, fontVariantNumeric: 'tabular-nums' }}>
                                      {ns.used_percent ?? 0}%
                                    </span>
                                  </div>
                                  <div style={{ width: '100%', height: '5px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                                    <div
                                      style={{
                                        width: `${Math.min(100, ns.used_percent || 0)}%`,
                                        height: '100%',
                                        background: statusColor,
                                        borderRadius: '3px'
                                      }}
                                    />
                                  </div>
                                </td>
                                <td style={{ padding: '12px', fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
                                  {(ns?.object_count ?? 0).toLocaleString()}
                                </td>
                                <td style={{ padding: '12px', color: 'var(--text-muted)', fontSize: '12px' }}>
                                  {ns.service_plan || 'Default'}
                                </td>
                                <td style={{ padding: '12px', textAlign: 'right' }}>
                                  <button
                                    type="button"
                                    className="secondary"
                                    onClick={() => handleCopyS3Endpoint(ns)}
                                    title="Copy S3 endpoint URL"
                                    style={{ padding: '4px 8px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                  >
                                    {copiedNamespace === ns.name ? <Check size={12} style={{ color: 'var(--color-up)' }} /> : <Copy size={12} />}
                                    <span>{copiedNamespace === ns.name ? 'Copied' : 'S3 URL'}</span>
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
            </>
          )}
        </>
      )}

      {/* ── Modal Dialog ── */}
      <HcpTenantModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setPrefillData(null);
        }}
        editingTenant={editingTenant}
        initialPrefill={prefillData}
        discoveredTenants={subTenants}
        clusterHost={isCluster ? activeTenant?.host : undefined}
        clusterPort={isCluster ? activeTenant?.port : undefined}
        onSaved={savedTenant => {
          fetchTenants();
          setSelectedTenantId(savedTenant.id);
        }}
        token={token}
        apiUrl={apiUrl}
      />

      {/* ── PDF Report Modal ── */}
      <HcpReportModal
        isOpen={reportModalOpen}
        onClose={() => {
          setReportModalOpen(false);
          setReportTenantName(undefined);
        }}
        activeTenant={activeTenant}
        subTenants={subTenants}
        initialTenantName={reportTenantName}
        token={token}
        apiUrl={apiUrl}
      />
    </div>
  );
};

export default HcpStorageDashboard;
