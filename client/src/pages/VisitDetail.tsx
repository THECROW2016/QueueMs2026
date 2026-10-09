import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '../auth';
import { ReasonModal } from '../components/ReasonModal';
import { Empty, ErrorBox, Field, Modal, PageHeader, PriorityBadge, Spinner, StatusBadge, useToast } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { dateTime, duration, humanize, money, timeOnly } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import type { Patient } from '../lib/types';

interface Visit {
  id: number; visitNumber: string; status: string; isEmergency: boolean; openedAt: string; closedAt: string | null; billingCleared: boolean;
  reasonForVisit: string | null; closureReason: string | null; patient: Patient | null;
  referrals: Array<{ id: number; from: string; to: string; serviceType: string | null; status: string; notes?: string | null; createdAt: string }>;
}
interface Journey {
  view: 'full' | 'summary';
  stages: Array<{ department: { id: number; code: string; name: string }; status: string; tickets: Array<{ id: number; displayNumber: string; status: string; serviceType: string | null; priority: number; waitSeconds: number | null; serviceSeconds: number | null; enteredAt: string; calledBy?: string | null; servedBy?: string | null; workflowStage?: string | null; resultStatus?: string; statusReason?: string | null; counter?: string | null }> }>;
  timeline?: Array<{ id: number; at: string; type: string; department: string | null; ticket: string | null; from: string | null; to: string | null; reason: string | null; by: string | null }>;
}
interface Invoice { id: number; invoiceNumber: string; description: string | null; currency: string; status: string; totalMinor: number; paidMinor: number; balanceMinor: number; payments: Array<{ id: number; amountMinor: number; method: string; reference: string | null; receiptNumber: string; createdAt: string }> }
interface Invoices { invoices: Invoice[]; totals: { totalMinor: number; paidMinor: number; balanceMinor: number } }

const invoiceSchema = z.object({ description: z.string().trim().max(255).optional(), amount: z.coerce.number({ invalid_type_error: 'Enter an amount' }).positive('Amount must be more than zero').max(10_000_000) });
const paymentSchema = z.object({
  amount: z.coerce.number({ invalid_type_error: 'Enter an amount' }).positive('Amount must be more than zero'),
  method: z.enum(['CASH', 'MPESA', 'CARD', 'BANK', 'INSURANCE']), reference: z.string().trim().max(80).optional(),
  confirmed: z.literal(true, { errorMap: () => ({ message: 'Confirm that the money has been received' }) }),
}).refine((v) => v.method === 'CASH' || (v.reference ?? '').length >= 3, { path: ['reference'], message: 'A reference is required for non-cash payments' });

export default function VisitDetail() {
  const { visitId } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const visit = useAsync(() => api.get<Visit>(`/visits/${visitId}`), [visitId]);
  const journey = useAsync(() => api.get<Journey>(`/visits/${visitId}/journey`).catch(() => null), [visitId]);
  const invoices = useAsync(() => (can('billing.view') ? api.get<Invoices>(`/visits/${visitId}/invoices`).catch(() => null) : Promise.resolve(null)), [visitId]);
  const [dialog, setDialog] = useState<null | 'cancel' | 'close' | 'invoice' | { pay: Invoice } | { receipt: number }>(null);

  const reloadAll = () => { void visit.reload(); void journey.reload(); void invoices.reload(); };
  if (visit.loading && !visit.data) return <Spinner />;
  if (visit.error && !visit.data) return <ErrorBox message={visit.error} onRetry={() => void visit.reload()} />;
  const v = visit.data!;
  const active = v.status === 'ACTIVE';

  return (
    <div>
      <PageHeader
        title={`Visit ${v.visitNumber}`}
        subtitle={`Opened ${dateTime(v.openedAt)}${v.closedAt ? ` · closed ${dateTime(v.closedAt)}` : ''}`}
        actions={<>
          <StatusBadge status={v.status} />{v.isEmergency && <span className="rounded bg-red-600 px-2 py-0.5 text-xs font-bold text-white">EMERGENCY</span>}
          {active && can('visit.cancel') && <button className="btn-secondary text-red-700" onClick={() => setDialog('cancel')}>Cancel visit</button>}
          {active && can('visit.close') && <button className="btn-primary" onClick={() => setDialog('close')}>Close visit</button>}
        </>}
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <section className="card p-4" aria-label="Patient journey">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Patient journey {journey.data?.view === 'summary' && <span className="ml-2 normal-case text-slate-400">(summary view)</span>}</h2>
            {journey.loading && !journey.data ? <Spinner /> : !journey.data ? <Empty>You do not have access to the journey for this visit.</Empty> : (
              <ol className="space-y-3">
                {journey.data.stages.map((s) => (
                  <li key={s.department.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center justify-between"><span className="font-semibold">{s.department.name}</span><StatusBadge status={s.status} /></div>
                    {s.tickets.length > 0 && (
                      <ul className="mt-2 space-y-1 text-sm text-slate-600">
                        {s.tickets.map((t) => (
                          <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                            <strong className="text-slate-900">{t.displayNumber}</strong> <StatusBadge status={t.status} /> <PriorityBadge priority={t.priority} />
                            {t.serviceType && <span>{humanize(t.serviceType)}</span>}
                            <span>waited {duration(t.waitSeconds)}</span>{t.serviceSeconds !== null && <span>served {duration(t.serviceSeconds)}</span>}
                            {t.workflowStage && <span>· {humanize(t.workflowStage)}</span>}
                            {t.resultStatus && t.resultStatus !== 'NOT_APPLICABLE' && <span>· result {humanize(t.resultStatus)}</span>}
                            {t.servedBy && <span className="text-slate-400">by {t.servedBy}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>

          {journey.data?.timeline && (
            <section className="card p-4" aria-label="Timeline">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Timeline</h2>
              <ul className="space-y-2 border-l-2 border-slate-200 pl-4 text-sm">
                {journey.data.timeline.map((e) => (
                  <li key={e.id}>
                    <span className="text-xs text-slate-500">{timeOnly(e.at)}</span>{' '}
                    <strong>{humanize(e.type)}</strong>{e.ticket ? ` ${e.ticket}` : ''}{e.department ? ` · ${e.department}` : ''}
                    {e.from && e.to && e.from !== e.to ? <span className="text-slate-500"> ({humanize(e.from)} → {humanize(e.to)})</span> : null}
                    {e.reason ? <span className="text-slate-600"> — {e.reason}</span> : null}{e.by ? <span className="text-slate-400"> · {e.by}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="space-y-5">
          <section className="card p-4" aria-label="Patient">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Patient</h2>
            {v.patient ? (
              <dl className="space-y-1 text-sm">
                <div><dt className="inline text-slate-500">Name: </dt><dd className="inline font-semibold">{v.patient.fullName}</dd></div>
                <div><dt className="inline text-slate-500">MRN: </dt><dd className="inline">{v.patient.mrn}</dd></div>
                <div><dt className="inline text-slate-500">Age / sex: </dt><dd className="inline">{v.patient.age ?? '—'} · {humanize(v.patient.sex)}</dd></div>
                {v.reasonForVisit && <div><dt className="inline text-slate-500">Reason: </dt><dd className="inline">{v.reasonForVisit}</dd></div>}
              </dl>
            ) : <p className="text-sm text-slate-500">Patient details are not available to your role.</p>}
            {v.closureReason && <p className="mt-2 text-sm text-slate-600">Closure note: {v.closureReason}</p>}
          </section>

          {v.referrals.length > 0 && (
            <section className="card p-4" aria-label="Referrals">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Referrals</h2>
              <ul className="space-y-2 text-sm">
                {v.referrals.map((r) => <li key={r.id}><strong>{r.from} → {r.to}</strong> <StatusBadge status={r.status} />{r.serviceType ? ` · ${humanize(r.serviceType)}` : ''}{r.notes ? <p className="text-slate-600">{r.notes}</p> : null}</li>)}
              </ul>
            </section>
          )}

          {invoices.data && (
            <section className="card p-4" aria-label="Billing">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Billing</h2>
                {active && can('billing.manage') && <button className="btn-secondary btn-sm" onClick={() => setDialog('invoice')}>+ Invoice</button>}
              </div>
              {invoices.data.invoices.length === 0 ? <p className="text-sm text-slate-500">No invoices.</p> : (
                <ul className="space-y-3">
                  {invoices.data.invoices.map((i) => (
                    <li key={i.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex items-center justify-between"><strong>{i.invoiceNumber}</strong><StatusBadge status={i.status} /></div>
                      {i.description && <p className="text-slate-600">{i.description}</p>}
                      <p className="mt-1">Total {money(i.totalMinor, i.currency)} · Paid {money(i.paidMinor, i.currency)} · <strong>Balance {money(i.balanceMinor, i.currency)}</strong></p>
                      {i.payments.map((p) => <p key={p.id} className="text-xs text-slate-500">{p.receiptNumber} · {money(p.amountMinor, i.currency)} {humanize(p.method)} · <button className="underline" onClick={() => setDialog({ receipt: p.id })}>receipt</button></p>)}
                      {can('billing.manage') && i.status !== 'VOID' && i.status !== 'PAID' && (
                        <div className="mt-2 flex gap-2">
                          <button className="btn-primary btn-sm" onClick={() => setDialog({ pay: i })}>Record payment</button>
                          {i.paidMinor === 0 && <VoidButton invoice={i} onDone={reloadAll} />}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-sm">Outstanding: <strong>{money(invoices.data.totals.balanceMinor)}</strong> · Billing {v.billingCleared ? <span className="font-semibold text-emerald-700">cleared</span> : <span className="font-semibold text-amber-700">not cleared</span>}</p>
              {active && can('billing.manage') && !v.billingCleared && <ClearBilling visitId={v.id} hasInvoices={invoices.data.invoices.some((i) => i.status !== 'VOID')} onDone={reloadAll} />}
            </section>
          )}
          <Link className="btn-secondary w-full" to="/visits">← All visits</Link>
        </div>
      </div>

      {dialog === 'cancel' && <ReasonModal title="Cancel this visit" confirmLabel="Cancel visit" danger intro="All open tickets for this visit will be cancelled." onClose={() => setDialog(null)} onConfirm={async (reason) => { await api.post(`/visits/${v.id}/cancel`, { reason }); toast('ok', 'Visit cancelled'); reloadAll(); }} />}
      {dialog === 'close' && <ReasonModal title="Close this visit" confirmLabel="Close visit" intro="Closing requires every ticket to be finished and billing to be cleared." onClose={() => setDialog(null)} onConfirm={async (reason) => { await api.post(`/visits/${v.id}/close`, { reason }); toast('ok', 'Visit closed'); reloadAll(); }} />}
      {dialog === 'invoice' && <InvoiceModal visitId={v.id} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reloadAll(); }} />}
      {typeof dialog === 'object' && dialog && 'pay' in dialog && <PaymentModal invoice={dialog.pay} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reloadAll(); }} />}
      {typeof dialog === 'object' && dialog && 'receipt' in dialog && <ReceiptModal paymentId={dialog.receipt} onClose={() => setDialog(null)} />}
    </div>
  );
}

function VoidButton({ invoice, onDone }: { invoice: Invoice; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  return (
    <>
      <button className="btn-secondary btn-sm text-red-700" onClick={() => setOpen(true)}>Void</button>
      {open && <ReasonModal title={`Void ${invoice.invoiceNumber}`} confirmLabel="Void invoice" danger onClose={() => setOpen(false)} onConfirm={async (reason) => { await api.post(`/invoices/${invoice.id}/void`, { reason }); toast('ok', 'Invoice voided'); onDone(); }} />}
    </>
  );
}

function ClearBilling({ visitId, hasInvoices, onDone }: { visitId: number; hasInvoices: boolean; onDone: () => void }) {
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  async function clear(reason?: string) { await api.post(`/visits/${visitId}/clear-billing`, { reason }); toast('ok', 'Billing cleared'); onDone(); }
  return (
    <>
      <button className="btn-primary btn-sm mt-2" onClick={async () => { if (hasInvoices) { try { await clear(); } catch (e) { toast('error', errorMessage(e)); } } else setAsking(true); }}>Mark billing cleared</button>
      {asking && <ReasonModal title="Clear billing without charges" confirmLabel="Clear billing" intro="There are no invoices on this visit. Record why no charge applies (for example: “No charges”)." onClose={() => setAsking(false)} onConfirm={(r) => clear(r)} />}
    </>
  );
}

function InvoiceModal({ visitId, onClose, onDone }: { visitId: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof invoiceSchema>>({ resolver: zodResolver(invoiceSchema) });
  return (
    <Modal title="New invoice" onClose={onClose}>
      <form className="space-y-4" onSubmit={handleSubmit(async (v) => {
        try { await api.post(`/visits/${visitId}/invoices`, { description: v.description || undefined, totalMinor: Math.round(v.amount * 100) }); toast('ok', 'Invoice created'); onDone(); } catch (e) { toast('error', errorMessage(e)); }
      })} noValidate>
        <Field label="Description" error={errors.description?.message}><input className="input" {...register('description')} /></Field>
        <Field label="Amount (KES)" error={errors.amount?.message}><input className="input" inputMode="decimal" {...register('amount')} /></Field>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={isSubmitting}>Create invoice</button></div>
      </form>
    </Modal>
  );
}

function PaymentModal({ invoice, onClose, onDone }: { invoice: Invoice; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [key] = useState(() => (crypto.randomUUID ? crypto.randomUUID() : `p-${Date.now()}-${Math.random()}`));
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<z.infer<typeof paymentSchema>>({ resolver: zodResolver(paymentSchema), defaultValues: { method: 'CASH', amount: invoice.balanceMinor / 100 } });
  const method = watch('method');
  return (
    <Modal title={`Payment for ${invoice.invoiceNumber}`} onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">Outstanding balance: <strong>{money(invoice.balanceMinor, invoice.currency)}</strong>. Only record money that has actually been received.</p>
      <form className="space-y-4" noValidate onSubmit={handleSubmit(async (v) => {
        try { await api.post(`/invoices/${invoice.id}/payments`, { amountMinor: Math.round(v.amount * 100), method: v.method, reference: v.reference || undefined, confirmed: true, idempotencyKey: key }); toast('ok', 'Payment recorded'); onDone(); } catch (e) { toast('error', errorMessage(e)); }
      })}>
        <Field label="Amount" error={errors.amount?.message}><input className="input" inputMode="decimal" {...register('amount')} /></Field>
        <Field label="Method"><select className="input" {...register('method')}><option value="CASH">Cash</option><option value="MPESA">M-Pesa</option><option value="CARD">Card</option><option value="BANK">Bank transfer</option><option value="INSURANCE">Insurance</option></select></Field>
        {method !== 'CASH' && <Field label="Reference / transaction code" error={errors.reference?.message}><input className="input" {...register('reference')} /></Field>}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" {...register('confirmed')} /> I confirm this payment has been received.</label>
        {errors.confirmed && <p role="alert" className="error-text">{errors.confirmed.message}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={isSubmitting}>Record payment</button></div>
      </form>
    </Modal>
  );
}

function ReceiptModal({ paymentId, onClose }: { paymentId: number; onClose: () => void }) {
  const r = useAsync(() => api.get<{ hospitalName: string; receiptNumber: string; invoiceNumber: string; patientName: string; mrn: string; visitNumber: string; amountMinor: number; currency: string; method: string; reference: string | null; paidAt: string; balanceMinor: number }>(`/payments/${paymentId}/receipt`), [paymentId]);
  return (
    <Modal title="Receipt" onClose={onClose}>
      {!r.data ? <Spinner /> : (
        <div className="print-area text-sm">
          <p className="text-center text-base font-bold">{r.data.hospitalName}</p>
          <p className="text-center text-slate-500">Receipt {r.data.receiptNumber}</p>
          <dl className="mt-3 space-y-1">
            <div>Patient: <strong>{r.data.patientName}</strong> ({r.data.mrn})</div><div>Visit: {r.data.visitNumber} · Invoice: {r.data.invoiceNumber}</div>
            <div>Paid: <strong>{money(r.data.amountMinor, r.data.currency)}</strong> by {humanize(r.data.method)}{r.data.reference ? ` (${r.data.reference})` : ''}</div>
            <div>Date: {dateTime(r.data.paidAt)}</div><div>Balance after payment: {money(r.data.balanceMinor, r.data.currency)}</div>
          </dl>
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Close</button><button className="btn-primary" onClick={() => window.print()}>Print</button></div>
    </Modal>
  );
}
