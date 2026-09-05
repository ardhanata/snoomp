/**
 * Client for /api/settings.
 *
 * These are instance-wide, not per-browser: two operators looking at the same
 * fleet must see the same SLA colouring. localStorage is still used, but only
 * as a first-paint cache so badges do not flicker while the request is in
 * flight — the server response always wins.
 */

export const REDACTED = '••••••••';

export interface SlaSettings {
  normal: number;
  warning: number;
  critical: number;
}

export interface ThresholdSettings {
  /* Index signature so the whole block can be handed to components that read
     thresholds by key (the per-monitor override form does exactly that). */
  [key: string]: number | null;
  cpu_warn: number | null;
  cpu_crit: number | null;
  mem_warn: number | null;
  mem_crit: number | null;
  disk_warn: number | null;
  disk_crit: number | null;
  latency_warn: number | null;
  latency_crit: number | null;
}

export interface DiscordSettings {
  enabled: boolean;
  webhook_critical: string;
  webhook_warning: string;
  oncall_role_id: string;
}

export interface DefaultsSettings {
  check_interval: number;
  retries: number;
  request_timeout: number;
  monitor_type: string;
  environment_tag: string;
  retention_days: number;
}

export interface AppearanceSettings {
  chart_1: string;
  chart_2: string;
  chart_3: string;
}

export interface InstanceSettings {
  sla: SlaSettings;
  thresholds: ThresholdSettings;
  discord: DiscordSettings;
  defaults: DefaultsSettings;
  appearance: AppearanceSettings;
}

/** Mirrors the server's DEFAULTS so the UI can render before the fetch lands. */
export const DEFAULT_SETTINGS: InstanceSettings = {
  sla: { normal: 99.9, warning: 99.0, critical: 95.0 },
  thresholds: {
    cpu_warn: 80, cpu_crit: 95,
    mem_warn: 85, mem_crit: 95,
    disk_warn: 85, disk_crit: 95,
    latency_warn: null, latency_crit: null,
  },
  discord: { enabled: false, webhook_critical: '', webhook_warning: '', oncall_role_id: '' },
  defaults: {
    check_interval: 60, retries: 0, request_timeout: 10,
    monitor_type: 'http', environment_tag: '', retention_days: 90,
  },
  appearance: { chart_1: '#8b5cf6', chart_2: '#06b6d4', chart_3: '#ec4899' },
};

const CACHE_KEY = 'snoomp_settings_cache_v1';

/**
 * Parse a number from a text input without assuming the user's decimal mark.
 *
 * `parseFloat('99,9')` returns 99 — it stops at the comma. Users on a comma-
 * decimal locale were silently storing a different value from the one on
 * screen, which is how an SLA target of 99.9 became 99.
 */
export function parseDecimal(raw: string): number | null {
  const normalised = (raw ?? '').trim().replace(',', '.');
  if (normalised === '') return null;
  const n = Number(normalised);
  return Number.isFinite(n) ? n : null;
}

/** Last known settings, for synchronous first paint. Never contains secrets. */
export function readCache(): InstanceSettings {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      sla: { ...DEFAULT_SETTINGS.sla, ...(parsed.sla || {}) },
      thresholds: { ...DEFAULT_SETTINGS.thresholds, ...(parsed.thresholds || {}) },
      discord: { ...DEFAULT_SETTINGS.discord, ...(parsed.discord || {}) },
      defaults: { ...DEFAULT_SETTINGS.defaults, ...(parsed.defaults || {}) },
      appearance: { ...DEFAULT_SETTINGS.appearance, ...(parsed.appearance || {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeCache(settings: InstanceSettings) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(settings));
  } catch {
    /* quota or private mode — the cache is optional */
  }
}

async function request<T>(apiUrl: string, token: string | null, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiUrl}/api/settings${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    // FastAPI puts the useful message in `detail`; surface it rather than a
    // bare status code, because these are almost always validation failures
    // the user can act on.
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body?.detail === 'string') detail = body.detail;
      else if (Array.isArray(body?.detail) && body.detail[0]?.msg) detail = body.detail[0].msg;
    } catch { /* non-JSON error body */ }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export async function fetchSettings(apiUrl: string, token: string | null): Promise<InstanceSettings> {
  const data = await request<InstanceSettings>(apiUrl, token, '/');
  writeCache(data);
  return data;
}

/** Partial update — send only the sections that changed. */
export async function saveSettings(
  apiUrl: string,
  token: string | null,
  patch: Partial<InstanceSettings>,
): Promise<InstanceSettings> {
  const data = await request<InstanceSettings>(apiUrl, token, '/', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
  writeCache(data);
  return data;
}

export async function testDiscord(apiUrl: string, token: string | null): Promise<{ ok: boolean; detail: string }> {
  return request(apiUrl, token, '/discord/test', { method: 'POST' });
}

/** Push chart colours into the CSS custom properties the charts read. */
export function applyAppearance(appearance: AppearanceSettings) {
  const root = document.documentElement;
  root.style.setProperty('--chart-1', appearance.chart_1);
  root.style.setProperty('--chart-2', appearance.chart_2);
  root.style.setProperty('--chart-3', appearance.chart_3);
}
