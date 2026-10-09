import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Field, Modal } from './ui';

const schema = z.object({ reason: z.string().trim().min(3, 'Please give a short reason (at least 3 characters)').max(255) });

/** Asks for a mandatory reason before a destructive or irreversible action. */
export function ReasonModal({ title, confirmLabel, danger, onClose, onConfirm, intro }: {
  title: string; confirmLabel: string; danger?: boolean; intro?: string; onClose: () => void; onConfirm: (reason: string) => Promise<void>;
}) {
  const { register, handleSubmit, formState: { errors, isSubmitting }, setError } = useForm<{ reason: string }>({ resolver: zodResolver(schema) });
  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={handleSubmit(async ({ reason }) => {
          try { await onConfirm(reason); onClose(); } catch (e) { setError('reason', { message: e instanceof Error ? e.message : 'Failed' }); }
        })}
        className="space-y-4"
      >
        {intro && <p className="text-sm text-slate-600">{intro}</p>}
        <Field label="Reason" error={errors.reason?.message}>
          <textarea className="input" rows={3} maxLength={255} {...register('reason')} />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Back</button>
          <button type="submit" className={danger ? 'btn-danger' : 'btn-primary'} disabled={isSubmitting}>{isSubmitting ? 'Working…' : confirmLabel}</button>
        </div>
      </form>
    </Modal>
  );
}
