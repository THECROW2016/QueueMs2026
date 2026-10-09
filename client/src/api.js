import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

export async function api(path, body) {
  const res = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let socket;
export function getSocket() {
  if (!socket) socket = io();
  return socket;
}

/** Live queue snapshot, refreshed by the server over Socket.IO. */
export function useQueue() {
  const [state, setState] = useState(null);
  useEffect(() => {
    const s = getSocket();
    const onUpdate = (snap) => setState(snap);
    s.on('queue:update', onUpdate);
    api('/queue').then(setState).catch(() => {});
    return () => s.off('queue:update', onUpdate);
  }, []);
  return state;
}

export function useSocketEvent(event, handler) {
  useEffect(() => {
    const s = getSocket();
    s.on(event, handler);
    return () => s.off(event, handler);
  }, [event, handler]);
}
