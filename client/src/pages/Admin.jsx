import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useQueue } from '../api.js';
import { StaffBar } from '../auth.jsx';

const screens = [
  ['/kiosk', 'Kiosk', 'Patients pick a service and take a ticket'],
  ['/display', 'Display screen', 'Live board for the waiting-room TV'],
  ['/counter', 'Counter panel', 'Call, serve, skip and complete tickets'],
  ['/portal', 'Patient portal', 'Patients check their ticket status'],
];

const emptyUser = { username: '', full_name: '', password: '', role: 'user' };

export default function Admin() {
  const queue = useQueue();
  const [svc, setSvc] = useState({ name: '', prefix: '' });
  const [counterName, setCounterName] = useState('');
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState(emptyUser);
  const [msg, setMsg] = useState('');

  const loadUsers = () => api('/users').then(setUsers).catch((e) => setMsg(e.message));
  useEffect(() => {
    loadUsers();
  }, []);

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
      <StaffBar />
      <h1>Setup</h1>

      <section className="home-grid">
        {screens.map(([to, title, desc]) => (
          <Link key={to} to={to} className="card link-card" target={to === '/counter' ? undefined : '_blank'}>
            <strong>{title}</strong>
            <span className="muted">{desc}</span>
          </Link>
        ))}
      </section>

      {msg && <p className="muted">{msg}</p>}

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

        <section className="card">
          <h2>Staff accounts</h2>
          <ul className="recent">
            {users.map((u) => (
              <li key={u.id}>
                <span>{u.full_name || u.username} <span className="muted">({u.username})</span></span>
                <b>{u.role === 'admin' ? 'Admin' : 'Staff'}</b>
              </li>
            ))}
          </ul>
          <form onSubmit={(e) => submit(e, async () => {
            await api('/users', newUser);
            setNewUser(emptyUser);
            await loadUsers();
          })}>
            <input placeholder="Full name" value={newUser.full_name}
              onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })} />
            <input placeholder="Username or email" value={newUser.username} required autoComplete="off"
              onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} />
            <input type="password" placeholder="Temporary password (8+ characters)" required minLength={8}
              autoComplete="new-password" value={newUser.password}
              onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
            <div className="row wrap">
              {[['user', 'Staff / Healthcare Provider'], ['admin', 'Administrator']].map(([value, label]) => (
                <label key={value} className="check">
                  <input type="radio" name="role" checked={newUser.role === value}
                    onChange={() => setNewUser({ ...newUser, role: value })} />
                  {label}
                </label>
              ))}
            </div>
            <button className="btn primary">Add account</button>
          </form>
        </section>
      </div>
    </main>
  );
}
