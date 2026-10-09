import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, ErrorBox, PageHeader, Pager, Spinner, useToast } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { dateTime, humanize } from '../lib/format';
import { useLiveUpdates } from '../lib/socket';
import type { Notification, Paged } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { useAuth } from '../auth';

export default function Notifications() {
  const { user } = useAuth();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const list = useAsync(() => api.get<Paged<Notification> & { unread: number }>('/notifications', { page, pageSize: 20, unreadOnly }), [page, unreadOnly]);
  useLiveUpdates(user?.departmentIds ?? [], () => void list.reload(), 30_000);

  async function mark(body: { ids?: number[]; all?: boolean }) {
    try { await api.post('/notifications/read', body); await list.reload(); } catch (e) { toast('error', errorMessage(e)); }
  }
  if (list.loading && !list.data) return <Spinner />;
  if (list.error && !list.data) return <ErrorBox message={list.error} onRetry={() => void list.reload()} />;
  const d = list.data!;
  return (
    <div>
      <PageHeader title="Notifications" subtitle={`${d.unread} unread`} actions={
        <>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={unreadOnly} onChange={(e) => { setUnreadOnly(e.target.checked); setPage(1); }} /> Unread only</label>
          <button className="btn-secondary" disabled={d.unread === 0} onClick={() => void mark({ all: true })}>Mark all read</button>
        </>
      } />
      <div className="card overflow-hidden">
        {d.items.length === 0 ? <Empty>No notifications.</Empty> : (
          <ul className="divide-y divide-slate-100">
            {d.items.map((n) => (
              <li key={n.id} className={`flex items-start gap-3 px-4 py-3 ${n.read ? '' : 'bg-brand-50/50'}`}>
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${n.read ? 'bg-slate-300' : n.type === 'EMERGENCY' ? 'bg-red-600' : 'bg-brand-600'}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{n.title}</p>
                  {n.body && <p className="text-sm text-slate-600">{n.body}</p>}
                  <p className="mt-0.5 text-xs text-slate-500">{n.department.name} · {humanize(n.type)} · {dateTime(n.createdAt)}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {n.visitId && <Link className="btn-secondary btn-sm" to={`/visits/${n.visitId}`}>Open visit</Link>}
                  {!n.read && <button className="btn-secondary btn-sm" onClick={() => void mark({ ids: [n.id] })}>Mark read</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
        <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
      </div>
    </div>
  );
}
