import { useCallback, useEffect, useState } from 'react';
import { useQueue, useSocketEvent } from '../api.js';

function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.connect(gain).connect(ctx.destination);
      const t = ctx.currentTime + i * 0.35;
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.start(t);
      osc.stop(t + 0.3);
    });
  } catch {
    /* audio unavailable */
  }
}

function announce(code, counter) {
  if (!('speechSynthesis' in window)) return;
  const spoken = code.split('').join(' ');
  const u = new SpeechSynthesisUtterance(`Ticket ${spoken}, please go to ${counter}`);
  u.rate = 0.9;
  window.speechSynthesis.speak(u);
}

export default function Display() {
  const queue = useQueue();
  const [flash, setFlash] = useState(null);
  const [soundOn, setSoundOn] = useState(false);
  const [clock, setClock] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const onCalled = useCallback(
    ({ code, counter }) => {
      setFlash({ code, counter, key: Date.now() });
      if (soundOn) {
        chime();
        setTimeout(() => announce(code, counter), 700);
      }
    },
    [soundOn],
  );
  useSocketEvent('ticket:called', onCalled);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 6000);
    return () => clearTimeout(t);
  }, [flash]);

  if (!queue) return <main className="display">Loading…</main>;

  return (
    <main className="display">
      <header className="row between">
        <h1 className="qms-brand">Queue<span>MS</span></h1>
        <div className="row">
          {!soundOn && (
            <button className="btn ghost" onClick={() => setSoundOn(true)}>Enable sound</button>
          )}
          <span className="clock">
            {clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </header>

      {flash && (
        <div className="flash" key={flash.key}>
          <div className="ticket-code">{flash.code}</div>
          <div className="lead">→ {flash.counter}</div>
        </div>
      )}

      <div className="display-body">
        <section className="counters">
          {queue.counters.map((c) => (
            <div key={c.id} className={`counter-tile ${c.current ? '' : 'idle'}`}>
              <span className="counter-name">{c.name}</span>
              <span className="ticket-code">{c.current?.code ?? '—'}</span>
            </div>
          ))}
        </section>
        <aside className="side">
          <h2>Recently called</h2>
          <ul className="recent">
            {queue.recent.map((r) => (
              <li key={r.id}>
                <b>{r.code}</b> <span>{r.counter_name}</span>
              </li>
            ))}
            {queue.recent.length === 0 && <li className="muted">Nobody yet</li>}
          </ul>
          <h2>Waiting</h2>
          <ul className="recent">
            {queue.services.map((s) => (
              <li key={s.id}>
                <span>{s.name}</span> <b>{s.waiting}</b>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </main>
  );
}
