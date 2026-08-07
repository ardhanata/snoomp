import React, { useState, useEffect, useRef } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import {
  Shield, Power, Trash2, Edit3, Plus,
  Search, Cpu, HardDrive, MemoryStick, Clock,
  Zap, Globe, Copy, ExternalLink, X,
  LayoutDashboard, Pencil, Check, ChevronDown, FileText,
  Database, RefreshCw, Server, Activity, Sun, Moon, TrendingUp, Sliders,
  CheckSquare
} from 'lucide-react';

import './styles/dashboard.css';
import RadialGauge from './components/RadialGauge';
import PublicStatusPage from './components/PublicStatusPage';
import MonitorModal from './components/MonitorModal';
import BatchEditModal from './components/BatchEditModal';
import { SnoompLogo } from './components/SnoompLogo';
import ExecutiveDashboard from './components/ExecutiveDashboard';
import UserPreferencesModal, { UserPreferences, SlaConfig } from './components/UserPreferencesModal';

const API_URL = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:8000`;
const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL  = import.meta.env.VITE_WS_URL  || `${WS_PROTOCOL}//${window.location.hostname}:8000`;

// ── Accent palette ──
const ACCENT_COLORS = [
  { hex: '#3b82f6', name: 'Azure Blue' },
  { hex: '#34a853', name: 'Emerald Green' },
  { hex: '#06b6d4', name: 'Cyan Tech' },
  { hex: '#8b5cf6', name: 'Purple Ray' },
];

// ── Helpers ──
function uptimeBadgeClass(pct: number, slaConfig?: SlaConfig): string {
  const normal = slaConfig?.normal ?? 99.9;
  const warning = slaConfig?.warning ?? 99.0;
  const critical = slaConfig?.critical ?? 95.0;
  if (pct >= normal)   return 'excellent';
  if (pct >= warning)  return 'good';
  if (pct >= critical) return 'warning';
  if (pct > 0)          return 'critical';
  return 'unknown';
}

function applyAccent(color: string) {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  document.documentElement.style.setProperty('--accent', color);
  document.documentElement.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
  document.documentElement.style.setProperty('--accent-glow', `rgba(${r},${g},${b},0.2)`);
  document.documentElement.style.setProperty('--accent-dim',  `rgba(${r},${g},${b},0.1)`);
}

// ── Status Page Types ──
interface StatusPageData {
  id: string;
  name: string;
  slug: string;
  description?: string;
  monitor_ids: string[];
  is_public: boolean;
  logo_url?: string;
}

interface StatusPageForm {
  name: string;
  slug: string;
  description: string;
  monitor_ids: string[];
  is_public: boolean;
}

const DEFAULT_SP_FORM: StatusPageForm = {
  name: '', slug: '', description: '', monitor_ids: [], is_public: true
};

// ══════════════════════════════════════════
//  MAIN APP
// ══════════════════════════════════════════
function App() {
  // ── Accent ──
  const [accentColor, setAccentColor] = useState(() => localStorage.getItem('snoomp_accent') || '#3b82f6');
  const changeAccent = (color: string) => {
    setAccentColor(color);
    localStorage.setItem('snoomp_accent', color);
    applyAccent(color);
  };
  useEffect(() => { applyAccent(accentColor); }, []); // eslint-disable-line

  // ── Auth ──
  const [token,     setToken]     = useState<string | null>(() => localStorage.getItem('snoomp_token'));
  const [role,      setRole]      = useState<string | null>(() => localStorage.getItem('snoomp_role'));
  const [username,  setUsername]  = useState('');
  const [password,  setPassword]  = useState('');
  const [authError, setAuthError] = useState('');

  // ── Theme ──
  const [theme, setTheme] = useState(() => localStorage.getItem('snoomp_theme') || 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('snoomp_theme', theme);
  }, [theme]);

  // ── View state ──
  const [view, setView] = useState<'dashboard' | 'status-pages' | 'executive'>('dashboard');
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showPreferencesModal, setShowPreferencesModal] = useState(false);
  const [appVersion, setAppVersion] = useState('v0.2.1');
  const profileMenuRef = useRef<HTMLDivElement>(null);

  const fetchVersion = async () => {
    try {
      const res = await fetch(`${API_URL}/api/version`);
      if (res.ok) {
        const data = await res.json();
        if (data.version) setAppVersion(`v${data.version}`);
      }
    } catch {}
  };

  useEffect(() => {
    fetchVersion();
  }, []);

  useEffect(() => {
    if (!showProfileMenu) return;
    const handleDocumentClick = (e: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setShowProfileMenu(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowProfileMenu(false);
    };
    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('click', handleDocumentClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showProfileMenu]);
  
  const [userPreferences, setUserPreferences] = useState<UserPreferences>(() => ({
    sla: {
      normal: parseFloat(localStorage.getItem('snoomp_sla_normal') || '99.9'),
      warning: parseFloat(localStorage.getItem('snoomp_sla_warning') || '99.0'),
      critical: parseFloat(localStorage.getItem('snoomp_sla_critical') || '95.0'),
    },
    theme: localStorage.getItem('snoomp_theme') || 'dark',
    accent: localStorage.getItem('snoomp_accent') || '#3b82f6',
    soundAlerts: localStorage.getItem('snoomp_sound_alerts') === 'true',
    browserNotifications: localStorage.getItem('snoomp_browser_notifications') === 'true',
    defaultCheckInterval: parseInt(localStorage.getItem('snoomp_default_check_interval') || '60', 10),
    timeFormat: (localStorage.getItem('snoomp_time_format') as any) || '24h',
  }));

  const handleSaveUserPreferences = (newPrefs: UserPreferences) => {
    setUserPreferences(newPrefs);
    setTheme(newPrefs.theme);
    applyAccent(newPrefs.accent);

    localStorage.setItem('snoomp_sla_normal', newPrefs.sla.normal.toString());
    localStorage.setItem('snoomp_sla_warning', newPrefs.sla.warning.toString());
    localStorage.setItem('snoomp_sla_critical', newPrefs.sla.critical.toString());
    localStorage.setItem('snoomp_theme', newPrefs.theme);
    localStorage.setItem('snoomp_accent', newPrefs.accent);
    localStorage.setItem('snoomp_sound_alerts', newPrefs.soundAlerts.toString());
    localStorage.setItem('snoomp_browser_notifications', newPrefs.browserNotifications.toString());
    localStorage.setItem('snoomp_default_check_interval', newPrefs.defaultCheckInterval.toString());
    localStorage.setItem('snoomp_time_format', newPrefs.timeFormat);
  };

  // ── Dashboard ──
  const [monitors,        setMonitors]        = useState<any[]>([]);
  const [selectedMonitor, setSelectedMonitor] = useState<any>(null);
  const [stats,           setStats]           = useState<any>({
    total_targets: 0, status_summary: { up: 0, down: 0, warning: 0, critical: 0 }
  });
  const [heartbeats,     setHeartbeats]     = useState<any[]>([]);
  const [metricsHistory, setMetricsHistory] = useState<any[]>([]);
  const [resourceHours, setResourceHours]   = useState<number>(24);
  const [dbEngineStatus, setDbEngineStatus] = useState<any>(null);
  const [dbEngineLoading, setDbEngineLoading] = useState(false);
  const [dbActiveTab, setDbActiveTab] = useState<'slow_queries' | 'tables' | 'tablespaces'>('slow_queries');
  const [incidents,      setIncidents]      = useState<any[]>([]);
  const [searchTerm,       setSearchTerm]       = useState('');
  const [selectedGroupTag, setSelectedGroupTag] = useState<string | null>(null);
  const [selectedEnvTag,   setSelectedEnvTag]   = useState<string | null>(null);

  // ── Batch Operation & Tag Management States ──
  const [isBatchMode,          setIsBatchMode]          = useState(false);
  const [selectedMonitorIds,   setSelectedMonitorIds]   = useState<string[]>([]);
  const [isBatchEditModalOpen, setIsBatchEditModalOpen] = useState(false);

  // ── Monitor Modal ──
  const [isModalOpen,    setIsModalOpen]    = useState(false);
  const [editingMonitor, setEditingMonitor] = useState<any>(null);

  // ── Status Pages ──
  const [statusPages,   setStatusPages]   = useState<StatusPageData[]>([]);
  const [showSpModal,   setShowSpModal]   = useState(false);
  const [editingPage,   setEditingPage]   = useState<StatusPageData | null>(null);
  const [spForm,        setSpForm]        = useState<StatusPageForm>(DEFAULT_SP_FORM);
  const [spSaving,      setSpSaving]      = useState(false);
  const [copiedSlug,    setCopiedSlug]    = useState<string | null>(null);
  const [spSearch,      setSpSearch]      = useState('');

  // ── Grouping ──
  const [groupBy, setGroupBy] = useState<'none' | 'tags' | 'type'>((localStorage.getItem('snoomp_group_by') as 'none' | 'tags' | 'type') || (localStorage.getItem('snoomp_group_by_tags') === 'true' ? 'tags' : 'none'));
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);

  // ── Availability Reports ──
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportTarget, setReportTarget] = useState<any>(null);
  const [reportRange, setReportRange] = useState<number>(168); // Hours: 24, 168 (7d), 720 (30d), 2160 (90d)
  const [reportData, setReportData] = useState<any>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [isPrintingReport, setIsPrintingReport] = useState(false);

  const handleGenerateReport = async (target: any, hours: number) => {
    setReportTarget(target);
    setReportRange(hours);
    setReportLoading(true);
    setShowReportModal(true);
    
    try {
      // Calculate limit based on interval and range to get all heartbeats in range
      const intervalSec = target.check_interval || 60;
      const hoursSec = hours * 3600;
      const limit = Math.ceil(hoursSec / intervalSec) + 100; // Add extra buffer
      
      const res = await fetch(`${API_URL}/api/dashboard/targets/${target.id}/heartbeats?limit=${limit}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (res.ok) {
        const hbs = await res.json() as any[];
        
        // Filter heartbeats strictly within the time range
        const cutoff = Date.now() - (hours * 3600 * 1000);
        const filteredHbs = hbs.filter(h => new Date(h.checked_at).getTime() >= cutoff);
        
        const total = filteredHbs.length || 1;
        const ups = filteredHbs.filter(h => h.status === 'up').length;
        const downs = filteredHbs.filter(h => h.status === 'down' || h.status === 'critical').length;
        
        const uptimePct = (ups / total) * 100;
        const downtimePct = 100 - uptimePct;
        const totalDowntimeSec = downs * intervalSec;
        
        // Estimate MTBF / MTTR
        // Find state changes to count failures
        let failures = 0;
        let lastStatus = 'up';
        filteredHbs.forEach(h => {
          if (h.status !== lastStatus) {
            if (h.status === 'down' || h.status === 'critical') failures++;
            lastStatus = h.status;
          }
        });
        
        const mttrMin = failures > 0 ? Math.round((totalDowntimeSec / 60) / failures) : 0;
        const mtbfHours = failures > 0 ? Math.round(((total - downs) * intervalSec / 3600) / failures) : hours;

        // Group downtime events for table
        const downtimeLogs: any[] = [];
        let currentOutage: any = null;
        
        // Sort ascending to trace timelines
        const sortedHbs = [...filteredHbs].sort((a, b) => new Date(a.checked_at).getTime() - new Date(b.checked_at).getTime());
        
        sortedHbs.forEach(h => {
          const isDown = h.status === 'down' || h.status === 'critical';
          if (isDown) {
            if (!currentOutage) {
              currentOutage = { started: new Date(h.checked_at), ended: null, error: h.error };
            }
          } else {
            if (currentOutage) {
              currentOutage.ended = new Date(h.checked_at);
              downtimeLogs.push(currentOutage);
              currentOutage = null;
            }
          }
        });
        if (currentOutage) {
          currentOutage.ended = new Date();
          downtimeLogs.push(currentOutage);
        }

        setReportData({
          uptimePct,
          downtimePct,
          totalDowntimeSec,
          failures,
          mttrMin,
          mtbfHours,
          downtimeLogs: downtimeLogs.reverse(), // latest first
          totalChecks: total
        });
      }
    } catch (err) {
      console.error(err);
    }
    setReportLoading(false);
  };

  const wsRef = useRef<WebSocket | null>(null);

  // ── Manual refresh ──
  const handleRefreshMonitor = async (id: string) => {
    try {
      const res = await fetch(`${API_URL}/api/targets/${encodeURIComponent(id)}/refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        alert('Check request sent to background queue.');
      } else {
        alert('Failed to trigger check.');
      }
    } catch {
      alert('Failed to connect to server.');
    }
  };

  // ── Auth handlers ──
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault(); setAuthError('');
    try {
      const fd = new URLSearchParams();
      fd.append('username', username); fd.append('password', password);
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: fd,
      });
      if (res.ok) {
        const d = await res.json();
        localStorage.setItem('snoomp_token', d.access_token);
        localStorage.setItem('snoomp_role',  d.role);
        setToken(d.access_token); setRole(d.role);
      } else {
        const err = await res.json();
        setAuthError(err.detail || 'Invalid credentials');
      }
    } catch { setAuthError('Connection failed'); }
  };

  const handleLogout = () => {
    localStorage.removeItem('snoomp_token'); localStorage.removeItem('snoomp_role');
    setToken(null); setRole(null); wsRef.current?.close();
  };

  // ── Fetch helpers ──
  const authHeaders = () => ({ Authorization: `Bearer ${token}` });

  const handleApiResponseError = async (res: Response, defaultMsg: string = 'Operation failed') => {
    if (res.status === 401) {
      handleLogout();
      alert('Session expired or invalid credentials. Please log in again.');
      return true;
    }
    const e = await res.json().catch(() => ({}));
    alert(`Error: ${e.detail || defaultMsg}`);
    return false;
  };

  const fetchStatsAndIncidents = async () => {
    if (!token) return;
    try {
      const [sRes, iRes] = await Promise.all([
        fetch(`${API_URL}/api/dashboard/stats`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/dashboard/incidents?limit=15`, { headers: authHeaders() }),
      ]);
      if (sRes.status === 401 || iRes.status === 401) { handleLogout(); return; }
      if (sRes.ok) setStats(await sRes.json());
      if (iRes.ok) setIncidents(await iRes.json());
    } catch {}
  };

  const fetchDbEngineStatus = async (id: string) => {
    setDbEngineLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/dashboard/targets/${id}/db-engine-status`, { headers: authHeaders() });
      if (res.status === 401) { handleLogout(); return; }
      if (res.ok) {
        setDbEngineStatus(await res.json());
      } else {
        setDbEngineStatus(null);
      }
    } catch {
      setDbEngineStatus(null);
    }
    setDbEngineLoading(false);
  };

  const fetchMonitorDetails = async (id: string, type: string, hours: number = resourceHours) => {
    if (!token) return;
    try {
      const hbRes = await fetch(`${API_URL}/api/dashboard/targets/${id}/heartbeats?limit=60`, { headers: authHeaders() });
      if (hbRes.status === 401) { handleLogout(); return; }
      if (hbRes.ok) setHeartbeats(await hbRes.json());
      
      const isDb = ['db', 'mongodb', 'redis'].includes(type.toLowerCase());
      if (['snmp', 'ssh', 'push', 'db', 'mongodb', 'redis'].includes(type.toLowerCase())) {
        const mRes = await fetch(`${API_URL}/api/dashboard/targets/${id}/metrics?hours=${hours}`, { headers: authHeaders() });
        if (mRes.ok) setMetricsHistory(await mRes.json());
      } else { 
        setMetricsHistory([]); 
      }
      
      setDbEngineStatus(null);
      
      if (isDb) {
        fetchDbEngineStatus(id);
      }
    } catch {}
  };

  const handleResourceHoursChange = (hours: number) => {
    setResourceHours(hours);
    if (selectedMonitor?.id) {
      fetchMonitorDetails(selectedMonitor.id, selectedMonitor.type, hours);
    }
  };

  const fetchStatusPages = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/status-pages/`, { headers: authHeaders() });
      if (res.status === 401) { handleLogout(); return; }
      if (res.ok) setStatusPages(await res.json());
    } catch {}
  };

  const [wsStatus, setWsStatus] = useState<'connected' | 'reconnecting' | 'disconnected'>('disconnected');
  const statsDebounceRef = useRef<any>(null);

  const debouncedFetchStatsAndIncidents = () => {
    if (statsDebounceRef.current) return;
    statsDebounceRef.current = setTimeout(() => {
      fetchStatsAndIncidents();
      statsDebounceRef.current = null;
    }, 1500);
  };

  // ── WebSocket & Data Fetching ──
  useEffect(() => {
    fetchVersion();
    if (!token) return;
    fetchMonitorsDirectly();
    fetchStatsAndIncidents();
    fetchStatusPages();

    let isMounted = true;
    let retryDelay = 1000;
    let reconnectTimeout: any = null;

    const connectWebSocket = () => {
      if (!isMounted) return;
      setWsStatus('reconnecting');

      const wsToken = localStorage.getItem('snoomp_token');
      const ws = new WebSocket(`${WS_URL}/api/ws${wsToken ? `?token=${wsToken}` : ''}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isMounted) return;
        setWsStatus('connected');
        retryDelay = 1000;
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'initial_state') {
            const monitorData = msg.data || msg.targets || [];
            if (Array.isArray(monitorData)) {
              setMonitors(monitorData);
            }
          } else if (msg.type === 'target_update' || msg.type === 'target_updated') {
            const u = msg.data || msg.target;
            if (!u) return;
            const targetId = u.target_id || u.id;
            setMonitors(prev => prev.map(m => m.id === targetId
              ? {
                  ...m,
                  status: u.status ?? m.status,
                  response_time_ms: u.response_time_ms ?? m.response_time_ms,
                  error: u.error ?? m.error,
                  metrics: u.metrics ?? m.metrics,
                  recent_heartbeats: u.status
                    ? [{ status: u.status }, ...(m.recent_heartbeats || [])].slice(0, 30)
                    : m.recent_heartbeats,
                }
              : m
            ));
            setSelectedMonitor((prev: any) => (prev && prev.id === targetId ? { ...prev, status: u.status ?? prev.status, response_time_ms: u.response_time_ms ?? prev.response_time_ms, error: u.error ?? prev.error, metrics: u.metrics ?? prev.metrics } : prev));
            debouncedFetchStatsAndIncidents();
          }
        } catch {}
      };

      ws.onclose = () => {
        if (!isMounted) return;
        setWsStatus('reconnecting');
        reconnectTimeout = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 2, 30000);
          connectWebSocket();
        }, retryDelay);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connectWebSocket();

    return () => {
      isMounted = false;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (wsRef.current) wsRef.current.close();
    };
  }, [token]);

  // Sync selected monitor on initial selection
  useEffect(() => {
    if (!selectedMonitor?.id) return;
    fetchMonitorDetails(selectedMonitor.id, selectedMonitor.type, resourceHours);
  }, [selectedMonitor?.id]); // eslint-disable-line

  // ── CRUD monitors ──
  const handleSaveMonitor = async (data: any) => {
    try {
      const h = { 'Content-Type': 'application/json', ...authHeaders() };
      const method = editingMonitor ? 'PUT' : 'POST';
      const url    = editingMonitor ? `${API_URL}/api/targets/${encodeURIComponent(editingMonitor.id)}` : `${API_URL}/api/targets`;
      const res = await fetch(url, { method, headers: h, body: JSON.stringify(data) });
      if (res.ok) { setIsModalOpen(false); setEditingMonitor(null); fetchStatsAndIncidents(); }
      else { await handleApiResponseError(res, 'Failed to save monitor'); }
    } catch { alert('Failed to save monitor.'); }
  };

  const handleToggleMonitor = async (m: any) => {
    try {
      const h = { 'Content-Type': 'application/json', ...authHeaders() };
      const p = { name: m.name, type: m.type, host: m.host, port: m.port, path: m.path, check_interval: m.check_interval, enabled: !m.enabled, tags: m.tags, config_json: m.config_json };
      const res = await fetch(`${API_URL}/api/targets/${encodeURIComponent(m.id)}`, { method: 'PUT', headers: h, body: JSON.stringify(p) });
      if (res.ok) fetchStatsAndIncidents();
      else if (res.status === 401) handleLogout();
    } catch {}
  };

  const handleDeleteMonitor = async (id: string) => {
    if (!window.confirm('Delete this monitor?')) return;
    try {
      const res = await fetch(`${API_URL}/api/targets/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() });
      if (res.ok) { setSelectedMonitor(null); fetchStatsAndIncidents(); }
      else if (res.status === 401) handleLogout();
    } catch {}
  };

  const fetchMonitorsDirectly = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/targets/`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setMonitors(data);
      } else if (res.status === 401) {
        handleLogout();
      }
    } catch {}
  };

  // ── CRUD Status Pages ──
  const openSpModal = (page?: StatusPageData) => {
    if (monitors.length === 0) {
      fetchMonitorsDirectly();
    }
    if (page) {
      setEditingPage(page);
      setSpForm({ name: page.name, slug: page.slug, description: page.description || '', monitor_ids: page.monitor_ids, is_public: page.is_public });
    } else {
      setEditingPage(null);
      setSpForm(DEFAULT_SP_FORM);
    }
    setSpSearch('');
    setShowSpModal(true);
  };

  const handleSaveStatusPage = async () => {
    if (!spForm.name || !spForm.slug) { alert('Name and slug are required.'); return; }
    setSpSaving(true);
    try {
      const h = { 'Content-Type': 'application/json', ...authHeaders() };
      const method = editingPage ? 'PUT' : 'POST';
      const url    = editingPage ? `${API_URL}/api/status-pages/${editingPage.id}` : `${API_URL}/api/status-pages/`;
      const res = await fetch(url, { method, headers: h, body: JSON.stringify(spForm) });
      if (res.ok) { await fetchStatusPages(); setShowSpModal(false); }
      else { await handleApiResponseError(res, 'Failed to save status page'); }
    } catch { alert('Failed to save status page.'); }
    setSpSaving(false);
  };

  const handleDeleteStatusPage = async (id: string) => {
    if (!window.confirm('Delete this status page?')) return;
    try {
      const res = await fetch(`${API_URL}/api/status-pages/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (res.ok) await fetchStatusPages();
      else if (res.status === 401) handleLogout();
    } catch {}
  };

  const copyPublicUrl = (slug: string) => {
    const url = `${window.location.origin}/status/${slug}`;
    navigator.clipboard.writeText(url).catch(() => {});
    setCopiedSlug(slug);
    setTimeout(() => setCopiedSlug(null), 2000);
  };

  // ── Tag Management Handlers ──
  const handleRenameTag = async (oldTag: string, newTag: string) => {
    if (!oldTag || !newTag || oldTag.trim() === newTag.trim()) return;
    const trimmedNew = newTag.trim();
    const affected = monitors.filter(m => m.tags && m.tags.includes(oldTag));
    
    setMonitors(prev => prev.map(m => {
      if (m.tags && m.tags.includes(oldTag)) {
        const updatedTags = Array.from(new Set(m.tags.map((t: string) => t === oldTag ? trimmedNew : t)));
        return { ...m, tags: updatedTags };
      }
      return m;
    }));

    try {
      await Promise.all(affected.map(m => {
        const updatedTags = Array.from(new Set((m.tags || []).map((t: string) => t === oldTag ? trimmedNew : t)));
        return fetch(`${API_URL}/api/targets/${encodeURIComponent(m.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ ...m, tags: updatedTags })
        });
      }));
    } catch (err) {
      console.error('Failed to update renamed tags:', err);
    }
  };

  const handleDeleteTag = async (tagToDelete: string) => {
    const affected = monitors.filter(m => m.tags && m.tags.includes(tagToDelete));
    
    setMonitors(prev => prev.map(m => {
      if (m.tags && m.tags.includes(tagToDelete)) {
        const updatedTags = m.tags.filter((t: string) => t !== tagToDelete);
        return { ...m, tags: updatedTags };
      }
      return m;
    }));

    try {
      await Promise.all(affected.map(m => {
        const updatedTags = (m.tags || []).filter((t: string) => t !== tagToDelete);
        return fetch(`${API_URL}/api/targets/${encodeURIComponent(m.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ ...m, tags: updatedTags })
        });
      }));
    } catch (err) {
      console.error('Failed to delete tag:', err);
    }
  };

  const handleAddTag = (_newTag: string) => {};

  // ── Batch Operation Handlers ──
  const handleApplyBatchEdit = async (data: {
    tagAction: 'add' | 'replace' | 'remove' | 'keep';
    tagsStr: string;
    checkInterval: number | null;
    enabledState: 'enable' | 'disable' | 'keep';
  }) => {
    if (selectedMonitorIds.length === 0) return;

    const parsedInputTags = data.tagsStr.split(',').map(t => t.trim()).filter(Boolean);
    const affected = monitors.filter(m => selectedMonitorIds.includes(m.id));

    setMonitors(prev => prev.map(m => {
      if (!selectedMonitorIds.includes(m.id)) return m;
      let newTags = normalizeTags(m.tags);
      if (data.tagAction === 'add') {
        newTags = Array.from(new Set([...newTags, ...parsedInputTags]));
      } else if (data.tagAction === 'replace') {
        newTags = parsedInputTags;
      } else if (data.tagAction === 'remove') {
        newTags = newTags.filter(t => !parsedInputTags.some(p => p.toLowerCase() === t.toLowerCase()));
      }
      return {
        ...m,
        tags: newTags,
        check_interval: data.checkInterval !== null ? data.checkInterval : m.check_interval,
        enabled: data.enabledState === 'keep' ? m.enabled : data.enabledState === 'enable'
      };
    }));

    try {
      await Promise.all(affected.map(m => {
        let newTags = normalizeTags(m.tags);
        if (data.tagAction === 'add') {
          newTags = Array.from(new Set([...newTags, ...parsedInputTags]));
        } else if (data.tagAction === 'replace') {
          newTags = parsedInputTags;
        } else if (data.tagAction === 'remove') {
          newTags = newTags.filter(t => !parsedInputTags.some(p => p.toLowerCase() === t.toLowerCase()));
        }
        const updatedTarget = {
          ...m,
          tags: newTags,
          check_interval: data.checkInterval !== null ? data.checkInterval : m.check_interval,
          enabled: data.enabledState === 'keep' ? m.enabled : data.enabledState === 'enable'
        };
        return fetch(`${API_URL}/api/targets/${encodeURIComponent(m.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(updatedTarget)
        });
      }));
      setIsBatchEditModalOpen(false);
    } catch (err) {
      console.error('Failed batch edit:', err);
    }
  };

  const handleBatchToggleEnabled = async () => {
    if (selectedMonitorIds.length === 0) return;
    const affected = monitors.filter(m => selectedMonitorIds.includes(m.id));
    const allEnabled = affected.every(m => m.enabled);
    const targetState = !allEnabled;

    setMonitors(prev => prev.map(m => selectedMonitorIds.includes(m.id) ? { ...m, enabled: targetState } : m));

    try {
      await Promise.all(affected.map(m => fetch(`${API_URL}/api/targets/${encodeURIComponent(m.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...m, enabled: targetState })
      })));
    } catch (err) {
      console.error('Failed batch toggle:', err);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedMonitorIds.length === 0) return;
    if (!window.confirm(`Are you sure you want to delete ${selectedMonitorIds.length} selected monitor(s)?`)) return;
    
    const idsToDelete = [...selectedMonitorIds];
    setMonitors(prev => prev.filter(m => !idsToDelete.includes(m.id)));
    setSelectedMonitorIds([]);

    try {
      await Promise.all(idsToDelete.map(id => fetch(`${API_URL}/api/targets/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })));
    } catch (err) {
      console.error('Failed batch delete:', err);
    }
  };

  // ── Tag Normalization Helper ──
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

  // ── Derived state ──
  const ENV_KEYWORDS = ['prod', 'production', 'staging', 'stag', 'dev', 'development', 'test', 'uat'];
  const isEnvTagHelper = (tag: string) => ENV_KEYWORDS.includes(tag.toLowerCase());

  const allTags = Array.from(new Set(monitors.flatMap(m => normalizeTags(m.tags)))) as string[];
  const groupTags = Array.from(new Set(allTags.filter(t => !isEnvTagHelper(t)))) as string[];
  const presentEnvTags = allTags.filter(t => isEnvTagHelper(t));
  const envTags = Array.from(new Set(['prod', 'staging', 'dev', ...presentEnvTags])) as string[];

  const filteredMonitors = monitors.filter(m => {
    const matchSearch = m.name.toLowerCase().includes(searchTerm.toLowerCase()) || m.host.toLowerCase().includes(searchTerm.toLowerCase());
    
    const targetTags = normalizeTags(m.tags);
    const matchGroup = selectedGroupTag
      ? targetTags.some((t: string) => t.toLowerCase() === selectedGroupTag.toLowerCase())
      : true;

    const matchEnv = selectedEnvTag
      ? (m.tags && m.tags.some((t: string) => {
          const tLower = t.toLowerCase();
          const selLower = selectedEnvTag.toLowerCase();
          if (tLower === selLower) return true;
          if ((selLower === 'staging' || selLower === 'stag') && (tLower === 'staging' || tLower === 'stag')) return true;
          if ((selLower === 'prod' || selLower === 'production') && (tLower === 'prod' || tLower === 'production')) return true;
          if ((selLower === 'dev' || selLower === 'development') && (tLower === 'dev' || tLower === 'development')) return true;
          return false;
        }))
      : true;

    return matchSearch && matchGroup && matchEnv;
  });
  const downCount = (stats.status_summary?.down || 0) + (stats.status_summary?.critical || 0);
  const sm = selectedMonitor;
  const isHostMetricType = sm && ['snmp', 'ssh', 'push'].includes(sm.type?.toLowerCase());
  const isDatabaseType   = sm && ['db', 'mongodb', 'redis'].includes(sm.type?.toLowerCase());

  // ═══════════════════════════════════════════
  //  ROUTING OVERRIDE FOR PUBLIC STATUS PAGES
  // ═══════════════════════════════════════════
  const pathname = window.location.pathname;
  if (pathname.startsWith('/status/')) {
    const slug = pathname.replace('/status/', '');
    return <PublicStatusPage slug={slug} />;
  }

  // ═══════════════════════════════════════════
  //  LOGIN PAGE (Asymmetric Split)
  // ═══════════════════════════════════════════
  if (!token) {
    return (
      <div className="login-wrap split-layout">
        {/* Left Side: Form */}
        <div className="login-form-pane">
          <div className="login-logo">
            <div className="login-logo-icon pulse-up">
              <Shield size={24} />
            </div>
            <h2>SNOOMP</h2>
            <p>Enterprise Health &amp; Resource Monitor</p>
          </div>
          
          {authError && <div className="login-error">{authError}</div>}
          
          <form onSubmit={handleLogin} className="login-form">
            <div className="form-group">
              <label>Username</label>
              <input type="text" required placeholder="admin" value={username} onChange={e => setUsername(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input type="password" required placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} />
            </div>
            <button type="submit" className="login-btn">
              Sign In
            </button>
          </form>
        </div>
        
        {/* Right Side: Visual Texture / Liquid Glass Approx */}
        <div className="login-visual-pane">
          <div className="login-visual-content">
            <div className="liquid-glass-web-approx" />
            <div className="login-visual-text">
              <h3>SYSTEM<br/>COCKPIT</h3>
              <p>MONITORING · INCIDENTS · AVAILABILITY</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════
  //  MAIN DASHBOARD
  // ═══════════════════════════════════════════
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

      {/* ─────────────────────────────────────
          TOP NAVBAR — Uptime Kuma style
         ───────────────────────────────────── */}
      <nav className="top-navbar">
        {/* Logo */}
        <a 
          href="#" 
          className="navbar-logo" 
          aria-label="Snoomp Dashboard Home"
          style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', textDecoration: 'none' }} 
          onClick={(e) => { e.preventDefault(); setSelectedMonitor(null); setView('dashboard'); }}
        >
          <SnoompLogo size={26} color="var(--accent)" />
        </a>

        <div className="navbar-spacer" />

        <div className="navbar-actions">
          {/* Accent theme picker */}
          <div style={{ display: 'flex', gap: '5px', alignItems: 'center', marginRight: '8px' }}>
            {ACCENT_COLORS.map(c => (
              <button
                key={c.hex}
                type="button"
                onClick={() => changeAccent(c.hex)}
                title={c.name}
                aria-label={`Set accent color to ${c.name}`}
                aria-pressed={accentColor === c.hex}
                style={{
                  width: '18px', height: '18px', borderRadius: '50%',
                  backgroundColor: c.hex, padding: 0, border: 'none',
                  outline: accentColor === c.hex ? `2px solid ${c.hex}` : '2px solid transparent',
                  outlineOffset: '2px', cursor: 'pointer', transition: 'outline 150ms',
                  boxShadow: 'none',
                }}
              />
            ))}
          </div>

          {/* Nav links */}
          <button
            className={`nav-link-btn ${view === 'executive' ? 'active' : ''}`}
            onClick={() => setView('executive')}
            style={{ color: view === 'executive' ? 'var(--accent)' : 'var(--text-secondary)' }}
          >
            <TrendingUp size={14} />
            Executive View
          </button>

          <button
            className={`nav-link-btn ${view === 'status-pages' ? 'active' : ''}`}
            onClick={() => setView('status-pages')}
          >
            <Globe size={14} />
            Status Pages
          </button>

          <button
            className={`nav-cta-btn ${view === 'dashboard' && !selectedMonitor ? 'active' : ''}`}
            onClick={() => { setSelectedMonitor(null); setView('dashboard'); }}
          >
            <LayoutDashboard size={14} />
            Dashboard
          </button>

          {/* Live Connection Status Pill — Theme Tokens & ARIA Announcement */}
          <div 
            role="status"
            aria-live="polite"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '12px',
              fontSize: '11px',
              fontWeight: '700',
              letterSpacing: '0.5px',
              background: 'var(--bg-elevated)',
              color: wsStatus === 'connected' ? 'var(--color-up)' : wsStatus === 'reconnecting' ? 'var(--color-warning)' : 'var(--color-down)',
              border: `1px solid ${wsStatus === 'connected' ? 'var(--color-up)' : wsStatus === 'reconnecting' ? 'var(--color-warning)' : 'var(--color-down)'}`,
              marginRight: '12px'
            }}
          >
            <span style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: 'currentColor',
              boxShadow: wsStatus === 'connected' ? '0 0 6px currentColor' : 'none'
            }} />
            <span>{wsStatus === 'connected' ? 'LIVE' : wsStatus === 'reconnecting' ? 'RECONNECTING' : 'OFFLINE'}</span>
          </div>

          {/* Theme Toggle Button */}
          <button 
            type="button"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            aria-pressed={theme === 'light'}
            title="Toggle theme"
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              background: 'var(--bg-void)', 
              borderRadius: '99px', 
              padding: '3px', 
              cursor: 'pointer',
              marginRight: '16px',
              border: '1px solid var(--border)'
            }}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '24px', height: '24px', borderRadius: '50%',
              background: theme === 'light' ? 'var(--bg-elevated)' : 'transparent',
              color: theme === 'light' ? '#f59e0b' : 'var(--text-muted)',
              boxShadow: theme === 'light' ? 'var(--shadow-sm)' : 'none',
              transition: 'all 0.2s'
            }}>
              <Sun size={14} strokeWidth={2.5} />
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '24px', height: '24px', borderRadius: '50%',
              background: theme === 'dark' ? 'var(--bg-elevated)' : 'transparent',
              color: theme === 'dark' ? '#60a5fa' : 'var(--text-muted)',
              boxShadow: theme === 'dark' ? 'var(--shadow-sm)' : 'none',
              transition: 'all 0.2s'
            }}>
              <Moon size={14} strokeWidth={2.5} />
            </div>
          </button>

          {/* User avatar */}
          <div ref={profileMenuRef} style={{ position: 'relative' }}>
            <button 
              type="button"
              className="nav-avatar" 
              onClick={() => setShowProfileMenu(!showProfileMenu)} 
              title="Profile Options"
              aria-label="User account menu"
              aria-expanded={showProfileMenu}
              aria-haspopup="true"
              style={{ cursor: 'pointer', background: 'transparent', border: 'none' }}
            >
              {role === 'admin' ? 'A' : 'U'}
            </button>
            {showProfileMenu && (
              <div style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                padding: '8px',
                width: '160px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                zIndex: 1000,
                display: 'flex',
                flexDirection: 'column',
                gap: '4px'
              }}>
                <button 
                  onClick={() => { setShowProfileMenu(false); setShowPreferencesModal(true); }}
                  style={{ background: 'transparent', border: 'none', padding: '8px 12px', textAlign: 'left', cursor: 'pointer', borderRadius: '4px', fontSize: '13px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <Sliders size={14} /> User Preferences
                </button>
                <div style={{ height: '1px', background: 'var(--border)', margin: '4px 0' }} />
                <button 
                  onClick={() => { setShowProfileMenu(false); handleLogout(); }}
                  style={{ background: 'transparent', border: 'none', padding: '8px 12px', textAlign: 'left', cursor: 'pointer', borderRadius: '4px', fontSize: '13px', color: 'var(--color-down)' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(237, 66, 69, 0.1)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  Log Out
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* ─────────────────────────────────────
          BODY: Sidebar + Main
         ───────────────────────────────────── */}
      <div className="app-layout">

        {/* ─── SIDEBAR ─── */}
        {view !== 'executive' && (
          <aside className="sidebar">

          {/* Add Monitor + Batch Toggle — top bar */}
          {role !== 'viewer' && (
            <div className="kuma-add-btn" style={{ display: 'flex', gap: '6px' }}>
              <button 
                onClick={() => { setEditingMonitor(null); setIsModalOpen(true); setView('dashboard'); }}
                style={{ flex: 1 }}
              >
                <Plus size={14} /> Add New Monitor
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setIsBatchMode(!isBatchMode);
                  setSelectedMonitorIds([]);
                }}
                title="Toggle Batch Selection Mode"
                style={{
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '11px',
                  background: isBatchMode ? 'var(--accent-dim)' : 'transparent',
                  borderColor: isBatchMode ? 'var(--accent)' : 'var(--border)',
                  color: isBatchMode ? 'var(--accent)' : 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <CheckSquare size={13} />
                <span>{isBatchMode ? 'Cancel' : 'Batch'}</span>
              </button>
            </div>
          )}

          {/* Search */}
          <div className="sidebar-search" style={{ paddingTop: '8px' }}>
            <div className="search-wrapper">
              <Search size={14} className="search-icon" />
              <input
                type="text"
                placeholder="Search monitors..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          {/* Filter chips — Section 1: System / Application Group */}
          <div style={{ padding: '6px 12px 4px' }}>
            <div style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
              System / Application Group
            </div>
            <div className="sidebar-filter-row" role="group" aria-label="System Group Filters" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              <button 
                type="button"
                className={`filter-chip ${!selectedGroupTag ? 'active' : ''}`} 
                onClick={() => setSelectedGroupTag(null)}
                aria-pressed={!selectedGroupTag}
                style={{ cursor: 'pointer', border: 'none', font: 'inherit' }}
              >
                All Systems
              </button>
              {groupTags.map(tag => (
                <button 
                  key={tag} 
                  type="button"
                  className={`filter-chip ${selectedGroupTag === tag ? 'active' : ''}`} 
                  onClick={() => setSelectedGroupTag(selectedGroupTag === tag ? null : tag)}
                  aria-pressed={selectedGroupTag === tag}
                  style={{ cursor: 'pointer', border: 'none', font: 'inherit' }}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* Filter chips — Section 2: Environment */}
          <div style={{ padding: '4px 12px 8px' }}>
            <div style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
              Environment
            </div>
            <div className="sidebar-filter-row" role="group" aria-label="Environment Filters" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              <button 
                type="button"
                className={`filter-chip ${!selectedEnvTag ? 'active' : ''}`} 
                onClick={() => setSelectedEnvTag(null)}
                aria-pressed={!selectedEnvTag}
                style={{ cursor: 'pointer', border: 'none', font: 'inherit' }}
              >
                All Envs
              </button>
              {envTags.map(tag => (
                <button 
                  key={tag} 
                  type="button"
                  className={`filter-chip ${selectedEnvTag === tag ? 'active' : ''}`} 
                  onClick={() => setSelectedEnvTag(selectedEnvTag === tag ? null : tag)}
                  aria-pressed={selectedEnvTag === tag}
                  style={{ cursor: 'pointer', border: 'none', font: 'inherit' }}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* Stats strip below search */}
          <div className="stats-summary-grid">
            <div className="stat-item">
              <div className="stat-val total">{stats.total_targets}</div>
              <div className="stat-label">Total</div>
            </div>
            <div className="stat-item">
              <div className="stat-val up">{stats.status_summary?.up || 0}</div>
              <div className="stat-label">Up</div>
            </div>
            <div className="stat-item">
              <div className="stat-val down">{downCount}</div>
              <div className="stat-label">Down</div>
            </div>
            <div className="stat-item">
              <div className="stat-val warn">{stats.status_summary?.warning || 0}</div>
              <div className="stat-label">Warn</div>
            </div>
          </div>

          {/* Batch Action Bar */}
          {isBatchMode && (
            <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent-glow)', padding: '10px 12px', borderRadius: '10px', margin: '8px 12px 4px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--accent)' }}>
                  {selectedMonitorIds.length} Selected
                </span>
                <button 
                  type="button"
                  className="secondary" 
                  style={{ fontSize: '10.5px', padding: '2px 8px' }}
                  onClick={() => {
                    if (selectedMonitorIds.length === filteredMonitors.length && filteredMonitors.length > 0) {
                      setSelectedMonitorIds([]);
                    } else {
                      setSelectedMonitorIds(filteredMonitors.map(m => m.id));
                    }
                  }}
                >
                  {selectedMonitorIds.length === filteredMonitors.length && filteredMonitors.length > 0 ? 'Deselect All' : 'Select All'}
                </button>
              </div>

              {selectedMonitorIds.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={() => setIsBatchEditModalOpen(true)}
                    style={{ fontSize: '11px', padding: '6px 8px', background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-glow)', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
                  >
                    <Edit3 size={12} /> Batch Edit
                  </button>
                  <button
                    type="button"
                    onClick={handleBatchToggleEnabled}
                    style={{ fontSize: '11px', padding: '6px 8px', background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
                  >
                    <Power size={12} /> Enable/Disable
                  </button>
                  <button
                    type="button"
                    onClick={handleBatchDelete}
                    style={{ fontSize: '11px', padding: '6px 8px', background: 'rgba(239,68,68,0.1)', color: 'var(--color-down)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', gridColumn: 'span 2', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
                  >
                    <Trash2 size={12} /> Delete Selected ({selectedMonitorIds.length})
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Grouping toggle */}
          <div className="sidebar-toggle-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="sidebar-toggle-label">Group by</span>
            <select 
              value={groupBy}
              onChange={(e) => {
                setGroupBy(e.target.value as 'none' | 'tags' | 'type');
                localStorage.setItem('snoomp_group_by', e.target.value);
              }}
              style={{ width: 'auto', padding: '2px 24px 2px 8px', fontSize: '10px', height: '22px', borderRadius: '4px', background: 'var(--bg-void)' }}
            >
              <option value="none">None</option>
              <option value="tags">Tags</option>
              <option value="type">Type</option>
            </select>
          </div>

          {/* Monitor list — Kuma style with optional collapsible groups */}
          <div className="sidebar-list">
            {(() => {
              if (filteredMonitors.length === 0) {
                return (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                    <span>No monitors match your filters.</span>
                    {(searchTerm || selectedGroupTag || selectedEnvTag) && (
                      <button
                        type="button"
                        onClick={() => { setSearchTerm(''); setSelectedGroupTag(null); setSelectedEnvTag(null); }}
                        style={{
                          fontSize: '11px',
                          padding: '4px 10px',
                          borderRadius: '6px',
                          background: 'var(--bg-elevated)',
                          border: '1px solid var(--border)',
                          color: 'var(--accent)',
                          cursor: 'pointer'
                        }}
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                );
              }

              // Renders a monitor item Kuma style
              const renderMonitorItem = (m: any) => {
                const isActive  = sm?.id === m.id && view === 'dashboard';
                const uptime    = m.uptime_24h ?? 0;
                const recentHbs = m.recent_heartbeats || [];
                const isSelected = selectedMonitorIds.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={`monitor-item-kuma ${isActive ? 'active' : ''}`}
                    aria-selected={isActive}
                    aria-label={`${m.name}, status ${m.status || 'unknown'}, uptime ${uptime.toFixed(1)}%`}
                    onClick={() => {
                      if (isBatchMode) {
                        if (isSelected) {
                          setSelectedMonitorIds(prev => prev.filter(id => id !== m.id));
                        } else {
                          setSelectedMonitorIds(prev => Array.from(new Set([...prev, m.id])));
                        }
                      } else {
                        setSelectedMonitor(m);
                        setView('dashboard');
                      }
                    }}
                    style={{
                      width: '100%',
                      font: 'inherit',
                      textAlign: 'left',
                      background: isSelected ? 'rgba(59,130,246,0.12)' : 'transparent',
                      border: isSelected ? '1px solid var(--accent-glow)' : '1px solid transparent'
                    }}
                  >
                    <div className="kuma-item-top" style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
                      {isBatchMode && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          style={{ marginRight: '4px', cursor: 'pointer', flexShrink: 0 }}
                        />
                      )}
                      <span className="kuma-name" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.name}
                      </span>
                      <span className={`uptime-badge ${uptimeBadgeClass(uptime)}`} style={{ flexShrink: 0 }} title="24-hour average uptime">
                        {recentHbs.length > 0 ? `${uptime.toFixed(1)}% 24h` : '—'}
                      </span>
                      {m.response_time_ms > 0 && (
                        <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', flexShrink: 0 }}>
                          {m.response_time_ms.toFixed(0)}ms
                        </span>
                      )}
                    </div>
                    <div className="mini-hb-row" title="Recent checks (last 30m)">
                      {recentHbs.length > 0
                        ? recentHbs.map((hb: any, i: number) => (
                            <div key={i} className={`mini-hb-bar ${hb.status || 'unknown'}`} />
                          ))
                        : Array(20).fill(null).map((_, i) => (
                            <div key={i} className="mini-hb-bar unknown" />
                          ))
                      }
                    </div>
                  </button>
                );
              };

              if (groupBy === 'none') {
                return filteredMonitors.map(renderMonitorItem);
              }

              // Group monitors by their first tag, or "UNGROUPED"
              const groups: { [key: string]: any[] } = {};
              filteredMonitors.forEach(m => {
                let groupKey = 'UNGROUPED';
                if (groupBy === 'tags') {
                  groupKey = m.tags && m.tags.length > 0 ? m.tags[0] : 'UNGROUPED';
                } else if (groupBy === 'type') {
                  groupKey = m.type ? m.type.toUpperCase() : 'UNKNOWN';
                }
                
                if (!groups[groupKey]) {
                  groups[groupKey] = [];
                }
                groups[groupKey].push(m);
              });

              const toggleGroup = (groupName: string) => {
                setCollapsedGroups(prev =>
                  prev.includes(groupName)
                    ? prev.filter(g => g !== groupName)
                    : [...prev, groupName]
                );
              };

              return Object.keys(groups).sort((a, b) => {
                if (a === 'UNGROUPED') return 1;
                if (b === 'UNGROUPED') return -1;
                return a.localeCompare(b);
              }).map(groupName => {
                const isCollapsed = collapsedGroups.includes(groupName);
                const groupMonitors = groups[groupName];
                const activeCount = groupMonitors.filter(m => m.status === 'up').length;

                return (
                  <div key={groupName} style={{ marginBottom: '8px' }}>
                    <button 
                      type="button"
                      className="sidebar-group-header" 
                      onClick={() => toggleGroup(groupName)}
                      aria-expanded={!isCollapsed}
                      aria-label={`Toggle ${groupName} group`}
                      style={{ width: '100%', font: 'inherit', border: 'none', textAlign: 'left', cursor: 'pointer' }}
                    >
                      <div className={`group-header-title ${isCollapsed ? 'collapsed' : ''}`}>
                        <ChevronDown size={11} />
                        <span>{groupName}</span>
                      </div>
                      <span className="group-count-badge">
                        {activeCount}/{groupMonitors.length}
                      </span>
                    </button>
                    {!isCollapsed && (
                      <div style={{ paddingLeft: '4px' }}>
                        {groupMonitors.map(renderMonitorItem)}
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>

          {/* Version Footer Badge */}
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' }}>
            <span>Snoomp Enterprise</span>
            <span style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', padding: '2px 8px', borderRadius: '10px', fontWeight: 600, color: 'var(--accent)' }}>
              {appVersion}
            </span>
          </div>
        </aside>
        )}

        {/* ─── MAIN PANEL ─── */}
        <main className="main-content">

          {/* ═══ EXECUTIVE DASHBOARD VIEW ═══ */}
          {view === 'executive' ? (
            <ExecutiveDashboard targets={monitors} stats={stats} slaConfig={userPreferences.sla} />
          ) : view === 'status-pages' ? (
            <div className="status-pages-view anim-fade-in">
              <div className="status-pages-header">
                <div>
                  <h2>Status Pages</h2>
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Create public-facing status pages for your monitors
                  </p>
                </div>
                {role !== 'viewer' && (
                  <button onClick={() => openSpModal()}>
                    <Plus size={14} /> New Status Page
                  </button>
                )}
              </div>

              {statusPages.length === 0 ? (
                <div className="empty-state" style={{ height: 'auto', padding: '60px 40px' }}>
                  <div className="empty-state-icon">
                    <Globe size={24} style={{ color: 'var(--text-muted)' }} />
                  </div>
                  <h2>No Status Pages Yet</h2>
                  <p>Create a public status page to share your system health with users, customers, or stakeholders — no login required.</p>
                  {role !== 'viewer' && (
                    <button onClick={() => openSpModal()} style={{ marginTop: '20px' }}>
                      <Plus size={14} /> Create First Status Page
                    </button>
                  )}
                </div>
              ) : (
                <div className="status-page-cards">
                  {statusPages.map(page => (
                    <div key={page.id} className="sp-card">
                      <div className="sp-card-name">{page.name}</div>
                      <div className="sp-card-slug">
                        <Globe size={10} />
                        /status/{page.slug}
                      </div>
                      {page.description && (
                        <div className="sp-card-desc">{page.description}</div>
                      )}

                      {/* Public URL copy row */}
                      <div className="sp-url-row">
                        <input
                          readOnly
                          value={`${window.location.origin}/status/${page.slug}`}
                          style={{ fontSize: '11px', color: 'var(--text-muted)' }}
                        />
                        <button
                          className="secondary"
                          style={{ padding: '7px', flexShrink: 0 }}
                          onClick={() => copyPublicUrl(page.slug)}
                          title="Copy public URL"
                        >
                          {copiedSlug === page.slug ? <Check size={13} style={{ color: 'var(--color-up)' }} /> : <Copy size={13} />}
                        </button>
                        <button
                          className="secondary"
                          style={{ padding: '7px', flexShrink: 0 }}
                          onClick={() => window.open(`/status/${page.slug}`, '_blank')}
                          title="Open public page"
                        >
                          <ExternalLink size={13} />
                        </button>
                      </div>

                      <div className="sp-card-footer">
                        <span className="sp-monitor-count">
                          {page.monitor_ids.length} monitor{page.monitor_ids.length !== 1 ? 's' : ''}
                        </span>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          {page.is_public && <span className="sp-public-badge">Public</span>}
                          {role !== 'viewer' && (
                            <>
                              <button className="secondary" style={{ padding: '5px 8px', fontSize: '12px' }} onClick={() => openSpModal(page)}>
                                <Pencil size={12} />
                              </button>
                              <button className="danger" style={{ padding: '5px 8px', fontSize: '12px' }} onClick={() => handleDeleteStatusPage(page.id)}>
                                <Trash2 size={12} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          ) : sm ? (
            /* ═══ MONITOR DETAIL VIEW ═══ */
            <div className="anim-fade-in">

              {/* Sticky header */}
              <div className="monitor-detail-header">
                <div>
                  <div className="detail-title-row">
                    <div className={`detail-status-badge ${sm.status || 'off'}`}>
                      <div className={`status-dot ${sm.status || 'off'}`} style={{ width: '7px', height: '7px' }} />
                      {(sm.status || 'off').toUpperCase()}
                    </div>
                    <h2>{sm.name}</h2>
                  </div>
                  <div className="detail-meta">
                    {sm.type?.toLowerCase().startsWith('http') ? (
                      <a href={`${sm.type}://${sm.host}${sm.port ? `:${sm.port}` : ''}${sm.path || ''}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                        {sm.host}{sm.port ? `:${sm.port}` : ''}{sm.path || ''}
                      </a>
                    ) : (
                      <>{sm.host}{sm.port ? `:${sm.port}` : ''}{sm.path || ''}</>
                    )}
                    {sm.response_time_ms > 0 && (
                      <span className="latency-pill" style={{ marginLeft: '10px' }}>
                        {sm.response_time_ms.toFixed(1)} ms
                      </span>
                    )}
                  </div>
                  {sm.tags?.length > 0 && (
                    <div className="tag-container">
                      {sm.tags.map((t: string) => <span key={t} className="tag-badge">{t}</span>)}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  {role !== 'viewer' && (
                    <div className="monitor-detail-actions" style={{ display: 'flex', gap: '4px' }}>
                      <button className="secondary" onClick={() => handleRefreshMonitor(sm.id)} title="Trigger immediate check (Pull/Refresh)">
                        <Zap size={14} style={{ color: 'var(--accent)' }} /> Refresh
                      </button>
                      <button className="secondary" onClick={() => handleToggleMonitor(sm)} title={sm.enabled ? 'Pause' : 'Resume'}>
                        <Power size={14} style={{ color: sm.enabled ? 'var(--color-up)' : 'var(--color-off)' }} />
                      </button>
                      <button className="secondary" onClick={() => { setEditingMonitor(sm); setIsModalOpen(true); }}>
                        <Edit3 size={14} />
                      </button>
                      <button className="danger" onClick={() => handleDeleteMonitor(sm.id)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                  <button className="secondary" onClick={() => handleGenerateReport(sm, 168)} title="Generate PDF Availability Report">
                    <FileText size={14} /> PDF Report
                  </button>
                </div>
              </div>

              {/* Heartbeat timeline */}
              <div className="detail-section">
                <div className="section-title">
                  <span>Heartbeat Timeline <span style={{ opacity: 0.5, fontSize: '10px' }}>— last 60 checks</span></span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Zap size={11} />
                    {sm.check_interval}s interval
                  </span>
                </div>
                <div className="heartbeat-timeline">
                  {heartbeats.map((hb: any, i: number) => (
                    <div
                      key={hb.id || i}
                      className={`hb-block ${hb.status}`}
                      title={`${new Date(hb.checked_at).toLocaleString()}\nStatus: ${hb.status.toUpperCase()}\nLatency: ${hb.response_time_ms?.toFixed(1)} ms${hb.error ? '\n' + hb.error : ''}`}
                    />
                  ))}
                  {heartbeats.length === 0 && (
                    <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>No heartbeat data yet.</div>
                  )}
                </div>
                <div className="timeline-footer">
                  <span>← Oldest</span>
                  <span>Latest →</span>
                </div>
              </div>

              {/* Host Resource Metrics (snmp, ssh, push) */}
              {isHostMetricType && sm.metrics && (
                <div className="detail-section">
                  <div className="section-title">
                    <span>System Resource Metrics</span>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Live · every {sm.check_interval}s</span>
                  </div>
                  <div className="metrics-grid">
                    <RadialGauge key={`${sm.id}-cpu`} value={sm.metrics.cpu_percent || 0} label="CPU Usage" sublabel="user + sys" />
                    <RadialGauge key={`${sm.id}-mem`} value={sm.metrics.mem_percent || 0} label="Memory" sublabel="used / total" />
                    <RadialGauge 
                      key={`${sm.id}-disk`} 
                      value={sm.metrics.disk_percent || 0} 
                      /* ponytail: simpler, correct label for total utilization */
                      label="Total Disk"
                      sublabel={sm.metrics.disks && sm.metrics.disks.length > 1 ? `${sm.metrics.disks.length} volumes monitored` : "partition usage"} 
                    />
                    <div className="uptime-card">
                      <span className="uptime-label">System Uptime</span>
                      <Clock size={20} style={{ color: 'var(--color-up)', opacity: 0.7 }} />
                      <div className="uptime-value">{sm.metrics.uptime || '—'}</div>
                      <span className="uptime-sub">Since last reboot</span>
                    </div>
                  </div>

                  {/* Hardware specs */}
                  {(sm.metrics.cpu_cores || sm.metrics.ram_total_gb || sm.metrics.disk_total_gb) && (
                    <div className="hw-spec-strip" style={{ marginTop: '12px' }}>
                      {sm.metrics.cpu_cores && (
                        <div className="hw-spec-item">
                          <span className="hw-spec-label"><Cpu size={9} style={{ verticalAlign: 'middle', marginRight: '2px' }} />CPU Cores</span>
                          <span className="hw-spec-value">{sm.metrics.cpu_cores}</span>
                        </div>
                      )}
                      {sm.metrics.ram_total_gb && (
                        <div className="hw-spec-item">
                          <span className="hw-spec-label"><MemoryStick size={9} style={{ verticalAlign: 'middle', marginRight: '2px' }} />Total RAM</span>
                          <span className="hw-spec-value">{sm.metrics.ram_total_gb} GB</span>
                        </div>
                      )}
                      {sm.metrics.disk_total_gb && (
                        <div className="hw-spec-item">
                          <span className="hw-spec-label"><HardDrive size={9} style={{ verticalAlign: 'middle', marginRight: '2px' }} />Total Storage</span>
                          <span className="hw-spec-value">{sm.metrics.disk_total_gb} GB</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Attached Storage & Filesystem Utilization Breakdown Panel */}
                  {sm.metrics.disks && sm.metrics.disks.length > 0 && (
                    <div style={{ marginTop: '16px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '14px 18px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <HardDrive size={13} style={{ color: 'var(--accent)' }} /> Attached Storage & Volume Utilization ({sm.metrics.disks.length} Partitions)
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          Total: {sm.metrics.disk_total_gb} GB
                        </span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px' }}>
                        {sm.metrics.disks.map((dk: any, idx: number) => {
                          const pct = dk.used_percent || 0;
                          const badgeColor = pct >= 90 ? 'var(--color-down)' : pct >= 80 ? 'var(--color-warning)' : 'var(--color-up)';
                          const isNfs = dk.filesystem?.includes(':') || dk.mount?.includes('nfs');
                          return (
                            <div key={idx} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px 14px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                                    {dk.mount}
                                  </span>
                                  {isNfs && (
                                    <span style={{ fontSize: '9px', background: 'rgba(59,130,246,0.15)', color: 'var(--accent)', padding: '1px 5px', borderRadius: '4px', fontWeight: 600 }}>NFS</span>
                                  )}
                                </div>
                                <span style={{ fontSize: '12px', fontWeight: 800, color: badgeColor, fontFamily: 'var(--font-mono)' }}>
                                  {pct}%
                                </span>
                              </div>
                              <div style={{ width: '100%', height: '6px', background: 'var(--bg-void)', borderRadius: '3px', overflow: 'hidden', marginBottom: '6px' }}>
                                <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: badgeColor, transition: 'width 0.3s' }} />
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)' }}>
                                <span style={{ fontFamily: 'var(--font-mono)', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={dk.filesystem}>{dk.filesystem}</span>
                                <span>{dk.size_gb ? `${dk.size_gb} GB` : '—'}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Resource History chart with timeframe selector */}
                  {['snmp', 'ssh', 'push', 'db', 'mongodb', 'redis'].includes(sm.type?.toLowerCase()) && (
                    <div className="chart-section" style={{ marginTop: '16px' }}>
                      <div className="section-title" style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>Resource History ({resourceHours === 24 ? '24h' : resourceHours === 168 ? '7d' : '30d'})</span>
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                          {[
                            { label: '24 hrs', value: 24 },
                            { label: '7 days', value: 168 },
                            { label: '30 days', value: 720 },
                          ].map(t => (
                            <button
                              key={t.value}
                              type="button"
                              className={`secondary ${resourceHours === t.value ? 'active' : ''}`}
                              style={{
                                fontSize: '11px',
                                padding: '2px 8px',
                                background: resourceHours === t.value ? 'rgba(59,130,246,0.15)' : 'transparent',
                                color: resourceHours === t.value ? 'var(--accent)' : 'var(--text-muted)',
                                border: resourceHours === t.value ? '1px solid var(--accent)' : '1px solid transparent',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontWeight: resourceHours === t.value ? '600' : 'normal',
                                transition: 'all 0.15s ease'
                              }}
                              onClick={() => handleResourceHoursChange(t.value)}
                            >
                              {t.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      {metricsHistory.length > 0 ? (
                        <>
                          <div className="chart-legend">
                            <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--chart-1)' }} />CPU</span>
                            <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--chart-2)' }} />Memory</span>
                            <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--chart-3)' }} />Disk</span>
                          </div>
                          <ResponsiveContainer width="100%" height={190}>
                            <AreaChart data={metricsHistory.map((m: any) => ({
                              timestamp: new Date(m.checked_at).getTime(),
                              cpu: m.cpu_percent, mem: m.mem_percent, disk: m.disk_percent,
                            }))}>
                              <defs>
                                <linearGradient id="gCpu"  x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.25}/><stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0}/></linearGradient>
                                <linearGradient id="gMem"  x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.25}/><stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0}/></linearGradient>
                                <linearGradient id="gDisk" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--chart-3)" stopOpacity={0.25}/><stop offset="95%" stopColor="var(--chart-3)" stopOpacity={0}/></linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                              <XAxis
                                dataKey="timestamp"
                                type="number"
                                domain={[Date.now() - resourceHours * 3600 * 1000, Date.now()]}
                                stroke="var(--text-muted)"
                                fontSize={10}
                                tick={{ fill: 'var(--text-muted)' }}
                                interval="preserveStartEnd"
                                minTickGap={45}
                                tickFormatter={(ts: number) => {
                                  const d = new Date(ts);
                                  return resourceHours > 24
                                    ? d.toLocaleDateString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                                    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                }}
                              />
                              <YAxis stroke="var(--text-muted)" fontSize={10} unit="%" domain={[0, 100]} tick={{ fill: 'var(--text-muted)' }} />
                              <Tooltip
                                labelFormatter={(ts: any) => new Date(Number(ts)).toLocaleString()}
                                contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '12px' }}
                              />
                              <Area type="monotone" dataKey="cpu"  name="CPU"  stroke="var(--chart-1)" fill="url(#gCpu)"  strokeWidth={1.5} dot={false} />
                              <Area type="monotone" dataKey="mem"  name="Memory" stroke="var(--chart-2)" fill="url(#gMem)"  strokeWidth={1.5} dot={false} />
                              <Area type="monotone" dataKey="disk" name="Disk"   stroke="var(--chart-3)" fill="url(#gDisk)" strokeWidth={1.5} dot={false} />
                            </AreaChart>
                          </ResponsiveContainer>
                        </>
                      ) : (
                        <div style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '24px 0', textAlign: 'center' }}>
                          No metric history data available for this timeframe ({resourceHours === 24 ? '24 hours' : resourceHours === 168 ? '7 days' : '30 days'}).
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Database Engine Diagnostics & Overview */}
              {isDatabaseType && (
                <div className="detail-section">
                  <div className="db-diagnostics-section">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Database size={16} style={{ color: 'var(--accent)' }} />
                            <span style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)', letterSpacing: '0.3px' }}>
                              Engine Diagnostics
                            </span>
                            <span style={{ fontSize: '10px', color: 'var(--text-muted)', background: 'rgba(59,130,246,0.1)', padding: '2px 8px', borderRadius: '10px', fontWeight: '500' }}>
                              {dbEngineStatus?.type?.toUpperCase() || 'LIVE'}
                            </span>
                          </div>
                          <button 
                            className="secondary" 
                            style={{ fontSize: '11px', padding: '5px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', borderRadius: '6px', transition: 'all 0.2s ease' }} 
                            onClick={() => fetchDbEngineStatus(sm.id)}
                            disabled={dbEngineLoading}
                          >
                            <RefreshCw size={12} style={{ animation: dbEngineLoading ? 'spin 1s linear infinite' : 'none' }} />
                            {dbEngineLoading ? 'Querying…' : 'Refresh'}
                          </button>
                        </div>

                        {dbEngineStatus ? (
                          <div>
                            {/* Stat cards row */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
                              <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
                                <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Total Size</div>
                                <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                                  {dbEngineStatus.info?.storage_size_mb ? (dbEngineStatus.info.storage_size_mb > 1024 ? `${(dbEngineStatus.info.storage_size_mb / 1024).toFixed(1)} GB` : `${dbEngineStatus.info.storage_size_mb} MB`) : '—'}
                                </div>
                                <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px' }}>{dbEngineStatus.info?.database_count || '—'} databases</div>
                              </div>
                              <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
                                <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Connections</div>
                                <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                                  {dbEngineStatus.info?.active_connections ?? '—'}
                                  <span style={{ fontSize: '11px', fontWeight: '400', color: 'var(--text-muted)' }}> / {dbEngineStatus.info?.max_connections ?? '—'}</span>
                                </div>
                                <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px' }}>active / max</div>
                              </div>
                              <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
                                <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Shared Buffers</div>
                                <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                                  {dbEngineStatus.info?.shared_buffers || '—'}
                                </div>
                                <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px' }}>cache: {dbEngineStatus.info?.effective_cache_size || '—'}</div>
                              </div>
                              <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
                                <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Uptime</div>
                                <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                                  {dbEngineStatus.info?.uptime_seconds ? `${Math.floor(dbEngineStatus.info.uptime_seconds / 86400)}d` : '—'}
                                </div>
                                <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px' }}>
                                  {dbEngineStatus.info?.uptime_seconds ? `${Math.floor((dbEngineStatus.info.uptime_seconds % 86400) / 3600)}h ${Math.floor((dbEngineStatus.info.uptime_seconds % 3600) / 60)}m` : 'since boot'}
                                </div>
                              </div>
                            </div>

                            {/* Version banner */}
                            <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 14px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px' }}>
                              <Server size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                              <span style={{ color: 'var(--text-muted)' }}>Engine:</span>
                              <span style={{ color: 'var(--text-primary)', fontWeight: '500', fontFamily: 'var(--font-mono)', fontSize: '10px' }}>
                                {dbEngineStatus.info?.version || 'Unknown'}
                              </span>
                            </div>

                            {/* Tab selector */}
                            <div style={{ display: 'flex', gap: '4px', marginBottom: '14px', background: 'var(--bg-secondary)', borderRadius: '8px', padding: '3px', border: '1px solid var(--border)' }}>
                              {[
                                { key: 'slow_queries', label: 'Active & Slow Queries', count: dbEngineStatus.slow_queries?.length },
                                { key: 'tables', label: sm.type.toLowerCase() === 'db' ? 'Databases' : 'Collections', count: dbEngineStatus.tables?.length },
                                { key: 'tablespaces', label: 'Tablespaces', count: dbEngineStatus.tablespaces?.length },
                              ].map(tab => (
                                <button
                                  key={tab.key}
                                  type="button"
                                  aria-selected={dbActiveTab === tab.key}
                                  style={{
                                    flex: 1, padding: '7px 12px', fontSize: '11px', fontWeight: '600', cursor: 'pointer',
                                    background: dbActiveTab === tab.key ? 'var(--bg-elevated)' : 'transparent',
                                    color: dbActiveTab === tab.key ? 'var(--accent)' : 'var(--text-secondary)',
                                    border: dbActiveTab === tab.key ? '1px solid var(--border)' : '1px solid transparent',
                                    borderRadius: '6px',
                                    transition: 'all 0.2s ease',
                                  }}
                                  onClick={() => setDbActiveTab(tab.key as "slow_queries" | "tables" | "tablespaces")}
                                >
                                  {tab.label} {tab.count != null && <span style={{ opacity: 0.7, fontWeight: '400' }}>({tab.count})</span>}
                                </button>
                              ))}
                            </div>

                            {/* Tab Content: Active / Slow & Idle Queries */}
                            {dbActiveTab === 'slow_queries' && (
                              <div style={{ maxHeight: '280px', overflow: 'auto', borderRadius: '8px', border: '1px solid var(--border)' }}>
                                {dbEngineStatus.slow_queries?.length === 0 ? (
                                  <div style={{ padding: '24px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
                                    <Activity size={20} style={{ opacity: 0.3, marginBottom: '8px' }} />
                                    <div>No slow queries or idle connection leaks found</div>
                                    <div style={{ fontSize: '10px', marginTop: '4px', opacity: 0.6 }}>All active queries completing within normal response time</div>
                                  </div>
                                ) : (
                                  <table style={{ width: '100%', minWidth: '940px', borderCollapse: 'collapse', fontSize: '11px', textAlign: 'left' }}>
                                    <thead>
                                      <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 1 }}>
                                        <th style={{ padding: '8px 10px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>PID</th>
                                        <th style={{ padding: '8px 10px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>User</th>
                                        <th style={{ padding: '8px 10px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Client IP</th>
                                        <th style={{ padding: '8px 10px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>App Name</th>
                                        <th style={{ padding: '8px 10px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Database</th>
                                        <th style={{ padding: '8px 10px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>State</th>
                                        <th style={{ padding: '8px 10px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Duration</th>
                                        <th style={{ padding: '8px 10px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Query Statement</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {dbEngineStatus.slow_queries.map((sq: any, i: number) => {
                                        const durSec = sq.duration_sec || 0;
                                        const isLong = durSec > 300;
                                        const durStr = durSec >= 3600 ? `${Math.floor(durSec / 3600)}h ${Math.floor((durSec % 3600) / 60)}m` : durSec >= 60 ? `${Math.floor(durSec / 60)}m ${Math.floor(durSec % 60)}s` : `${durSec.toFixed(1)}s`;
                                        return (
                                          <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', transition: 'background 0.15s', background: isLong ? 'rgba(239,68,68,0.04)' : 'transparent' }}>
                                            <td style={{ padding: '7px 10px', fontFamily: 'var(--font-mono)', fontSize: '10px' }}>{sq.pid}</td>
                                            <td style={{ padding: '7px 10px', fontWeight: '500' }}>{sq.usename}</td>
                                            <td style={{ padding: '7px 10px', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--accent)' }}>{sq.client_addr || 'local'}</td>
                                            <td style={{ padding: '7px 10px', fontSize: '10px', color: 'var(--text-secondary)' }}>{sq.application_name || '—'}</td>
                                            <td style={{ padding: '7px 10px', fontSize: '10px', color: 'var(--text-secondary)' }}>{sq.datname || '—'}</td>
                                            <td style={{ padding: '7px 10px' }}>
                                              <span style={{ fontSize: '9px', padding: '2px 6px', borderRadius: '4px', fontWeight: '600', background: sq.state === 'active' ? 'rgba(34,197,94,0.15)' : 'rgba(250,168,26,0.15)', color: sq.state === 'active' ? '#22c55e' : '#faa81a' }}>
                                                {sq.state}
                                              </span>
                                            </td>
                                            <td style={{ padding: '7px 10px', fontWeight: '600', fontFamily: 'var(--font-mono)', fontSize: '10px', color: isLong ? '#ef4444' : durSec > 30 ? '#faa81a' : '#22c55e' }}>
                                              {durStr}
                                            </td>
                                            <td style={{ padding: '7px 10px', minWidth: '320px' }}>
                                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <code
                                                  style={{
                                                    fontFamily: 'var(--font-mono)',
                                                    fontSize: '10px',
                                                    color: 'var(--text-primary)',
                                                    whiteSpace: 'nowrap',
                                                    overflowX: 'auto',
                                                    maxWidth: '460px',
                                                    display: 'block',
                                                    background: 'rgba(0,0,0,0.3)',
                                                    padding: '4px 8px',
                                                    borderRadius: '4px',
                                                    border: '1px solid var(--border)'
                                                  }}
                                                  title={sq.query}
                                                >
                                                  {sq.query}
                                                </code>
                                                <button
                                                  type="button"
                                                  title="Copy SQL Query"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    navigator.clipboard.writeText(sq.query);
                                                    const btn = e.currentTarget;
                                                    btn.innerText = 'Copied!';
                                                    setTimeout(() => { btn.innerText = 'Copy'; }, 1500);
                                                  }}
                                                  style={{
                                                    fontSize: '9px',
                                                    padding: '3px 8px',
                                                    background: 'var(--bg-elevated)',
                                                    border: '1px solid var(--border)',
                                                    borderRadius: '4px',
                                                    color: 'var(--accent)',
                                                    cursor: 'pointer',
                                                    whiteSpace: 'nowrap',
                                                    flexShrink: 0
                                                  }}
                                                >
                                                  Copy
                                                </button>
                                              </div>
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            )}

                            {/* Tab Content: Databases */}
                            {dbActiveTab === 'tables' && (
                              <div style={{ maxHeight: '340px', overflowY: 'auto', borderRadius: '8px', border: '1px solid var(--border)' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', textAlign: 'left' }}>
                                  <thead>
                                    <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 1 }}>
                                      <th style={{ padding: '8px 10px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>#</th>
                                      <th style={{ padding: '8px 10px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{sm.type.toLowerCase() === 'db' ? 'Database Name' : 'Collection'}</th>
                                      <th style={{ padding: '8px 10px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'right' }}>Size</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {dbEngineStatus.tables?.map((tbl: any, i: number) => {
                                      return (
                                        <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', background: 'transparent', transition: 'background 0.15s' }}>
                                          <td style={{ padding: '7px 10px', fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{i + 1}</td>
                                          <td style={{ padding: '7px 10px', fontWeight: '400', color: 'var(--text-primary)' }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                              <Database size={11} style={{ color: 'var(--text-muted)', opacity: 0.4, flexShrink: 0 }} />
                                              {tbl.table_name}
                                            </span>
                                          </td>
                                          <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: '500' }}>{tbl.total_size}</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}

                            {/* Tab Content: Tablespaces */}
                            {dbActiveTab === 'tablespaces' && (
                              <div style={{ maxHeight: '340px', overflowY: 'auto', borderRadius: '8px', border: '1px solid var(--border)' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', textAlign: 'left' }}>
                                  <thead>
                                    <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 1 }}>
                                      <th style={{ padding: '8px 10px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>#</th>
                                      <th style={{ padding: '8px 10px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Tablespace Name</th>
                                      <th style={{ padding: '8px 10px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Location / Path</th>
                                      <th style={{ padding: '8px 10px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'right' }}>Total Size</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {dbEngineStatus.tablespaces && dbEngineStatus.tablespaces.length > 0 ? (
                                      dbEngineStatus.tablespaces.map((ts: any, i: number) => (
                                        <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', background: 'transparent' }}>
                                          <td style={{ padding: '7px 10px', fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{i + 1}</td>
                                          <td style={{ padding: '7px 10px', fontWeight: '600', color: 'var(--text-primary)' }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                              <HardDrive size={11} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                                              {ts.tablespace_name}
                                            </span>
                                          </td>
                                          <td style={{ padding: '7px 10px', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-secondary)' }}>{ts.location}</td>
                                          <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: '600', color: 'var(--accent)' }}>{ts.size}</td>
                                        </tr>
                                      ))
                                    ) : (
                                      <tr>
                                        <td colSpan={4} style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                                          No separate tablespaces configured (using default database storage).
                                        </td>
                                      </tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                            <Database size={24} style={{ opacity: 0.15, marginBottom: '10px' }} />
                            <div>{dbEngineLoading ? 'Querying database engine…' : 'Click Refresh to load live engine diagnostics'}</div>
                          </div>
                        )}
                      </div>

                    {/* Latency History Chart for Database Monitors */}
                    {metricsHistory.length > 0 && (
                      <div className="chart-section" style={{ marginTop: '16px' }}>
                        <div className="section-title" style={{ marginBottom: '8px' }}>
                          <span>Database Query Latency (24h)</span>
                        </div>
                        <ResponsiveContainer width="100%" height={190}>
                          <AreaChart data={metricsHistory.map((m: any) => ({
                            time: new Date(m.checked_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                            latency: m.response_time_ms || 0,
                          }))}>
                            <defs>
                              <linearGradient id="gLatency" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--accent)" stopOpacity={0.25}/><stop offset="95%" stopColor="var(--accent)" stopOpacity={0}/></linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                            <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={10} tick={{ fill: 'var(--text-muted)' }} interval="preserveStartEnd" minTickGap={40} />
                            <YAxis stroke="var(--text-muted)" fontSize={10} unit="ms" domain={[0, 'auto']} tick={{ fill: 'var(--text-muted)' }} />
                            <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '12px' }} />
                            <Area type="monotone" dataKey="latency" name="Latency" stroke="var(--accent)" fill="url(#gLatency)" strokeWidth={1.5} dot={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                )}

              {/* Standard Response Latency for HTTP, TCP, Ping, DNS */}
              {!isHostMetricType && !isDatabaseType && (
                <div className="detail-section">
                  <div className="section-title">Response Latency</div>
                  {heartbeats.length > 0 ? (
                    <div className="chart-section">
                      <ResponsiveContainer width="100%" height={190}>
                        <AreaChart data={heartbeats.map((h: any) => ({
                          time: new Date(h.checked_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                          latency: h.response_time_ms,
                        }))}>
                          <defs>
                            <linearGradient id="gLat" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={10} tick={{ fill: 'var(--text-muted)' }} interval="preserveStartEnd" minTickGap={40} />
                          <YAxis stroke="var(--text-muted)" fontSize={10} unit="ms" tick={{ fill: 'var(--text-muted)' }} />
                          <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '12px' }} />
                          <Area type="monotone" dataKey="latency" name="Latency" stroke="var(--accent)" fill="url(#gLat)" strokeWidth={2} dot={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center', padding: '20px' }}>No chart data.</div>
                  )}
                </div>
              )}

              {/* Error */}
              {sm.error && (
                <div className="detail-section">
                  <div className="error-alert">
                    <div className="error-alert-title">Active Error</div>
                    <div className="error-alert-msg">{sm.error}</div>
                  </div>
                </div>
              )}

              {/* Push docs */}
              {sm.type?.toLowerCase() === 'push' && (
                <div className="detail-section">
                  <div className="push-info-card">
                    <div className="push-info-title">Push Monitor Setup</div>
                    <p className="push-info-desc">Configure your scripts or cron jobs to push status updates to SNOOMP periodically.</p>
                    <div className="code-block">
{`# Heartbeat ping:
curl "${API_URL}/api/dashboard/push/${sm.id}"

# Push metrics:
curl -X POST -H "Content-Type: application/json" \\
  -d '{"cpu_percent":12.5,"mem_percent":45.0,"disk_percent":30.0,"uptime":"5 days"}' \\
  "${API_URL}/api/dashboard/push/${sm.id}"`}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ═══ EXECUTIVE DASHBOARD (HOMEPAGE) ═══ */
            <div className="anim-fade-in" style={{ padding: '24px' }}>
              {/* Executive Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', borderBottom: '1px solid var(--border)', paddingBottom: '16px' }}>
                <div>
                  <h1 style={{ fontSize: '24px', fontWeight: 800, fontFamily: 'var(--font-header)', letterSpacing: '-0.8px', margin: 0 }}>
                    System health
                  </h1>
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    All monitored services at a glance.
                  </p>
                </div>
                <button className="secondary" onClick={() => window.print()} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <FileText size={14} /> Download PDF Report
                </button>
              </div>

              {/* Status Alert Banner */}
              <div style={{ 
                background: downCount > 0 ? 'rgba(237, 66, 69, 0.1)' : 'rgba(59, 165, 92, 0.1)', 
                border: downCount > 0 ? '1px solid rgba(237, 66, 69, 0.25)' : '1px solid rgba(59, 165, 92, 0.25)', 
                borderRadius: 'var(--radius-md)', 
                padding: '16px 20px', 
                display: 'flex', 
                alignItems: 'center', 
                gap: '12px',
                marginBottom: '20px'
              }}>
                <div style={{
                  width: '12px', height: '12px', borderRadius: '50%',
                  background: downCount > 0 ? 'var(--color-down)' : 'var(--color-up)',
                  boxShadow: downCount > 0 ? '0 0 8px var(--color-down)' : '0 0 8px var(--color-up-glow)',
                  animation: 'ripple 2s infinite'
                }} />
                <div>
                  <h4 style={{ margin: 0, fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)' }}>
                    {downCount > 0 ? `${downCount} Active Incident(s) Detected` : 'All Systems Operational'}
                  </h4>
                  <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                    {downCount > 0 
                      ? 'Some infrastructure components are experiencing connectivity issues or degraded performance.' 
                      : 'All monitored endpoints and resources are responding normally.'
                    }
                  </p>
                </div>
              </div>

              {/* KPI cards grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                <div className="metric-card" style={{ padding: '16px 20px' }}>
                  <span className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-up)' }} />
                    Global Uptime (24h)
                  </span>
                  <div style={{ fontSize: '28px', fontWeight: 600, color: 'var(--text-primary)', marginTop: '8px', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.5px' }}>
                    {(() => {
                      const totalUptimes = filteredMonitors.filter(m => m.enabled).map(m => m.uptime_24h ?? 100);
                      if (totalUptimes.length === 0) return '100.00%';
                      const avg = totalUptimes.reduce((a, b) => a + b, 0) / totalUptimes.length;
                      return `${avg.toFixed(2)}%`;
                    })()}
                  </div>
                  <span className="radial-sub">Average across active hosts</span>
                </div>

                <div className="metric-card" style={{ padding: '16px 20px' }}>
                  <span className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text-muted)' }} />
                    Monitored Hosts
                  </span>
                  <div style={{ fontSize: '28px', fontWeight: 600, color: 'var(--text-primary)', marginTop: '8px', fontFamily: 'var(--font-mono)', letterSpacing: '-0.5px' }}>
                    {filteredMonitors.length}
                  </div>
                  <span className="radial-sub">{filteredMonitors.filter(m => m.enabled).length} enabled / {filteredMonitors.filter(m => !m.enabled).length} paused</span>
                </div>

                <div className="metric-card" style={{ padding: '16px 20px' }}>
                  <span className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: downCount > 0 ? 'var(--color-down)' : 'var(--text-muted)' }} />
                    Active Incidents
                  </span>
                  <div style={{ fontSize: '28px', fontWeight: 600, color: downCount > 0 ? 'var(--color-down)' : 'var(--text-primary)', marginTop: '8px', fontFamily: 'var(--font-mono)', letterSpacing: '-0.5px' }}>
                    {downCount}
                  </div>
                  <span className="radial-sub">Currently failing healthchecks</span>
                </div>

                <div className="metric-card" style={{ padding: '16px 20px' }}>
                  <span className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-warning)' }} />
                    Avg Response Time
                  </span>
                  <div style={{ fontSize: '28px', fontWeight: 600, color: 'var(--text-primary)', marginTop: '8px', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.5px' }}>
                    {(() => {
                      const activeRes = filteredMonitors.filter(m => m.response_time_ms > 0).map(m => m.response_time_ms);
                      if (activeRes.length === 0) return '0 ms';
                      const avg = activeRes.reduce((a, b) => a + b, 0) / activeRes.length;
                      return `${avg.toFixed(0)} ms`;
                    })()}
                  </div>
                  <span className="radial-sub">Overall system responsiveness</span>
                </div>
              </div>

              {/* Outages & Hosts Overview Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px', marginBottom: '24px' }}>
                {/* Active Incidents / Outages */}
                <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '20px' }}>
                  <h3 style={{ margin: '0 0 14px', fontSize: '15px', fontWeight: 700 }}>Outages & Alerts</h3>
                  {filteredMonitors.filter(m => m.status === 'down' || m.status === 'critical').length === 0 ? (
                    <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                      No active outages detected.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {filteredMonitors.filter(m => m.status === 'down' || m.status === 'critical').map(m => (
                        <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'rgba(237, 66, 69, 0.05)', border: '1px solid rgba(237, 66, 69, 0.15)', borderRadius: 'var(--radius-sm)' }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--color-down)' }}>{m.name}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{m.host} ({m.type.toUpperCase()})</div>
                          </div>
                          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-down)', textTransform: 'uppercase' }}>
                            {m.error || 'Connection Failed'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Quick Monitors Table */}
                <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '20px' }}>
                  <h3 style={{ margin: '0 0 14px', fontSize: '15px', fontWeight: 700 }}>Infrastructure Overview</h3>
                  <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {filteredMonitors.map(m => (
                      <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className={`status-dot ${m.status || 'off'}`} style={{ width: '8px', height: '8px' }} />
                          <span style={{ fontSize: '13px', fontWeight: 500 }}>{m.name}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                          <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                            {m.response_time_ms > 0 ? `${m.response_time_ms.toFixed(0)} ms` : '—'}
                          </span>
                          <span style={{ fontSize: '11.5px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: m.status === 'up' ? 'var(--color-up)' : 'var(--color-down)' }}>
                            {m.uptime_24h ? `${m.uptime_24h.toFixed(1)}%` : '—'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Recent Incidents list */}
              {incidents.length > 0 && (
                <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '20px' }}>
                  <div className="section-title" style={{ marginBottom: '12px' }}>Recent Incidents Log</div>
                  <div className="incidents-list" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                    {incidents.map((inc: any) => (
                      <div key={inc.id} className="incident-row" style={{ padding: '8px 4px' }}>
                        <div>
                          <span className="incident-name" style={{ color: inc.to_status === 'up' ? 'var(--color-up)' : 'var(--color-down)' }}>{inc.target_name}</span>
                          <span className="incident-transition"> {inc.from_status.toUpperCase()} → {inc.to_status.toUpperCase()}</span>
                        </div>
                        <span className="incident-time">{new Date(inc.started_at).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* ─── USER PREFERENCES MODAL ─── */}
      <UserPreferencesModal
        isOpen={showPreferencesModal}
        onClose={() => setShowPreferencesModal(false)}
        preferences={userPreferences}
        monitors={monitors}
        allTags={allTags}
        onRenameTag={handleRenameTag}
        onDeleteTag={handleDeleteTag}
        onAddTag={handleAddTag}
        onSave={(newPrefs) => {
          setUserPreferences(newPrefs);
          localStorage.setItem('snoomp_sla_normal', newPrefs.sla.normal.toString());
          localStorage.setItem('snoomp_sla_warning', newPrefs.sla.warning.toString());
          localStorage.setItem('snoomp_sla_critical', newPrefs.sla.critical.toString());
          localStorage.setItem('snoomp_sound_alerts', newPrefs.soundAlerts.toString());
          localStorage.setItem('snoomp_browser_notifications', newPrefs.browserNotifications.toString());
          localStorage.setItem('snoomp_check_interval', newPrefs.defaultCheckInterval.toString());
          localStorage.setItem('snoomp_time_format', newPrefs.timeFormat);
          setTheme(newPrefs.theme);
          changeAccent(newPrefs.accent);
          setShowPreferencesModal(false);
        }}
      />

      {/* ─── BATCH EDIT MODAL ─── */}
      <BatchEditModal
        isOpen={isBatchEditModalOpen}
        onClose={() => setIsBatchEditModalOpen(false)}
        selectedCount={selectedMonitorIds.length}
        selectedMonitors={monitors.filter(m => selectedMonitorIds.includes(m.id))}
        existingTags={allTags}
        onApplyBatch={handleApplyBatchEdit}
      />

      {/* ─── MONITOR MODAL ─── */}
      <MonitorModal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); setEditingMonitor(null); }}
        onSave={handleSaveMonitor}
        editingMonitor={editingMonitor}
        token={token}
        existingTags={allTags}
      />

      {/* ─── STATUS PAGE CREATE/EDIT MODAL ─── */}
      {showSpModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowSpModal(false)}>
          <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="sp-modal-title" style={{ width: '540px', padding: '24px', borderRadius: '24px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}>
            <div className="modal-header" style={{ marginBottom: '20px' }}>
              <div>
                <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--text-muted)', fontWeight: 700 }}>Status Page Configuration</span>
                <h3 id="sp-modal-title" style={{ margin: 0, fontSize: '20px', fontWeight: 700, fontFamily: 'var(--font-header)' }}>{editingPage ? 'Edit Status Page' : 'New Status Page'}</h3>
              </div>
              <button type="button" aria-label="Close modal" className="secondary" style={{ padding: '8px', borderRadius: '50%' }} onClick={() => setShowSpModal(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Page Name *</label>
              <input
                type="text" placeholder="e.g. Production Status"
                value={spForm.name}
                onChange={e => setSpForm(p => ({ ...p, name: e.target.value }))}
                style={{ borderRadius: '10px', padding: '10px 14px' }}
              />
            </div>

            <div className="form-row" style={{ gap: '16px', marginBottom: '16px' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Slug (URL path) *</label>
                <input
                  type="text" placeholder="e.g. production"
                  value={spForm.slug}
                  onChange={e => setSpForm(p => ({ ...p, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))}
                  style={{ borderRadius: '10px', padding: '10px 14px' }}
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Visibility</label>
                <select value={spForm.is_public ? 'public' : 'private'} onChange={e => setSpForm(p => ({ ...p, is_public: e.target.value === 'public' }))} style={{ borderRadius: '10px', padding: '10px 14px' }}>
                  <option value="public">Public (no login)</option>
                  <option value="private">Private</option>
                </select>
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Description</label>
              <textarea
                rows={2} placeholder="Optional description shown on the status page"
                value={spForm.description}
                onChange={e => setSpForm(p => ({ ...p, description: e.target.value }))}
                style={{ resize: 'vertical', borderRadius: '10px', padding: '10px 14px' }}
              />
            </div>

            <div className="form-group" style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <label style={{ margin: 0, fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Monitors to Display</label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input 
                    type="text" 
                    placeholder="Search monitors..." 
                    value={spSearch} 
                    onChange={e => setSpSearch(e.target.value)}
                    style={{ padding: '6px 12px', fontSize: '12px', width: '160px', borderRadius: '8px' }}
                  />
                  <button 
                    type="button" 
                    className="secondary" 
                    style={{ padding: '6px 12px', fontSize: '12px', borderRadius: '8px' }}
                    onClick={() => {
                      const filteredIds = monitors
                        .filter(m => (m.name + (m.host || '')).toLowerCase().includes(spSearch.toLowerCase()))
                        .map(m => m.id);
                      
                      const allSelected = filteredIds.every(id => spForm.monitor_ids.includes(id));
                      if (allSelected) {
                        setSpForm(p => ({ ...p, monitor_ids: p.monitor_ids.filter(id => !filteredIds.includes(id)) }));
                      } else {
                        setSpForm(p => ({ ...p, monitor_ids: Array.from(new Set([...p.monitor_ids, ...filteredIds])) }));
                      }
                    }}
                  >
                    {monitors
                      .filter(m => (m.name + (m.host || '')).toLowerCase().includes(spSearch.toLowerCase()))
                      .every(m => spForm.monitor_ids.includes(m.id)) && monitors.filter(m => (m.name + (m.host || '')).toLowerCase().includes(spSearch.toLowerCase())).length > 0
                      ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
              </div>
              <div className="sp-form-monitors" style={{ border: '1px solid var(--border)', borderRadius: '12px', padding: '8px', maxHeight: '180px', overflowY: 'auto', background: 'var(--bg-void)' }}>
                {monitors.length === 0 ? (
                  <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                    No monitors available yet. Add a monitor first or{' '}
                    <button type="button" onClick={fetchMonitorsDirectly} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline', fontWeight: 600, padding: 0, font: 'inherit' }}>
                      click to reload
                    </button>
                  </div>
                ) : monitors.filter(m => (m.name + (m.host || '')).toLowerCase().includes(spSearch.toLowerCase())).length === 0 ? (
                  <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                    No monitors matching &quot;{spSearch}&quot;
                  </div>
                ) : (
                  monitors
                    .filter(m => (m.name + (m.host || '')).toLowerCase().includes(spSearch.toLowerCase()))
                    .map(m => (
                    <label key={m.id} className="sp-monitor-check" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: '8px', cursor: 'pointer', transition: 'background 0.15s' }}>
                      <input
                        type="checkbox"
                        checked={spForm.monitor_ids.includes(m.id)}
                        onChange={e => {
                          if (e.target.checked) {
                            setSpForm(p => ({ ...p, monitor_ids: [...p.monitor_ids, m.id] }));
                          } else {
                            setSpForm(p => ({ ...p, monitor_ids: p.monitor_ids.filter(id => id !== m.id) }));
                          }
                        }}
                        style={{ margin: 0 }}
                      />
                      <div className={`status-dot ${m.status || 'off'}`} style={{ width: '8px', height: '8px', flexShrink: 0, borderRadius: '50%' }} />
                      <span style={{ fontWeight: 600, fontSize: '13px' }}>{m.name}</span>
                      <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{m.host}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            {/* Preview URL */}
            {spForm.slug && (
              <div className="form-group">
                <label>Public URL Preview</label>
                <div className="sp-url-row">
                  <input readOnly value={`${window.location.origin}/status/${spForm.slug}`} style={{ fontSize: '12px', color: 'var(--text-muted)' }} />
                </div>
              </div>
            )}

            <div className="form-actions">
              <button className="secondary" onClick={() => setShowSpModal(false)}>Cancel</button>
              <button onClick={handleSaveStatusPage} disabled={spSaving}>
                {spSaving ? 'Saving…' : (editingPage ? 'Update Page' : 'Create Page')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── PDF REPORT GENERATION MODAL ─── */}
      {showReportModal && reportTarget && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowReportModal(false)}>
          <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="report-modal-title" style={{ width: '600px', background: 'var(--bg-elevated)' }}>
            <div className="modal-header">
              <h3 id="report-modal-title">Generate Availability Report</h3>
              <button type="button" aria-label="Close modal" className="secondary" style={{ padding: '6px' }} onClick={() => setShowReportModal(false)}>
                <X size={16} />
              </button>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontWeight: '700', fontSize: '15px', color: 'var(--text-primary)' }}>{reportTarget.name}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{reportTarget.host} ({reportTarget.type.toUpperCase()})</div>
            </div>

            <div className="form-group" style={{ marginBottom: '20px' }}>
              <label>Select Report Time Range</label>
              <select 
                value={reportRange} 
                onChange={e => handleGenerateReport(reportTarget, Number(e.target.value))}
                style={{ width: '100%', padding: '10px' }}
              >
                <option value={24}>Last 24 Hours</option>
                <option value={168}>Last 7 Days</option>
                <option value={720}>Last 30 Days</option>
                <option value={2160}>Last 90 Days</option>
              </select>
            </div>

            {reportLoading ? (
              <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                ⏳ Querying database and calculating metrics...
              </div>
            ) : reportData ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Stats Summary Preview */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '6px', textAlign: 'center', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Uptime</div>
                    <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--color-up)', marginTop: '4px' }}>
                      {reportData.uptimePct.toFixed(2)}%
                    </div>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '6px', textAlign: 'center', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>MTTR</div>
                    <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-primary)', marginTop: '4px' }}>
                      {reportData.mttrMin} Mins
                    </div>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '6px', textAlign: 'center', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>MTBF</div>
                    <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-primary)', marginTop: '4px' }}>
                      {reportData.mtbfHours} Hours
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Total outages in period: <span style={{ fontWeight: '700', color: reportData.failures > 0 ? 'var(--color-down)' : 'var(--text-muted)' }}>{reportData.failures}</span>
                </div>

                <div className="form-actions" style={{ marginTop: '10px' }}>
                  <button className="secondary" onClick={() => setShowReportModal(false)}>Close</button>
                  <button 
                    onClick={() => {
                      setIsPrintingReport(true);
                      setTimeout(() => {
                        window.print();
                        setIsPrintingReport(false);
                      }, 500);
                    }}
                    style={{ background: 'var(--color-up)', color: '#fff', border: 'none' }}
                  >
                    🖨️ Export PDF / Print Report
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* ─── FULL SCREEN PRINT LAYOUT FOR AVAILABILITY REPORT ─── */}
      {isPrintingReport && reportTarget && reportData && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
          background: '#fff', color: '#000', zIndex: 99999, padding: '40px',
          fontFamily: 'system-ui, -apple-system, sans-serif', overflowY: 'auto'
        }} className="print-report-container">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #333', paddingBottom: '12px', marginBottom: '24px' }}>
            <div>
              <h1 style={{ margin: 0, fontSize: '24px', fontWeight: '800', color: '#000' }}>AVAILABILITY REPORT</h1>
              <div style={{ fontSize: '12px', color: '#555', marginTop: '4px' }}>
                Generated on {new Date().toLocaleString()} · SNOOMP Health Monitor
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <h2 style={{ margin: 0, fontSize: '18px', color: '#000' }}>{reportTarget.name}</h2>
              <div style={{ fontSize: '12px', color: '#555' }}>{reportTarget.host}</div>
            </div>
          </div>

          <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#333', marginBottom: '16px' }}>
            Last {reportRange === 24 ? '24 Hours' : `${reportRange / 24} Days`} Availability Report for {reportTarget.name}
          </h3>

          {/* Availability Chart & Summaries Row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '24px', marginBottom: '30px' }}>
            {/* Visual availability chart */}
            <div style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontSize: '12px', fontWeight: '700', color: '#555', marginBottom: '12px' }}>Monitor Availability Chart</div>
              <div style={{
                width: '120px', height: '120px', borderRadius: '50%',
                background: `conic-gradient(#2ea44f 0% ${reportData.uptimePct}%, #cf222e ${reportData.uptimePct}% 100%)`,
                display: 'flex', alignItems: 'center', justifySelf: 'center',
                boxShadow: 'inset 0 0 10px rgba(0,0,0,0.1)'
              }} />
              <div style={{ display: 'flex', gap: '12px', fontSize: '11px', marginTop: '14px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '8px', height: '8px', background: '#2ea44f', borderRadius: '50%' }} />
                  Uptime ({reportData.uptimePct.toFixed(1)}%)
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '8px', height: '8px', background: '#cf222e', borderRadius: '50%' }} />
                  Downtime ({reportData.downtimePct.toFixed(1)}%)
                </span>
              </div>
            </div>

            {/* Summaries tables */}
            <div style={{ display: 'grid', gridTemplateRows: '1fr 1fr', gap: '12px' }}>
              {/* Table 1: Downtime/Uptime Summary */}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: '#f5f5f5', borderBottom: '1px solid #ddd' }}>
                    <th colSpan={2} style={{ textAlign: 'left', padding: '6px 8px', fontWeight: '700', color: '#333' }}>Monitor Downtime/Uptime Summary</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '6px 8px', color: '#555' }}>Total Downtime</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: '600' }}>
                      {Math.floor(reportData.totalDowntimeSec / 3600)} Hrs {Math.floor((reportData.totalDowntimeSec % 3600) / 60)} Mins
                    </td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '6px 8px', color: '#555' }}>Total Downtime Percentage</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: '600' }}>{reportData.downtimePct.toFixed(2)}%</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '6px 8px', color: '#555' }}>Total Uptime Percentage</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: '600', color: '#2ea44f' }}>{reportData.uptimePct.toFixed(2)}%</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '6px 8px', color: '#555' }}>Mean Time To Repair (MTTR)</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: '600' }}>{reportData.mttrMin} Mins</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '6px 8px', color: '#555' }}>Mean Time Between Failures (MTBF)</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: '600' }}>{reportData.mtbfHours} Hours</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Downtime History Table */}
          <div style={{ marginBottom: '30px' }}>
            <h4 style={{ fontSize: '13px', fontWeight: '700', color: '#333', background: '#f5f5f5', padding: '6px 8px', margin: '0 0 10px', borderBottom: '1px solid #ddd' }}>
              Monitor Downtime History
            </h4>
            {reportData.downtimeLogs.length === 0 ? (
              <div style={{ padding: '16px', border: '1px solid #eee', borderRadius: '4px', textAlign: 'center', fontSize: '12px', color: '#666' }}>
                No downtime events logged during this period.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #ddd', color: '#555' }}>
                    <th style={{ padding: '6px' }}>Start Time</th>
                    <th style={{ padding: '6px' }}>End Time</th>
                    <th style={{ padding: '6px' }}>Duration</th>
                    <th style={{ padding: '6px' }}>Error Details</th>
                  </tr>
                </thead>
                <tbody>
                  {reportData.downtimeLogs.map((log: any, idx: number) => {
                    const durationSec = Math.round((log.ended.getTime() - log.started.getTime()) / 1000);
                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: '6px', color: '#000' }}>{log.started.toLocaleString()}</td>
                        <td style={{ padding: '6px', color: '#000' }}>{log.ended ? log.ended.toLocaleString() : 'Active Outage'}</td>
                        <td style={{ padding: '6px', fontWeight: '600' }}>
                          {durationSec >= 3600 ? `${Math.floor(durationSec / 3600)}h ` : ''}
                          {Math.floor((durationSec % 3600) / 60)}m {durationSec % 60}s
                        </td>
                        <td style={{ padding: '6px', color: '#cf222e' }}>{log.error || 'Connection Timeout'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Help Card */}
          <div style={{ border: '1px solid #ffcc00', background: '#fffbeb', padding: '16px', borderRadius: '6px', fontSize: '11px', color: '#665c00' }}>
            <h5 style={{ margin: '0 0 6px', fontWeight: '700' }}>Glossary & Definitions</h5>
            <p style={{ margin: '4px 0' }}>
              <strong>Mean Time To Repair (MTTR):</strong> The average time taken to resolve a device or system outage and restore normal operating conditions. Lower MTTR values indicate faster incident resolution.
            </p>
            <p style={{ margin: '4px 0' }}>
              <strong>Mean Time Between Failures (MTBF):</strong> The average elapsed time between system crashes or service outages. Higher MTBF values represent higher infrastructure stability.
            </p>
          </div>
        </div>
      )}

      {/* User Preferences Modal (SLA, Appearance, Notifications, Defaults) */}
      <UserPreferencesModal
        isOpen={showPreferencesModal}
        onClose={() => setShowPreferencesModal(false)}
        preferences={userPreferences}
        onSave={handleSaveUserPreferences}
      />
    </div>
  );
}

export default App;
