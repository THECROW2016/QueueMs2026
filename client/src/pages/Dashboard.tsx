import { Link } from 'react-router-dom';
import { ErrorBox, PageHeader, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { duration } from '../lib/format';
import { useLiveUpdates } from '../lib/socket';
import type { Department } from '../lib/types';
import { useAsync } from '../lib/useAsync';

interface Dash {
  date: string; activeVisits: number; registrationsToday: number; visitsOpenedToday: number; visitsCompletedToday: number;
  avgWaitTodaySeconds: number | null; medianWaitTodaySeconds: number | null; ticketsTodayByStatus: Record<string, number>;
  departments: Array<{ id: number; name: string; code: string; waiting: number; called: number; inService: number; onHold: number; absent: number; longestWaitingSeconds: number | null }>;
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-3xl font-extrabold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export default function Dashboard() {
  const dash = useAsync(() => api.get<Dash>('/dashboard'), []);
  const depts = useAsync(() => api.get<Department[]>('/departments'), []);
  const { connected } = useLiveUpdates((depts.data ?? []).map((d) => d.id), () => void dash.reload(), 20_000);
  if (dash.loading && !dash.data) return <Spinner />;
  if (dash.error && !dash.data) return <ErrorBox message={dash.error} onRetry={() => void dash.reload()} />;
  const d = dash.data!;
  const t = d.ticketsTodayByStatus;
  return (
    <div>
      <PageHeader title="Hospital overview" subtitle={`Today, ${d.date}. Figures are read from the database each time this page refreshes.`} actions={<span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${connected ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{connected ? '● Live' : '○ Refreshing'}</span>} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Patients registered" value={d.registrationsToday} />
        <Stat label="Active visits" value={d.activeVisits} hint={`${d.visitsOpenedToday} opened · ${d.visitsCompletedToday} completed today`} />
        <Stat label="Average wait" value={duration(d.avgWaitTodaySeconds)} hint={`Median ${duration(d.medianWaitTodaySeconds)}`} />
        <Stat label="Tickets today" value={Object.values(t).reduce((a, b) => a + b, 0)} hint={`${t.COMPLETED ?? 0} completed · ${t.CANCELLED ?? 0} cancelled`} />
      </div>
      <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">Departments</h2>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50"><tr><th className="th">Department</th><th className="th">Waiting</th><th className="th">Called</th><th className="th">In service</th><th className="th">On hold</th><th className="th">Absent</th><th className="th">Longest wait</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {d.departments.map((x) => (
              <tr key={x.id}>
                <td className="td font-semibold"><Link className="text-brand-700 hover:underline" to={`/queue/${x.id}`}>{x.name}</Link></td>
                <td className="td tabular-nums">{x.waiting}</td><td className="td tabular-nums">{x.called}</td><td className="td tabular-nums">{x.inService}</td>
                <td className="td tabular-nums">{x.onHold}</td><td className="td tabular-nums">{x.absent}</td><td className="td">{duration(x.longestWaitingSeconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
