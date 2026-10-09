import { useState } from 'react';
import { useAuth } from '../auth';
import { ErrorBox, Modal, PageHeader, Spinner, useToast } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import type { Counter, Department, RoutingRule } from '../lib/types';
import { useAsync } from '../lib/useAsync';

type Tab = 'departments' | 'counters' | 'routing';

export default function AdminDepartments() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('departments');
  const tabs: Array<[Tab, string, boolean]> = [['departments', 'Departments', can('departments.manage')], ['counters', 'Counters & rooms', can('counters.manage')], ['routing', 'Routing rules', can('routing.manage')]];
  return (
    <div>
      <PageHeader title="Departments, counters and routing" subtitle="Changes apply to new tickets straight away. Existing tickets keep their numbers." />
      <div role="tablist" className="mb-4 flex gap-1 border-b border-slate-200">
        {tabs.filter((t) => t[2]).map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${tab === key ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>
      {tab === 'departments' && <DepartmentsTab />}
      {tab === 'counters' && <CountersTab />}
      {tab === 'routing' && <RoutingTab />}
    </div>
  );
}

const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

function DepartmentsTab() {
  const toast = useToast();
  const list = useAsync(() => api.get<Department[]>('/departments', { includeInactive: true }), []);
  const [edit, setEdit] = useState<Department | 'new' | null>(null);
  if (list.loading && !list.data) return <Spinner />;
  if (list.error && !list.data) return <ErrorBox message={list.error} onRetry={() => void list.reload()} />;
  return (
    <>
      <div className="mb-3 flex justify-end"><button className="btn-primary" onClick={() => setEdit('new')}>+ New department</button></div>
      <div className="card overflow-x-auto">
        <table className="w-full"><thead className="bg-slate-50"><tr><th className="th">Order</th><th className="th">Name</th><th className="th">Code</th><th className="th">Prefix</th><th className="th">Numbering</th><th className="th">Type</th><th className="th">Status</th><th className="th" /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {list.data!.map((d) => (
              <tr key={d.id} className={d.isActive ? '' : 'text-slate-400'}><td className="td">{d.sortOrder}</td><td className="td font-semibold">{d.name}</td><td className="td font-mono text-xs">{d.code}</td><td className="td">{d.ticketPrefix}</td><td className="td">{d.sequencePolicy === 'DAILY' ? 'Resets daily' : 'Continuous'}</td><td className="td">{d.isClinical ? 'Clinical' : 'Non-clinical'}</td><td className="td">{d.isActive ? 'Active' : 'Inactive'}</td>
                <td className="td text-right"><button className="btn-secondary btn-sm" onClick={() => setEdit(d)}>Edit</button></td></tr>
            ))}
          </tbody></table>
      </div>
      {edit && (
        <Modal title={edit === 'new' ? 'New department' : `Edit ${edit.name}`} onClose={() => setEdit(null)} wide>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const body = {
              name: String(f.get('name')).trim(), ticketPrefix: String(f.get('prefix')).trim(), sortOrder: Number(f.get('sortOrder')), isActive: f.get('isActive') === 'on',
              isClinical: f.get('isClinical') === 'on', sequencePolicy: String(f.get('policy')), workflowStages: csv(String(f.get('stages'))).map((s) => s.toUpperCase().replace(/\s+/g, '_')), serviceTypes: csv(String(f.get('types'))),
            };
            try {
              if (edit === 'new') await api.post('/departments', { ...body, code: String(f.get('code')).trim().toUpperCase() });
              else await api.patch(`/departments/${edit.id}`, body);
              toast('ok', 'Saved'); setEdit(null); void list.reload();
            } catch (err) { toast('error', errorMessage(err)); }
          }}>
            <label className="block"><span className="label">Name</span><input name="name" required className="input" defaultValue={edit === 'new' ? '' : edit.name} /></label>
            {edit === 'new' ? <label className="block"><span className="label">Code</span><input name="code" required pattern="[A-Za-z0-9_]{2,30}" className="input" /></label> : <div><span className="label">Code</span><p className="py-2 font-mono text-sm">{edit.code}</p></div>}
            <label className="block"><span className="label">Ticket prefix</span><input name="prefix" required maxLength={8} pattern="[A-Za-z0-9]+" className="input" defaultValue={edit === 'new' ? '' : edit.ticketPrefix} /></label>
            <label className="block"><span className="label">Display order</span><input name="sortOrder" type="number" min={0} max={999} className="input" defaultValue={edit === 'new' ? 50 : edit.sortOrder} /></label>
            <label className="block"><span className="label">Numbering</span><select name="policy" className="input" defaultValue={edit === 'new' ? 'DAILY' : edit.sequencePolicy}><option value="DAILY">Restart every day</option><option value="CONTINUOUS">Continuous</option></select></label>
            <div className="flex items-end gap-6 pb-2 text-sm"><label className="flex items-center gap-2"><input type="checkbox" name="isClinical" defaultChecked={edit === 'new' ? false : edit.isClinical} /> Clinical</label><label className="flex items-center gap-2"><input type="checkbox" name="isActive" defaultChecked={edit === 'new' ? true : edit.isActive} /> Active</label></div>
            <label className="block sm:col-span-2"><span className="label">Workflow stages (comma separated)</span><input name="stages" className="input" defaultValue={edit === 'new' ? '' : edit.workflowStages.join(', ')} /></label>
            <label className="block sm:col-span-2"><span className="label">Service types (comma separated)</span><input name="types" className="input" defaultValue={edit === 'new' ? '' : edit.serviceTypes.join(', ')} /></label>
            <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="btn-secondary" onClick={() => setEdit(null)}>Cancel</button><button className="btn-primary">Save</button></div>
          </form>
        </Modal>
      )}
    </>
  );
}

function CountersTab() {
  const toast = useToast();
  const depts = useAsync(() => api.get<Department[]>('/departments'), []);
  const counters = useAsync(() => api.get<Counter[]>('/counters', { includeInactive: true }), []);
  const [name, setName] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [kind, setKind] = useState<'COUNTER' | 'ROOM'>('COUNTER');
  if (counters.loading && !counters.data) return <Spinner />;
  const deptName = (id: number) => depts.data?.find((d) => d.id === id)?.name ?? id;
  const patch = async (c: Counter, body: object) => { try { await api.patch(`/counters/${c.id}`, body); await counters.reload(); } catch (e) { toast('error', errorMessage(e)); } };
  return (
    <>
      <form className="card mb-4 flex flex-wrap items-end gap-3 p-4" onSubmit={async (e) => {
        e.preventDefault();
        try { await api.post('/counters', { departmentId: Number(departmentId), name: name.trim(), kind }); setName(''); toast('ok', 'Counter added'); await counters.reload(); } catch (err) { toast('error', errorMessage(err)); }
      }}>
        <label className="block"><span className="label">Department</span><select className="input" required value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}><option value="">Select…</option>{(depts.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label className="block"><span className="label">Name</span><input className="input" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Room 4" /></label>
        <label className="block"><span className="label">Type</span><select className="input" value={kind} onChange={(e) => setKind(e.target.value as 'COUNTER' | 'ROOM')}><option value="COUNTER">Counter</option><option value="ROOM">Room</option></select></label>
        <button className="btn-primary">Add</button>
      </form>
      <div className="card overflow-x-auto"><table className="w-full"><thead className="bg-slate-50"><tr><th className="th">Department</th><th className="th">Name</th><th className="th">Type</th><th className="th">Status</th><th className="th" /></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {(counters.data ?? []).map((c) => (
            <tr key={c.id} className={c.isActive ? '' : 'text-slate-400'}><td className="td">{deptName(c.departmentId)}</td><td className="td font-semibold">{c.name}</td><td className="td">{c.kind === 'ROOM' ? 'Room' : 'Counter'}</td><td className="td">{c.isActive ? 'Active' : 'Inactive'}</td>
              <td className="td text-right whitespace-nowrap">
                <button className="btn-secondary btn-sm mr-1" onClick={() => { const n = window.prompt('New name', c.name); if (n && n.trim() && n.trim() !== c.name) void patch(c, { name: n.trim() }); }}>Rename</button>
                <button className="btn-secondary btn-sm" onClick={() => void patch(c, { isActive: !c.isActive })}>{c.isActive ? 'Deactivate' : 'Activate'}</button></td></tr>
          ))}
        </tbody></table></div>
    </>
  );
}

function RoutingTab() {
  const toast = useToast();
  const depts = useAsync(() => api.get<Department[]>('/departments'), []);
  const rules = useAsync(() => api.get<RoutingRule[]>('/routing-rules'), []);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  if (rules.loading && !rules.data) return <Spinner />;
  const save = async (body: object) => { try { await api.put('/routing-rules', body); await rules.reload(); } catch (e) { toast('error', errorMessage(e)); } };
  return (
    <>
      <form className="card mb-4 flex flex-wrap items-end gap-3 p-4" onSubmit={async (e) => {
        e.preventDefault();
        if (from === to) { toast('error', 'Choose two different departments.'); return; }
        await save({ fromDepartmentId: Number(from), toDepartmentId: Number(to), isActive: true }); toast('ok', 'Rule saved');
      }}>
        <label className="block"><span className="label">From</span><select className="input" required value={from} onChange={(e) => setFrom(e.target.value)}><option value="">Select…</option>{(depts.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label className="block"><span className="label">To</span><select className="input" required value={to} onChange={(e) => setTo(e.target.value)}><option value="">Select…</option>{(depts.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <button className="btn-primary">Allow this route</button>
      </form>
      <div className="card overflow-x-auto"><table className="w-full"><thead className="bg-slate-50"><tr><th className="th">From</th><th className="th">To</th><th className="th">Active</th><th className="th">Reason required</th><th className="th">Emergency only</th><th className="th" /></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {(rules.data ?? []).map((r) => (
            <tr key={r.id}><td className="td font-semibold">{r.from.name}</td><td className="td font-semibold">{r.to.name}</td>
              {(['isActive', 'requiresReason', 'emergencyOnly'] as const).map((k) => (
                <td key={k} className="td"><input type="checkbox" aria-label={`${k} ${r.from.name} to ${r.to.name}`} checked={r[k]} onChange={(e) => void save({ fromDepartmentId: r.fromDepartmentId, toDepartmentId: r.toDepartmentId, [k]: e.target.checked })} /></td>
              ))}
              <td className="td text-right"><button className="btn-secondary btn-sm text-red-700" onClick={async () => { if (!window.confirm(`Remove the route ${r.from.name} → ${r.to.name}?`)) return; try { await api.del(`/routing-rules/${r.id}`); await rules.reload(); } catch (e) { toast('error', errorMessage(e)); } }}>Remove</button></td></tr>
          ))}
        </tbody></table></div>
    </>
  );
}
