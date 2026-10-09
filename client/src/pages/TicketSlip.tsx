import { useParams, Link } from 'react-router-dom';
import { ErrorBox, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { dateTime } from '../lib/format';
import { useAsync } from '../lib/useAsync';

interface Slip { hospitalName: string; displayNumber: string; departmentName: string; issuedAt: string; peopleAhead: number; instructions: string }

/** Thermal-printer friendly ticket. Contains no personal or medical information. */
export default function TicketSlip() {
  const { ticketId } = useParams();
  const { data, error, loading, reload } = useAsync(() => api.get<Slip>(`/tickets/${ticketId}/slip`), [ticketId]);
  if (loading) return <Spinner />;
  if (error || !data) return <ErrorBox message={error ?? 'Ticket not found'} onRetry={() => void reload()} />;
  return (
    <div className="mx-auto max-w-sm">
      <div className="print-area card p-6 text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">{data.hospitalName}</p>
        <p className="mt-4 text-sm text-slate-500">Your number</p>
        <p className="text-7xl font-extrabold tracking-tight" data-testid="slip-number">{data.displayNumber}</p>
        <p className="mt-2 text-lg font-semibold">{data.departmentName}</p>
        <p className="mt-1 text-sm text-slate-600">{data.peopleAhead} {data.peopleAhead === 1 ? 'person' : 'people'} ahead of you</p>
        <p className="mt-3 text-xs text-slate-500">{dateTime(data.issuedAt)}</p>
        <p className="mt-4 border-t border-dashed border-slate-300 pt-3 text-xs text-slate-600">{data.instructions}</p>
      </div>
      <div className="mt-4 flex justify-center gap-2">
        <button className="btn-primary" onClick={() => window.print()}>Print ticket</button>
        <Link className="btn-secondary" to="/">Done</Link>
      </div>
    </div>
  );
}
