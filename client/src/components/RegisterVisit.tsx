import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ApiError, api, errorMessage } from '../lib/api';
import type { Paged, Patient } from '../lib/types';
import { Field, Modal, useToast } from './ui';

const schema = z.object({
  fullName: z.string().trim().min(2, 'Enter the patient’s full name').max(190),
  // Optional so an unidentified emergency patient can still be registered; the duplicate check works better with it.
  dateOfBirth: z.string().refine((d) => d === '' || (/^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d) <= new Date()), 'Date of birth cannot be in the future'),
  sex: z.enum(['FEMALE', 'MALE', 'OTHER', 'UNKNOWN']),
  phone: z.string().trim().max(30).optional(),
  nationalId: z.string().trim().max(40).optional(),
  address: z.string().trim().max(255).optional(),
  reasonForVisit: z.string().trim().max(255).optional(),
});
type Form = z.infer<typeof schema>;
type Candidate = { id: number; mrn: string; fullName: string; dateOfBirth: string | null; sex: string; phone: string | null };

const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

/**
 * Registers a new patient (with duplicate warning) or opens a visit for an existing one, and issues the Reception ticket.
 * One idempotency key per open dialog makes a double click or a retry safe.
 */
export function RegisterVisit({ existing, onClose, onDone }: { existing?: Patient; onClose: () => void; onDone: (r: { ticketId: number; displayNumber: string; visitId: number }) => void }) {
  const toast = useToast();
  const [key] = useState(newKey);
  const [dups, setDups] = useState<Candidate[] | null>(null);
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<Patient[]>([]);
  const [chosen, setChosen] = useState<Patient | undefined>(existing);
  const { register, handleSubmit, formState: { errors, isSubmitting }, getValues } = useForm<Form>({
    resolver: zodResolver(schema), defaultValues: { sex: 'UNKNOWN', dateOfBirth: '' },
  });

  async function submit(values: Form | null, confirmDuplicate = false) {
    try {
      const body = chosen
        ? { patientId: chosen.id, idempotencyKey: key, reasonForVisit: values?.reasonForVisit || undefined }
        : { newPatient: { ...values!, dateOfBirth: values!.dateOfBirth || undefined, phone: values!.phone || undefined, nationalId: values!.nationalId || undefined, address: values!.address || undefined }, reasonForVisit: values!.reasonForVisit || undefined, confirmDuplicate, idempotencyKey: key };
      const r = await api.post<{ visit: { id: number }; ticket: { id: number; displayNumber: string } }>('/visits', body);
      toast('ok', `Ticket ${r.ticket.displayNumber} issued`);
      onDone({ ticketId: r.ticket.id, displayNumber: r.ticket.displayNumber, visitId: r.visit.id });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'DUPLICATE_SUSPECTED') { setDups((e.details as { candidates: Candidate[] }).candidates); return; }
      toast('error', errorMessage(e));
    }
  }

  async function lookup() {
    if (search.trim().length < 2) return;
    try { setFound((await api.get<Paged<Patient>>('/patients', { q: search.trim(), pageSize: 6 })).items); } catch (e) { toast('error', errorMessage(e)); }
  }

  return (
    <Modal title={chosen ? 'New visit for existing patient' : 'Register patient and issue ticket'} onClose={onClose} wide>
      {dups && (
        <div role="alert" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-semibold text-amber-900">A similar patient already exists</p>
          <ul className="mt-2 space-y-1">
            {dups.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2">
                <span>{d.fullName} · {d.mrn} · {d.dateOfBirth ?? 'DOB unknown'}</span>
                <button type="button" className="btn-secondary btn-sm" onClick={() => { setChosen({ ...d, age: null } as Patient); setDups(null); }}>Use this patient</button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn-secondary btn-sm mt-3" onClick={() => void submit(getValues(), true)}>This is a different person — create new record</button>
        </div>
      )}
      {!chosen && (
        <div className="mb-4 rounded-lg bg-slate-50 p-3">
          <label className="label" htmlFor="rv-search">Returning patient? Search first</label>
          <div className="flex gap-2">
            <input id="rv-search" className="input" placeholder="Name, MRN, phone or ID" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void lookup(); } }} />
            <button type="button" className="btn-secondary" onClick={() => void lookup()}>Search</button>
          </div>
          {found.length > 0 && (
            <ul className="mt-2 divide-y rounded-lg border bg-white text-sm">
              {found.map((p) => (
                <li key={p.id} className="flex items-center justify-between px-3 py-2">
                  <span>{p.fullName} · {p.mrn} · {p.dateOfBirth ?? '—'}</span>
                  <button type="button" className="btn-primary btn-sm" onClick={() => setChosen(p)}>Select</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {chosen ? (
        <form onSubmit={handleSubmit((v) => submit(v))} className="space-y-4">
          <div className="rounded-lg border bg-white p-3 text-sm"><strong>{chosen.fullName}</strong> · {chosen.mrn}{!existing && <button type="button" className="ml-3 text-brand-700 underline" onClick={() => setChosen(undefined)}>Change</button>}</div>
          <Field label="Reason for visit (optional)"><input className="input" {...register('reasonForVisit')} /></Field>
          <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={isSubmitting}>Issue ticket</button></div>
        </form>
      ) : (
        <form onSubmit={handleSubmit((v) => submit(v))} className="grid gap-4 sm:grid-cols-2" noValidate>
          <div className="sm:col-span-2"><Field label="Full name" error={errors.fullName?.message}><input className="input" autoComplete="off" {...register('fullName')} /></Field></div>
          <Field label="Date of birth" error={errors.dateOfBirth?.message}><input type="date" className="input" {...register('dateOfBirth')} /></Field>
          <Field label="Sex" error={errors.sex?.message}>
            <select className="input" {...register('sex')}><option value="FEMALE">Female</option><option value="MALE">Male</option><option value="OTHER">Other</option><option value="UNKNOWN">Not stated</option></select>
          </Field>
          <Field label="Phone"><input className="input" inputMode="tel" {...register('phone')} /></Field>
          <Field label="National ID"><input className="input" {...register('nationalId')} /></Field>
          <div className="sm:col-span-2"><Field label="Address"><input className="input" {...register('address')} /></Field></div>
          <div className="sm:col-span-2"><Field label="Reason for visit (optional)"><input className="input" {...register('reasonForVisit')} /></Field></div>
          <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : 'Register and issue ticket'}</button></div>
        </form>
      )}
    </Modal>
  );
}
