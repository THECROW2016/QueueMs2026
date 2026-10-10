import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { PrintableSlip, type SlipData } from '../components/PrintableSlip';
import { PrinterSettings } from '../components/PrinterSettings';
import { ErrorBox, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { usePrintSettings } from '../lib/printSettings';
import { useAsync } from '../lib/useAsync';

/** Ticket page: preview, printer settings and print. Registration sends reception here with `state.issued` to allow auto-print. */
export default function TicketSlip() {
  const { ticketId } = useParams();
  const location = useLocation();
  const nav = useNavigate();
  const { data, error, loading, reload } = useAsync(() => api.get<SlipData>(`/tickets/${ticketId}/slip`), [ticketId]);
  const [settings, update, reset] = usePrintSettings();
  const [showSettings, setShowSettings] = useState(false);
  const autoDone = useRef(false);
  const justIssued = (location.state as { issued?: boolean } | null)?.issued === true;

  useEffect(() => {
    if (!data || autoDone.current || !justIssued) return;
    autoDone.current = true;
    // Drop the flag so a refresh or "back" does not print the same ticket again.
    nav(location.pathname, { replace: true, state: null });
    // Not cleared on cleanup: clearing the route state above re-runs this effect and must not cancel the print.
    if (settings.autoPrint) window.setTimeout(() => window.print(), 300);
  }, [data, justIssued, settings.autoPrint, nav, location.pathname]);

  if (loading) return <Spinner />;
  if (error || !data) return <ErrorBox message={error ?? 'Ticket not found'} onRetry={() => void reload()} />;
  return (
    <div className="mx-auto max-w-xl">
      <PrintableSlip slip={data} settings={settings} />
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <button className="btn-primary" onClick={() => window.print()}>Print ticket{settings.copies > 1 ? ` (${settings.copies} copies)` : ''}</button>
        <button className="btn-secondary" aria-expanded={showSettings} onClick={() => setShowSettings((v) => !v)}>Printer settings</button>
        <Link className="btn-secondary" to="/">Done</Link>
      </div>
      {showSettings && <div className="mt-4"><PrinterSettings settings={settings} onChange={update} onReset={reset} /></div>}
    </div>
  );
}
