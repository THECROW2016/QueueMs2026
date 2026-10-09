export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown, public requestId?: string) {
    super(message);
  }
}

let csrfToken = '';
export const setCsrfToken = (t: string | null) => { csrfToken = t ?? ''; };

type Query = Record<string, string | number | boolean | undefined | null>;
const qs = (q?: Query) => {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: (() => void) | null) => { onUnauthorized = fn; };

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  let res: Response;
  try {
    res = await fetch(`/api${path}${qs(query)}`, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string; details?: unknown; requestId?: string } } | null)?.error;
    if (res.status === 401 && path !== '/auth/login' && path !== '/auth/me') onUnauthorized?.();
    throw new ApiError(res.status, e?.code ?? 'ERROR', e?.message ?? `Request failed (${res.status}).`, e?.details, e?.requestId);
  }
  return data as T;
}

export const api = {
  get: <T,>(path: string, query?: Query) => request<T>('GET', path, undefined, query),
  post: <T,>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T,>(path: string, body: unknown = {}) => request<T>('PATCH', path, body),
  put: <T,>(path: string, body: unknown = {}) => request<T>('PUT', path, body),
  del: <T,>(path: string) => request<T>('DELETE', path),
  /** Absolute URL for downloads (CSV); the session cookie authorises it. */
  url: (path: string, query?: Query) => `/api${path}${qs(query)}`,
};

export const errorMessage = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong.');
