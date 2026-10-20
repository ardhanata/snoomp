import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Pulse,
  Cpu,
  HardDrives,
  Stack,
  ArrowsClockwise,
  Warning,
  MagnifyingGlass,
  ArrowsDownUp,
  Lightning,
  Clock,
  ShieldWarning,
  CloudArrowDown,
  CheckCircle,
  ChartBar
} from '@phosphor-icons/react';

interface HcpDataStreamDashboardProps {
  token: string | null;
  apiUrl: string;
  selectedHcpId: string;
  hcpEndpointName?: string;
}

export const HcpDataStreamDashboard: React.FC<HcpDataStreamDashboardProps> = ({
  token,
  apiUrl,
  selectedHcpId,
  hcpEndpointName
}) => {
  // Navigation View State
  const [activeTab, setActiveTab] = useState<'overview' | 'streams' | 'nodes' | 'investigation'>('overview');
  const [timeRangeHours, setTimeRangeHours] = useState<number>(24);

  // Data states
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [overviewData, setOverviewData] = useState<any | null>(null);
  const [nodesData, setNodesData] = useState<any | null>(null);
  const [tenantStreams, setTenantStreams] = useState<any[]>([]);
  const [probesData, setProbesData] = useState<any | null>(null);
  const [investigationData, setInvestigationData] = useState<any | null>(null);

  // Action states
  const [pollingNodes, setPollingNodes] = useState<boolean>(false);
  const [runningProbes, setRunningProbes] = useState<boolean>(false);
  const [preparingLogs, setPreparingLogs] = useState<boolean>(false);
  const [logJobStatus, setLogJobStatus] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Filters & Sorting for Streams
  const [streamSearch, setStreamSearch] = useState<string>('');
  const [statusMixFilter, setStatusMixFilter] = useState<'all' | 'errors' | 'clean'>('all');
  const [sortField, setSortField] = useState<'requests' | 'latency' | 'bandwidth' | 'errors'>('requests');
  const [sortAsc, setSortAsc] = useState<boolean>(false);

  const authHeaders = useMemo((): Record<string, string> => {
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }, [token]);

  // Load all telemetry for the selected HCP endpoint
  const fetchTelemetry = useCallback(async (isManual: boolean = false) => {
    if (!selectedHcpId) return;
    if (isManual) setRefreshing(true);
    else setLoading(true);

    try {
      const [ovRes, ndRes, stRes, pbRes, invRes] = await Promise.all([
        fetch(`${apiUrl}/api/hcp/${selectedHcpId}/stream/overview?hours=${timeRangeHours}`, { headers: authHeaders }),
        fetch(`${apiUrl}/api/hcp/${selectedHcpId}/stream/nodes?hours=${timeRangeHours}`, { headers: authHeaders }),
        fetch(`${apiUrl}/api/hcp/${selectedHcpId}/stream/tenants?hours=${timeRangeHours}`, { headers: authHeaders }),
        fetch(`${apiUrl}/api/hcp/${selectedHcpId}/stream/probes?limit=60`, { headers: authHeaders }),
        fetch(`${apiUrl}/api/hcp/${selectedHcpId}/stream/investigation?hours=${Math.max(48, timeRangeHours)}`, { headers: authHeaders })
      ]);

      if (ovRes.ok) setOverviewData(await ovRes.json());
      if (ndRes.ok) setNodesData(await ndRes.json());
      if (stRes.ok) {
        const d = await stRes.json();
        setTenantStreams(d.streams || []);
      }
      if (pbRes.ok) setProbesData(await pbRes.json());
      if (invRes.ok) setInvestigationData(await invRes.json());
    } catch (err) {
      console.error('Failed to load HCP stream telemetry:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiUrl, selectedHcpId, timeRangeHours, authHeaders]);

  useEffect(() => {
    fetchTelemetry();
  }, [fetchTelemetry]);

  // Manual trigger: Poll Nodes Now
  const handlePollNodesNow = async () => {
    if (!selectedHcpId) return;
    setPollingNodes(true);
    setStatusMessage('Polling MAPI /mapi/nodes/statistics...');
    try {
      const res = await fetch(`${apiUrl}/api/hcp/${selectedHcpId}/stream/nodes/poll`, {
        method: 'POST',
        headers: authHeaders
      });
      if (res.ok) {
        const polled = await res.json();
        setStatusMessage(`Successfully polled ${polled.nodes?.length || 4} nodes.`);
        // Refresh nodes telemetry view
        const ndRes = await fetch(`${apiUrl}/api/hcp/${selectedHcpId}/stream/nodes?hours=${timeRangeHours}`, { headers: authHeaders });
        if (ndRes.ok) setNodesData(await ndRes.json());
      } else {
        const err = await res.json();
        setStatusMessage(`Node poll failed: ${err.detail || 'Unknown error'}`);
      }
    } catch (e: any) {
      setStatusMessage(`Node poll failed: ${e.message}`);
    } finally {
      setPollingNodes(false);
      setTimeout(() => setStatusMessage(null), 4000);
    }
  };

  // Manual trigger: Run Synthetic Probes Now
  const handleRunProbesNow = async () => {
    if (!selectedHcpId) return;
    setRunningProbes(true);
    setStatusMessage('Dispatching synthetic probes to monitored namespaces...');
    try {
      const res = await fetch(`${apiUrl}/api/hcp/${selectedHcpId}/stream/probes/run`, {
        method: 'POST',
        headers: authHeaders
      });
      if (res.ok) {
        const result = await res.json();
        setStatusMessage(`Executed probes on ${result.namespaces_probed || 0} namespaces (${result.successful_probes || 0} passed).`);
        // Refresh probes & overview
        const pbRes = await fetch(`${apiUrl}/api/hcp/${selectedHcpId}/stream/probes?limit=60`, { headers: authHeaders });
        if (pbRes.ok) setProbesData(await pbRes.json());
        const ovRes = await fetch(`${apiUrl}/api/hcp/${selectedHcpId}/stream/overview?hours=${timeRangeHours}`, { headers: authHeaders });
        if (ovRes.ok) setOverviewData(await ovRes.json());
      } else {
        const err = await res.json();
        setStatusMessage(`Probes failed: ${err.detail || 'Unknown error'}`);
      }
    } catch (e: any) {
      setStatusMessage(`Probes failed: ${e.message}`);
    } finally {
      setRunningProbes(false);
      setTimeout(() => setStatusMessage(null), 5000);
    }
  };

  // Manual trigger: Prepare & Download Access Logs
  const handlePrepareLogs = async () => {
    if (!selectedHcpId) return;
    setPreparingLogs(true);
    setLogJobStatus('Checking HCP log archive status via /mapi/logs...');
    try {
      const res = await fetch(`${apiUrl}/api/hcp/${selectedHcpId}/stream/logs/prepare`, {
        method: 'POST',
        headers: authHeaders
      });
      if (res.ok) {
        const job = await res.json();
        if (job.status === 'ready') {
          setLogJobStatus('Log package is ready on HCP. Downloading and processing access logs...');
        } else {
          setLogJobStatus(`Job #${job.id.slice(0, 8)}: ${job.error_message || 'Packaging logs on HCP cluster...'}`);
        }
        pollLogJobStatus(job.id);
      } else {
        const err = await res.json();
        setLogJobStatus(`Log preparation notice: ${err.detail || 'Cluster in progress'}`);
        setPreparingLogs(false);
      }
    } catch (e: any) {
      setLogJobStatus(`Log prepare failed: ${e.message}`);
      setPreparingLogs(false);
    }
  };

  const pollLogJobStatus = async (jobId: string) => {
    try {
      const res = await fetch(`${apiUrl}/api/hcp/${selectedHcpId}/stream/logs/jobs/${jobId}`, {
        headers: authHeaders
      });
      if (res.ok) {
        const job = await res.json();
        if (job.status === 'completed') {
          setLogJobStatus(`Logs processed: ${(job.records_processed ?? job.records_parsed ?? 0).toLocaleString()} records ingested.`);
          setPreparingLogs(false);
          fetchTelemetry(true);
        } else if (job.status === 'failed') {
          setLogJobStatus(`Ingest notice: ${job.error_message || 'Download error'}`);
          setPreparingLogs(false);
        } else {
          setLogJobStatus(`Status: ${job.error_message || `HCP log package is ${job.status}...`}`);
          setTimeout(() => pollLogJobStatus(jobId), 4000);
        }
      }
    } catch {
      setPreparingLogs(false);
    }
  };

  // Filtered and sorted Tenant Streams
  const filteredStreams = useMemo(() => {
    return tenantStreams
      .filter((s: any) => {
        const matchSearch =
          (s.tenant_name || '').toLowerCase().includes(streamSearch.toLowerCase()) ||
          (s.namespace_name || '').toLowerCase().includes(streamSearch.toLowerCase());
        if (!matchSearch) return false;

        if (statusMixFilter === 'errors') {
          return (s.share_5xx_percent > 0 || s.share_4xx_percent > 5);
        }
        if (statusMixFilter === 'clean') {
          return s.share_5xx_percent === 0;
        }
        return true;
      })
      .sort((a: any, b: any) => {
        let valA = 0;
        let valB = 0;
        if (sortField === 'requests') {
          valA = a.total_requests;
          valB = b.total_requests;
        } else if (sortField === 'latency') {
          valA = a.p95_latency_ms;
          valB = b.p95_latency_ms;
        } else if (sortField === 'bandwidth') {
          valA = (a.mb_in || 0) + (a.mb_out || 0);
          valB = (b.mb_in || 0) + (b.mb_out || 0);
        } else if (sortField === 'errors') {
          valA = (a.share_5xx_percent || 0) * 10 + (a.share_4xx_percent || 0);
          valB = (b.share_5xx_percent || 0) * 10 + (b.share_4xx_percent || 0);
        }
        return sortAsc ? valA - valB : valB - valA;
      });
  }, [tenantStreams, streamSearch, statusMixFilter, sortField, sortAsc]);

  const flaggedTenants = overviewData?.flagged_tenants || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* ── Subnav & Control Header ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px',
          padding: '16px 20px',
          borderRadius: '12px',
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)'
        }}
      >
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
            <Pulse size={20} aria-hidden="true" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Data Stream Telemetry {hcpEndpointName ? `(${hcpEndpointName})` : ''}
              </span>
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  background: 'rgba(59, 130, 246, 0.15)',
                  color: 'var(--accent)',
                  border: '1px solid rgba(59, 130, 246, 0.3)'
                }}
              >
                READ-ONLY MONITORING
              </span>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
              Read-only MAPI node statistics, non-mutating HTTP HEAD reachability checks, and access log telemetry. Zero write or configuration operations are performed on the platform.
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Time range selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.03)', padding: '2px 4px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            {[1, 6, 24, 48, 168].map(h => (
              <button
                key={h}
                type="button"
                onClick={() => setTimeRangeHours(h)}
                className={`filter-chip ${timeRangeHours === h ? 'active' : ''}`}
                style={{
                  fontSize: '11px',
                  padding: '4px 8px',
                  borderRadius: '6px',
                  fontWeight: timeRangeHours === h ? 600 : 400
                }}
              >
                {h === 1 ? '1h' : h === 6 ? '6h' : h === 24 ? '24h' : h === 48 ? '48h' : '7d'}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="secondary"
            onClick={() => fetchTelemetry(true)}
            disabled={refreshing || loading}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 12px' }}
            title="Refresh stream metrics"
          >
            <ArrowsClockwise size={13} className={refreshing ? 'spin' : ''} aria-hidden="true" />
            <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* ── Status Toast Banner (if any active action) ── */}
      {statusMessage && (
        <div
          style={{
            padding: '10px 16px',
            borderRadius: '8px',
            background: 'rgba(59, 130, 246, 0.1)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            color: 'var(--text-primary)',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <Pulse size={14} className="spin" color="var(--accent)" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* ── 4 Main Tabs ── */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '4px' }}>
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className={`filter-chip ${activeTab === 'overview' ? 'active' : ''}`}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: activeTab === 'overview' ? 600 : 500 }}
        >
          <ChartBar size={15} />
          <span>1. Platform Overview</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('streams')}
          className={`filter-chip ${activeTab === 'streams' ? 'active' : ''}`}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: activeTab === 'streams' ? 600 : 500 }}
        >
          <Stack size={15} />
          <span>2. Tenant &amp; Namespace Streams ({tenantStreams.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('nodes')}
          className={`filter-chip ${activeTab === 'nodes' ? 'active' : ''}`}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: activeTab === 'nodes' ? 600 : 500 }}
        >
          <HardDrives size={15} />
          <span>3. Node Health (Nodes 101-104)</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('investigation')}
          className={`filter-chip ${activeTab === 'investigation' ? 'active' : ''}`}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: activeTab === 'investigation' ? 600 : 500 }}
        >
          <Lightning size={15} />
          <span>4. Probes &amp; Investigation</span>
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          VIEW 1: PLATFORM OVERVIEW
      ═══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Top KPI Metric Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '14px' }}>
            {/* KPI 1: Requests Rate */}
            <div style={{ padding: '16px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Pulse size={14} color="var(--accent)" />
                <span>Request Rate</span>
              </div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                {overviewData?.traffic?.requests_per_sec !== undefined
                  ? `${overviewData.traffic.requests_per_sec} req/s`
                  : overviewData?.total_requests_per_sec !== undefined
                  ? `${overviewData.total_requests_per_sec} req/s`
                  : '0.00 req/s'}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                Window: last {timeRangeHours} hours
              </div>
            </div>

            {/* KPI 2: Status Mix Breakdown */}
            <div style={{ padding: '16px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Lightning size={14} color="var(--color-up)" />
                <span>Status Mix (2xx / 4xx / 5xx)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', fontVariantNumeric: 'tabular-nums' }}>
                <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--color-up)' }}>
                  {overviewData?.traffic?.share_2xx_percent ?? overviewData?.rate_2xx_percent ?? 100}%
                </span>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>/</span>
                <span style={{ fontSize: '16px', fontWeight: 600, color: (overviewData?.traffic?.share_4xx_percent ?? overviewData?.rate_4xx_percent ?? 0) > 0 ? 'var(--color-warning)' : 'var(--text-muted)' }}>
                  {overviewData?.traffic?.share_4xx_percent ?? overviewData?.rate_4xx_percent ?? 0}%
                </span>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>/</span>
                <span style={{ fontSize: '16px', fontWeight: 600, color: (overviewData?.traffic?.share_5xx_percent ?? overviewData?.rate_5xx_percent ?? 0) > 0 ? 'var(--color-down)' : 'var(--text-muted)' }}>
                  {overviewData?.traffic?.share_5xx_percent ?? overviewData?.rate_5xx_percent ?? 0}%
                </span>
              </div>
              {/* Mini Status Bar */}
              <div style={{ width: '100%', height: '5px', borderRadius: '3px', background: 'rgba(255,255,255,0.1)', overflow: 'hidden', display: 'flex', marginTop: '8px' }}>
                <div style={{ width: `${overviewData?.traffic?.share_2xx_percent ?? overviewData?.rate_2xx_percent ?? 100}%`, background: 'var(--color-up)' }} />
                <div style={{ width: `${overviewData?.traffic?.share_4xx_percent ?? overviewData?.rate_4xx_percent ?? 0}%`, background: 'var(--color-warning)' }} />
                <div style={{ width: `${overviewData?.traffic?.share_5xx_percent ?? overviewData?.rate_5xx_percent ?? 0}%`, background: 'var(--color-down)' }} />
              </div>
            </div>

            {/* KPI 3: Latency & Bandwidth */}
            <div style={{ padding: '16px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Clock size={14} color="var(--color-warning)" />
                <span>p95 Latency &amp; Bandwidth</span>
              </div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                {overviewData?.traffic?.duration_ms_p95 !== undefined
                  ? `${overviewData.traffic.duration_ms_p95} ms`
                  : overviewData?.p95_latency_ms !== undefined
                  ? `${overviewData.p95_latency_ms} ms`
                  : 'N/A'}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', fontVariantNumeric: 'tabular-nums' }}>
                Throughput: {overviewData?.cluster_nodes?.frontend_mb_per_sec ?? overviewData?.total_bandwidth_mb_sec ?? 0.0} MB/s
              </div>
            </div>

            {/* KPI 4: Synthetic Probes Pass Rate */}
            <div style={{ padding: '16px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <ShieldWarning size={14} color="var(--accent)" />
                <span>Synthetic Reachability</span>
              </div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: (overviewData?.probe?.pass_rate_percent ?? overviewData?.probe_pass_rate_percent ?? 100) >= 95 ? 'var(--color-up)' : 'var(--color-warning)', fontVariantNumeric: 'tabular-nums' }}>
                {overviewData?.probe?.pass_rate_percent !== undefined
                  ? `${overviewData.probe.pass_rate_percent}%`
                  : overviewData?.probe_pass_rate_percent !== undefined
                  ? `${overviewData.probe_pass_rate_percent}%`
                  : '100%'}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                {probesData?.total_probes ? `${probesData.total_probes} read-only HEAD checks` : 'No recent probe runs'}
              </div>
            </div>
          </div>

          {/* Alert Panel: Flagged Tenants (FR-5) */}
          <div
            style={{
              padding: '16px 20px',
              borderRadius: '10px',
              background: flaggedTenants.length > 0 ? 'rgba(239, 68, 68, 0.06)' : 'rgba(16, 185, 129, 0.05)',
              border: flaggedTenants.length > 0 ? '1px solid rgba(239, 68, 68, 0.25)' : '1px solid rgba(16, 185, 129, 0.2)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {flaggedTenants.length > 0 ? (
                  <Warning size={18} color="var(--color-down)" />
                ) : (
                  <CheckCircle size={18} color="var(--color-up)" />
                )}
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {flaggedTenants.length > 0
                    ? `Action Required: ${flaggedTenants.length} Tenant(s) Flagged (HTTP 403 / 5xx)`
                    : 'System Status: All Monitored Tenants & MAPI Endpoints Healthy'}
                </span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Rule FR-5: MAPI Permission &amp; Readability Sentinel
              </div>
            </div>

            {flaggedTenants.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                  Tenants where system-level credentials receive HTTP 403 (administrationAllowed=false) or 5xx server responses:
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px' }}>
                  {flaggedTenants.map((ft: any, idx: number) => {
                    const statusCode = ft.status_code || (ft.reason && ft.reason.includes('403') ? 403 : 503);
                    const tenantTitle = ft.tenant_name || ft.name || 'Tenant';
                    return (
                      <div
                        key={idx}
                        style={{
                          padding: '10px 14px',
                          borderRadius: '8px',
                          background: 'rgba(0,0,0,0.3)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between'
                        }}
                      >
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                            {tenantTitle}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            {ft.reason}
                          </div>
                        </div>
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: '4px',
                            background: statusCode === 403 ? 'rgba(245, 158, 11, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                            color: statusCode === 403 ? 'var(--color-warning)' : 'var(--color-down)'
                          }}
                        >
                          HTTP {statusCode}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                No permission blocks detected. System credentials can access all configured tenant statistics.
              </p>
            )}
          </div>

          {/* Quick Action Bar for MAPI Poll & Probes */}
          <div
            style={{
              padding: '16px 20px',
              borderRadius: '10px',
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px'
            }}
          >
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Read-Only Observability &amp; Pipeline Triggers
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Poll live MAPI node health or execute non-mutating HTTP HEAD reachability checks across monitored namespaces
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                type="button"
                className="secondary"
                onClick={handlePollNodesNow}
                disabled={pollingNodes}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
              >
                <Cpu size={14} className={pollingNodes ? 'spin' : ''} />
                <span>{pollingNodes ? 'Polling MAPI...' : 'Poll Nodes (Read-Only)'}</span>
              </button>

              <button
                type="button"
                className="primary"
                onClick={handleRunProbesNow}
                disabled={runningProbes}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
              >
                <Lightning size={14} className={runningProbes ? 'spin' : ''} />
                <span>{runningProbes ? 'Checking...' : 'Check Reachability (HEAD)'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          VIEW 2: TENANT & NAMESPACE DATA STREAMS
      ═══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'streams' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Filter Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px'
            }}
          >
            {/* Search Input */}
            <div style={{ position: 'relative', width: '280px' }}>
              <MagnifyingGlass size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search tenant or namespace..."
                value={streamSearch}
                onChange={e => setStreamSearch(e.target.value)}
                style={{
                  width: '100%',
                  padding: '7px 10px 7px 32px',
                  borderRadius: '8px',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                  fontSize: '13px'
                }}
              />
            </div>

            {/* Status Mix Filter & Sort */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.03)', padding: '2px 4px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <button
                  type="button"
                  onClick={() => setStatusMixFilter('all')}
                  className={`filter-chip ${statusMixFilter === 'all' ? 'active' : ''}`}
                  style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '6px' }}
                >
                  All Streams
                </button>
                <button
                  type="button"
                  onClick={() => setStatusMixFilter('errors')}
                  className={`filter-chip ${statusMixFilter === 'errors' ? 'active' : ''}`}
                  style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '6px' }}
                >
                  Has Errors (4xx/5xx)
                </button>
                <button
                  type="button"
                  onClick={() => setStatusMixFilter('clean')}
                  className={`filter-chip ${statusMixFilter === 'clean' ? 'active' : ''}`}
                  style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '6px' }}
                >
                  Clean (0% 5xx)
                </button>
              </div>

              {/* Sort By Dropdown */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <select
                  value={sortField}
                  onChange={e => setSortField(e.target.value as any)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '8px',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-primary)',
                    fontSize: '12px'
                  }}
                >
                  <option value="requests">Sort by: Requests</option>
                  <option value="latency">Sort by: p95 Latency</option>
                  <option value="bandwidth">Sort by: Bandwidth</option>
                  <option value="errors">Sort by: Error Rate</option>
                </select>

                <button
                  type="button"
                  className="secondary"
                  onClick={() => setSortAsc(!sortAsc)}
                  style={{ padding: '6px 8px' }}
                  title="Toggle Ascending/Descending"
                >
                  <ArrowsDownUp size={14} />
                </button>
              </div>
            </div>
          </div>

          {/* Streams Table */}
          <div style={{ overflowX: 'auto', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Tenant / Namespace</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Request Rate</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600, width: '220px' }}>Status Mix (2xx / 4xx / 5xx)</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>p50 / p95 Latency</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Bandwidth (In / Out)</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredStreams.length > 0 ? (
                  filteredStreams.map((s: any, idx: number) => {
                    const has5xx = (s.share_5xx_percent || 0) > 0;
                    const has4xx = (s.share_4xx_percent || 0) > 5;
                    return (
                      <tr
                        key={idx}
                        style={{
                          borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                          background: has5xx ? 'rgba(239, 68, 68, 0.03)' : 'transparent'
                        }}
                      >
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                            {s.namespace_name}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            Tenant: {s.tenant_name}
                          </div>
                        </td>

                        <td style={{ padding: '12px 16px', fontVariantNumeric: 'tabular-nums' }}>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                            {s.requests_per_sec} req/s
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            {(s.total_requests ?? 0).toLocaleString()} total
                          </div>
                        </td>

                        {/* Status Mix Bar */}
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px', fontVariantNumeric: 'tabular-nums' }}>
                            <span style={{ color: 'var(--color-up)' }}>{s.share_2xx_percent}%</span>
                            <span style={{ color: has4xx ? 'var(--color-warning)' : 'var(--text-muted)' }}>{s.share_4xx_percent}%</span>
                            <span style={{ color: has5xx ? 'var(--color-down)' : 'var(--text-muted)', fontWeight: has5xx ? 700 : 400 }}>{s.share_5xx_percent}%</span>
                          </div>
                          <div style={{ width: '100%', height: '6px', borderRadius: '3px', background: 'rgba(255,255,255,0.1)', overflow: 'hidden', display: 'flex' }}>
                            <div style={{ width: `${s.share_2xx_percent}%`, background: 'var(--color-up)' }} />
                            <div style={{ width: `${s.share_4xx_percent}%`, background: 'var(--color-warning)' }} />
                            <div style={{ width: `${s.share_5xx_percent}%`, background: 'var(--color-down)' }} />
                          </div>
                        </td>

                        <td style={{ padding: '12px 16px', fontVariantNumeric: 'tabular-nums' }}>
                          <div style={{ color: 'var(--text-primary)' }}>
                            {s.p50_latency_ms} ms <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>(p50)</span>
                          </div>
                          <div style={{ fontSize: '11px', color: s.p95_latency_ms > 200 ? 'var(--color-warning)' : 'var(--text-muted)' }}>
                            {s.p95_latency_ms} ms <span style={{ color: 'var(--text-muted)' }}>(p95)</span>
                          </div>
                        </td>

                        <td style={{ padding: '12px 16px', fontVariantNumeric: 'tabular-nums' }}>
                          <div style={{ color: 'var(--text-primary)' }}>
                            In: {s.mb_in} MB
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            Out: {s.mb_out} MB
                          </div>
                        </td>

                        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => {
                              // Trigger probe specifically for this namespace
                              fetch(`${apiUrl}/api/hcp/${selectedHcpId}/stream/probes/run?tenant_name=${encodeURIComponent(s.tenant_name)}&namespace_name=${encodeURIComponent(s.namespace_name)}`, {
                                method: 'POST',
                                headers: authHeaders
                              }).then(() => fetchTelemetry(true));
                            }}
                            style={{ fontSize: '11px', padding: '4px 8px' }}
                            title="Run non-mutating HTTP HEAD reachability probe on this namespace"
                          >
                            Check HEAD
                          </button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      {loading ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                          <Pulse size={16} className="spin" />
                          <span>Loading namespace data streams...</span>
                        </div>
                      ) : (
                        <div>
                          <Stack size={24} style={{ opacity: 0.4, marginBottom: '8px' }} />
                          <div>No access log stream aggregates available for the selected period.</div>
                          <div style={{ fontSize: '11px', marginTop: '4px' }}>
                            Prepare an access log package via tab 4 or wait for scheduled log ingestion.
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          VIEW 3: NODE HEALTH (NODES 101–104)
      ═══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'nodes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Cluster Summary Header */}
          <div
            style={{
              padding: '16px 20px',
              borderRadius: '10px',
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '16px'
            }}
          >
            <div>
              <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
                HCP Node Telemetry &amp; Load Balancing (Nodes 101-104)
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Direct read-only MAPI poll from /mapi/nodes/statistics: CPU, I/O wait, active HTTP/S sockets, and front-end network traffic
              </div>
            </div>

            <button
              type="button"
              className="primary"
              onClick={handlePollNodesNow}
              disabled={pollingNodes}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
            >
              <ArrowsClockwise size={14} className={pollingNodes ? 'spin' : ''} />
              <span>{pollingNodes ? 'Polling MAPI...' : 'Poll Nodes (Read-Only)'}</span>
            </button>
          </div>

          {/* Node Cards Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            {(nodesData?.nodes || []).map((node: any, idx: number) => {
              const cpuTotal = node.cpu_total || (node.cpu_user || 0) + (node.cpu_system || 0);
              const isHighCpu = cpuTotal > 75;
              const isHighIo = (node.io_wait || 0) > 20;

              return (
                <div
                  key={idx}
                  style={{
                    padding: '18px',
                    background: 'var(--panel)',
                    borderRadius: 'var(--radius-md)',
                    border: (isHighCpu || isHighIo) ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid var(--border)'
                  }}
                >
                  {/* Card Header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <HardDrives size={18} color="var(--accent)" />
                      <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
                        Node {node.node_number}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: '11px',
                        padding: '3px 8px',
                        borderRadius: '4px',
                        background: 'rgba(16, 185, 129, 0.15)',
                        color: 'var(--color-up)',
                        fontWeight: 600
                      }}
                    >
                      ONLINE
                    </span>
                  </div>

                  {/* Address */}
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '16px', fontFamily: 'monospace' }}>
                    {node.node_address || `10.200.0.${node.node_number}`}
                  </div>

                  {/* CPU Metric with Progress Bar */}
                  <div style={{ marginBottom: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                      <span style={{ color: 'var(--text-muted)' }}>CPU Utilization</span>
                      <span style={{ fontWeight: 600, color: isHighCpu ? 'var(--color-down)' : 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                        {cpuTotal.toFixed(1)}% (usr: {(node.cpu_user || 0).toFixed(1)}%, sys: {(node.cpu_system || 0).toFixed(1)}%)
                      </span>
                    </div>
                    <div style={{ width: '100%', height: '6px', borderRadius: '3px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${Math.min(100, cpuTotal)}%`,
                          height: '100%',
                          background: isHighCpu ? 'var(--color-down)' : 'var(--accent)'
                        }}
                      />
                    </div>
                  </div>

                  {/* I/O Wait Metric with Progress Bar */}
                  <div style={{ marginBottom: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                      <span style={{ color: 'var(--text-muted)' }}>I/O Wait</span>
                      <span style={{ fontWeight: 600, color: isHighIo ? 'var(--color-warning)' : 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                        {(node.io_wait || 0).toFixed(1)}%
                      </span>
                    </div>
                    <div style={{ width: '100%', height: '6px', borderRadius: '3px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${Math.min(100, (node.io_wait || 0) * 2)}%`,
                          height: '100%',
                          background: isHighIo ? 'var(--color-warning)' : 'rgba(59, 130, 246, 0.7)'
                        }}
                      />
                    </div>
                  </div>

                  {/* Connection & Network Throughput */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Connections</div>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                        {node.total_connections ?? (node.open_http_connections || 0) + (node.open_https_connections || 0)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Frontend MB/s</div>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                        {node.frontend_mb_per_sec !== undefined ? `${node.frontend_mb_per_sec} MB/s` : '0.00 MB/s'}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {(!nodesData?.nodes || nodesData.nodes.length === 0) && (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <HardDrives size={32} style={{ opacity: 0.4, marginBottom: '8px' }} />
              <div>No live node statistics recorded yet.</div>
              <button
                type="button"
                className="primary"
                onClick={handlePollNodesNow}
                style={{ marginTop: '12px' }}
              >
                Poll Nodes Now
              </button>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          VIEW 4: SYNTHETIC PROBES & ACCESS LOG INVESTIGATION
      ═══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'investigation' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Synthetic Probes Section */}
          <div
            style={{
              padding: '20px',
              borderRadius: '12px',
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <ShieldWarning size={18} color="var(--accent)" />
                  <span>Read-Only Synthetic Probes (HTTP HEAD Only)</span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Continuous non-mutating HEAD requests to verify namespace reachability and measure network latency without writing, modifying, or deleting any data on the platform
                </div>
              </div>

              <button
                type="button"
                className="primary"
                onClick={handleRunProbesNow}
                disabled={runningProbes}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
              >
                <Lightning size={14} className={runningProbes ? 'spin' : ''} />
                <span>{runningProbes ? 'Checking...' : 'Check Reachability (HEAD)'}</span>
              </button>
            </div>

            {/* Recent Probe History Table */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '8px 12px' }}>Timestamp</th>
                    <th style={{ padding: '8px 12px' }}>Tenant / Namespace</th>
                    <th style={{ padding: '8px 12px' }}>Operation</th>
                    <th style={{ padding: '8px 12px' }}>Status</th>
                    <th style={{ padding: '8px 12px' }}>Latency</th>
                    <th style={{ padding: '8px 12px' }}>Diagnostics</th>
                  </tr>
                </thead>
                <tbody>
                  {(probesData?.probes || []).slice(0, 8).map((p: any, idx: number) => {
                    const isOk = p.success || p.status_code === 200;
                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '8px 12px', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                          {p?.timestamp ? new Date(p.timestamp).toLocaleString(undefined, {
                            month: 'short',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                            hour12: false
                          }) : '-'}
                        </td>
                        <td style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {p.tenant_name} / {p.namespace_name}
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <span style={{ padding: '2px 6px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', fontFamily: 'monospace' }}>
                            {p.operation}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <span
                            style={{
                              padding: '2px 6px',
                              borderRadius: '4px',
                              background: isOk ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                              color: isOk ? 'var(--color-up)' : 'var(--color-down)',
                              fontWeight: 700
                            }}
                          >
                            HTTP {p.status_code}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', fontVariantNumeric: 'tabular-nums' }}>
                          {p.latency_ms} ms
                        </td>
                        <td style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: '11px' }}>
                          {p.error_message || (p.status_code === 403 ? 'Restricted by tenant configuration (FR-5)' : 'Endpoint OK')}
                        </td>
                      </tr>
                    );
                  })}
                  {(!probesData?.probes || probesData.probes.length === 0) && (
                    <tr>
                      <td colSpan={6} style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        No synthetic probe runs recorded. Click &quot;Run Probes Now&quot; to test.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Access Log Packaging Trigger Banner (FR-7) */}
          <div
            style={{
              padding: '16px 20px',
              borderRadius: '10px',
              background: 'rgba(59, 130, 246, 0.05)',
              border: '1px solid rgba(59, 130, 246, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px'
            }}
          >
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <CloudArrowDown size={16} color="var(--accent)" />
                <span>Asynchronous Access Log Ingest Pipeline</span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {logJobStatus || 'Packages recent HCP node access logs via POST /mapi/logs/prepare and parses 4xx/413 error paths'}
              </div>
            </div>

            <button
              type="button"
              className="secondary"
              onClick={handlePrepareLogs}
              disabled={preparingLogs}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
            >
              <CloudArrowDown size={14} className={preparingLogs ? 'spin' : ''} />
              <span>{preparingLogs ? 'Processing...' : 'Prepare Access Logs'}</span>
            </button>
          </div>

          {/* Investigation Grid: Top Clients & 4xx Errors */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
            {/* Top Clients by Volume & Errors */}
            <div style={{ padding: '16px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Pulse size={16} color="var(--accent)" />
                <span>Top Clients by Requests &amp; Errors</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {(investigationData?.top_clients || []).slice(0, 6).map((c: any, idx: number) => (
                  <div
                    key={idx}
                    style={{
                      padding: '8px 12px',
                      borderRadius: '6px',
                      background: 'rgba(255,255,255,0.03)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '12px'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                        {c.client_ip}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {(c.requests ?? c.total_requests ?? 0).toLocaleString()} requests
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: (c.errors ?? c.error_requests ?? 0) > 0 ? 'var(--color-down)' : 'var(--color-up)', fontWeight: 600 }}>
                        {c.errors ?? c.error_requests ?? 0} errors
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {c.error_rate_percent ?? 0}% error rate
                      </div>
                    </div>
                  </div>
                ))}
                {(!investigationData?.top_clients || investigationData.top_clients.length === 0) && (
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '16px' }}>
                    No client IP records available. Ingest logs to populate.
                  </div>
                )}
              </div>
            </div>

            {/* 4xx & 413 Error Breakdown by Path (FR-7) */}
            <div style={{ padding: '16px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Warning size={16} color="var(--color-warning)" />
                <span>4xx &amp; 413 Error Breakdown by Path</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {(investigationData?.errors_4xx_breakdown || []).slice(0, 6).map((err: any, idx: number) => (
                  <div
                    key={idx}
                    style={{
                      padding: '8px 12px',
                      borderRadius: '6px',
                      background: 'rgba(245, 158, 11, 0.05)',
                      border: '1px solid rgba(245, 158, 11, 0.2)',
                      fontSize: '12px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                        {err.path}
                      </span>
                      <span style={{ fontWeight: 700, color: 'var(--color-warning)' }}>
                        {err.count}x
                      </span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      User: {err.user_name || 'anonymous'} • Reason: {err.reason}
                    </div>
                  </div>
                ))}
                {(!investigationData?.errors_4xx_breakdown || investigationData.errors_4xx_breakdown.length === 0) && (
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '16px' }}>
                    No 4xx/413 error clusters detected in recent logs.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Slowest Transfers with Throughput MB/s (FR-8) */}
          <div style={{ padding: '16px', overflowX: 'auto', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Clock size={16} color="var(--accent)" />
              <span>Slowest Transfers with Throughput (FR-8: Computed MB/s)</span>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '8px 12px' }}>Client IP</th>
                  <th style={{ padding: '8px 12px' }}>Tenant / Namespace</th>
                  <th style={{ padding: '8px 12px' }}>Target Path</th>
                  <th style={{ padding: '8px 12px' }}>Duration</th>
                  <th style={{ padding: '8px 12px' }}>Transferred</th>
                  <th style={{ padding: '8px 12px' }}>Throughput (MB/s)</th>
                </tr>
              </thead>
              <tbody>
                {(investigationData?.slowest_transfers || []).slice(0, 6).map((t: any, idx: number) => (
                  <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>{t.client_ip}</td>
                    <td style={{ padding: '8px 12px', fontWeight: 600 }}>{t.tenant_name}/{t.namespace_name}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--text-muted)', fontFamily: 'monospace', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.path}
                    </td>
                    <td style={{ padding: '8px 12px', fontVariantNumeric: 'tabular-nums' }}>{t.duration_sec ?? 0}s</td>
                    <td style={{ padding: '8px 12px', fontVariantNumeric: 'tabular-nums' }}>
                      {((t.bytes_transferred ?? (t.mb_transferred ? t.mb_transferred * 1024 * 1024 : 0)) / (1024 * 1024)).toFixed(2)} MB
                    </td>
                    <td style={{ padding: '8px 12px', fontWeight: 600, color: (t.mb_per_sec ?? t.effective_mb_per_sec ?? 0) < 1.0 ? 'var(--color-warning)' : 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                      {(t.mb_per_sec ?? t.effective_mb_per_sec ?? 0).toFixed(2)} MB/s
                    </td>
                  </tr>
                ))}
                {(!investigationData?.slowest_transfers || investigationData.slowest_transfers.length === 0) && (
                  <tr>
                    <td colSpan={6} style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      No slow transfer records captured.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default HcpDataStreamDashboard;
