import { useEffect, useState } from 'react';
import { api, useQueue } from '../api.js';

const load = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const save = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
};

export default function Counter() {
  const queue = useQueue();
  const [counterId, setCounterId] = useState(() => load('qms.counter', null));
  const [serviceIds, setServiceIds] = useState(() => load('qms.services', []));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => save('qms.counter', counterId), [counterId]);
  useEffect(() => save('qms.services', serviceIds), [serviceIds]);

  if (!queue) return <main className="page">Loading…</main>;

  const counter = queue.counters.find((c) => c.id === counterId);
  if (!counter) {
    return (
      <main className="page">
        <h1>Which counter is this?</h1>
        <div className="service-grid">
          {queue.counters.map((c) => (
            <button key={c.id} className="service-btn" onClick={() => setCounterId(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      </main>
    );
  }

  const current = counter.current;
  const handled = serviceIds.length ? serviceIds : queue.services.map((s) => s.id);
  const waitingHere = queue.services
    .filter((s) => handled.includes(s.id))
    .reduce((n, s) => n + s.waiting, 0);

  async function run(fn) {
    setBusy(true);
    setError('');
    try {
      const r = await fn();
      if (r && 'ticket' in r && !r.ticket) setError('No one is waiting for your services.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id) =>
    setServiceIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <main className="page counter">
      <header className="row between">
        <h1>{counter.name}</h1>
        <button className="btn ghost" onClick={() => setCounterId(null)}>Switch counter</button>
      </header>

      <section className="card now">
        <p className="muted">Now at this counter</p>
        {current ? (
          <>
            <div className="ticket-code">{current.code}</div>
            <p>
              {current.service_name} ·{' '}
              <span className={`pill ${current.status}`}>{current.status}</span>
            </p>
            <div className="row wrap">
              <button className="btn" disabled={busy}
                onClick={() => run(() => api(`/tickets/${current.id}/recall`, {}))}
                hidden={current.status !== 'called'}>Recall</button>
              <button className="btn" disabled={busy}
                onClick={() => run(() => api(`/tickets/${current.id}/serve`, {}))}
                hidden={current.status !== 'called'}>Start serving</button>
              <button className="btn" disabled={busy}
                onClick={() => run(() => api(`/tickets/${current.id}/skip`, {}))}
                hidden={current.status !== 'called'}>No-show / skip</button>
              <button className="btn" disabled={busy}
                onClick={() => run(() => api(`/tickets/${current.id}/complete`, {}))}>Complete</button>
            </div>
          </>
        ) : (
          <div className="ticket-code dim">—</div>
        )}
      </section>

      <button
        className="btn primary big"
        disabled={busy}
        onClick={() => run(() => api(`/counters/${counter.id}/call-next`, { serviceIds: handled }))}
      >
        Call next ({waitingHere} waiting)
      </button>
      {error && <p className="error">{error}</p>}

      <section className="card">
        <p className="muted">Services this counter handles</p>
        <div className="row wrap">
          {queue.services.map((s) => (
            <label key={s.id} className="check">
              <input
                type="checkbox"
                checked={serviceIds.length === 0 || serviceIds.includes(s.id)}
                onChange={() =>
                  serviceIds.length === 0
                    ? setServiceIds(queue.services.map((x) => x.id).filter((x) => x !== s.id))
                    : toggle(s.id)
                }
              />
              {s.prefix} · {s.name} <span className="muted">({s.waiting})</span>
            </label>
          ))}
        </div>
      </section>
    </main>
  );
}
