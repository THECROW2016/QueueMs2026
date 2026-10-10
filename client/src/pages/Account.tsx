import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAuth } from '../auth';
import { PrintableSlip } from '../components/PrintableSlip';
import { PrinterSettings } from '../components/PrinterSettings';
import { Field, PageHeader, useToast } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { humanize } from '../lib/format';
import { usePrintSettings } from '../lib/printSettings';

const schema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: z.string().min(10, 'Use at least 10 characters'),
  confirm: z.string(),
}).refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match' })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ['newPassword'], message: 'Choose a different password' });

const SAMPLE_SLIP = { hospitalName: 'Sample ticket', displayNumber: 'R-001', departmentName: 'Reception', issuedAt: new Date().toISOString(), peopleAhead: 2, instructions: 'This is a test print. No patient is registered.' };

/** Per-computer ticket printer settings with a test print, for staff who issue tickets. */
function TicketPrinter() {
  const [settings, update, reset] = usePrintSettings();
  return (
    <section className="mb-5" aria-labelledby="ticket-printer">
      <h2 id="ticket-printer" className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Ticket printer</h2>
      <PrinterSettings settings={settings} onChange={update} onReset={reset} />
      <div className="mt-3"><PrintableSlip slip={SAMPLE_SLIP} settings={settings} /></div>
      <div className="mt-3"><button type="button" className="btn-primary" onClick={() => window.print()}>Print test ticket</button></div>
    </section>
  );
}

export default function Account() {
  const { user, refresh, can } = useAuth();
  const toast = useToast();
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  return (
    <div className="max-w-xl">
      <PageHeader title="My account" />
      <section className="card mb-5 p-4 text-sm">
        <p><span className="text-slate-500">Name:</span> <strong>{user?.fullName}</strong></p>
        <p><span className="text-slate-500">Username:</span> {user?.username}</p>
        <p><span className="text-slate-500">Roles:</span> {user?.roles.map(humanize).join(', ')}</p>
        {user?.mustChangePassword && <p role="alert" className="mt-3 rounded bg-amber-50 p-2 text-amber-900">Your password was set by an administrator. Please choose a new one now.</p>}
      </section>
      {can('visit.create') && <TicketPrinter />}
      <form className="card space-y-4 p-4" noValidate onSubmit={handleSubmit(async (v) => {
        try { await api.post('/auth/change-password', { currentPassword: v.currentPassword, newPassword: v.newPassword }); toast('ok', 'Password changed'); reset(); await refresh(); } catch (e) { toast('error', errorMessage(e)); }
      })}>
        <h2 className="font-bold">Change password</h2>
        <Field label="Current password" error={errors.currentPassword?.message}><input type="password" autoComplete="current-password" className="input" {...register('currentPassword')} /></Field>
        <Field label="New password" error={errors.newPassword?.message} hint="At least 10 characters. Avoid common words and reused passwords."><input type="password" autoComplete="new-password" className="input" {...register('newPassword')} /></Field>
        <Field label="Confirm new password" error={errors.confirm?.message}><input type="password" autoComplete="new-password" className="input" {...register('confirm')} /></Field>
        <button className="btn-primary" disabled={isSubmitting}>Change password</button>
      </form>
    </div>
  );
}
