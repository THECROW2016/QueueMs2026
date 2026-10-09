import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, useSocketEvent } from '../api.js';

export default function TicketStatus() {
  const { id } = useParams();
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState('');

  const refresh = useCallback(() => {
    api(`/tickets/${id}`).then(setTicket).catch((e) => setError(e.message));
  }, [id]);

  useEffect(refresh, [refresh]);
  useSocketEvent('queue:update', refresh);

  if (error) return <main className="page center"><p className="error">{error}</p></main>;
  if (!ticket) return <main className="page center">Loading…</main>;

  const message = {
    waiting: ticket.ahead === 0 ? 'You are next.' : `${ticket.ahead} ahead of you.`,
    called: `Please go to ${ticket.counter_name} now.`,
    serving: `Being served at ${ticket.counter_name}.`,
    done: 'Completed. Thank you!',
    skipped: 'Your ticket was skipped. Please see a staff member.',
  }[ticket.status];

  return (
    <main className="page center">
      <p className="muted">{ticket.service_name}</p>
      <div className="ticket-code">{ticket.code}</div>
      <p className="lead">{message}</p>
    </main>
  );
}
