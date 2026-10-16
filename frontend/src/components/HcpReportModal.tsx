import React, { useState, useEffect } from 'react';
import { FileText, X, Download, Server, Database, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import Dialog from './Dialog';
import { downloadPdf } from '../lib/downloadPdf';

interface HcpReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTenant: any | null;
  subTenants: string[];
  initialTenantName?: string;
  token: string | null;
  apiUrl: string;
}

export const HcpReportModal: React.FC<HcpReportModalProps> = ({
  isOpen,
  onClose,
  activeTenant,
  subTenants,
  initialTenantName,
  token,
  apiUrl,
}) => {
  const isCluster = Boolean(activeTenant?.is_cluster || activeTenant?.metrics?.is_cluster);

  const [reportType, setReportType] = useState<'cluster' | 'tenant'>(
    isCluster && !initialTenantName ? 'cluster' : 'tenant'
  );
  const [selectedSubTenant, setSelectedSubTenant] = useState<string>('');
  const [downloading, setDownloading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (initialTenantName) {
      setSelectedSubTenant(initialTenantName);
      setReportType('tenant');
    } else if (subTenants.length > 0) {
      setSelectedSubTenant(subTenants[0]);
    } else if (activeTenant?.tenant_name && activeTenant.tenant_name !== '*') {
      setSelectedSubTenant(activeTenant.tenant_name);
    }
  }, [initialTenantName, subTenants, activeTenant]);

  useEffect(() => {
    if (!isOpen) {
      setErrorMsg(null);
      setSuccessMsg(null);
      setDownloading(false);
    }
  }, [isOpen]);

  const handleDownload = async () => {
    if (!activeTenant) return;
    setDownloading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    let path = '';
    let fallbackName = 'hcp-report.pdf';

    if (reportType === 'cluster') {
      path = `/api/reports/hcp/${encodeURIComponent(activeTenant.id)}/cluster.pdf`;
      fallbackName = `hcp-cluster-${activeTenant.name || 'report'}.pdf`;
    } else {
      const targetTenant = (isCluster ? selectedSubTenant : activeTenant.tenant_name) || 'tenant';
      if (!targetTenant) {
        setErrorMsg('Please select a tenant to generate the audit report.');
        setDownloading(false);
        return;
      }
      path = `/api/reports/hcp/${encodeURIComponent(activeTenant.id)}/tenant.pdf?tenant_name=${encodeURIComponent(targetTenant)}`;
      fallbackName = `hcp-tenant-${targetTenant}.pdf`;
    }

    try {
      const res = await downloadPdf(`${apiUrl}${path}`, token, fallbackName);
      if (!res.ok) {
        setErrorMsg(res.error || 'Failed to generate PDF report.');
      } else {
        setSuccessMsg(`Report generated: ${res.filename || fallbackName}`);
        setTimeout(() => {
          onClose();
        }, 1200);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Network error while requesting PDF.');
    } finally {
      setDownloading(false);
    }
  };

  if (!activeTenant) return null;

  const clusterMeta = activeTenant.metrics?.cluster;
  const tenantsList: any[] = activeTenant.metrics?.tenants || [];
  const selectedTenantInfo = tenantsList.find((t: any) => t.name === selectedSubTenant);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      aria-labelledby="hcp-report-title"
      className="modal-content"
      style={{ width: '560px', maxWidth: '95vw', background: 'var(--bg-elevated)' }}
    >
      <div className="modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ color: 'var(--accent)', background: 'rgba(59, 130, 246, 0.1)', padding: '6px', borderRadius: '6px' }}>
            <FileText size={18} aria-hidden="true" />
          </div>
          <div>
            <h3 id="hcp-report-title" style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
              Export HCP Storage PDF Report
            </h3>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
              {activeTenant.name} ({activeTenant.host}:{activeTenant.port})
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: '4px',
            display: 'flex',
            alignItems: 'center'
          }}
        >
          <X size={18} />
        </button>
      </div>

      <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Mode Selector */}
        {isCluster && (
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
              Report Scope
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setReportType('cluster')}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  padding: '12px 14px',
                  borderRadius: '6px',
                  border: reportType === 'cluster' ? '1px solid var(--accent)' : '1px solid var(--border)',
                  background: reportType === 'cluster' ? 'rgba(59, 130, 246, 0.08)' : 'var(--surface-raised)',
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                <Server size={18} style={{ color: reportType === 'cluster' ? 'var(--accent)' : 'var(--text-muted)', marginTop: '2px', flexShrink: 0 }} aria-hidden="true" />
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: reportType === 'cluster' ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                    Cluster Fleet Report
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px', lineHeight: '1.3' }}>
                    All tenants, total used capacity, quota breaches, and directory.
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setReportType('tenant')}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  padding: '12px 14px',
                  borderRadius: '6px',
                  border: reportType === 'tenant' ? '1px solid var(--accent)' : '1px solid var(--border)',
                  background: reportType === 'tenant' ? 'rgba(59, 130, 246, 0.08)' : 'var(--surface-raised)',
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                <Database size={18} style={{ color: reportType === 'tenant' ? 'var(--accent)' : 'var(--text-muted)', marginTop: '2px', flexShrink: 0 }} aria-hidden="true" />
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: reportType === 'tenant' ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                    Tenant S3 Audit
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px', lineHeight: '1.3' }}>
                    Single tenant quota envelope, bucket breakdown, and object stats.
                  </div>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Dynamic Controls based on report type */}
        {reportType === 'cluster' ? (
          <div style={{ background: 'var(--surface-raised)', padding: '14px 16px', borderRadius: '6px', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
              Cluster Fleet Summary
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', fontSize: '12px' }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Tenants:</span>{' '}
                <strong style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
                  {clusterMeta?.total_tenants ?? subTenants.length}
                </strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Used Space:</span>{' '}
                <strong style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
                  {clusterMeta?.storage_used_formatted ?? '0 B'}
                </strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Total Objects:</span>{' '}
                <strong style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
                  {(clusterMeta?.object_count ?? 0).toLocaleString()}
                </strong>
              </div>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '10px', borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
              Includes watchlist of all buckets exceeding the 85% soft quota ceiling.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {isCluster && (
              <div>
                <label
                  htmlFor="hcp-subtenant-select"
                  style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}
                >
                  Target Tenant
                </label>
                <select
                  id="hcp-subtenant-select"
                  className="input-field"
                  value={selectedSubTenant}
                  onChange={(e) => setSelectedSubTenant(e.target.value)}
                  style={{ width: '100%', fontSize: '13px', padding: '8px 10px', background: 'var(--surface-raised)' }}
                >
                  {subTenants.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ background: 'var(--surface-raised)', padding: '14px 16px', borderRadius: '6px', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
                Tenant Audit Scope: <span style={{ color: 'var(--accent)' }}>{selectedSubTenant || activeTenant.tenant_name}</span>
              </div>
              {selectedTenantInfo && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', fontSize: '12px', marginBottom: '8px' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Used:</span>{' '}
                    <strong style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
                      {selectedTenantInfo.storage_used_formatted || '0 B'}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Quota:</span>{' '}
                    <strong style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
                      {selectedTenantInfo.hard_quota_formatted || 'Unlimited'}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Objects:</span>{' '}
                    <strong style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
                      {(selectedTenantInfo.object_count || 0).toLocaleString()}
                    </strong>
                  </div>
                </div>
              )}
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Itemizes all provisioned S3 namespaces, stored object volume, and quota utilization.
              </div>
            </div>
          </div>
        )}

        {/* Status Feedback */}
        {errorMsg && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--color-down)', color: 'var(--color-down)', fontSize: '12px' }}>
            <AlertCircle size={15} style={{ flexShrink: 0 }} aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', borderRadius: '6px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid var(--color-up)', color: 'var(--color-up)', fontSize: '12px' }}>
            <CheckCircle2 size={15} style={{ flexShrink: 0 }} aria-hidden="true" />
            <span>{successMsg}</span>
          </div>
        )}
      </div>

      <div className="form-actions" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px', padding: '14px 20px', borderTop: '1px solid var(--border)' }}>
        <button
          type="button"
          className="secondary"
          onClick={onClose}
          disabled={downloading}
          style={{ fontSize: '13px', padding: '7px 14px' }}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={handleDownload}
          disabled={downloading}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '13px',
            padding: '7px 16px',
            fontWeight: 600
          }}
        >
          {downloading ? (
            <>
              <Loader2 size={14} className="spin" aria-hidden="true" />
              <span>Building PDF...</span>
            </>
          ) : (
            <>
              <Download size={14} aria-hidden="true" />
              <span>Download A4 PDF</span>
            </>
          )}
        </button>
      </div>
    </Dialog>
  );
};
