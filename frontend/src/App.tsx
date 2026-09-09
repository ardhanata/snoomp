import React, { useState, useEffect, useRef } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import {
  Shield, Power, Trash2, Edit3, Plus,
  Search, Cpu, HardDrive, MemoryStick, Clock,
  Zap, Globe, Copy, ExternalLink, X,
  LayoutDashboard, Pencil, Check, ChevronDown, FileText,
  Database, RefreshCw, Server, Activity, Sun, Moon, TrendingUp, Sliders,
  CheckSquare, Share2, Printer, Menu,
  Download, ArrowUpCircle
} from 'lucide-react';

import './styles/dashboard.css';
import './styles/toast.css';
import RadialGauge from './components/RadialGauge';
import PublicStatusPage from './components/PublicStatusPage';
import Dialog from './components/Dialog';
import { SnoompLogo } from './components/SnoompLogo';
import ExecutiveDashboard, { SlaTrend } from './components/ExecutiveDashboard';
import DatabaseMetricsChart from './components/DatabaseMetricsChart';
import MonitorRow from './components/MonitorRow';
import { InstanceSettings, readCache, fetchSettings, applyAppearance } from './lib/settings';
import { downloadPdf } from './lib/downloadPdf';

const MonitorModal = React.lazy(() => import('./components/MonitorModal'));
const BatchEditModal = React.lazy(() => import('./components/BatchEditModal'));
const UserPreferencesModal = React.lazy(() => import('./components/UserPreferencesModal'));
const UpdateModal = React.lazy(() => import('./components/UpdateModal'));

const API_URL = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? window.location.origin : '');
const WS_PROTOCOL = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = import.meta.env.VITE_WS_URL || (typeof window !== 'undefined' ? `${WS_PROTOCOL}//${window.location.host}` : '');



// ── Helpers ──

/**
 * Copy text to the clipboard, working in non-secure contexts.
 *
 * `navigator.clipboard` is undefined on plain http (anything other than
 * localhost), which is how Snoomp is served in native-Windows mode on a LAN
 * IP. Reading `.writeText` off undefined throws synchronously, so every call
 * site must go through this helper rather than touching the API directly.
 * Falls back to the execCommand path, which has no secure-context requirement.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy path
    }
  }

  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.top = '-9999px';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

/** Absolute URL that deep-links back to a specific monitor. */
function monitorShareUrl(monitorId: string): string {
  return `${window.location.origin}${window.location.pathname}?monitor=${encodeURIComponent(monitorId)}`;
}

/**
 * Kernel/pseudo filesystems that carry no operational signal — tmpfs, cgroup,
 * per-user runtime dirs. They sit at 0% forever and only add noise to the
 * volume grid.
 */
const PSEUDO_FS_PREFIXES = ['/dev', '/sys', '/run'];

/**
 * Real, user-meaningful volumes only.
 *
 * `mount` is optional in practice — some SNMP agents report a filesystem row
 * with no mount point — so this must not assume the field is a string.
 */
function visibleVolumes(disks: any[] | undefined | null): any[] {
  if (!Array.isArray(disks)) return [];
  return disks.filter(dk => {
    const mount = dk?.mount;
    if (typeof mount !== 'string' || mount === '') return false;
    return !PSEUDO_FS_PREFIXES.some(prefix => mount.startsWith(prefix));
  });
}

// ponytail: clear inline styles on default accent so CSS data-theme tokens resolve naturally
function applyAccent(color: string, currentTheme?: string) {
  const isLight = (currentTheme || document.documentElement.getAttribute('data-theme')) === 'light';
  if (!color || color.toLowerCase() === '#3b82f6') {
    document.documentElement.style.removeProperty('--accent');
    document.documentElement.style.removeProperty('--accent-rgb');
    document.documentElement.style.removeProperty('--accent-glow');
    document.documentElement.style.removeProperty('--accent-dim');
    return;
  }
  let hex = color;
  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);
  if (isLight) {
    r = Math.round(r * 0.72);
    g = Math.round(g * 0.72);
    b = Math.round(b * 0.72);
    hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
  document.documentElement.style.setProperty('--accent', hex);
  document.documentElement.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
  document.documentElement.style.setProperty('--accent-glow', `rgba(${r},${g},${b},0.2)`);
  document.documentElement.style.setProperty('--accent-dim', `rgba(${r},${g},${b},0.1)`);
}

/**
 * Strip the inline theme colours off <html> for the duration of printing.
 *
 * index.html sets `documentElement.style.backgroundColor` before React boots to
 * avoid a flash of the wrong theme. That inline value paints the page *canvas*,
 * which in print covers the entire sheet rather than just the content box — so
 * in dark theme the PDF came out with a black frame around the report.
 *
 * The print stylesheet already overrides it, but an inline style is exactly the
 * kind of thing that wins by accident (a future `!important` on the inline set,
 * a UA quirk, a browser that resolves the canvas before author styles). Removing
 * it outright for the print job removes the dependency on cascade order, and it
 * is restored immediately afterwards so the on-screen anti-flash still works.
 */
function usePrintSurface() {
  useEffect(() => {
    const root = document.documentElement;
    let saved: { bg: string; color: string } | null = null;

    const before = () => {
      saved = { bg: root.style.backgroundColor, color: root.style.color };
      root.style.removeProperty('background-color');
      root.style.removeProperty('color');
    };
    const after = () => {
      if (!saved) return;
      if (saved.bg) root.style.backgroundColor = saved.bg;
      if (saved.color) root.style.color = saved.color;
      saved = null;
    };

    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
      after();
    };
  }, []);
}

/** Hoisted: constructing an Intl formatter per render is not free. */
const numberFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

/** Selectable buckets in the sidebar stats strip. */
const STATUS_FILTERS = ['up', 'down', 'warn'] as const;
type StatusFilter = typeof STATUS_FILTERS[number] | null;

/** Narrow an untrusted query-string value to a valid status filter. */
function parseStatusFilter(raw: string | null): StatusFilter {
  return STATUS_FILTERS.some(s => s === raw) ? (raw as StatusFilter) : null;
}

/** Collapse a raw monitor status onto one of the strip's buckets. */
function statusBucket(status: string | undefined | null): StatusFilter {
  switch ((status || '').toLowerCase()) {
    case 'up': return 'up';
    case 'warning': return 'warn';
    case 'down':
    case 'critical': return 'down';
    default: return null;
  }
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
    applyAccent(color, theme);
  };
  useEffect(() => { applyAccent(accentColor, theme); }, []); // eslint-disable-line

  // ── Auth ──
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('snoomp_token'));
  const [role, setRole] = useState<string | null>(() => localStorage.getItem('snoomp_role'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  // ── Theme ──
  const [theme, setTheme] = useState(() => localStorage.getItem('snoomp_theme') || 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('snoomp_theme', theme);
    applyAccent(accentColor, theme);
  }, [theme, accentColor]);

  // ── Toasts ──
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  // ── URL Params Initialization ──
  const searchParams = new URLSearchParams(window.location.search);

  // ── View state ──
  const [view, setView] = useState<'dashboard' | 'status-pages' | 'executive'>(
    (searchParams.get('view') as any) || 'dashboard'
  );
  const [initialLoading, setInitialLoading] = useState(true);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showPreferencesModal, setShowPreferencesModal] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [hasUpdate, setHasUpdate] = useState(false);
  const [latestVersion, setLatestVersion] = useState('');
  const [appVersion, setAppVersion] = useState('v1.0.0');
  const profileMenuRef = useRef<HTMLDivElement>(null);

  const fetchVersion = async () => {
    try {
      const res = await fetch(`${API_URL}/api/version`);
      if (res.ok) {
        const data = await res.json();
        if (data.version) setAppVersion(`v${data.version}`);
      }
    } catch { }
  };

  const checkForUpdatesSilently = async () => {
    try {
      const res = await fetch(`${API_URL}/api/system/check-updates`);
      if (res.ok) {
        const data = await res.json();
        if (data.has_update) {
          setHasUpdate(true);
          if (data.latest_version) setLatestVersion(data.latest_version);
        }
      }
    } catch { }
  };

  useEffect(() => {
    fetchVersion();
    checkForUpdatesSilently();
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

  /**
   * Instance settings, served by /api/settings.
   *
   * Seeded from a localStorage cache purely so SLA badge colours and chart
   * colours are correct on first paint; the server response replaces it as
   * soon as it lands. These are shared across operators — theme and accent
   * remain per-person and stay in localStorage.
   */
  const [instanceSettings, setInstanceSettings] = useState<InstanceSettings>(() => readCache());

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchSettings(API_URL, token)
      .then(s => {
        if (cancelled) return;
        setInstanceSettings(s);
        applyAppearance(s.appearance);
      })
      .catch(() => { /* cached values remain in effect */ });
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => { applyAppearance(instanceSettings.appearance); }, [instanceSettings.appearance]);



  // ── Dashboard ──
  const [monitors, setMonitors] = useState<any[]>([]);
  const [selectedMonitor, setSelectedMonitor] = useState<any>(null);
  const [stats, setStats] = useState<any>({
    total_targets: 0, status_summary: { up: 0, down: 0, warning: 0, critical: 0 }
  });
  const [heartbeats, setHeartbeats] = useState<any[]>([]);
  const [metricsHistory, setMetricsHistory] = useState<any[]>([]);
  const [resourceHours, setResourceHours] = useState<number>(24);
  const [dbEngineStatus, setDbEngineStatus] = useState<any>(null);
  const [dbEngineLoading, setDbEngineLoading] = useState(false);
  const [dbActiveTab, setDbActiveTab] = useState<'slow_queries' | 'tables' | 'tablespaces'>(
    (searchParams.get('dbTab') as any) || 'slow_queries'
  );
  const [incidents, setIncidents] = useState<any[]>([]);
  const [slaTrend, setSlaTrend] = useState<SlaTrend | null>(null);
  const [slaTrendLoading, setSlaTrendLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState(searchParams.get('q') || '');
  const [selectedGroupTag, setSelectedGroupTag] = useState<string | null>(searchParams.get('group'));
  const [selectedEnvTag, setSelectedEnvTag] = useState<string | null>(searchParams.get('env'));

  /** Status filter driven by the stats strip. `null` = show everything. */
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    () => parseStatusFilter(searchParams.get('status'))
  );

  /* Below the drawer breakpoint the sidebar is off-canvas. Closed by default —
     on a narrow screen the monitor detail is what you came for. */
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const drawerToggleRef = useRef<HTMLButtonElement>(null);
  const mainContentRef = useRef<HTMLElement>(null);

  /* Filters live behind a disclosure to keep the monitor list above the fold.
     Opens by default on a clean session, stays closed once the user closes it. */
  const [filtersOpen, setFiltersOpen] = useState(
    () => localStorage.getItem('snoomp_filters_open') !== 'false'
  );
  const toggleFilters = () => {
    setFiltersOpen(prev => {
      localStorage.setItem('snoomp_filters_open', String(!prev));
      return !prev;
    });
  };

  // ── Batch Operation & Tag Management States ──
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [selectedMonitorIds, setSelectedMonitorIds] = useState<string[]>([]);
  const [isBatchEditModalOpen, setIsBatchEditModalOpen] = useState(false);

  // ── Monitor Modal ──
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMonitor, setEditingMonitor] = useState<any>(null);

  // ── Status Pages ──
  const [statusPages, setStatusPages] = useState<StatusPageData[]>([]);
  const [showSpModal, setShowSpModal] = useState(false);
  const [editingPage, setEditingPage] = useState<StatusPageData | null>(null);
  const [spForm, setSpForm] = useState<StatusPageForm>(DEFAULT_SP_FORM);
  const [spSaving, setSpSaving] = useState(false);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const deepLinkResolved = useRef(false);
  const [spSearch, setSpSearch] = useState('');

  // ── Grouping ──
  const [groupBy, setGroupBy] = useState<'none' | 'tags' | 'type'>(
    (searchParams.get('groupBy') as any) || (localStorage.getItem('snoomp_group_by') as 'none' | 'tags' | 'type') || (localStorage.getItem('snoomp_group_by_tags') === 'true' ? 'tags' : 'none')
  );
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);

  /* Load the trend lazily on first visit to the Executive view. */
  useEffect(() => {
    if (view === 'executive' && !slaTrend && !slaTrendLoading) fetchSlaTrend();
  }, [view, token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (view === 'executive') document.title = 'Executive Dashboard - Snoomp';
    else if (view === 'status-pages') document.title = 'Status Pages - Snoomp';
    else if (view === 'dashboard' && selectedMonitor) document.title = `${selectedMonitor.name} - Snoomp`;
    else document.title = 'Snoomp';
  }, [view, selectedMonitor]);

  /**
   * Drawer side effects, all keyed off `sidebarOpen`.
   *
   * `inert` rather than `aria-hidden` on the background: aria-hidden leaves the
   * content keyboard-focusable, so Tab would walk into an invisible region.
   * It's set imperatively because React 18 doesn't type the attribute.
   */
  useEffect(() => {
    if (!sidebarOpen) return;

    const main = mainContentRef.current;
    main?.setAttribute('inert', '');
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    // Above the breakpoint the sidebar is a normal column again — leaving the
    // drawer "open" would strand `inert` on the main content after a resize.
    const mq = window.matchMedia('(min-width: 901px)');
    const onBreakpoint = (e: MediaQueryListEvent) => {
      if (e.matches) setSidebarOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    mq.addEventListener('change', onBreakpoint);

    return () => {
      main?.removeAttribute('inert');
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      mq.removeEventListener('change', onBreakpoint);
      // Send focus back where it came from, not to the top of the document.
      drawerToggleRef.current?.focus();
    };
  }, [sidebarOpen]);

  // ── URL State Synchronization ──
  //
  // Gated on `initialLoading` for a reason: this effect writes `selectedMonitor`
  // (null on mount) into the query string. If it ran before the monitor list
  // resolved it would strip the incoming `?monitor=<id>` from a shared link,
  // and the deep-link resolver in fetchMonitorsDirectly — which reads the param
  // back off window.location — would find nothing. Wait for the list first.
  //
  // Debounced because `searchTerm` changes on every keystroke and Safari
  // throttles history.replaceState to ~100 calls per 30s before throwing.
  useEffect(() => {
    if (initialLoading) return;
    if (window.location.pathname.startsWith('/status/')) return;

    const timer = setTimeout(() => {
      const url = new URL(window.location.href);
      const setOrDelete = (key: string, value: string | null | undefined) => {
        if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
      };

      setOrDelete('q', searchTerm);
      setOrDelete('group', selectedGroupTag);
      setOrDelete('env', selectedEnvTag);
      setOrDelete('status', statusFilter);
      setOrDelete('groupBy', groupBy !== 'none' ? groupBy : null);
      setOrDelete('dbTab', dbActiveTab !== 'slow_queries' ? dbActiveTab : null);
      setOrDelete('view', view !== 'dashboard' ? view : null);
      setOrDelete('monitor', selectedMonitor?.id);

      if (url.toString() !== window.location.href) {
        window.history.replaceState({}, '', url.toString());
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [initialLoading, searchTerm, selectedGroupTag, selectedEnvTag, statusFilter, groupBy, dbActiveTab, view, selectedMonitor]);

  // ── Availability Reports ──
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportTarget, setReportTarget] = useState<any>(null);
  const [reportRange, setReportRange] = useState<number>(168); // Hours: 24, 168 (7d), 720 (30d), 2160 (90d)
  const [reportData, setReportData] = useState<any>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState<string | null>(null);

  /**
   * Fetch a server-generated PDF and hand it to the browser as a download.
   * Replaces window.print(): the document is composed server-side, so the
   * output no longer depends on the viewer's browser, theme or print dialog.
   */
  const getPdf = React.useCallback(async (path: string, key: string) => {
    setDownloadingPdf(key);
    const res = await downloadPdf(`${API_URL}${path}`, token);
    setDownloadingPdf(null);
    if (!res.ok) showToast(res.error || 'Could not build the report.');
    else showToast(`Downloaded ${res.filename}`);
  }, [token]);

  usePrintSurface();


  const handleGenerateReport = async (target: any, hours: number) => {
    setReportTarget(target);
    setReportRange(hours);
    setReportLoading(true);
    setShowReportModal(true);

    try {
      // The server aggregates this. It used to be computed here by deriving a
      // row limit from the check interval, fetching that many heartbeats, then
      // reducing them in the browser — ~130k rows for a 90-day report.
      const res = await fetch(
        `${API_URL}/api/dashboard/targets/${encodeURIComponent(target.id)}/report?hours=${hours}`,
        { headers: authHeaders() }
      );

      if (res.status === 401) { handleLogout(); return; }
      if (!res.ok) {
        setReportData(null);
        showToast('Could not generate the report. Try again.');
        return;
      }

      const d = await res.json();

      // Dates are revived here rather than in PrintableReport so the component
      // stays a pure renderer over already-typed values.
      setReportData({
        uptimePct: d.uptime_pct,
        downtimePct: d.downtime_pct,
        totalDowntimeSec: d.total_downtime_sec,
        failures: d.failures,
        mttrMin: d.mttr_min,
        mtbfHours: d.mtbf_hours,
        totalChecks: d.total_checks,
        avgLatency: d.avg_response_ms,
        p95Latency: d.p95_response_ms,
        bucketMs: d.bucket_ms,
        timeline: (d.timeline ?? []).map((b: any) => ({
          start: new Date(b.start),
          checks: b.checks,
          uptimePct: b.uptime_pct,
          avgLatency: b.avg_latency,
        })),
        downtimeLogs: (d.outages ?? []).map((o: any) => ({
          started: new Date(o.started),
          ended: o.ended ? new Date(o.ended) : null,
          error: o.error,
        })),
      });
    } catch {
      setReportData(null);
      showToast('Could not reach the server to generate the report.');
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
        showToast('Check request sent to background queue.');
      } else {
        showToast('Failed to trigger check.');
      }
    } catch {
      showToast('Failed to connect to server.');
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
        localStorage.setItem('snoomp_role', d.role);
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
      showToast('Session expired or invalid credentials. Please log in again.');
      setToken(null);
      return true;
    }
    const e = await res.json().catch(() => ({}));
    showToast(`Error: ${e.detail || defaultMsg}`);
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
    } catch { }
  };

  /* Fetched only when the Executive view is opened — it's an aggregate over the
     whole heartbeat table and nothing else on the dashboard needs it. */
  const fetchSlaTrend = async () => {
    if (!token) return;
    setSlaTrendLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/dashboard/sla-trend?months=6`, { headers: authHeaders() });
      if (res.status === 401) { handleLogout(); return; }
      if (res.ok) setSlaTrend(await res.json());
    } catch { /* leave the previous trend on screen rather than blanking it */ }
    setSlaTrendLoading(false);
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
    } catch { }
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
    } catch { }
  };

  const [wsStatus, setWsStatus] = useState<'connected' | 'reconnecting' | 'disconnected'>('disconnected');
  const statsDebounceRef = useRef<any>(null);

  const debouncedFetchStatsAndIncidents = () => {
    clearTimeout(statsDebounceRef.current);
    statsDebounceRef.current = setTimeout(fetchStatsAndIncidents, 1500);
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
            // ponytail: guarantee array shape
            setMonitors(Array.isArray(monitorData) ? monitorData : []);
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
        } catch { }
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
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
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
      const url = editingMonitor ? `${API_URL}/api/targets/${encodeURIComponent(editingMonitor.id)}` : `${API_URL}/api/targets`;
      const res = await fetch(url, { method, headers: h, body: JSON.stringify(data) });
      if (res.ok) { setIsModalOpen(false); setEditingMonitor(null); fetchStatsAndIncidents(); }
      else { await handleApiResponseError(res, 'Failed to save monitor'); }
    } catch { showToast('Failed to save monitor.'); }
  };

  const handleToggleMonitor = async (m: any) => {
    try {
      const h = { 'Content-Type': 'application/json', ...authHeaders() };
      const p = { name: m.name, type: m.type, host: m.host, port: m.port, path: m.path, check_interval: m.check_interval, enabled: !m.enabled, tags: m.tags, config_json: m.config_json };
      const res = await fetch(`${API_URL}/api/targets/${encodeURIComponent(m.id)}`, { method: 'PUT', headers: h, body: JSON.stringify(p) });
      if (res.ok) fetchStatsAndIncidents();
      else if (res.status === 401) handleLogout();
    } catch { }
  };

  const handleDeleteMonitor = async (id: string) => {
    if (!window.confirm('Delete this monitor?')) return;
    try {
      const res = await fetch(`${API_URL}/api/targets/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() });
      if (res.ok) { setSelectedMonitor(null); fetchStatsAndIncidents(); }
      else if (res.status === 401) handleLogout();
    } catch { }
  };

  const fetchMonitorsDirectly = async () => {
    if (!token) {
      setInitialLoading(false);
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/targets`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        // ponytail: guarantee array shape to avoid G.flatMap runtime error
        const list = Array.isArray(data) ? data : (Array.isArray(data?.targets) ? data.targets : (Array.isArray(data?.data) ? data.data : []));
        setMonitors(list);

        // Resolve a shared ?monitor=<id> link once the list is available.
        // Runs only on the first load so it can't fight the user's navigation.
        if (!deepLinkResolved.current) {
          deepLinkResolved.current = true;
          const wanted = new URLSearchParams(window.location.search).get('monitor');
          if (wanted) {
            const match = data.find((m: any) => m.id === wanted);
            if (match) {
              setSelectedMonitor(match);
              setView('dashboard');
            }
          }
        }
      } else if (res.status === 401) {
        handleLogout();
      }
    } catch { } finally {
      setInitialLoading(false);
    }
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
    if (!spForm.name || !spForm.slug) { showToast('Name and slug are required.'); return; }
    setSpSaving(true);
    try {
      const h = { 'Content-Type': 'application/json', ...authHeaders() };
      const method = editingPage ? 'PUT' : 'POST';
      const url = editingPage ? `${API_URL}/api/status-pages/${editingPage.id}` : `${API_URL}/api/status-pages/`;
      const res = await fetch(url, { method, headers: h, body: JSON.stringify(spForm) });
      if (res.ok) { await fetchStatusPages(); setShowSpModal(false); }
      else { await handleApiResponseError(res, 'Failed to save status page'); }
    } catch { showToast('Failed to save status page.'); }
    setSpSaving(false);
  };

  const handleDeleteStatusPage = async (id: string) => {
    if (!window.confirm('Delete this status page?')) return;
    try {
      const res = await fetch(`${API_URL}/api/status-pages/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (res.ok) await fetchStatusPages();
      else if (res.status === 401) handleLogout();
    } catch { }
  };

  const copyPublicUrl = async (slug: string) => {
    const url = `${window.location.origin}/status/${slug}`;
    const ok = await copyToClipboard(url);
    if (!ok) return;
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

  const handleAddTag = (_newTag: string) => { };

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
  // ponytail: robust flatMap-free tag normalizer, zero dependencies, zero crashes
  const normalizeTags = (tags: any): string[] => {
    if (!tags) return [];
    const list = Array.isArray(tags) ? tags : [tags];
    const out: string[] = [];
    for (const item of list) {
      if (typeof item === 'string') {
        for (const part of item.split(',')) {
          const trimmed = part.trim();
          if (trimmed) out.push(trimmed);
        }
      }
    }
    return out;
  };

  // ── Derived state ──
  const ENV_KEYWORDS = ['prod', 'production', 'staging', 'stag', 'dev', 'development', 'test', 'uat'];
  const isEnvTagHelper = (tag: string) => ENV_KEYWORDS.includes(tag.toLowerCase());

  // ponytail: safe list to ensure no non-array can crash the dashboard
  const safeMonitors = Array.isArray(monitors) ? monitors : [];
  const allTags = Array.from(new Set(safeMonitors.map(m => normalizeTags(m?.tags)).flat().filter(Boolean))) as string[];
  const groupTags = Array.from(new Set(allTags.filter(t => !isEnvTagHelper(t)))) as string[];
  const presentEnvTags = allTags.filter(t => isEnvTagHelper(t));
  const envTags = Array.from(new Set(['prod', 'staging', 'dev', ...presentEnvTags])) as string[];

  /**
   * Search + tag filters only — deliberately excludes the status filter.
   *
   * The stats strip is both a readout and a control, so its numbers are
   * counted from this list. If they were counted after the status filter, then
   * clicking "Down" would zero out Up and Warn and you could never click your
   * way back out.
   */
  const tagFilteredMonitors = safeMonitors.filter(m => {
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

  /** What the list actually renders: tag filters, then the status bucket. */
  const filteredMonitors = statusFilter
    ? tagFilteredMonitors.filter(m => statusBucket(m.status) === statusFilter)
    : tagFilteredMonitors;

  /** True when anything is narrowing the sidebar list. */
  const isListFiltered = Boolean(searchTerm || selectedGroupTag || selectedEnvTag || statusFilter);

  /** Count of active chip/status filters, surfaced on the disclosure header. */
  const activeFilterCount =
    (selectedGroupTag ? 1 : 0) + (selectedEnvTag ? 1 : 0) + (statusFilter ? 1 : 0);

  const clearAllFilters = () => {
    setSearchTerm('');
    setSelectedGroupTag(null);
    setSelectedEnvTag(null);
    setStatusFilter(null);
  };

  /**
   * Fleet-wide down count, straight from the API summary.
   *
   * Keep this fleet-wide: the Executive homepage reads it for the incident
   * banner and the "Active Incidents" KPI, where a filtered number would be
   * wrong. The sidebar uses `sidebarCounts` below instead.
   */
  const downCount = (stats.status_summary?.down || 0) + (stats.status_summary?.critical || 0);
  // ponytail: track warnings and latency >= 1000ms for status banner and alerts
  const warnCount = (stats.status_summary?.warning || 0);

  /**
   * Counts for the sidebar strip, derived from the rows actually rendered.
   *
   * Previously this strip read `stats.total_targets` — the unfiltered API
   * total — while sitting directly beneath the filter chips, so narrowing to
   * three monitors still displayed "52 Total". Single pass; the list is small
   * enough that memoising would cost more than it saves.
   */
  const sidebarCounts = { total: tagFilteredMonitors.length, up: 0, down: 0, warn: 0 };
  for (const m of tagFilteredMonitors) {
    const bucket = statusBucket(m.status);
    if (bucket) sidebarCounts[bucket]++;
  }

  /**
   * Homepage KPI figures.
   *
   * One pass instead of six: the JSX previously ran two inline IIFEs plus four
   * separate `.filter()` walks (two of them the identical outage filter, once
   * for a length check and again for the map) on every render.
   */
  const homeStats = (() => {
    const outages: any[] = [];
    let enabled = 0;
    let uptimeSum = 0;
    let uptimeCount = 0;
    let latencySum = 0;
    let latencyCount = 0;
    let slowCount = 0;

    for (const m of filteredMonitors) {
      if (m.enabled) {
        enabled++;
        uptimeSum += m.uptime_24h ?? 100;
        uptimeCount++;
      }
      // ponytail: include outages, warnings, and latency >= 1000ms in alerts feed
      const isSlow = m.response_time_ms != null && m.response_time_ms >= 1000;
      if (isSlow) slowCount++;
      if (m.status === 'down' || m.status === 'critical' || m.status === 'warning' || isSlow) {
        outages.push(m);
      }
      if (m.response_time_ms > 0) {
        latencySum += m.response_time_ms;
        latencyCount++;
      }
    }

    return {
      outages,
      enabled,
      paused: filteredMonitors.length - enabled,
      avgUptime: uptimeCount > 0 ? uptimeSum / uptimeCount : 100,
      avgLatency: latencyCount > 0 ? latencySum / latencyCount : 0,
      slowCount,
    };
  })();
  const sm = selectedMonitor;
  const isHostMetricType = sm && ['snmp', 'ssh', 'push'].includes(sm.type?.toLowerCase());
  const isDatabaseType = sm && ['db', 'mongodb', 'redis'].includes(sm.type?.toLowerCase());

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

          {authError && <div className="login-error" role="alert">{authError}</div>}

          <form onSubmit={handleLogin} className="login-form">
            <div className="form-group">
              <label htmlFor="login-username">Username</label>
              <input id="login-username" name="username" autoComplete="username" spellCheck={false} type="text" required placeholder="admin" value={username} onChange={e => setUsername(e.target.value)} />
            </div>
            <div className="form-group">
              <label htmlFor="login-password">Password</label>
              <input id="login-password" name="password" autoComplete="current-password" type="password" required placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} />
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
              <h3>SYSTEM<br />COCKPIT</h3>
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
    <div className="app-root" style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* ponytail: accessible high-contrast skip link in both dark and light themes (WCAG 1.4.3) */}
      <a href="#main-content" style={{ position: 'absolute', top: '-999px', left: '12px', background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '2px solid var(--accent)', padding: '8px 14px', borderRadius: 'var(--radius-sm)', fontWeight: 600, fontSize: '13px', zIndex: 10000, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }} onFocus={e => e.currentTarget.style.top = '12px'} onBlur={e => e.currentTarget.style.top = '-999px'}>Skip to main content</a>
      {toastMsg && (
        <div role="status" aria-live="polite" className="toast-notification">
          {toastMsg}
        </div>
      )}

      {/* ─────────────────────────────────────
          TOP NAVBAR
         ───────────────────────────────────── */}
      <nav className="top-navbar">
        {/* Drawer toggle — CSS hides it at/above the breakpoint, so it costs
            nothing on desktop and needs no viewport state to render. */}
        {view !== 'executive' && (
          <button
            type="button"
            ref={drawerToggleRef}
            className="sidebar-drawer-toggle"
            aria-label={sidebarOpen ? 'Close monitor list' : 'Open monitor list'}
            aria-expanded={sidebarOpen}
            aria-controls="sidebar-nav"
            onClick={() => setSidebarOpen(o => !o)}
          >
            {sidebarOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
          </button>
        )}

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
              padding: '4px 11px',
              borderRadius: '12px',
              fontSize: '12px',
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
              color: theme === 'light' ? 'var(--color-warning)' : 'var(--text-muted)',
              boxShadow: theme === 'light' ? 'var(--shadow-sm)' : 'none',
              transition: 'all 0.2s'
            }}>
              <Sun size={14} strokeWidth={2.5} />
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '24px', height: '24px', borderRadius: '50%',
              background: theme === 'dark' ? 'var(--bg-elevated)' : 'transparent',
              color: theme === 'dark' ? 'var(--accent)' : 'var(--text-muted)',
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
                <button
                  onClick={() => { setShowProfileMenu(false); setShowUpdateModal(true); }}
                  style={{ background: 'transparent', border: 'none', padding: '8px 12px', textAlign: 'left', cursor: 'pointer', borderRadius: '4px', fontSize: '13px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <ArrowUpCircle size={14} style={{ color: hasUpdate ? 'var(--accent)' : 'inherit' }} />
                  <span>Check for Updates</span>
                  {hasUpdate && (
                    <span style={{ marginLeft: 'auto', background: 'var(--accent)', color: '#0c0d12', fontSize: '10px', fontWeight: 700, padding: '1px 5px', borderRadius: '8px' }}>
                      NEW
                    </span>
                  )}
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
      {initialLoading ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
          <div style={{ width: '40px', height: '40px', border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          <div style={{ color: 'var(--text-muted)', fontSize: '14px', fontWeight: 500 }}>Initializing dashboard…</div>
        </div>
      ) : (
        <div className="app-layout">

          {/* ─── SIDEBAR ─── */}
          {view !== 'executive' && (
            <aside
              id="sidebar-nav"
              className={`sidebar ${sidebarOpen ? 'is-open' : ''}`}
              aria-label="Monitors"
            >

              {/* Add Monitor — full width primary, with a meta row beneath.
                  The primary action gets the whole row so its label can never
                  wrap; batch selection drops to secondary weight below it,
                  which matches how often each is actually used. */}
              <div className="sidebar-primary-action">
                {role !== 'viewer' && (
                  <button
                    onClick={() => { setEditingMonitor(null); setIsModalOpen(true); setView('dashboard'); }}
                  >
                    <Plus size={14} aria-hidden="true" /> Add New Monitor
                  </button>
                )}

                <div className="sidebar-meta-row">
                  {/* Only shown while a filter is narrowing the list — the stats
                      strip below already carries the unfiltered total. */}
                  {isListFiltered && (
                    <span className="sidebar-meta-count">
                      {filteredMonitors.length} of {monitors.length} shown
                    </span>
                  )}
                  {role !== 'viewer' && (
                    <button
                      type="button"
                      className={`sidebar-select-btn ${isBatchMode ? 'active' : ''}`}
                      aria-pressed={isBatchMode}
                      onClick={() => {
                        setIsBatchMode(!isBatchMode);
                        setSelectedMonitorIds([]);
                      }}
                    >
                      <CheckSquare size={12} aria-hidden="true" />
                      {isBatchMode ? 'Cancel' : 'Select'}
                    </button>
                  )}
                </div>
              </div>

              {/* Search */}
              <div className="sidebar-search">
                <div className="search-wrapper">
                  <Search size={14} className="search-icon" aria-hidden="true" />
                  <input
                    type="search"
                    aria-label="Search monitors"
                    placeholder="Search monitors…"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                  />
                </div>
              </div>

              {/* Filters — collapsed behind a disclosure so the monitor list
                  stays above the fold. Both chip groups live inside. */}
              <div className="sidebar-section">
                <button
                  type="button"
                  className="sidebar-disclosure"
                  aria-expanded={filtersOpen}
                  aria-controls="sidebar-filter-panel"
                  onClick={toggleFilters}
                >
                  <ChevronDown
                    size={12}
                    aria-hidden="true"
                    className={filtersOpen ? '' : 'collapsed'}
                  />
                  <span>Filters</span>
                  {activeFilterCount > 0 && (
                    <span className="sidebar-disclosure-badge">{activeFilterCount}</span>
                  )}
                  {activeFilterCount > 0 && (
                    /* Rendered as a sibling, not nested — a button inside a
                       button is invalid and the inner one never receives clicks. */
                    <span
                      role="button"
                      tabIndex={0}
                      className="sidebar-disclosure-clear"
                      onClick={e => { e.stopPropagation(); clearAllFilters(); }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          clearAllFilters();
                        }
                      }}
                    >
                      Clear
                    </span>
                  )}
                </button>

                <div id="sidebar-filter-panel" hidden={!filtersOpen}>
                  <div className="sidebar-section-label">
                    System / Application Group
                  </div>
                  <div className="sidebar-filter-row" role="group" aria-label="System Group Filters">
                    <button
                      type="button"
                      className={`filter-chip ${!selectedGroupTag ? 'active' : ''}`}
                      onClick={() => setSelectedGroupTag(null)}
                      aria-pressed={!selectedGroupTag}
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
                      >
                        {tag}
                      </button>
                    ))}
                  </div>

                  <div className="sidebar-section-label" style={{ marginTop: 'var(--space-3)' }}>
                    Environment
                  </div>
                  <div className="sidebar-filter-row" role="group" aria-label="Environment Filters">
                    <button
                      type="button"
                      className={`filter-chip ${!selectedEnvTag ? 'active' : ''}`}
                      onClick={() => setSelectedEnvTag(null)}
                      aria-pressed={!selectedEnvTag}
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
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Stats strip — doubles as the status filter. Counts come from
                  the tag-filtered list so they stay stable while a status
                  bucket is selected. */}
              <div className="stats-summary-grid" role="group" aria-label="Filter by status">
                <button
                  type="button"
                  className={`stat-item ${!statusFilter ? 'active' : ''}`}
                  aria-pressed={!statusFilter}
                  onClick={() => setStatusFilter(null)}
                >
                  <span className="stat-val total">{sidebarCounts.total}</span>
                  <span className="stat-label">{isListFiltered ? 'Shown' : 'Total'}</span>
                </button>
                {STATUS_FILTERS.map(key => (
                  <button
                    key={key}
                    type="button"
                    className={`stat-item ${statusFilter === key ? 'active' : ''}`}
                    aria-pressed={statusFilter === key}
                    aria-label={`Show only ${key === 'warn' ? 'warning' : key} monitors, ${sidebarCounts[key]} of ${sidebarCounts.total}`}
                    onClick={() => setStatusFilter(statusFilter === key ? null : key)}
                  >
                    <span className={`stat-val ${key}`}>{sidebarCounts[key]}</span>
                    <span className="stat-label">{key === 'warn' ? 'Warn' : key === 'up' ? 'Up' : 'Down'}</span>
                  </button>
                ))}
              </div>

              {/* Batch Action Bar */}
              {isBatchMode && (
                <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent-glow)', padding: '11px 12px', borderRadius: '11px', margin: '8px 12px 4px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--accent)' }}>
                      {selectedMonitorIds.length} Selected
                    </span>
                    <button
                      type="button"
                      className="secondary"
                      style={{ fontSize: '12px', padding: '2px 8px' }}
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
                        style={{ fontSize: '12px', padding: '6px 8px', background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-glow)', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
                      >
                        <Edit3 size={12} /> Batch Edit
                      </button>
                      <button
                        type="button"
                        onClick={handleBatchToggleEnabled}
                        style={{ fontSize: '12px', padding: '6px 8px', background: 'var(--surface-raised)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
                      >
                        <Power size={12} /> Enable/Disable
                      </button>
                      <button
                        type="button"
                        onClick={handleBatchDelete}
                        style={{ fontSize: '12px', padding: '6px 8px', background: 'var(--color-down-glow)', color: 'var(--color-down)', border: '1px solid var(--border)', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', gridColumn: 'span 2', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
                      >
                        <Trash2 size={12} /> Delete Selected ({selectedMonitorIds.length})
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Grouping toggle */}
              <div className="sidebar-toggle-row">
                <label className="sidebar-toggle-label" htmlFor="monitor-group-by-select">Group by</label>
                <select
                  id="monitor-group-by-select"
                  aria-label="Group monitors by"
                  value={groupBy}
                  onChange={(e) => {
                    setGroupBy(e.target.value as 'none' | 'tags' | 'type');
                    localStorage.setItem('snoomp_group_by', e.target.value);
                  }}
                  style={{ width: 'auto', padding: '2px 24px 2px 8px', fontSize: '11px', height: '22px', borderRadius: '4px', background: 'var(--bg-void)' }}
                >
                  <option value="none">None</option>
                  <option value="tags">Tags</option>
                  <option value="type">Type</option>
                </select>
              </div>

              {/* Monitor list — flat, or grouped into collapsible sections */}
              <div className="sidebar-list">
                {(() => {
                  if (filteredMonitors.length === 0) {
                    return (
                      <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                        <span>No monitors match your filters.</span>
                        {isListFiltered && (
                          <button
                            type="button"
                            onClick={clearAllFilters}
                            style={{
                              fontSize: '12px',
                              padding: '4px 11px',
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

                  // Renders one monitor row in the sidebar list using memoized component
                  const renderMonitorItem = (m: any) => {
                    const isActive = sm?.id === m.id && view === 'dashboard';
                    const isSelected = selectedMonitorIds.includes(m.id);
                    return (
                      <MonitorRow
                        key={m.id}
                        monitor={m}
                        isActive={isActive}
                        isBatchMode={isBatchMode}
                        isSelected={isSelected}
                        slaConfig={instanceSettings.sla}
                        onSelect={(selectedM) => {
                          setSelectedMonitor(selectedM);
                          setSidebarOpen(false);
                          setView('dashboard');
                        }}
                        onToggleSelect={(id) => {
                          if (selectedMonitorIds.includes(id)) {
                            setSelectedMonitorIds(prev => prev.filter(mid => mid !== id));
                          } else {
                            setSelectedMonitorIds(prev => Array.from(new Set([...prev, id])));
                          }
                        }}
                      />
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
                        {/* ponytail: rely on .sidebar-group-header CSS for width and alignment without right-side gap */}
                        <button
                          type="button"
                          className="sidebar-group-header"
                          onClick={() => toggleGroup(groupName)}
                          aria-expanded={!isCollapsed}
                          aria-label={`Toggle ${groupName} group`}
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
              <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' }}>
                <span>Snoomp Enterprise</span>
                <button
                  type="button"
                  onClick={() => setShowUpdateModal(true)}
                  title={hasUpdate ? `Update available: v${latestVersion} (Click to inspect)` : 'Click to check for updates'}
                  style={{
                    background: hasUpdate ? 'rgba(56, 189, 248, 0.15)' : 'var(--bg-elevated)',
                    border: `1px solid ${hasUpdate ? 'var(--accent)' : 'var(--border)'}`,
                    padding: '2px 8px',
                    borderRadius: '11px',
                    fontWeight: 600,
                    color: 'var(--accent)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = hasUpdate ? 'var(--accent)' : 'var(--border)'; }}
                >
                  {hasUpdate && (
                    <span
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        background: 'var(--accent)',
                        boxShadow: '0 0 6px var(--accent)'
                      }}
                    />
                  )}
                  <span>{appVersion}</span>
                  {hasUpdate && <span style={{ fontSize: '10px', opacity: 0.9 }}>• Update</span>}
                </button>
              </div>
            </aside>
          )}

          {/* ─── MAIN PANEL ─── */}
          {/* Scrim. Only hit-testable while the drawer is open (CSS), and
              presentational — Esc and the toggle are the labelled affordances. */}
          <div
            className={`sidebar-scrim ${sidebarOpen ? 'is-open' : ''}`}
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />

          <main id="main-content" className="main-content" ref={mainContentRef}>

            {/* ═══ EXECUTIVE DASHBOARD VIEW ═══ */}
            {view === 'executive' ? (
              <ExecutiveDashboard
                targets={monitors}
                slaConfig={instanceSettings.sla}
                slaTrend={slaTrend}
                slaTrendLoading={slaTrendLoading}
                onSelectDomain={tag => {
                  setSelectedGroupTag(tag);
                  setSelectedMonitor(null);
                  setView('dashboard');
                }}
                onPrint={() => getPdf('/api/reports/executive.pdf', 'executive')}
                downloadingPdf={downloadingPdf === 'executive'}
              />
            ) : view === 'status-pages' ? (
              <div className="status-pages-view anim-fade-in">
                <div className="status-pages-header">
                  <div>
                    <h2>Status Pages</h2>
                    <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Create public-facing status pages for your monitors
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                      className="secondary"
                      onClick={() => getPdf('/api/reports/fleet.pdf', 'statusPages')}
                      style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <Printer size={14} aria-hidden="true" />
                      {downloadingPdf === 'statusPages' ? 'Building PDF…' : 'Download PDF'}
                    </button>
                    {role !== 'viewer' && (
                      <button onClick={() => openSpModal()}>
                        <Plus size={14} /> New Status Page
                      </button>
                    )}
                  </div>
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
                            style={{ fontSize: '12px', color: 'var(--text-muted)' }}
                          />
                          <button
                            className="secondary"
                            style={{ padding: '7px', flexShrink: 0 }}
                            onClick={() => copyPublicUrl(page.slug)}
                            title="Copy public URL"
                            aria-label="Copy public URL"
                          >
                            {copiedSlug === page.slug ? <Check size={13} style={{ color: 'var(--color-up)' }} /> : <Copy size={13} />}
                          </button>
                          <button
                            className="secondary"
                            style={{ padding: '7px', flexShrink: 0 }}
                            onClick={() => window.open(`/status/${page.slug}`, '_blank')}
                            title="Open public page"
                            aria-label="Open public page"
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
                                <button className="secondary" style={{ padding: '5px 8px', fontSize: '12px' }} onClick={() => openSpModal(page)} title="Edit" aria-label="Edit Status Page">
                                  <Pencil size={12} />
                                </button>
                                <button className="danger" style={{ padding: '5px 8px', fontSize: '12px' }} onClick={() => handleDeleteStatusPage(page.id)} title="Delete" aria-label="Delete Status Page">
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
                      <h1 style={{ fontSize: '1.5em', margin: 0 }}>{sm.name}</h1>
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
                        <span className="latency-pill" style={{ marginLeft: '11px' }}>
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

                  <div className="monitor-detail-actions" style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    {role !== 'viewer' && (
                      <button className="secondary" onClick={() => handleRefreshMonitor(sm.id)} title="Trigger immediate check (Pull/Refresh)">
                        <Zap size={14} style={{ color: 'var(--accent)' }} />
                      </button>
                    )}
                    {/* Web Share where available, clipboard otherwise. Both paths are
                      secure-context-safe via copyToClipboard(). */}
                    <button
                      className="secondary"
                      type="button"
                      aria-label={`Share ${sm.name}`}
                      title="Copy a link to this monitor"
                      onClick={async () => {
                        const url = monitorShareUrl(sm.id);
                        const summary = `${sm.name} is ${(sm.status || 'unknown').toUpperCase()} — Snoomp`;

                        if (navigator.share) {
                          try {
                            await navigator.share({ title: sm.name, text: summary, url });
                            return;
                          } catch (err: any) {
                            // User dismissed the sheet — not an error, don't fall through.
                            if (err?.name === 'AbortError') return;
                          }
                        }

                        const ok = await copyToClipboard(url);
                        setShareState(ok ? 'copied' : 'failed');
                        setTimeout(() => setShareState('idle'), 2500);
                      }}
                    >
                      {shareState === 'copied'
                        ? <Check size={14} style={{ color: 'var(--color-up)' }} />
                        : <Share2 size={14} />}
                    </button>
                    <span role="status" aria-live="polite" className="sr-only">
                      {shareState === 'copied' ? 'Link copied to clipboard'
                        : shareState === 'failed' ? 'Could not copy the link. Select the address bar and copy it manually.'
                          : ''}
                    </span>
                    <button className="secondary" onClick={() => handleGenerateReport(sm, 168)} title="Generate PDF Availability Report" aria-label="Generate PDF Availability Report">
                      <FileText size={14} />
                    </button>
                    {role !== 'viewer' && (
                      <>
                        <button className="secondary" onClick={() => { setEditingMonitor(sm); setIsModalOpen(true); }} title="Edit Monitor" aria-label="Edit Monitor">
                          <Edit3 size={14} />
                        </button>
                        <button className="secondary" onClick={() => handleToggleMonitor(sm)} title={sm.enabled ? 'Pause' : 'Resume'} aria-label={sm.enabled ? 'Pause' : 'Resume'}>
                          <Power size={14} style={{ color: sm.enabled ? 'var(--color-up)' : 'var(--color-off)' }} />
                        </button>
                        <button className="danger" onClick={() => handleDeleteMonitor(sm.id)} title="Delete Monitor" aria-label="Delete Monitor">
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Heartbeat timeline */}
                <div className="detail-section">
                  <div className="section-title">
                    <h2 style={{ fontSize: 'inherit', margin: 0, fontWeight: 'inherit' }}>Heartbeat Timeline <span style={{ opacity: 0.5, fontSize: '11px' }}>- last 60 checks</span></h2>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Zap size={11} />
                      {sm.check_interval}s interval
                    </span>
                  </div>
                  <div className="heartbeat-timeline" role="img" aria-label={`${heartbeats.filter((hb: any) => hb.status === 'up').length} of ${heartbeats.length} checks OK`}>
                    {heartbeats.map((hb: any, i: number) => (
                      <div
                        key={hb.id || i}
                        className={`hb-block ${hb.status}`}
                        title={`${new Date(hb.checked_at).toLocaleString()} - Status: ${hb.status.toUpperCase()} - Latency: ${new Intl.NumberFormat(navigator.language).format(hb.response_time_ms || 0)} ms${hb.error ? ' - ' + hb.error : ''}`}
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
                      <h2 style={{ fontSize: 'inherit', margin: 0, fontWeight: 'inherit' }}>System Resource Metrics</h2>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Live · every {sm.check_interval}s</span>
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
                        <div className="uptime-value">
                          {sm.metrics.uptime ? (
                            sm.metrics.uptime.trim()
                              .replace(/\bmin(s)?\b/g, 'minutes')
                              .replace(/\b(\d{1,2}):(\d{2})\b/g, (_: string, h: string, m: string) => {
                                const hours = parseInt(h, 10);
                                const minutes = parseInt(m, 10);
                                const parts: string[] = [];
                                if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
                                if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
                                return parts.length > 0 ? parts.join(', ') : '0 minutes';
                              })
                          ) : '—'}
                        </div>
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

                    {/* ponytail: cold connection latency phase diagnostics */}
                    {sm.metrics.timing && (
                      <div style={{ marginTop: '16px', background: 'var(--bg-elevated)', border: '1px solid ' + (sm.response_time_ms >= 1000 ? 'var(--color-warning)' : 'var(--border)'), borderRadius: 'var(--radius-md)', padding: '14px 18px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                          <span style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Activity size={13} style={{ color: sm.response_time_ms >= 1000 ? 'var(--color-warning)' : 'var(--accent)' }} />
                            Cold Connection Phase Diagnostics
                          </span>
                          <span style={{ fontSize: '11px', fontWeight: 600, color: sm.response_time_ms >= 1000 ? 'var(--color-warning)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                            Bottleneck: {sm.metrics.timing.bottleneck}
                          </span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                          <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '6px', padding: '10px 12px' }}>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Phase 1: TCP Handshake &amp; SSH Auth</div>
                            <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: sm.metrics.timing.connect_ms >= 500 ? 'var(--color-warning)' : 'var(--text-primary)' }}>
                              {sm.metrics.timing.connect_ms} ms
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>Diffie-Hellman KEX, cipher negotiation &amp; credential verify</div>
                          </div>
                          <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '6px', padding: '10px 12px' }}>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Phase 2: Remote Shell &amp; Process Execution</div>
                            <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: sm.metrics.timing.exec_ms >= 500 ? 'var(--color-warning)' : 'var(--text-primary)' }}>
                              {sm.metrics.timing.exec_ms} ms
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>uptime, free, df, /proc/stat, loadavg process forks</div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Attached Storage & Filesystem Utilization Breakdown Panel */}
                    {(() => {
                      const visibleDisks = visibleVolumes(sm.metrics.disks);
                      if (visibleDisks.length === 0) return null;
                      const hiddenCount = (sm.metrics.disks?.length || 0) - visibleDisks.length;
                      return (
                      <div style={{ marginTop: '16px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '14px 18px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                          <span style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <HardDrive size={13} style={{ color: 'var(--accent)' }} /> Attached Storage & Volume Utilization ({visibleDisks.length} Partitions)
                          </span>
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                            Total: {sm.metrics.disk_total_gb} GB
                            {hiddenCount > 0 && <span style={{ opacity: 0.6 }}> · {hiddenCount} system volumes hidden</span>}
                          </span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '11px' }}>
                          {visibleDisks.map((dk: any, idx: number) => {
                            const pct = dk.used_percent || 0;
                            const badgeColor = pct >= 90 ? 'var(--color-down)' : pct >= 80 ? 'var(--color-warning)' : 'var(--color-up)';
                            const isNfs = dk.filesystem?.includes(':') || dk.mount?.includes('nfs');
                            return (
                              <div key={idx} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px', padding: '11px 14px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={dk.mount}>
                                      {dk.mount}
                                    </span>
                                    {isNfs && (
                                      <span style={{ fontSize: '11px', background: 'var(--accent-dim)', color: 'var(--accent)', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>NFS</span>
                                    )}
                                  </div>
                                  <span style={{ fontSize: '12px', fontWeight: 800, color: badgeColor, fontFamily: 'var(--font-mono)' }}>
                                    {pct}%
                                  </span>
                                </div>
                                <div style={{ width: '100%', height: '6px', background: 'var(--bg-void)', borderRadius: '3px', overflow: 'hidden', marginBottom: '6px' }}>
                                  <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: badgeColor, transition: 'width 0.3s' }} />
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)' }}>
                                  <span style={{ fontFamily: 'var(--font-mono)', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={dk.filesystem}>{dk.filesystem}</span>
                                  <span>{dk.size_gb ? `${dk.size_gb} GB` : '—'}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      );
                    })()}

                    {/* Resource History chart with timeframe selector.
                        Host types only — this block already sits inside
                        `isHostMetricType`, so the database entries that used to
                        be listed here could never match. Databases get their
                        own engine-specific charts further down. */}
                    {['snmp', 'ssh', 'push'].includes(sm.type?.toLowerCase()) && (
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
                                  fontSize: '12px',
                                  padding: '2px 8px',
                                  background: resourceHours === t.value ? 'var(--accent-dim)' : 'transparent',
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
                                  <linearGradient id="gCpu" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.25} /><stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} /></linearGradient>
                                  <linearGradient id="gMem" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.25} /><stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0} /></linearGradient>
                                  <linearGradient id="gDisk" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--chart-3)" stopOpacity={0.25} /><stop offset="95%" stopColor="var(--chart-3)" stopOpacity={0} /></linearGradient>
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
                                <Area type="monotone" dataKey="cpu" name="CPU" stroke="var(--chart-1)" fill="url(#gCpu)" strokeWidth={1.5} dot={false} />
                                <Area type="monotone" dataKey="mem" name="Memory" stroke="var(--chart-2)" fill="url(#gMem)" strokeWidth={1.5} dot={false} />
                                <Area type="monotone" dataKey="disk" name="Disk" stroke="var(--chart-3)" fill="url(#gDisk)" strokeWidth={1.5} dot={false} />
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
                          <h2 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)', letterSpacing: '0.3px', margin: 0 }}>
                            Engine Diagnostics
                          </h2>
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'var(--accent-dim)', padding: '2px 8px', borderRadius: '11px', fontWeight: '500' }}>
                            {dbEngineStatus?.type?.toUpperCase() || 'LIVE'}
                          </span>
                        </div>
                        <button
                          className="secondary"
                          style={{ fontSize: '12px', padding: '5px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', borderRadius: '6px', transition: 'all 0.2s ease' }}
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
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '11px', marginBottom: '16px' }}>
                            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '11px', padding: '12px', textAlign: 'center' }}>
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Total Size</div>
                              <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                                {dbEngineStatus.info?.storage_size_mb ? (dbEngineStatus.info.storage_size_mb > 1024 ? `${(dbEngineStatus.info.storage_size_mb / 1024).toFixed(1)} GB` : `${dbEngineStatus.info.storage_size_mb} MB`) : '—'}
                              </div>
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{dbEngineStatus.info?.database_count || '—'} databases</div>
                            </div>
                            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '11px', padding: '12px', textAlign: 'center' }}>
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Connections</div>
                              <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                                {dbEngineStatus.info?.active_connections ?? '—'}
                                <span style={{ fontSize: '12px', fontWeight: '400', color: 'var(--text-muted)' }}> / {dbEngineStatus.info?.max_connections ?? '—'}</span>
                              </div>
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>active / max</div>
                            </div>
                            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '11px', padding: '12px', textAlign: 'center' }}>
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Shared Buffers</div>
                              <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                                {dbEngineStatus.info?.shared_buffers || '—'}
                              </div>
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>cache: {dbEngineStatus.info?.effective_cache_size || '—'}</div>
                            </div>
                            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '11px', padding: '12px', textAlign: 'center' }}>
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Uptime</div>
                              <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                                {dbEngineStatus.info?.uptime_seconds ? `${Math.floor(dbEngineStatus.info.uptime_seconds / 86400)}d` : '—'}
                              </div>
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                                {dbEngineStatus.info?.uptime_seconds ? `${Math.floor((dbEngineStatus.info.uptime_seconds % 86400) / 3600)}h ${Math.floor((dbEngineStatus.info.uptime_seconds % 3600) / 60)}m` : 'since boot'}
                              </div>
                            </div>
                          </div>

                          {/* Version banner */}
                          <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 14px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                            <Server size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                            <span style={{ color: 'var(--text-muted)' }}>Engine:</span>
                            <span style={{ color: 'var(--text-primary)', fontWeight: '500', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                              {dbEngineStatus.info?.version || 'Unknown'}
                            </span>
                          </div>

                          {/* Tab selector */}
                          <div role="tablist" aria-label="Engine diagnostics tabs" style={{ display: 'flex', gap: '4px', marginBottom: '14px', background: 'var(--bg-secondary)', borderRadius: '8px', padding: '3px', border: '1px solid var(--border)' }}>
                            {[
                              { key: 'slow_queries', label: 'Active & Slow Queries', count: dbEngineStatus.slow_queries?.length },
                              { key: 'tables', label: sm.type.toLowerCase() === 'db' ? 'Databases' : 'Collections', count: dbEngineStatus.tables?.length },
                              { key: 'tablespaces', label: 'Tablespaces', count: dbEngineStatus.tablespaces?.length },
                            ].map(tab => (
                              <button
                                key={tab.key}
                                id={`tab-${tab.key}`}
                                role="tab"
                                aria-selected={dbActiveTab === tab.key}
                                aria-controls={`tabpanel-${tab.key}`}
                                type="button"
                                style={{
                                  flex: 1, padding: '7px 12px', fontSize: '12px', fontWeight: '600', cursor: 'pointer',
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
                            <div role="tabpanel" id="tabpanel-slow_queries" aria-labelledby="tab-slow_queries" style={{ maxHeight: '280px', overflow: 'auto', borderRadius: '8px', border: '1px solid var(--border)' }}>
                              {dbEngineStatus.slow_queries?.length === 0 ? (
                                <div style={{ padding: '24px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
                                  <Activity size={20} style={{ opacity: 0.3, marginBottom: '8px' }} />
                                  <div>No slow queries or idle connection leaks found</div>
                                  <div style={{ fontSize: '11px', marginTop: '4px', opacity: 0.6 }}>All active queries completing within normal response time</div>
                                </div>
                              ) : (
                                <table style={{ width: '100%', minWidth: '940px', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                                  <caption className="sr-only">Active database connections and slow queries</caption>
                                  <thead>
                                    <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 1 }}>
                                      <th scope="col" style={{ padding: '8px 11px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>PID</th>
                                      <th scope="col" style={{ padding: '8px 11px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>User</th>
                                      <th scope="col" style={{ padding: '8px 11px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Client IP</th>
                                      <th scope="col" style={{ padding: '8px 11px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>App Name</th>
                                      <th scope="col" style={{ padding: '8px 11px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Database</th>
                                      <th scope="col" style={{ padding: '8px 11px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>State</th>
                                      <th scope="col" style={{ padding: '8px 11px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Duration</th>
                                      <th scope="col" style={{ padding: '8px 11px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Query Statement</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {dbEngineStatus.slow_queries.map((sq: any, i: number) => {
                                      const durSec = sq.duration_sec || 0;
                                      const isLong = durSec > 300;
                                      const durStr = durSec >= 3600 ? `${Math.floor(durSec / 3600)}h ${Math.floor((durSec % 3600) / 60)}m` : durSec >= 60 ? `${Math.floor(durSec / 60)}m ${Math.floor(durSec % 60)}s` : `${durSec.toFixed(1)}s`;
                                      return (
                                        <tr key={i} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.15s', background: isLong ? 'var(--surface-raised)' : 'transparent', borderLeft: isLong ? '3px solid var(--color-down)' : '3px solid transparent' }}>
                                          <td style={{ padding: '7px 11px', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{sq.pid}</td>
                                          <td style={{ padding: '7px 11px', fontWeight: '500' }}>{sq.usename}</td>
                                          <td style={{ padding: '7px 11px', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--accent)' }}>{sq.client_addr || 'local'}</td>
                                          <td style={{ padding: '7px 11px', fontSize: '11px', color: 'var(--text-secondary)' }}>{sq.application_name || '—'}</td>
                                          <td style={{ padding: '7px 11px', fontSize: '11px', color: 'var(--text-secondary)' }}>{sq.datname || '—'}</td>
                                          <td style={{ padding: '7px 11px' }}>
                                            {/* Neutral surface tint with semantic color text and indicator dot (WCAG AA >= 4.5:1, fixes P0.2) */}
                                            <span style={{
                                              fontSize: '11px',
                                              padding: '2px 8px',
                                              borderRadius: '4px',
                                              fontWeight: '600',
                                              background: 'var(--surface-raised)',
                                              border: '1px solid var(--border)',
                                              color: sq.state === 'active' ? 'var(--color-up)' : 'var(--color-warning)',
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: '5px'
                                            }}>
                                              <span style={{
                                                width: '6px',
                                                height: '6px',
                                                borderRadius: '50%',
                                                background: sq.state === 'active' ? 'var(--color-up)' : 'var(--color-warning)',
                                                flexShrink: 0
                                              }} />
                                              {sq.state}
                                            </span>
                                          </td>
                                          <td style={{ padding: '7px 11px', fontWeight: '600', fontFamily: 'var(--font-mono)', fontSize: '11px', color: isLong ? 'var(--color-down)' : durSec > 30 ? 'var(--color-warning)' : 'var(--color-up)' }}>
                                            {durStr}
                                          </td>
                                          <td style={{ padding: '7px 11px', minWidth: '320px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                              <div
                                                tabIndex={0}
                                                style={{
                                                  fontFamily: 'var(--font-mono)',
                                                  fontSize: '11px',
                                                  color: 'var(--text-primary)',
                                                  whiteSpace: 'nowrap',
                                                  overflowX: 'auto',
                                                  maxWidth: '460px',
                                                  display: 'block',
                                                  background: 'var(--bg-secondary)',
                                                  padding: '4px 8px',
                                                  borderRadius: '4px',
                                                  border: '1px solid var(--border)'
                                                }}
                                                title={sq.query}
                                              >
                                                <code>{sq.query}</code>
                                              </div>
                                              <button
                                                type="button"
                                                title="Copy SQL Query"
                                                onClick={async (e) => {
                                                  e.stopPropagation();
                                                  const btn = e.currentTarget;
                                                  const ok = await copyToClipboard(sq.query);
                                                  btn.innerText = ok ? 'Copied!' : 'Failed';
                                                  setTimeout(() => { btn.innerText = 'Copy'; }, 1500);
                                                }}
                                                style={{
                                                  fontSize: '11px',
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
                            <div role="tabpanel" id="tabpanel-tables" aria-labelledby="tab-tables" style={{ maxHeight: '340px', overflowY: 'auto', borderRadius: '8px', border: '1px solid var(--border)' }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                                <caption className="sr-only">Database and collection sizes</caption>
                                <thead>
                                  <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 1 }}>
                                    <th scope="col" style={{ padding: '8px 11px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>#</th>
                                    <th scope="col" style={{ padding: '8px 11px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{sm.type.toLowerCase() === 'db' ? 'Database Name' : 'Collection'}</th>
                                    <th scope="col" style={{ padding: '8px 11px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'right' }}>Size</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {dbEngineStatus.tables?.map((tbl: any, i: number) => {
                                    return (
                                      <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: 'transparent', transition: 'background 0.15s' }}>
                                        <td style={{ padding: '7px 11px', fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{i + 1}</td>
                                        <td style={{ padding: '7px 11px', fontWeight: '400', color: 'var(--text-primary)' }}>
                                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                            <Database size={11} style={{ color: 'var(--text-muted)', opacity: 0.4, flexShrink: 0 }} />
                                            {tbl.table_name}
                                          </span>
                                        </td>
                                        <td style={{ padding: '7px 11px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: '500' }}>{tbl.total_size}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}

                          {/* Tab Content: Tablespaces */}
                          {dbActiveTab === 'tablespaces' && (
                            <div role="tabpanel" id="tabpanel-tablespaces" aria-labelledby="tab-tablespaces" style={{ maxHeight: '340px', overflowY: 'auto', borderRadius: '8px', border: '1px solid var(--border)' }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                                <caption className="sr-only">Storage tablespace allocations</caption>
                                <thead>
                                  <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 1 }}>
                                    <th scope="col" style={{ padding: '8px 11px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>#</th>
                                    <th scope="col" style={{ padding: '8px 11px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Tablespace Name</th>
                                    <th scope="col" style={{ padding: '8px 11px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Location / Path</th>
                                    <th scope="col" style={{ padding: '8px 11px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'right' }}>Total Size</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {dbEngineStatus.tablespaces && dbEngineStatus.tablespaces.length > 0 ? (
                                    dbEngineStatus.tablespaces.map((ts: any, i: number) => (
                                      <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: 'transparent' }}>
                                        <td style={{ padding: '7px 11px', fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{i + 1}</td>
                                        <td style={{ padding: '7px 11px', fontWeight: '600', color: 'var(--text-primary)' }}>
                                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                            <HardDrive size={11} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                                            {ts.tablespace_name}
                                          </span>
                                        </td>
                                        <td style={{ padding: '7px 11px', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-secondary)' }}>{ts.location}</td>
                                        <td style={{ padding: '7px 11px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: '600', color: 'var(--accent)' }}>{ts.size}</td>
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
                          <Database size={24} style={{ opacity: 0.15, marginBottom: '11px' }} />
                          <div>{dbEngineLoading ? 'Querying database engine…' : 'Click Refresh to load live engine diagnostics'}</div>
                        </div>
                      )}
                    </div>

                    {/* Engine metrics, charted under their real names.
                        The checkers also squeeze these into cpu/mem/disk_percent
                        for the legacy resource chart; this reads details_json
                        directly so nothing is renamed or rescaled. */}
                    <div className="chart-section" style={{ marginTop: '16px' }}>
                      <div className="section-title" style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                        <h2 style={{ fontSize: 'inherit', margin: 0, fontWeight: 'inherit' }}>
                          {sm.type?.toLowerCase() === 'db' ? 'PostgreSQL Metrics'
                            : sm.type?.toLowerCase() === 'mongodb' ? 'MongoDB Metrics'
                              : 'Redis Metrics'}
                          {' '}({resourceHours === 24 ? '24h' : resourceHours === 168 ? '7d' : '30d'})
                        </h2>
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }} role="group" aria-label="Metric timeframe">
                          {[
                            { label: '24 hrs', value: 24 },
                            { label: '7 days', value: 168 },
                            { label: '30 days', value: 720 },
                          ].map(t => (
                            <button
                              key={t.value}
                              type="button"
                              className="secondary"
                              aria-pressed={resourceHours === t.value}
                              style={{
                                fontSize: '12px', padding: '2px 8px', borderRadius: 'var(--radius-sm)',
                                background: resourceHours === t.value ? 'var(--accent-dim)' : 'transparent',
                                color: resourceHours === t.value ? 'var(--accent)' : 'var(--text-muted)',
                                border: resourceHours === t.value ? '1px solid var(--accent)' : '1px solid transparent',
                                cursor: 'pointer',
                                fontWeight: resourceHours === t.value ? 600 : 400,
                              }}
                              onClick={() => handleResourceHoursChange(t.value)}
                            >
                              {t.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <DatabaseMetricsChart
                        engine={sm.type?.toLowerCase() as 'db' | 'mongodb' | 'redis'}
                        metrics={metricsHistory}
                        rangeHours={resourceHours}
                      />
                    </div>

                    {/* Latency History Chart for Database Monitors */}
                    {heartbeats.length > 0 && (
                      <div className="chart-section" style={{ marginTop: '16px' }}>
                        <div className="section-title" style={{ marginBottom: '8px' }}>
                          <h2 style={{ fontSize: 'inherit', margin: 0, fontWeight: 'inherit' }}>Database Query Latency (24h)</h2>
                        </div>
                        <ResponsiveContainer width="100%" height={190}>
                          <AreaChart data={heartbeats.map((h: any) => ({
                            time: new Date(h.checked_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                            latency: h.response_time_ms || 0,
                          }))}>
                            <defs>
                              <linearGradient id="gLatency" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--accent)" stopOpacity={0.25} /><stop offset="95%" stopColor="var(--accent)" stopOpacity={0} /></linearGradient>
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
                    <div className="section-title">
                      <h2 style={{ fontSize: 'inherit', margin: 0, fontWeight: 'inherit' }}>Response Latency</h2>
                    </div>
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
                  <button
                    className="secondary"
                    disabled={downloadingPdf === 'fleet'}
                    onClick={() => getPdf('/api/reports/fleet.pdf', 'fleet')}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <FileText size={14} /> {downloadingPdf === 'fleet' ? 'Building PDF…' : 'Download PDF'}
                  </button>
                </div>

                {/* Status Alert Banner */}
                {(() => {
                  const hasDown = downCount > 0;
                  const hasWarn = !hasDown && (warnCount > 0 || homeStats.slowCount > 0);
                  const bannerBg = hasDown ? 'rgba(237, 66, 69, 0.1)' : (hasWarn ? 'var(--color-warning-glow)' : 'rgba(59, 165, 92, 0.1)');
                  const bannerBorder = hasDown ? '1px solid rgba(237, 66, 69, 0.25)' : (hasWarn ? '1px solid var(--color-warning)' : '1px solid rgba(59, 165, 92, 0.25)');
                  const dotColor = hasDown ? 'var(--color-down)' : (hasWarn ? 'var(--color-warning)' : 'var(--color-up)');
                  const dotGlow = hasDown ? '0 0 8px var(--color-down)' : (hasWarn ? '0 0 8px var(--color-warning)' : '0 0 8px var(--color-up-glow)');
                  const title = hasDown
                    ? `${downCount} Active Incident(s) Detected`
                    : (hasWarn ? `${warnCount || homeStats.slowCount} Latency / Performance Warning(s) Detected` : 'All Systems Operational');
                  const desc = hasDown
                    ? 'Some infrastructure components are experiencing connectivity issues or degraded performance.'
                    : (hasWarn
                      ? 'One or more monitors exceeded latency threshold (>= 1000ms) or resource limits.'
                      : 'All monitored endpoints and resources are responding normally.');

                  return (
                    <div style={{
                      background: bannerBg,
                      border: bannerBorder,
                      borderRadius: 'var(--radius-md)',
                      padding: '16px 20px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      marginBottom: '20px'
                    }}>
                      <div style={{
                        width: '12px', height: '12px', borderRadius: '50%',
                        background: dotColor,
                        boxShadow: dotGlow,
                        animation: 'ripple 2s infinite'
                      }} />
                      <div>
                        <h2 style={{ margin: 0, fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)' }}>
                          {title}
                        </h2>
                        <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                          {desc}
                        </p>
                      </div>
                    </div>
                  );
                })()}

                {/* KPI cards grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                  <div className="metric-card" style={{ padding: '16px 20px' }}>
                    <span className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-up)' }} />
                      Global Uptime (24h)
                    </span>
                    <div style={{ fontSize: '28px', fontWeight: 600, color: 'var(--text-primary)', marginTop: '8px', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.5px' }}>
                      {homeStats.avgUptime.toFixed(2)}%
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
                    <span className="radial-sub">{homeStats.enabled} enabled / {homeStats.paused} paused</span>
                  </div>

                  <div className="metric-card" style={{ padding: '16px 20px' }}>
                    <span className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: downCount > 0 ? 'var(--color-down)' : ((warnCount > 0 || homeStats.slowCount > 0) ? 'var(--color-warning)' : 'var(--text-muted)')
                      }} />
                      Active Incidents &amp; Alerts
                    </span>
                    <div style={{
                      fontSize: '28px', fontWeight: 600,
                      color: downCount > 0 ? 'var(--color-down)' : ((warnCount > 0 || homeStats.slowCount > 0) ? 'var(--color-warning)' : 'var(--text-primary)'),
                      marginTop: '8px', fontFamily: 'var(--font-mono)', letterSpacing: '-0.5px'
                    }}>
                      {downCount > 0 ? downCount : (warnCount || homeStats.slowCount)}
                    </div>
                    <span className="radial-sub">
                      {downCount > 0
                        ? 'Currently failing healthchecks'
                        : ((warnCount > 0 || homeStats.slowCount > 0) ? 'Monitors exceeding latency or threshold limits' : 'No service disruptions')}
                    </span>
                  </div>

                  <div className="metric-card" style={{ padding: '16px 20px' }}>
                    <span className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-warning)' }} />
                      Avg Response Time
                    </span>
                    <div style={{ fontSize: '28px', fontWeight: 600, color: 'var(--text-primary)', marginTop: '8px', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.5px' }}>
                      {numberFmt.format(homeStats.avgLatency)} ms
                    </div>
                    <span className="radial-sub">Overall system responsiveness</span>
                  </div>
                </div>

                {/* Outages & Hosts Overview Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px', marginBottom: '24px' }}>
                  {/* Active Incidents / Outages */}
                  <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '20px' }}>
                    <h3 style={{ margin: '0 0 14px', fontSize: '15px', fontWeight: 700 }}>Outages &amp; Alerts</h3>
                    {homeStats.outages.length === 0 ? (
                      <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                        No active outages or alerts detected.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {homeStats.outages.map(m => {
                          const isWarn = m.status === 'warning' || (m.status !== 'down' && m.status !== 'critical' && m.response_time_ms >= 1000);
                          const errText = m.error || (m.response_time_ms >= 1000 ? `High Latency (${numberFmt.format(m.response_time_ms)} ms)` : 'Threshold Exceeded');
                          const timing = m.metrics?.timing;
                          return (
                            <button
                              key={m.id}
                              type="button"
                              className={`outage-row ${isWarn ? 'warning' : ''}`}
                              onClick={() => { setSelectedMonitor(m); setView('dashboard'); }}
                              aria-label={`Open ${m.name}, status ${m.status || 'alert'}`}
                              title={errText}
                            >
                              <span className="outage-row-main">
                                <span className="outage-row-name">{m.name}</span>
                                <span className="outage-row-host">
                                  {m.host} ({m.type.toUpperCase()})
                                  {timing && (
                                    <span style={{ marginLeft: '6px', color: 'var(--color-warning)', fontWeight: 500 }}>
                                      · Connect: {timing.connect_ms}ms, Exec: {timing.exec_ms}ms ({timing.bottleneck})
                                    </span>
                                  )}
                                </span>
                              </span>
                              <span className="outage-row-err">{errText}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Quick Monitors Table */}
                  <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '20px' }}>
                    <h3 style={{ margin: '0 0 14px', fontSize: '15px', fontWeight: 700 }}>Infrastructure Overview</h3>
                    <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {filteredMonitors.map(m => (
                        <button
                          key={m.id}
                          type="button"
                          className="infra-row"
                          onClick={() => { setSelectedMonitor(m); setView('dashboard'); }}
                          aria-label={`Open ${m.name}, status ${m.status || 'unknown'}`}
                        >
                          <span className="infra-row-main">
                            <span className={`status-dot ${m.status || 'off'}`} style={{ width: '8px', height: '8px' }} />
                            <span className="infra-row-name">{m.name}</span>
                          </span>
                          <span className="infra-row-stats">
                            <span
                              className="infra-row-ms"
                              style={m.response_time_ms >= 1000 ? { color: 'var(--color-warning)', fontWeight: 600 } : undefined}
                            >
                              {m.response_time_ms > 0 ? `${numberFmt.format(m.response_time_ms)} ms` : '—'}
                            </span>
                            <span
                              className="infra-row-uptime"
                              style={{ color: m.status === 'up' ? 'var(--color-up)' : 'var(--color-down)' }}
                            >
                              {m.uptime_24h ? `${m.uptime_24h.toFixed(1)}%` : '—'}
                            </span>
                          </span>
                        </button>
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
      )}

      {/* ─── MODALS (LAZY LOADED) ─── */}
      <React.Suspense fallback={null}>
        <UserPreferencesModal
          isOpen={showPreferencesModal}
          onClose={() => setShowPreferencesModal(false)}
          apiUrl={API_URL}
          token={token}
          role={role}
          monitors={monitors}
          allTags={allTags}
          onRenameTag={handleRenameTag}
          onDeleteTag={handleDeleteTag}
          onAddTag={handleAddTag}
          accent={accentColor}
          onAccentChange={changeAccent}
          onSaved={(saved) => {
            setInstanceSettings(saved);
            applyAppearance(saved.appearance);
          }}
        />

        <BatchEditModal
          isOpen={isBatchEditModalOpen}
          onClose={() => setIsBatchEditModalOpen(false)}
          selectedCount={selectedMonitorIds.length}
          selectedMonitors={monitors.filter(m => selectedMonitorIds.includes(m.id))}
          existingTags={allTags}
          onApplyBatch={handleApplyBatchEdit}
        />

        <MonitorModal
          isOpen={isModalOpen}
          onClose={() => { setIsModalOpen(false); setEditingMonitor(null); }}
          onSave={handleSaveMonitor}
          editingMonitor={editingMonitor}
          globalThresholds={instanceSettings.thresholds}
          token={token}
          existingTags={allTags}
          onToast={showToast}
        />

        <UpdateModal
          isOpen={showUpdateModal}
          onClose={() => setShowUpdateModal(false)}
          apiUrl={API_URL}
          currentAppVersion={appVersion}
          onUpdateDetected={(info) => {
            setHasUpdate(info.has_update);
            if (info.latest_version) setLatestVersion(info.latest_version);
          }}
        />
      </React.Suspense>

      {/* ─── STATUS PAGE CREATE/EDIT MODAL ─── */}
      {showSpModal && (
        <Dialog isOpen={showSpModal} onClose={() => setShowSpModal(false)} aria-labelledby="sp-modal-title" className="modal-content" style={{ width: '540px', padding: '24px', borderRadius: '24px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}>
          <div className="modal-header" style={{ marginBottom: '20px' }}>
            <div>
              <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--text-muted)', fontWeight: 700 }}>Status Page Configuration</span>
              <h3 id="sp-modal-title" style={{ margin: 0, fontSize: '20px', fontWeight: 700, fontFamily: 'var(--font-header)' }}>{editingPage ? 'Edit Status Page' : 'New Status Page'}</h3>
            </div>
            <button type="button" aria-label="Close modal" className="secondary" style={{ padding: '8px', borderRadius: '50%' }} onClick={() => setShowSpModal(false)}>
              <X size={16} />
            </button>
          </div>

          <div className="form-group" style={{ marginBottom: '16px' }}>
            <label htmlFor="sp-page-name" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Page Name *</label>
            <input
              id="sp-page-name"
              type="text" placeholder="e.g. Production Status"
              value={spForm.name}
              onChange={e => setSpForm(p => ({ ...p, name: e.target.value }))}
              style={{ borderRadius: '11px', padding: '11px 14px' }}
            />
          </div>

          <div className="form-row" style={{ gap: '16px', marginBottom: '16px' }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label htmlFor="sp-page-slug" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Slug (URL path) *</label>
              <input
                id="sp-page-slug"
                type="text" placeholder="e.g. production"
                value={spForm.slug}
                onChange={e => setSpForm(p => ({ ...p, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))}
                style={{ borderRadius: '11px', padding: '11px 14px' }}
              />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label htmlFor="sp-page-visibility" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Visibility</label>
              <select id="sp-page-visibility" value={spForm.is_public ? 'public' : 'private'} onChange={e => setSpForm(p => ({ ...p, is_public: e.target.value === 'public' }))} style={{ borderRadius: '11px', padding: '11px 14px' }}>
                <option value="public">Public (no login)</option>
                <option value="private">Private</option>
              </select>
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: '16px' }}>
            <label htmlFor="sp-page-desc" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Description</label>
            <textarea
              id="sp-page-desc"
              rows={2} placeholder="Optional description shown on the status page"
              value={spForm.description}
              onChange={e => setSpForm(p => ({ ...p, description: e.target.value }))}
              style={{ resize: 'vertical', borderRadius: '11px', padding: '11px 14px' }}
            />
          </div>

          <div className="form-group" style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '11px' }}>
              <label htmlFor="sp-monitor-search" style={{ margin: 0, fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Monitors to Display</label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  id="sp-monitor-search"
                  type="search"
                  placeholder="Search monitors…"
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
                  No monitors matching &quot;&quot;{spSearch}&quot;&quot;
                </div>
              ) : (
                monitors
                  .filter(m => (m.name + (m.host || '')).toLowerCase().includes(spSearch.toLowerCase()))
                  .map(m => (
                    <label key={m.id} className="sp-monitor-check" style={{ display: 'flex', alignItems: 'center', gap: '11px', padding: '8px 12px', borderRadius: '8px', cursor: 'pointer', transition: 'background 0.15s' }}>
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
                      <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{m.host}</span>
                    </label>
                  ))
              )}
            </div>
          </div>

          {/* Preview URL */}
          {spForm.slug && (
            <div className="form-group">
              <label htmlFor="sp-url-preview">Public URL Preview</label>
              <div className="sp-url-row">
                <input id="sp-url-preview" aria-label="Public URL Preview" readOnly value={`${window.location.origin}/status/${spForm.slug}`} style={{ fontSize: '12px', color: 'var(--text-muted)' }} />
              </div>
            </div>
          )}

          <div className="form-actions">
            <button className="secondary" onClick={() => setShowSpModal(false)}>Cancel</button>
            <button onClick={handleSaveStatusPage} disabled={spSaving}>
              {spSaving ? 'Saving…' : (editingPage ? 'Update Page' : 'Create Page')}
            </button>
          </div>
        </Dialog>
      )}

      {/* ─── PDF REPORT GENERATION MODAL ─── */}
      {showReportModal && reportTarget && (
        <Dialog isOpen={showReportModal} onClose={() => setShowReportModal(false)} aria-labelledby="report-modal-title" className="modal-content" style={{ width: '600px', background: 'var(--bg-elevated)' }}>
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
            <label htmlFor="report-time-range">Select Report Time Range</label>
            <select
              id="report-time-range"
              value={reportRange}
              onChange={e => handleGenerateReport(reportTarget, Number(e.target.value))}
              style={{ width: '100%', padding: '11px' }}
            >
              <option value={24}>Last 24 Hours</option>
              <option value={168}>Last 7 Days</option>
              <option value={720}>Last 30 Days</option>
              <option value={2160}>Last 90 Days</option>
            </select>
          </div>

          {reportLoading ? (
            <div aria-live="polite" style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
              ⏳ Querying database and calculating metrics…
            </div>
          ) : reportData ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Stats Summary Preview */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '11px' }}>
                <div style={{ background: 'var(--surface-raised)', padding: '11px', borderRadius: '6px', textAlign: 'center', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Uptime</div>
                  <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--color-up)', marginTop: '4px' }}>
                    {reportData.uptimePct.toFixed(2)}%
                  </div>
                </div>
                <div style={{ background: 'var(--surface-raised)', padding: '11px', borderRadius: '6px', textAlign: 'center', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>MTTR</div>
                  <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-primary)', marginTop: '4px' }}>
                    {reportData.mttrMin} Mins
                  </div>
                </div>
                <div style={{ background: 'var(--surface-raised)', padding: '11px', borderRadius: '6px', textAlign: 'center', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>MTBF</div>
                  <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-primary)', marginTop: '4px' }}>
                    {reportData.mtbfHours} Hours
                  </div>
                </div>
              </div>

              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Total outages in period: <span style={{ fontWeight: '700', color: reportData.failures > 0 ? 'var(--color-down)' : 'var(--text-muted)' }}>{reportData.failures}</span>
              </div>

              <div className="form-actions" style={{ marginTop: '11px' }}>
                <button className="secondary" onClick={() => setShowReportModal(false)}>Close</button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={downloadingPdf === 'monitor'}
                  onClick={() => reportTarget && getPdf(
                    `/api/reports/targets/${encodeURIComponent(reportTarget.id)}.pdf?hours=${reportRange}`,
                    'monitor',
                  )}
                >
                  <Download size={14} aria-hidden="true" />
                  {downloadingPdf === 'monitor' ? 'Building PDF…' : 'Download PDF'}
                </button>
              </div>
            </div>
          ) : null}
        </Dialog>
      )}

      {/* ─── PRINT-ONLY AVAILABILITY REPORT ─── */}
      

      

      

      


    </div>
  );
}

export default App;
