import { useEffect, useState } from 'react';
import { api } from '../api.js';

const RESET_AFTER_MS = 12000;

export default function Kiosk() {
  const [services, setServices] = useState([]);
  const [selected, setSelected] = useState(null);
  const [phone, setPhone] = useState('');
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/services').then(setServices).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!ticket) return;
    const t = setTimeout(reset, RESET_AFTER_MS);
    return () => clearTimeout(t);
  }, [ticket]);

  function reset() {
    setTicket(null);
    setSelected(null);
    setPhone('');
    setError('');
  }

  async function take() {
    setBusy(true);
    setError('');
    try {
      setTicket(await api('/tickets', { serviceId: selected.id, phone: phone || undefined }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (ticket) {
    return (
      <main className="page kiosk center">
        <p className="muted">Your ticket</p>
        <div className="ticket-code">{ticket.code}</div>
        <p className="lead">{ticket.service_name}</p>
        <p>
          {ticket.ahead === 0 ? 'You are next.' : `${ticket.ahead} ahead of you.`}
          {ticket.phone && ' We will text you when your turn is near.'}
        </p>
        <button className="btn" onClick={reset}>Done</button>
      </main>
    );
  }

  return (
    <main className="page kiosk">
      <h1>Welcome. What do you need help with?</h1>
      <div className="service-grid">
        {services.map((s) => (
          <button
            key={s.id}
            className={`service-btn ${selected?.id === s.id ? 'active' : ''}`}
            onClick={() => setSelected(s)}
          >
            <span className="prefix">{s.prefix}</span>
            {s.name}
          </button>
        ))}
      </div>

      {selected && (
        <div className="card kiosk-confirm">
          <label>
            Phone number for SMS updates <span className="muted">(optional)</span>
            <input
              inputMode="tel"
              placeholder="07XX XXX XXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <button className="btn primary big" disabled={busy} onClick={take}>
            Take ticket for {selected.name}
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  );
}
