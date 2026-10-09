import { useState } from 'react';
import { Empty, ErrorBox, PageHeader, Pager, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { dateTime } from '../lib/format';
import type { Paged } from '../lib/types';
import { useAsync } from '../lib/useAsync';

interface Row { id: number; createdAt: string; action: string; entityType: string | null; entityId: string | null; user: { username: string; fullName: string } | null; ipAddress: string | null; metadata: Record<string, unknown> | null }

export default function AuditLog() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const useRange = !!from && !!to && to >= from;
  const list = useAsync(() => api.get<Paged<Row>>('/audit-logs', { page, pageSize: 30, action: action.trim(), ...(useRange ? { from, to } : {}) }), [page, action, from, to]);
  return (
    <div>
      <PageHeader title="Audit log" subtitle="Who did what and when. Entries cannot be edited. Passwords and tokens are never recorded." />
      <div className="card mb-4 flex flex-wrap items-end gap-3 p-4">
        <label className="block"><span className="label">Action contains</span><input className="input" value={action} placeholder="e.g. LOGIN" onChange={(e) => { setAction(e.target.value); setPage(1); }} /></label>
        <label className="block"><span className="label">From</span><input type="date" className="input" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></label>
        <label className="block"><span className="label">To</span><input type="date" className="input" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></label>
      </div>
      {list.loading && !list.data ? <Spinner /> : list.error && !list.data ? <ErrorBox message={list.error} onRetry={() => void list.reload()} /> : (
        <div className="card overflow-x-auto">
          {list.data!.items.length === 0 ? <Empty>No entries.</Empty> : (
            <table className="w-full">
              <thead className="bg-slate-50"><tr><th className="th">When</th><th className="th">User</th><th className="th">Action</th><th className="th">Entity</th><th className="th">IP</th><th className="th">Details</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {list.data!.items.map((r) => (
                  <tr key={r.id}>
                    <td className="td whitespace-nowrap">{dateTime(r.createdAt)}</td><td className="td">{r.user?.username ?? <span className="text-slate-400">system</span>}</td>
                    <td className="td font-mono text-xs">{r.action}</td><td className="td">{r.entityType ? `${r.entityType} ${r.entityId ?? ''}` : '—'}</td><td className="td">{r.ipAddress ?? '—'}</td>
                    <td className="td max-w-xs truncate font-mono text-xs text-slate-500" title={r.metadata ? JSON.stringify(r.metadata) : ''}>{r.metadata ? JSON.stringify(r.metadata) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Pager page={list.data!.page} pageSize={list.data!.pageSize} total={list.data!.total} onPage={setPage} />
        </div>
      )}
    </div>
  );
}
