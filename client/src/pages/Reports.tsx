import { useState } from 'react';
import { useAuth } from '../auth';
import { ErrorBox, PageHeader, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { duration, todayKey } from '../lib/format';
import type { Department } from '../lib/types';
import { useAsync } from '../lib/useAsync';

interface Summary {
  range: { from: string; to: string };
  totals: { registrations: number; visitsOpened: number; visitsCompleted: number; visitsIncomplete: number; visitsCancelled: number; avgVisitTurnaroundSeconds: number | null; medianVisitTurnaroundSeconds: number | null };
  daily: Array<{ date: string; registrations: number; visitsOpened: number; visitsCompleted: number; visitsCancelled: number; visitsActive: number }>;
  departments: Array<{ departmentId: number; department: string; ticketsIssued: number; completed: number; transferredOut: number; cancelled: number; skipped: number; stillOpen: number; absentEvents: number; recalls: number; referralsIn: number; avgWaitSeconds: number | null; medianWaitSeconds: number | null; longestWaitSeconds: number | null; avgServiceSeconds: number | null; medianServiceSeconds: number | null }>;
  longestWaits: Array<{ ticket: string; department: string; waitSeconds: number; enteredAt: string }>;
}

const daysAgo = (n: number) => new Date(Date.now() + 3 * 3_600_000 - n * 86_400_000).toISOString().slice(0, 10);

export default function Reports() {
  const { can } = useAuth();
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(todayKey());
  const [departmentId, setDepartmentId] = useState('');
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const depts = useAsync(() => api.get<Department[]>('/departments'), []);
  const q = { from, to, departmentId, includeCancelled };
  const report = useAsync(() => api.get<Summary>('/reports/summary', q), [from, to, departmentId, includeCancelled]);
  const invalid = !from || !to || to < from;
  const exportUrl = (kind: string) => api.url('/reports/export', { ...q, report: kind });

  return (
    <div>
      <PageHeader title="Reports" subtitle="Calculated from recorded tickets and visits. Cancelled and test visits are excluded unless you include them." />
      <form className="card mb-5 flex flex-wrap items-end gap-3 p-4" onSubmit={(e) => e.preventDefault()}>
        <label className="block"><span className="label">From</span><input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="block"><span className="label">To</span><input type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="block"><span className="label">Department</span>
          <select className="input" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}><option value="">All departments</option>{(depts.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={includeCancelled} onChange={(e) => setIncludeCancelled(e.target.checked)} /> Include cancelled visits</label>
        {can('reports.export') && !invalid && (
          <div className="ml-auto flex gap-2">
            <a className="btn-secondary btn-sm" href={exportUrl('departments')} download>Export departments CSV</a>
            <a className="btn-secondary btn-sm" href={exportUrl('daily')} download>Export daily CSV</a>
            <a className="btn-secondary btn-sm" href={exportUrl('longest-waits')} download>Export longest waits CSV</a>
          </div>
        )}
      </form>
      {invalid ? <ErrorBox message="Choose a valid date range (the end date cannot be before the start date)." /> : report.loading && !report.data ? <Spinner /> : report.error && !report.data ? <ErrorBox message={report.error} onRetry={() => void report.reload()} /> : report.data && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
            {[
              ['Registrations', report.data.totals.registrations], ['Visits opened', report.data.totals.visitsOpened], ['Completed', report.data.totals.visitsCompleted],
              ['Incomplete', report.data.totals.visitsIncomplete], ['Cancelled', report.data.totals.visitsCancelled], ['Avg turnaround', duration(report.data.totals.avgVisitTurnaroundSeconds)],
            ].map(([label, value]) => <div key={label as string} className="card p-3"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-2xl font-extrabold tabular-nums">{value}</div></div>)}
          </div>
          <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">By department</h2>
          <div className="card overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50"><tr>{['Department', 'Tickets', 'Completed', 'Transferred', 'Cancelled', 'Skipped', 'Open', 'Absent', 'Recalls', 'Referrals in', 'Avg wait', 'Median wait', 'Longest wait', 'Avg service'].map((h) => <th key={h} className="th whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {report.data.departments.map((d) => (
                  <tr key={d.departmentId}><td className="td font-semibold">{d.department}</td><td className="td tabular-nums">{d.ticketsIssued}</td><td className="td tabular-nums">{d.completed}</td><td className="td tabular-nums">{d.transferredOut}</td><td className="td tabular-nums">{d.cancelled}</td><td className="td tabular-nums">{d.skipped}</td><td className="td tabular-nums">{d.stillOpen}</td><td className="td tabular-nums">{d.absentEvents}</td><td className="td tabular-nums">{d.recalls}</td><td className="td tabular-nums">{d.referralsIn}</td><td className="td">{duration(d.avgWaitSeconds)}</td><td className="td">{duration(d.medianWaitSeconds)}</td><td className="td">{duration(d.longestWaitSeconds)}</td><td className="td">{duration(d.avgServiceSeconds)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <div>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">By day</h2>
              <div className="card overflow-x-auto"><table className="w-full"><thead className="bg-slate-50"><tr>{['Date', 'Registered', 'Visits', 'Completed', 'Cancelled', 'Active'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">{report.data.daily.map((r) => <tr key={r.date}><td className="td">{r.date}</td><td className="td tabular-nums">{r.registrations}</td><td className="td tabular-nums">{r.visitsOpened}</td><td className="td tabular-nums">{r.visitsCompleted}</td><td className="td tabular-nums">{r.visitsCancelled}</td><td className="td tabular-nums">{r.visitsActive}</td></tr>)}</tbody></table></div>
            </div>
            <div>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Longest waits</h2>
              <div className="card overflow-x-auto"><table className="w-full"><thead className="bg-slate-50"><tr><th className="th">Ticket</th><th className="th">Department</th><th className="th">Waited</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{report.data.longestWaits.length === 0 ? <tr><td className="td text-slate-500" colSpan={3}>No called tickets in this range.</td></tr> : report.data.longestWaits.map((w, i) => <tr key={i}><td className="td font-semibold">{w.ticket}</td><td className="td">{w.department}</td><td className="td">{duration(w.waitSeconds)}</td></tr>)}</tbody></table></div>
            </div>
          </div>
          <p className="mt-4 text-xs text-slate-500">Wait = first call − arrival. Service = completion − start of service, for completed tickets. Turnaround = visit close − visit opening, for completed visits. Dates use the hospital’s local day.</p>
        </>
      )}
    </div>
  );
}
