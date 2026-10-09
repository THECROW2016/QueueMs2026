import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, ErrorBox, PageHeader, Pager, Spinner, StatusBadge } from '../components/ui';
import { api } from '../lib/api';
import { dateTime } from '../lib/format';
import type { Paged } from '../lib/types';
import { useAsync } from '../lib/useAsync';

interface Row { id: number; visitNumber: string; status: string; isEmergency: boolean; openedAt: string; closedAt: string | null; ticketCount: number; patient: { fullName: string; mrn: string } | null; billingCleared: boolean }

export default function Visits() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const list = useAsync(() => api.get<Paged<Row>>('/visits', { page, pageSize: 20, status }), [page, status]);
  return (
    <div>
      <PageHeader title="Visits" subtitle="Visits you are allowed to see, newest first." actions={
        <select className="input" aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option><option value="ACTIVE">Active</option><option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option>
        </select>
      } />
      {list.loading && !list.data ? <Spinner /> : list.error && !list.data ? <ErrorBox message={list.error} onRetry={() => void list.reload()} /> : (
        <div className="card overflow-hidden">
          {list.data!.items.length === 0 ? <Empty>No visits found.</Empty> : (
            <table className="w-full">
              <thead className="bg-slate-50"><tr><th className="th">Visit</th><th className="th">Patient</th><th className="th">Opened</th><th className="th">Tickets</th><th className="th">Status</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {list.data!.items.map((v) => (
                  <tr key={v.id}>
                    <td className="td font-semibold"><Link className="text-brand-700 hover:underline" to={`/visits/${v.id}`}>{v.visitNumber}</Link> {v.isEmergency && <span className="rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-bold text-white">EMERGENCY</span>}</td>
                    <td className="td">{v.patient ? `${v.patient.fullName} · ${v.patient.mrn}` : <span className="text-slate-400">Restricted</span>}</td>
                    <td className="td">{dateTime(v.openedAt)}</td><td className="td">{v.ticketCount}</td><td className="td"><StatusBadge status={v.status} /></td>
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
