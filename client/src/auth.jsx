import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = still checking

  const refresh = useCallback(
    () => api('/auth/me').then((r) => setUser(r.user)).catch(() => setUser(null)),
    [],
  );
  useEffect(() => {
    refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await api('/auth/logout', {}).catch(() => {});
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, setUser, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

/** Only render children for a signed-in user (with the admin role if asked). */
export function RequireAuth({ role, children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (user === undefined) return <main className="page">Loading…</main>;
  if (!user) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  }
  if (role === 'admin' && user.role !== 'admin') return <Navigate to="/counter" replace />;
  return children;
}

/** Signed-in user's name with change-password and sign-out controls. */
export function StaffBar() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [msg, setMsg] = useState('');

  async function save(e) {
    e.preventDefault();
    setMsg('');
    try {
      await api('/auth/password', form);
      setForm({ currentPassword: '', newPassword: '' });
      setMsg('Password changed.');
    } catch (err) {
      setMsg(err.message);
    }
  }

  if (!user) return null;
  return (
    <div className="staff-bar">
      <div className="row between wrap">
        <span className="muted">
          Signed in as <b>{user.full_name || user.username}</b> · {user.role === 'admin' ? 'Admin' : 'Staff'}
        </span>
        <div className="row wrap">
          {user.role === 'admin' && (
            <>
              <button className="btn ghost" onClick={() => navigate('/admin')}>Setup</button>
              <button className="btn ghost" onClick={() => navigate('/counter')}>Counter</button>
            </>
          )}
          <button className="btn ghost" onClick={() => setOpen(!open)}>Change password</button>
          <button
            className="btn ghost"
            onClick={async () => {
              await signOut();
              navigate('/login');
            }}
          >
            Sign out
          </button>
        </div>
      </div>
      {open && (
        <form className="row wrap password-form" onSubmit={save}>
          <input type="password" placeholder="Current password" autoComplete="current-password"
            value={form.currentPassword} required
            onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
          <input type="password" placeholder="New password (8+ characters)" autoComplete="new-password"
            value={form.newPassword} required minLength={8}
            onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
          <button className="btn primary">Save</button>
          {msg && <span className="muted">{msg}</span>}
        </form>
      )}
    </div>
  );
}
