import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { RegisterVisit } from '../components/RegisterVisit';
import { Empty, ErrorBox, Modal, PageHeader, Pager, StatusBadge, useToast } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { dateTime, humanize } from '../lib/format';
import type { Paged, Patient } from '../lib/types';

interface VisitRow { id: number; visitNumber: string; status: string; openedAt: string }

export default function Patients() {
  const { can } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [res, setRes] = useState<Paged<Patient> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<{ patient: Patient; visits: VisitRow[] } | null>(null);
  const [newVisitFor, setNewVisitFor] = useState<Patient | null | 'new'>(null);

  async function search(p = 1, t = q) {
    if (t.trim().length < 2) { setError('Type at least 2 characters.'); return; }
    setBusy(true); setError('');
    try { setRes(await api.get<Paged<Patient>>('/patients', { q: t.trim(), page: p, pageSize: 15 })); setTerm(t.trim()); setPage(p); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function open(p: Patient) {
    try {
      const [full, visits] = await Promise.all([
        can('patient.view') ? api.get<Patient>(`/patients/${p.id}`) : Promise.resolve(p),
        can('visit.view') ? api.get<Paged<VisitRow>>('/visits', { patientId: p.id, pageSize: 10 }) : Promise.resolve({ items: [] as VisitRow[] }),
      ]);
      setDetail({ patient: full, visits: visits.items });
    } catch (e) { toast('error', errorMessage(e)); }
  }

  return (
    <div>
      <PageHeader title="Patients" subtitle="Search by name, MRN, phone number or national ID. Searches and record views are logged." actions={can('visit.create') ? <button className="btn-primary" onClick={() => setNewVisitFor('new')}>+ Register patient</button> : undefined} />
      <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); void search(1); }} role="search">
        <input className="input max-w-md" aria-label="Search patients" placeholder="Search patients…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-primary" disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
      </form>
      {error && <ErrorBox message={error} />}
      {res && (
        <div className="card overflow-hidden">
          {res.items.length === 0 ? <Empty>No patients match “{term}”.</Empty> : (
            <table className="w-full">
              <thead className="bg-slate-50"><tr><th className="th">Name</th><th className="th">MRN</th><th className="th">Date of birth</th><th className="th">Sex</th><th className="th">Phone</th><th className="th" /></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {res.items.map((p) => (
                  <tr key={p.id}>
                    <td className="td font-semibold">{p.fullName}</td><td className="td">{p.mrn}</td><td className="td">{p.dateOfBirth ?? '—'}{p.age !== null ? ` (${p.age})` : ''}</td>
                    <td className="td">{humanize(p.sex)}</td><td className="td">{p.phone ?? '—'}</td>
                    <td className="td text-right whitespace-nowrap">
                      {can('patient.view') && <button className="btn-secondary btn-sm mr-1" onClick={() => void open(p)}>Open</button>}
                      {can('visit.create') && <button className="btn-primary btn-sm" onClick={() => setNewVisitFor(p)}>New visit</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Pager page={res.page} pageSize={res.pageSize} total={res.total} onPage={(p) => void search(p, term)} />
        </div>
      )}
      {detail && (
        <Modal title={detail.patient.fullName} onClose={() => setDetail(null)} wide>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="label">MRN</dt><dd>{detail.patient.mrn}</dd></div>
            <div><dt className="label">Date of birth</dt><dd>{detail.patient.dateOfBirth ?? '—'}</dd></div>
            <div><dt className="label">Sex</dt><dd>{humanize(detail.patient.sex)}</dd></div>
            <div><dt className="label">Phone</dt><dd>{detail.patient.phone ?? '—'}</dd></div>
            <div><dt className="label">National ID</dt><dd>{detail.patient.nationalId ?? '—'}</dd></div>
            <div><dt className="label">Address</dt><dd>{detail.patient.address ?? '—'}</dd></div>
          </dl>
          <h3 className="mb-2 mt-5 text-sm font-semibold uppercase tracking-wide text-slate-500">Visits</h3>
          {detail.visits.length === 0 ? <p className="text-sm text-slate-500">No visits you can see.</p> : (
            <ul className="divide-y rounded-lg border">
              {detail.visits.map((v) => <li key={v.id} className="flex items-center justify-between px-3 py-2 text-sm"><Link className="text-brand-700 hover:underline" to={`/visits/${v.id}`}>{v.visitNumber}</Link><span>{dateTime(v.openedAt)} <StatusBadge status={v.status} /></span></li>)}
            </ul>
          )}
        </Modal>
      )}
      {newVisitFor && (
        <RegisterVisit existing={newVisitFor === 'new' ? undefined : newVisitFor} onClose={() => setNewVisitFor(null)} onDone={(r) => { setNewVisitFor(null); nav(`/tickets/${r.ticketId}/slip`); }} />
      )}
    </div>
  );
}
