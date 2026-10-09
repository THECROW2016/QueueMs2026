import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';

/** Patients enter the number on their ticket to follow it live. */
export default function Portal() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  async function find(e) {
    e.preventDefault();
    setError('');
    try {
      const t = await api(`/tickets/lookup?code=${encodeURIComponent(code)}`);
      navigate(`/ticket/${t.id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="page center">
      <h1>Check your queue status</h1>
      <p className="muted">Enter the number printed on your ticket.</p>
      <form className="card portal-form" onSubmit={find}>
        <input
          placeholder="e.g. A007"
          value={code}
          autoCapitalize="characters"
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          required
        />
        <button className="btn primary big">Check status</button>
        {error && <p className="error">{error}</p>}
      </form>
    </main>
  );
}
