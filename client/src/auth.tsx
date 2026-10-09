import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, setCsrfToken, setUnauthorizedHandler } from './lib/api';
import type { AuthUser } from './lib/types';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  can: (permission: string) => boolean;
  signIn: (username: string, password: string) => Promise<AuthUser>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get<{ user: AuthUser | null; csrfToken: string | null }>('/auth/me');
      setCsrfToken(r.csrfToken);
      setUser(r.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => { setCsrfToken(null); setUser(null); });
    void refresh();
    return () => setUnauthorizedHandler(null);
  }, [refresh]);

  const signIn = useCallback(async (username: string, password: string) => {
    const r = await api.post<{ user: AuthUser; csrfToken: string }>('/auth/login', { username, password });
    setCsrfToken(r.csrfToken);
    setUser(r.user);
    return r.user;
  }, []);

  const signOut = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* session may already be gone */ }
    setCsrfToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthState>(() => {
    const perms = new Set(user?.permissions ?? []);
    return { user, loading, can: (p) => perms.has(p), signIn, signOut, refresh };
  }, [user, loading, signIn, signOut, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}

/** Redirects to sign-in when there is no session; optionally requires a permission. */
export function RequireAuth({ children, permission }: { children: ReactNode; permission?: string }) {
  const { user, loading, can } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="p-8 text-sm text-slate-500" role="status">Loading…</div>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (permission && !can(permission)) {
    return (
      <div className="mx-auto max-w-lg p-10 text-center">
        <h1 className="text-xl font-bold">Not available</h1>
        <p className="mt-2 text-sm text-slate-600">Your account does not have access to this page.</p>
      </div>
    );
  }
  return <>{children}</>;
}
