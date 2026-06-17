/**
 * Fetch wrapper for the superadmin-api envelope { success, data, meta, error }.
 * Handles bearer auth, one transparent refresh on 401, and logout broadcast.
 */

export interface ApiMeta {
  page: number;
  limit: number;
  total: number;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly error: ApiError,
  ) {
    super(error.message);
  }
}

const BASE = '/api/v1';
const STORAGE_KEY = 'jainerp_sa_session';

export interface Session {
  access_token: string;
  refresh_token: string;
  user: { id: string; name: string | null; email: string | null; mobile: string; admin_role?: string };
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null) {
  if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  else localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event('session-changed'));
}

async function rawRequest<T>(
  path: string,
  opts: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<{ data: T; meta: ApiMeta | null }> {
  const res = await fetch(BASE + path, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    throw new ApiRequestError(
      res.status,
      json?.error ?? { code: 'NETWORK', message: `HTTP ${res.status}` },
    );
  }
  return { data: json.data as T, meta: json.meta ?? null };
}

let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const session = loadSession();
  if (!session) return null;
  try {
    const { data } = await rawRequest<{ access_token: string }>('/admin/auth/refresh', {
      method: 'POST',
      body: { refresh_token: session.refresh_token },
    });
    saveSession({ ...session, access_token: data.access_token });
    return data.access_token;
  } catch {
    saveSession(null);
    return null;
  }
}

/** Authenticated request with envelope unwrap + auto refresh-once on 401. */
export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<{ data: T; meta: ApiMeta | null }> {
  const session = loadSession();
  try {
    return await rawRequest<T>(path, { ...opts, token: session?.access_token });
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 401 && session) {
      refreshing = refreshing ?? refreshAccessToken();
      const token = await refreshing;
      refreshing = null;
      if (token) return rawRequest<T>(path, { ...opts, token });
    }
    throw e;
  }
}

/** Unauthenticated request (login steps). */
export const publicApi = rawRequest;

export function formatPaise(paise: number | null | undefined): string {
  if (paise == null) return '—';
  return '₹' + (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
