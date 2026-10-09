import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ErrorBox, Field, Modal, PageHeader, Pager, Spinner, useToast } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { dateTime, humanize } from '../lib/format';
import type { Department, Paged, Role, StaffUser } from '../lib/types';
import { useAsync } from '../lib/useAsync';

const base = {
  fullName: z.string().trim().min(2, 'Enter the full name').max(190),
  email: z.string().trim().email('Enter a valid email').or(z.literal('')).optional(),
  roleCodes: z.array(z.string()).min(1, 'Choose at least one role'),
  departmentIds: z.array(z.string()),
};
const createSchema = z.object({
  ...base,
  username: z.string().trim().min(3, 'At least 3 characters').max(100).regex(/^[A-Za-z0-9._@-]+$/, 'Letters, numbers and . _ @ - only'),
  password: z.string().min(10, 'Use at least 10 characters'),
});
type CreateForm = z.infer<typeof createSchema>;
const editSchema = z.object({ ...base, isActive: z.boolean() });
type EditForm = z.infer<typeof editSchema>;

function Checks({ options, value, onChange, name }: { options: Array<{ value: string; label: string }>; value: string[]; onChange: (v: string[]) => void; name: string }) {
  return (
    <fieldset className="grid gap-1 sm:grid-cols-2"><legend className="sr-only">{name}</legend>
      {options.map((o) => (
        <label key={o.value} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.includes(o.value)} onChange={(e) => onChange(e.target.checked ? [...value, o.value] : value.filter((x) => x !== o.value))} /> {o.label}</label>
      ))}
    </fieldset>
  );
}

export default function AdminUsers() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<StaffUser | 'new' | null>(null);
  const [resetToken, setResetToken] = useState<{ user: StaffUser; token: string } | null>(null);
  const users = useAsync(() => api.get<Paged<StaffUser>>('/users', { page, pageSize: 20, search: search.trim() }), [page, search]);
  const roles = useAsync(() => api.get<Role[]>('/roles'), []);
  const depts = useAsync(() => api.get<Department[]>('/departments'), []);

  async function issueReset(u: StaffUser) {
    try { const r = await api.post<{ token: string }>(`/users/${u.id}/reset-password`); setResetToken({ user: u, token: r.token }); } catch (e) { toast('error', errorMessage(e)); }
  }

  return (
    <div>
      <PageHeader title="Users" subtitle="Staff accounts, roles and department assignments." actions={<button className="btn-primary" onClick={() => setEditing('new')}>+ New user</button>} />
      <input className="input mb-4 max-w-sm" aria-label="Search users" placeholder="Search by name, username or email" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      {users.loading && !users.data ? <Spinner /> : users.error && !users.data ? <ErrorBox message={users.error} onRetry={() => void users.reload()} /> : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50"><tr><th className="th">Name</th><th className="th">Username</th><th className="th">Roles</th><th className="th">Departments</th><th className="th">Last sign-in</th><th className="th">Status</th><th className="th" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {users.data!.items.map((u) => (
                <tr key={u.id} className={u.isActive ? '' : 'text-slate-400'}>
                  <td className="td font-semibold">{u.fullName}</td><td className="td">{u.username}</td><td className="td">{u.roles.map((r) => r.name).join(', ')}</td>
                  <td className="td">{u.departments.map((d) => d.name).join(', ') || '—'}</td><td className="td">{dateTime(u.lastLoginAt)}</td>
                  <td className="td">{!u.isActive ? 'Disabled' : u.lockedUntil && new Date(u.lockedUntil) > new Date() ? 'Locked' : 'Active'}</td>
                  <td className="td whitespace-nowrap text-right"><button className="btn-secondary btn-sm mr-1" onClick={() => setEditing(u)}>Edit</button><button className="btn-secondary btn-sm" onClick={() => void issueReset(u)}>Reset password</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={users.data!.page} pageSize={users.data!.pageSize} total={users.data!.total} onPage={setPage} />
        </div>
      )}
      {editing && roles.data && depts.data && <UserModal user={editing === 'new' ? null : editing} roles={roles.data} depts={depts.data} onClose={() => setEditing(null)} onDone={() => { setEditing(null); void users.reload(); }} />}
      {resetToken && (
        <Modal title="One-time reset token" onClose={() => setResetToken(null)}>
          <p className="text-sm text-slate-600">Give this token to <strong>{resetToken.user.fullName}</strong> through a trusted channel. It works once, expires soon, and will not be shown again.</p>
          <code className="mt-3 block break-all rounded bg-slate-100 p-3 text-sm" data-testid="reset-token">{resetToken.token}</code>
          <div className="mt-4 flex justify-end gap-2"><button className="btn-secondary" onClick={() => void navigator.clipboard?.writeText(resetToken.token)}>Copy</button><button className="btn-primary" onClick={() => setResetToken(null)}>Done</button></div>
        </Modal>
      )}
    </div>
  );
}

function UserModal({ user, roles, depts, onClose, onDone }: { user: StaffUser | null; roles: Role[]; depts: Department[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const creating = !user;
  const form = useForm<CreateForm & { isActive: boolean }>({
    resolver: zodResolver(creating ? createSchema : editSchema) as never,
    defaultValues: { username: user?.username ?? '', fullName: user?.fullName ?? '', email: user?.email ?? '', password: '', isActive: user?.isActive ?? true, roleCodes: user?.roles.map((r) => r.code) ?? [], departmentIds: user?.departments.map((d) => String(d.id)) ?? [] },
  });
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = form;
  return (
    <Modal title={creating ? 'New user' : `Edit ${user!.fullName}`} onClose={onClose} wide>
      <form className="grid gap-4 sm:grid-cols-2" noValidate onSubmit={handleSubmit(async (v) => {
        const common = { fullName: v.fullName, email: v.email || null, roleCodes: v.roleCodes, departmentIds: v.departmentIds.map(Number) };
        try {
          if (creating) await api.post('/users', { ...common, username: v.username, password: v.password });
          else await api.patch(`/users/${user!.id}`, { ...common, isActive: v.isActive });
          toast('ok', creating ? 'User created. They must change the password at first sign-in.' : 'User updated'); onDone();
        } catch (e) { toast('error', errorMessage(e)); }
      })}>
        {creating && <Field label="Username" error={errors.username?.message}><input className="input" autoComplete="off" {...register('username')} /></Field>}
        <Field label="Full name" error={errors.fullName?.message}><input className="input" {...register('fullName')} /></Field>
        <Field label="Email (optional)" error={errors.email?.message}><input className="input" type="email" {...register('email')} /></Field>
        {creating && <Field label="Temporary password" error={errors.password?.message} hint="The user must change it at first sign-in."><input className="input" type="password" autoComplete="new-password" {...register('password')} /></Field>}
        <div className="sm:col-span-2">
          <span className="label">Roles</span>
          <Checks name="Roles" options={roles.map((r) => ({ value: r.code, label: humanize(r.code) }))} value={watch('roleCodes')} onChange={(v) => setValue('roleCodes', v, { shouldValidate: true })} />
          {errors.roleCodes && <p role="alert" className="error-text">{errors.roleCodes.message as string}</p>}
        </div>
        <div className="sm:col-span-2">
          <span className="label">Departments</span>
          <Checks name="Departments" options={depts.map((d) => ({ value: String(d.id), label: d.name }))} value={watch('departmentIds')} onChange={(v) => setValue('departmentIds', v)} />
        </div>
        {!creating && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" {...register('isActive')} /> Account is active (untick to disable sign-in)</label>}
        <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={isSubmitting}>{creating ? 'Create user' : 'Save changes'}</button></div>
      </form>
    </Modal>
  );
}
