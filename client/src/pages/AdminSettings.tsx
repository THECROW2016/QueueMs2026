import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ErrorBox, Field, PageHeader, Spinner, useToast } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useAsync } from '../lib/useAsync';

const schema = z.object({
  'hospital.name': z.string().trim().min(1, 'Required').max(120),
  'hospital.logoUrl': z.string().trim().max(500).refine((v) => v === '' || /^https:\/\//.test(v) || v.startsWith('/'), 'Use an https:// address or a path starting with /'),
  'display.instructions': z.string().trim().max(300),
  'display.showClock': z.boolean(),
  'display.recentCount': z.coerce.number().int().min(1).max(12),
  'display.language': z.string().trim().min(2).max(20),
  'display.speechRate': z.coerce.number().min(0.5).max(1.5),
  'queue.priorityOrdering': z.enum(['priority_then_arrival', 'arrival_only']),
  'queue.absentGraceMinutes': z.coerce.number().int().min(1).max(240),
  'ticket.footer': z.string().trim().max(300),
});
type Form = z.infer<typeof schema>;

export default function AdminSettings() {
  const toast = useToast();
  const settings = useAsync(() => api.get<Form>('/settings'), []);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting, isDirty } } = useForm<Form>({ resolver: zodResolver(schema) as never });
  useEffect(() => { if (settings.data) reset(settings.data); }, [settings.data, reset]);
  if (settings.loading && !settings.data) return <Spinner />;
  if (settings.error && !settings.data) return <ErrorBox message={settings.error} onRetry={() => void settings.reload()} />;
  return (
    <div className="max-w-2xl">
      <PageHeader title="Settings" subtitle="Hospital identity, waiting-room display and queue behaviour." />
      <form className="card space-y-5 p-5" noValidate onSubmit={handleSubmit(async (v) => {
        try { const saved = await api.patch<Form>('/settings', v); reset(saved); toast('ok', 'Settings saved'); } catch (e) { toast('error', errorMessage(e)); }
      })}>
        <h2 className="font-bold">Hospital</h2>
        <Field label="Hospital name" error={errors['hospital.name']?.message}><input className="input" {...register('hospital.name')} /></Field>
        <Field label="Logo address (optional)" error={errors['hospital.logoUrl']?.message} hint="Shown on the waiting-room display."><input className="input" {...register('hospital.logoUrl')} /></Field>
        <h2 className="pt-2 font-bold">Waiting-room display</h2>
        <Field label="Message at the bottom of the screen" error={errors['display.instructions']?.message}><input className="input" {...register('display.instructions')} /></Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Recent calls shown" error={errors['display.recentCount']?.message}><input type="number" className="input" {...register('display.recentCount')} /></Field>
          <Field label="Voice language" error={errors['display.language']?.message} hint="e.g. en-KE, sw-KE"><input className="input" {...register('display.language')} /></Field>
          <Field label="Voice speed" error={errors['display.speechRate']?.message}><input type="number" step="0.05" className="input" {...register('display.speechRate')} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register('display.showClock')} /> Show the clock</label>
        <h2 className="pt-2 font-bold">Queue behaviour</h2>
        <Field label="Order of calling"><select className="input" {...register('queue.priorityOrdering')}><option value="priority_then_arrival">Urgent and emergency first, then arrival order</option><option value="arrival_only">Arrival order only</option></select></Field>
        <Field label="Minutes an absent patient can be restored" error={errors['queue.absentGraceMinutes']?.message}><input type="number" className="input" {...register('queue.absentGraceMinutes')} /></Field>
        <Field label="Footer on printed tickets" error={errors['ticket.footer']?.message}><input className="input" {...register('ticket.footer')} /></Field>
        <button className="btn-primary" disabled={isSubmitting || !isDirty}>Save settings</button>
      </form>
    </div>
  );
}
