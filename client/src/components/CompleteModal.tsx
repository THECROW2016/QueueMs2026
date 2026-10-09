import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import type { Department, RoutingRule, Ticket } from '../lib/types';
import { humanize } from '../lib/format';
import { Modal, useToast } from './ui';

interface Step { departmentId: number; serviceType: string; notes: string; reason: string; emergency: boolean; priority: number }

/** Finish a ticket and, optionally, send the patient on to one or more departments the routing rules allow. */
export function CompleteModal({ ticket, rules, departments, canPrioritise, canEmergency, onClose, onDone }: {
  ticket: Ticket; rules: RoutingRule[]; departments: Department[]; canPrioritise: boolean; canEmergency: boolean; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const options = rules.filter((r) => r.isActive && r.fromDepartmentId === ticket.department.id && (!r.emergencyOnly || canEmergency));
  const [steps, setSteps] = useState<Record<number, Step>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toggle = (r: RoutingRule) => setSteps((s) => {
    const n = { ...s };
    if (n[r.toDepartmentId]) delete n[r.toDepartmentId];
    else n[r.toDepartmentId] = { departmentId: r.toDepartmentId, serviceType: '', notes: '', reason: '', emergency: false, priority: 0 };
    return n;
  });
  const patch = (id: number, p: Partial<Step>) => setSteps((s) => ({ ...s, [id]: { ...s[id]!, ...p } }));

  async function submit() {
    setError('');
    const chosen = Object.values(steps);
    for (const st of chosen) {
      const rule = options.find((r) => r.toDepartmentId === st.departmentId)!;
      if (rule.requiresReason && st.reason.trim().length < 3) { setError(`A reason is required to send the patient to ${rule.to.name}.`); return; }
      if (st.priority === 1 && st.reason.trim().length < 3) { setError(`Give a reason for marking the ${rule.to.name} ticket urgent.`); return; }
      if (rule.emergencyOnly && !st.emergency) { setError(`${rule.to.name} is reserved for emergency routing — tick the emergency box.`); return; }
    }
    setBusy(true);
    try {
      await api.post(`/tickets/${ticket.id}/complete`, {
        next: chosen.map((st) => ({
          departmentId: st.departmentId, serviceType: st.serviceType || undefined, notes: st.notes || undefined,
          reason: st.reason || undefined, emergency: st.emergency || undefined, priority: st.priority || undefined,
        })),
      });
      toast('ok', chosen.length ? `${ticket.displayNumber} completed and routed` : `${ticket.displayNumber} completed`);
      onDone();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Modal title={`Complete ${ticket.displayNumber}`} onClose={onClose} wide>
      <p className="mb-3 text-sm text-slate-600">Choose where the patient goes next, or finish here if no further department is needed. You may select more than one.</p>
      {options.length === 0 && <p className="mb-3 rounded bg-slate-50 p-3 text-sm text-slate-600">No onward departments are configured for {ticket.department.name}. The ticket will simply be completed.</p>}
      <div className="space-y-3">
        {options.map((r) => {
          const st = steps[r.toDepartmentId];
          const dept = departments.find((d) => d.id === r.toDepartmentId);
          return (
            <div key={r.id} className={`rounded-lg border p-3 ${st ? 'border-brand-500 bg-brand-50/40' : 'border-slate-200'}`}>
              <label className="flex items-center gap-2 font-semibold">
                <input type="checkbox" checked={!!st} onChange={() => toggle(r)} /> {r.to.name}
                {r.requiresReason && <span className="text-xs font-normal text-slate-500">(reason required)</span>}
                {r.emergencyOnly && <span className="text-xs font-normal text-red-600">(emergency only)</span>}
              </label>
              {st && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {(dept?.serviceTypes.length ?? 0) > 0 && (
                    <label className="block"><span className="label">Service</span>
                      <select className="input" value={st.serviceType} onChange={(e) => patch(st.departmentId, { serviceType: e.target.value })}>
                        <option value="">Any / not specified</option>{dept!.serviceTypes.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
                      </select>
                    </label>
                  )}
                  {canPrioritise && (
                    <label className="block"><span className="label">Priority</span>
                      <select className="input" value={st.priority} onChange={(e) => patch(st.departmentId, { priority: Number(e.target.value) })}>
                        <option value={0}>Routine</option><option value={1}>Urgent</option>{canEmergency && <option value={2}>Emergency</option>}
                      </select>
                    </label>
                  )}
                  <label className="block sm:col-span-2"><span className="label">Reason {r.requiresReason ? '(required)' : '(optional)'}</span>
                    <input className="input" value={st.reason} maxLength={255} onChange={(e) => patch(st.departmentId, { reason: e.target.value })} />
                  </label>
                  <label className="block sm:col-span-2"><span className="label">Note for {r.to.name}</span>
                    <textarea className="input" rows={2} value={st.notes} maxLength={2000} onChange={(e) => patch(st.departmentId, { notes: e.target.value })} />
                  </label>
                  {r.emergencyOnly && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={st.emergency} onChange={(e) => patch(st.departmentId, { emergency: e.target.checked })} /> This is an emergency</label>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {error && <p role="alert" className="error-text mt-3">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>Back</button>
        <button className="btn-primary" onClick={() => void submit()} disabled={busy}>{busy ? 'Working…' : Object.keys(steps).length ? 'Complete and route' : 'Complete'}</button>
      </div>
    </Modal>
  );
}
