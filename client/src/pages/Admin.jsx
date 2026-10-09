import { useState } from 'react';
import { api, useQueue } from '../api.js';

export default function Admin() {
  const queue = useQueue();
  const [svc, setSvc] = useState({ name: '', prefix: '' });
  const [counterName, setCounterName] = useState('');
  const [msg, setMsg] = useState('');

  async function submit(e, fn) {
    e.preventDefault();
    setMsg('');
    try {
      await fn();
      setMsg('Saved.');
    } catch (err) {
      setMsg(err.message);
    }
  }

  return (
    <main className="page">
      <h1>Setup</h1>
      <div className="two-col">
        <section className="card">
          <h2>Services</h2>
          <ul className="recent">
            {queue?.services.map((s) => (
              <li key={s.id}><b>{s.prefix}</b> <span>{s.name}</span></li>
            ))}
          </ul>
          <form onSubmit={(e) => submit(e, async () => {
            await api('/services', svc);
            setSvc({ name: '', prefix: '' });
          })}>
            <input placeholder="Service name" value={svc.name} required
              onChange={(e) => setSvc({ ...svc, name: e.target.value })} />
            <input placeholder="Ticket prefix, e.g. D" value={svc.prefix} required maxLength={3}
              onChange={(e) => setSvc({ ...svc, prefix: e.target.value })} />
            <button className="btn primary">Add service</button>
          </form>
        </section>
        <section className="card">
          <h2>Counters</h2>
          <ul className="recent">
            {queue?.counters.map((c) => <li key={c.id}><span>{c.name}</span></li>)}
          </ul>
          <form onSubmit={(e) => submit(e, async () => {
            await api('/counters', { name: counterName });
            setCounterName('');
          })}>
            <input placeholder="Counter name" value={counterName} required
              onChange={(e) => setCounterName(e.target.value)} />
            <button className="btn primary">Add counter</button>
          </form>
        </section>
      </div>
      {msg && <p className="muted">{msg}</p>}
    </main>
  );
}
