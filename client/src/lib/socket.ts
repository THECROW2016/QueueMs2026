import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

let shared: Socket | null = null;
const wanted = new Set<number>();

function socket(): Socket {
  if (!shared) {
    shared = io({ path: '/socket.io', transports: ['websocket', 'polling'], withCredentials: true, reconnectionDelayMax: 10_000 });
    // After any reconnect, ask for our rooms again (the server forgets them).
    shared.on('connect', () => wanted.forEach((id) => shared!.emit('subscribe', id)));
  }
  return shared;
}

export function closeSocket() { shared?.close(); shared = null; wanted.clear(); }

/**
 * Subscribes to live events for some departments. `onEvent` runs when the server says something changed.
 * While the socket is down the hook polls every `pollMs`, so screens never silently go stale.
 */
export function useLiveUpdates(departmentIds: number[], onEvent: () => void, pollMs = 15_000) {
  const [connected, setConnected] = useState(false);
  const cb = useRef(onEvent);
  cb.current = onEvent;
  const key = departmentIds.join(',');

  useEffect(() => {
    const s = socket();
    const ids = key ? key.split(',').map(Number) : [];
    ids.forEach((id) => { wanted.add(id); if (s.connected) s.emit('subscribe', id); });
    const fire = () => cb.current();
    const up = () => { setConnected(true); fire(); };
    const down = () => setConnected(false);
    setConnected(s.connected);
    s.on('queue.changed', fire);
    s.on('notification.created', fire);
    s.on('connect', up);
    s.on('disconnect', down);
    s.on('connect_error', down);
    return () => {
      s.off('queue.changed', fire); s.off('notification.created', fire); s.off('connect', up); s.off('disconnect', down); s.off('connect_error', down);
      ids.forEach((id) => { wanted.delete(id); if (s.connected) s.emit('unsubscribe', id); });
    };
  }, [key]);

  useEffect(() => {
    if (connected) return;
    const t = setInterval(() => cb.current(), pollMs);
    return () => clearInterval(t);
  }, [connected, pollMs]);

  return { connected };
}
