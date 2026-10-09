import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { humanize } from '../lib/format';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <div role="status" className="p-6 text-sm text-slate-500">{label}</div>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <span>{message}</span>
      {onRetry && <button className="btn-secondary btn-sm" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-8 text-center text-sm text-slate-500">{children}</div>;
}

const TONES: Record<string, string> = {
  WAITING: 'bg-amber-100 text-amber-800', CALLED: 'bg-sky-100 text-sky-800', IN_SERVICE: 'bg-emerald-100 text-emerald-800',
  ON_HOLD: 'bg-orange-100 text-orange-800', ABSENT: 'bg-slate-200 text-slate-700', COMPLETED: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  REFERRED: 'bg-indigo-100 text-indigo-800', SKIPPED: 'bg-slate-100 text-slate-600', CANCELLED: 'bg-red-100 text-red-700',
  NOT_STARTED: 'bg-slate-100 text-slate-500', NOT_REQUIRED: 'bg-slate-50 text-slate-400 ring-1 ring-slate-200',
  ACTIVE: 'bg-sky-100 text-sky-800', PAID: 'bg-emerald-100 text-emerald-800', PARTIALLY_PAID: 'bg-amber-100 text-amber-800',
  UNPAID: 'bg-red-100 text-red-700', VOID: 'bg-slate-200 text-slate-600', PENDING: 'bg-amber-100 text-amber-800', AVAILABLE: 'bg-emerald-100 text-emerald-800',
};
export function StatusBadge({ status }: { status: string }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${TONES[status] ?? 'bg-slate-100 text-slate-700'}`}>{humanize(status)}</span>;
}

export function PriorityBadge({ priority }: { priority: number }) {
  if (priority <= 0) return null;
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase ${priority >= 2 ? 'bg-red-600 text-white' : 'bg-orange-500 text-white'}`}>{priority >= 2 ? 'Emergency' : 'Urgent'}</span>;
}

export function Field({ label, error, children, hint }: { label: string; error?: string; children: ReactNode; hint?: string }) {
  // The input sits inside the <label>, so the label is associated with it without ids.
  return (
    <div>
      <label className="block">
        <span className="label">{label}</span>
        {children}
      </label>
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p role="alert" className="error-text">{error}</p>}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus(); };
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`card my-8 w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} p-5`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button className="rounded p-1 text-slate-500 hover:bg-slate-100" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/* --------------------------------- Toasts -------------------------------- */

interface Toast { id: number; kind: 'ok' | 'error'; text: string }
const ToastCtx = createContext<(kind: Toast['kind'], text: string) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setItems((l) => [...l.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} className={`pointer-events-auto rounded-lg px-4 py-3 text-sm shadow-lg ${t.kind === 'error' ? 'bg-red-600 text-white' : 'bg-slate-900 text-white'}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2 text-sm text-slate-600">
      <span>{total} result{total === 1 ? '' : 's'}</span>
      <div className="flex items-center gap-2">
        <button className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <span>Page {page} of {pages}</span>
        <button className="btn-secondary btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}
