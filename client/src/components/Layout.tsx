import { useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { api } from '../lib/api';
import { useLiveUpdates } from '../lib/socket';
import type { Department, Paged, Notification } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { closeSocket } from '../lib/socket';

const link = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${isActive ? 'bg-brand-600 text-white' : 'text-slate-300 hover:bg-ink-700 hover:text-white'}`;

export function Layout() {
  const { user, can, signOut } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const depts = useAsync(() => api.get<Department[]>('/departments'), []);
  const unread = useAsync(() => (can('notifications.view') ? api.get<Paged<Notification> & { unread: number }>('/notifications', { unreadOnly: 'true', pageSize: 1 }) : Promise.resolve(null)), []);
  const ids = (depts.data ?? []).map((d) => d.id);
  useLiveUpdates(ids, () => void unread.reload(), 30_000);
  useEffect(() => setOpen(false), [location.pathname]);

  if (user?.mustChangePassword && location.pathname !== '/account') return <Navigate to="/account" replace />;

  const clinicalOrOps = (depts.data ?? []).filter((d) => can('queue.view'));
  return (
    <div className="flex min-h-screen">
      <aside className={`${open ? 'block' : 'hidden'} fixed inset-y-0 left-0 z-40 w-64 shrink-0 overflow-y-auto bg-ink-900 p-4 md:static md:block`} aria-label="Main navigation">
        <div className="mb-6 flex items-center gap-2 px-1">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-500 font-extrabold text-white">A</span>
          <div className="leading-tight text-white">
            <div className="font-bold">AfriQueue</div>
            <div className="text-[10px] tracking-wider text-slate-400">HOSPITAL QUEUES</div>
          </div>
        </div>
        <nav className="space-y-1">
          {can('dashboard.admin') && <NavLink to="/" end className={link}>Dashboard</NavLink>}
          {clinicalOrOps.length > 0 && <div className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Queues</div>}
          {clinicalOrOps.map((d) => <NavLink key={d.id} to={`/queue/${d.id}`} className={link}>{d.name}</NavLink>)}
          <div className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Records</div>
          {can('patient.search') && <NavLink to="/patients" className={link}>Patients</NavLink>}
          {can('visit.view') && <NavLink to="/visits" className={link}>Visits</NavLink>}
          {can('notifications.view') && (
            <NavLink to="/notifications" className={link}>
              Notifications
              {(unread.data?.unread ?? 0) > 0 && <span className="ml-auto rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white" aria-label={`${unread.data?.unread} unread`}>{unread.data?.unread}</span>}
            </NavLink>
          )}
          {(can('reports.view') || can('audit.view') || can('users.manage') || can('settings.manage')) && <div className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Administration</div>}
          {can('reports.view') && <NavLink to="/reports" className={link}>Reports</NavLink>}
          {can('users.manage') && <NavLink to="/admin/users" className={link}>Users</NavLink>}
          {(can('departments.manage') || can('counters.manage') || can('routing.manage')) && <NavLink to="/admin/departments" className={link}>Departments &amp; routing</NavLink>}
          {can('settings.manage') && <NavLink to="/admin/settings" className={link}>Settings</NavLink>}
          {can('audit.view') && <NavLink to="/admin/audit" className={link}>Audit log</NavLink>}
          <div className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Screens</div>
          <a href="/display" target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-300 hover:bg-ink-700 hover:text-white">Waiting-room display ↗</a>
        </nav>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5">
          <button className="btn-secondary btn-sm md:hidden" onClick={() => setOpen(true)} aria-label="Open menu">☰ Menu</button>
          <div className="hidden text-sm text-slate-500 md:block">{(user?.roles ?? []).join(', ').replace(/_/g, ' ').toLowerCase()}</div>
          <div className="flex items-center gap-3">
            <NavLink to="/account" className="text-sm font-medium text-slate-700 hover:underline">{user?.fullName}</NavLink>
            <button className="btn-secondary btn-sm" onClick={async () => { await signOut(); closeSocket(); nav('/login', { replace: true }); }}>Sign out</button>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6"><Outlet /></main>
      </div>
    </div>
  );
}
