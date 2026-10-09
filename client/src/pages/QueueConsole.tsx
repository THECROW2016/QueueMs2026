import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { CompleteModal } from '../components/CompleteModal';
import { ReasonModal } from '../components/ReasonModal';
import { RegisterVisit } from '../components/RegisterVisit';
import { Empty, ErrorBox, Modal, PageHeader, PriorityBadge, Spinner, StatusBadge, useToast } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { duration, humanize, timeOnly } from '../lib/format';
import { useLiveUpdates } from '../lib/socket';
import type { Counter, Department, DepartmentQueue, RoutingRule, Ticket } from '../lib/types';
import { useAsync } from '../lib/useAsync';

type Dialog =
  | { kind: 'reason'; ticket: Ticket; action: 'skip' | 'cancel' | 'absent' | 'hold' | 'priority-urgent' | 'transfer-reason'; }
  | { kind: 'complete'; ticket: Ticket }
  | { kind: 'transfer'; ticket: Ticket }
  | { kind: 'priority'; ticket: Ticket }
  | { kind: 'register' }
  | null;

export default function QueueConsole() {
  const { departmentId } = useParams();
  const deptId = Number(departmentId);
  const { can } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<number | 'call' | null>(null);

  const queue = useAsync(() => api.get<DepartmentQueue>(`/departments/${deptId}/queue`), [deptId]);
  const counters = useAsync(() => api.get<Counter[]>('/counters', { departmentId: deptId }), [deptId]);
  const rules = useAsync(() => api.get<RoutingRule[]>('/routing-rules'), []);
  const departments = useAsync(() => api.get<Department[]>('/departments'), []);
  const { connected } = useLiveUpdates([deptId], () => void queue.reload());

  const storeKey = `hqms.counter.${deptId}`;
  const [counterId, setCounterId] = useState<number | ''>('');
  useEffect(() => {
    const list = counters.data ?? [];
    let saved: number | null = null;
    try { saved = Number(localStorage.getItem(storeKey)) || null; } catch { /* storage unavailable */ }
    setCounterId(list.find((c) => c.id === saved)?.id ?? (list.length === 1 ? list[0]!.id : ''));
  }, [counters.data, storeKey]);
  const pickCounter = (id: number | '') => { setCounterId(id); try { localStorage.setItem(storeKey, String(id)); } catch { /* ignore */ } };

  const data = queue.data;
  const dept = departments.data?.find((d) => d.id === deptId);
  const clinical = !!dept?.isClinical;

  const act = useCallback(async (ticket: Ticket, path: string, body: unknown = {}, ok?: string) => {
    setBusy(ticket.id);
    try { await api.post(`/tickets/${ticket.id}/${path}`, body); if (ok) toast('ok', ok); await queue.reload(); }
    catch (e) { toast('error', errorMessage(e)); await queue.reload(); }
    finally { setBusy(null); }
  }, [queue, toast]);

  async function callNext() {
    if (counterId === '') { toast('error', 'Choose your counter or room first.'); return; }
    setBusy('call');
    try {
      const r = await api.post<{ ticket: Ticket | null }>(`/departments/${deptId}/call-next`, { counterId });
      toast(r.ticket ? 'ok' : 'ok', r.ticket ? `Called ${r.ticket.displayNumber}` : 'No patients are waiting.');
      await queue.reload();
    } catch (e) { toast('error', errorMessage(e)); await queue.reload(); } finally { setBusy(null); }
  }

  const myBusy = useMemo(() => (data?.active ?? []).some((t) => t.counter?.id === counterId && (t.status === 'CALLED' || t.status === 'IN_SERVICE')), [data, counterId]);

  if (queue.loading && !data) return <Spinner />;
  if (queue.error && !data) return <ErrorBox message={queue.error} onRetry={() => void queue.reload()} />;
  if (!data) return null;

  const reasonConfig = dialog?.kind === 'reason' ? {
    skip: { title: `Skip ${dialog.ticket.displayNumber}`, label: 'Skip ticket', path: 'skip', danger: false, intro: 'The patient will leave the queue. The reason is recorded.' },
    cancel: { title: `Cancel ${dialog.ticket.displayNumber}`, label: 'Cancel ticket', path: 'cancel', danger: true, intro: 'This cannot be undone.' },
    absent: { title: `Mark ${dialog.ticket.displayNumber} absent`, label: 'Mark absent', path: 'absent', danger: false, intro: 'The patient did not respond to the call. They can be restored for a limited time.' },
    hold: { title: `Put ${dialog.ticket.displayNumber} on hold`, label: 'Put on hold', path: 'hold', danger: false, intro: undefined },
    'priority-urgent': { title: '', label: '', path: '', danger: false, intro: undefined },
    'transfer-reason': { title: '', label: '', path: '', danger: false, intro: undefined },
  }[dialog.action] : null;

  return (
    <div>
      <PageHeader
        title={data.department.name}
        subtitle={`${data.counts.waiting} waiting · ${data.counts.called + data.counts.inService} with staff · average wait today ${duration(data.averageWaitSeconds)}`}
        actions={
          <>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${connected ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`} title={connected ? 'Live updates are on' : 'Live updates are down; refreshing every 15 seconds'}>
              {connected ? '● Live' : '○ Refreshing'}
            </span>
            {can('visit.create') && data.department.code === 'RECEPTION' && <button className="btn-primary" onClick={() => setDialog({ kind: 'register' })}>+ Register patient</button>}
          </>
        }
      />

      {can('queue.call') && (
        <section className="card mb-5 flex flex-wrap items-end gap-3 p-4" aria-label="Call the next patient">
          <label className="block min-w-[12rem]">
            <span className="label">{dept?.isClinical ? 'My room' : 'My counter'}</span>
            <select className="input" value={counterId} onChange={(e) => pickCounter(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Select…</option>
              {(counters.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <button className="btn-primary px-5 py-2.5 text-base" onClick={() => void callNext()} disabled={busy === 'call' || data.counts.waiting === 0 || myBusy}>
            {busy === 'call' ? 'Calling…' : 'Call next patient'}
          </button>
          <div className="text-sm text-slate-500">
            {data.nextEligible ? <>Next in line: <strong className="text-slate-800">{data.nextEligible.displayNumber}</strong></> : 'Nobody is waiting.'}
            {myBusy && <span className="ml-2 text-amber-700">Finish your current patient first.</span>}
          </div>
        </section>
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <section aria-label="Patients with staff">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Now with staff</h2>
            {data.active.length === 0 ? <div className="card"><Empty>No patient has been called.</Empty></div> : (
              <div className="grid gap-3 md:grid-cols-2">
                {data.active.map((t) => (
                  <article key={t.id} className="card p-4" data-testid={`active-${t.displayNumber}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-2xl font-extrabold tracking-tight">{t.displayNumber}</div>
                        <div className="text-sm text-slate-600">{t.patient ? `${t.patient.fullName} · ${t.patient.mrn}` : t.visitNumber}</div>
                        <div className="text-xs text-slate-500">{t.counter?.name ?? '—'} · {t.status === 'IN_SERVICE' ? `in service ${duration(t.serviceSeconds)}` : `called ${timeOnly(t.lastCalledAt)}`}{t.serviceType ? ` · ${humanize(t.serviceType)}` : ''}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1"><StatusBadge status={t.status} /><PriorityBadge priority={t.priority} /></div>
                    </div>
                    {t.referral && <p className="mt-2 rounded bg-indigo-50 px-2 py-1 text-xs text-indigo-900">From {t.referral.fromDepartment}{t.referral.notes ? `: ${t.referral.notes}` : ''}</p>}
                    {(data.department.workflowStages.length > 0 && t.status === 'IN_SERVICE' && can('queue.serve')) && (
                      <label className="mt-3 block"><span className="label">Progress</span>
                        <select className="input" value={t.workflowStage ?? ''} onChange={(e) => e.target.value && void act(t, 'workflow', { stage: e.target.value })}>
                          <option value="">Not set</option>{data.department.workflowStages.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
                        </select>
                      </label>
                    )}
                    {can('results.status.update') && t.status !== 'CALLED' && (
                      <label className="mt-3 block"><span className="label">Result / report</span>
                        <select className="input" value={t.resultStatus} onChange={(e) => void act(t, 'result-status', { status: e.target.value }, 'Result status updated')} disabled={t.resultStatus === 'NOT_APPLICABLE' && false}>
                          <option value="NOT_APPLICABLE" disabled>Not set</option><option value="PENDING">Pending</option><option value="AVAILABLE">Available</option>
                        </select>
                      </label>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {t.status === 'CALLED' && <>
                        {can('queue.serve') && <button className="btn-primary btn-sm" disabled={busy === t.id} onClick={() => void act(t, 'start')}>Start service</button>}
                        {can('queue.call') && <button className="btn-secondary btn-sm" disabled={busy === t.id} onClick={() => void act(t, 'recall', {}, `Recalled ${t.displayNumber}`)}>Recall{t.callCount > 1 ? ` (${t.callCount})` : ''}</button>}
                        {can('queue.absent') && <button className="btn-secondary btn-sm" onClick={() => setDialog({ kind: 'reason', ticket: t, action: 'absent' })}>Absent</button>}
                      </>}
                      {t.status === 'IN_SERVICE' && <>
                        {can('queue.complete') && <button className="btn-primary btn-sm" onClick={() => setDialog({ kind: 'complete', ticket: t })}>Complete…</button>}
                        {can('queue.serve') && <button className="btn-secondary btn-sm" onClick={() => setDialog({ kind: 'reason', ticket: t, action: 'hold' })}>Hold</button>}
                        {can('queue.transfer') && <button className="btn-secondary btn-sm" onClick={() => setDialog({ kind: 'transfer', ticket: t })}>Transfer…</button>}
                      </>}
                      {t.status === 'ON_HOLD' && <>
                        {can('queue.serve') && <button className="btn-primary btn-sm" disabled={busy === t.id} onClick={() => void act(t, 'resume')}>Resume</button>}
                        {can('queue.complete') && <button className="btn-secondary btn-sm" onClick={() => setDialog({ kind: 'complete', ticket: t })}>Complete…</button>}
                      </>}
                      {can('queue.priority') && t.status !== 'ON_HOLD' && <button className="btn-secondary btn-sm" onClick={() => setDialog({ kind: 'priority', ticket: t })}>Priority</button>}
                      {t.status === 'CALLED' && can('queue.skip') && <button className="btn-secondary btn-sm" onClick={() => setDialog({ kind: 'reason', ticket: t, action: 'skip' })}>Skip</button>}
                      {can('queue.cancel') && <button className="btn-secondary btn-sm text-red-700" onClick={() => setDialog({ kind: 'reason', ticket: t, action: 'cancel' })}>Cancel</button>}
                      <Link className="btn-secondary btn-sm" to={`/visits/${t.visitId}`}>Visit</Link>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section aria-label="Waiting patients" className="card overflow-hidden">
            <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Waiting ({data.counts.waiting})</h2>
            {data.waiting.length === 0 ? <Empty>Nobody is waiting.</Empty> : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50"><tr><th className="th">#</th><th className="th">Ticket</th><th className="th">Patient</th><th className="th">Service</th><th className="th">Waiting</th><th className="th" /></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.waiting.map((t) => (
                      <tr key={t.id} className={t.priority >= 2 ? 'bg-red-50' : t.priority === 1 ? 'bg-orange-50' : ''}>
                        <td className="td text-slate-500">{t.position}</td>
                        <td className="td font-bold">{t.displayNumber} <PriorityBadge priority={t.priority} /></td>
                        <td className="td">{t.patient ? <>{t.patient.fullName}<span className="block text-xs text-slate-500">{t.patient.mrn}</span></> : <span className="text-slate-400">{t.visitNumber}</span>}</td>
                        <td className="td text-slate-600">{t.serviceType ? humanize(t.serviceType) : '—'}{t.priorityReason ? <span className="block text-xs text-slate-500">{t.priorityReason}</span> : null}</td>
                        <td className="td whitespace-nowrap">{duration(t.waitingSeconds)}</td>
                        <td className="td whitespace-nowrap text-right">
                          {data.department.code === 'RECEPTION' && can('visit.create') && <button className="btn-secondary btn-sm mr-1" onClick={() => nav(`/tickets/${t.id}/slip`)}>Slip</button>}
                          {can('queue.priority') && <button className="btn-secondary btn-sm mr-1" onClick={() => setDialog({ kind: 'priority', ticket: t })}>Priority</button>}
                          {can('queue.skip') && <button className="btn-secondary btn-sm mr-1" onClick={() => setDialog({ kind: 'reason', ticket: t, action: 'skip' })}>Skip</button>}
                          {can('queue.cancel') && <button className="btn-secondary btn-sm text-red-700" onClick={() => setDialog({ kind: 'reason', ticket: t, action: 'cancel' })}>Cancel</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="space-y-5">
          <section aria-label="Absent patients" className="card">
            <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Absent ({data.absent.length})</h2>
            {data.absent.length === 0 ? <Empty>No absent patients.</Empty> : (
              <ul className="divide-y divide-slate-100">
                {data.absent.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                    <span><strong>{t.displayNumber}</strong> <span className="text-slate-500">{t.patient?.fullName ?? ''}</span></span>
                    <span className="flex gap-1">
                      {can('queue.absent') && <button className="btn-secondary btn-sm" disabled={busy === t.id} onClick={() => void act(t, 'restore', {}, `${t.displayNumber} is back in the queue`)}>Restore</button>}
                      {can('queue.cancel') && <button className="btn-secondary btn-sm text-red-700" onClick={() => setDialog({ kind: 'reason', ticket: t, action: 'cancel' })}>Cancel</button>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-label="Recently completed" className="card">
            <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Recently completed</h2>
            {data.recentlyCompleted.length === 0 ? <Empty>Nothing completed yet today.</Empty> : (
              <ul className="divide-y divide-slate-100">
                {data.recentlyCompleted.map((t) => (
                  <li key={t.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span><strong>{t.displayNumber}</strong> <span className="text-slate-500">{t.patient?.fullName ?? ''}</span></span>
                    <span className="flex items-center gap-2 text-xs text-slate-500">{timeOnly(t.completedAt)} <StatusBadge status={t.status} /></span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {dialog?.kind === 'register' && (
        <RegisterVisit onClose={() => setDialog(null)} onDone={(r) => { setDialog(null); void queue.reload(); nav(`/tickets/${r.ticketId}/slip`); }} />
      )}
      {dialog?.kind === 'reason' && reasonConfig && reasonConfig.title && (
        <ReasonModal
          title={reasonConfig.title} confirmLabel={reasonConfig.label} danger={reasonConfig.danger} intro={reasonConfig.intro} onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await api.post(`/tickets/${dialog.ticket.id}/${reasonConfig.path}`, { reason });
            toast('ok', `${dialog.ticket.displayNumber}: ${reasonConfig.label.toLowerCase()} done`);
            await queue.reload();
          }}
        />
      )}
      {dialog?.kind === 'complete' && (
        <CompleteModal
          ticket={dialog.ticket} rules={rules.data ?? []} departments={departments.data ?? []} canPrioritise={can('queue.priority')} canEmergency={can('queue.emergency')}
          onClose={() => setDialog(null)} onDone={() => { setDialog(null); void queue.reload(); }}
        />
      )}
      {dialog?.kind === 'transfer' && (
        <TransferModal ticket={dialog.ticket} rules={rules.data ?? []} onClose={() => setDialog(null)} onDone={() => { setDialog(null); void queue.reload(); }} />
      )}
      {dialog?.kind === 'priority' && (
        <PriorityModal ticket={dialog.ticket} canEmergency={can('queue.emergency')} onClose={() => setDialog(null)} onDone={() => { setDialog(null); void queue.reload(); }} />
      )}
    </div>
  );
}

function TransferModal({ ticket, rules, onClose, onDone }: { ticket: Ticket; rules: RoutingRule[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const options = rules.filter((r) => r.isActive && !r.emergencyOnly && r.fromDepartmentId === ticket.department.id);
  const [to, setTo] = useState<number | ''>('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`Transfer ${ticket.displayNumber}`} onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">Moves the patient to another department. This ticket will be closed there and a new one issued.</p>
      <label className="block"><span className="label">Department</span>
        <select className="input" value={to} onChange={(e) => setTo(e.target.value ? Number(e.target.value) : '')}>
          <option value="">Select…</option>{options.map((r) => <option key={r.id} value={r.toDepartmentId}>{r.to.name}</option>)}
        </select>
      </label>
      <label className="mt-3 block"><span className="label">Reason</span><input className="input" value={reason} maxLength={255} onChange={(e) => setReason(e.target.value)} /></label>
      {err && <p role="alert" className="error-text">{err}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>Back</button>
        <button className="btn-primary" disabled={busy} onClick={async () => {
          if (to === '') return setErr('Choose a department.');
          if (reason.trim().length < 3) return setErr('Please give a reason.');
          setBusy(true);
          try { await api.post(`/tickets/${ticket.id}/transfer`, { departmentId: to, reason }); toast('ok', 'Patient transferred'); onDone(); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
        }}>Transfer</button>
      </div>
    </Modal>
  );
}

function PriorityModal({ ticket, canEmergency, onClose, onDone }: { ticket: Ticket; canEmergency: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [priority, setPriority] = useState(ticket.priority);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`Priority for ${ticket.displayNumber}`} onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">Only clinical staff change priority. Every change is recorded with your name and reason.</p>
      <label className="block"><span className="label">Priority</span>
        <select className="input" value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
          <option value={0}>Routine</option><option value={1}>Urgent</option>{canEmergency && <option value={2}>Emergency</option>}
        </select>
      </label>
      <label className="mt-3 block"><span className="label">Reason</span><input className="input" value={reason} maxLength={255} onChange={(e) => setReason(e.target.value)} /></label>
      {err && <p role="alert" className="error-text">{err}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>Back</button>
        <button className="btn-primary" disabled={busy} onClick={async () => {
          if (priority === ticket.priority) return setErr('Choose a different priority.');
          if (reason.trim().length < 3) return setErr('Please give a reason.');
          setBusy(true);
          try { await api.post(`/tickets/${ticket.id}/priority`, { priority, reason }); toast('ok', 'Priority updated'); onDone(); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
        }}>Save</button>
      </div>
    </Modal>
  );
}
