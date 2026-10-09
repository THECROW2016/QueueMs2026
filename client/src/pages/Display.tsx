import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { announcementText, AnnounceTracker } from '../lib/announce';
import type { DisplaySnapshot } from '../lib/types';

const PREFS = 'hqms.display.prefs';
interface Prefs { muted: boolean; rate: number; lang: string }

function loadPrefs(): Partial<Prefs> {
  try { return JSON.parse(localStorage.getItem(PREFS) ?? '{}') as Partial<Prefs>; } catch { return {}; }
}

/**
 * Public waiting-room screen. Shows ticket numbers, counters and queue sizes only — never patient information.
 * Browsers block speech until the page has had a user gesture, so the screen shows an "Enable sound" step first.
 */
export default function Display() {
  const [snap, setSnap] = useState<DisplaySnapshot | null>(null);
  const [offline, setOffline] = useState(false);
  const [now, setNow] = useState(new Date());
  const [banner, setBanner] = useState<{ text: string; key: string } | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(() => ({ muted: false, rate: 0.9, lang: '', ...loadPrefs() }));
  const [showControls, setShowControls] = useState(false);
  const tracker = useRef(new AnnounceTracker());
  const primed = useRef(false);
  const speakQueue = useRef<string[]>([]);
  const speaking = useRef(false);
  const prefsRef = useRef(prefs);
  const soundRef = useRef(soundOn);
  const snapRef = useRef<DisplaySnapshot | null>(null);
  prefsRef.current = prefs;
  soundRef.current = soundOn;
  const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const savePrefs = (p: Prefs) => { setPrefs(p); try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* ignore */ } };

  const pump = useCallback(() => {
    if (speaking.current || !speechSupported) return;
    const text = speakQueue.current.shift();
    if (!text) return;
    speaking.current = true;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = prefsRef.current.lang || snapRef.current?.settings.language || 'en-KE';
    u.rate = prefsRef.current.rate || snapRef.current?.settings.speechRate || 0.9;
    const done = () => { speaking.current = false; setTimeout(pump, 400); };
    u.onend = done; u.onerror = done;
    window.speechSynthesis.speak(u);
  }, [speechSupported]);

  const announce = useCallback((c: DisplaySnapshot['nowServing'][number]) => {
    if (!tracker.current.take(c.callKey)) return;
    const text = announcementText(c);
    setBanner({ text: `${c.displayNumber} → ${c.counter ?? c.department}`, key: c.callKey });
    setTimeout(() => setBanner((b) => (b?.key === c.callKey ? null : b)), 12_000);
    if (soundRef.current && !prefsRef.current.muted && speechSupported) {
      // A recall of a ticket already queued for speech should not stack up.
      if (!speakQueue.current.includes(text)) speakQueue.current.push(text);
      pump();
    }
  }, [pump, speechSupported]);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/public/display', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as DisplaySnapshot;
      snapRef.current = data;
      setSnap(data);
      setOffline(false);
      if (!primed.current) { tracker.current.prime(data.nowServing.map((c) => c.callKey)); primed.current = true; }
      else data.nowServing.slice().reverse().forEach(announce);
    } catch { setOffline(true); }
  }, [announce]);

  useEffect(() => {
    void load();
    const poll = setInterval(() => void load(), 20_000);
    const clock = setInterval(() => setNow(new Date()), 1000);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(() => void load(), 250); };
    const socket = io('/display', { path: '/socket.io', transports: ['websocket', 'polling'], reconnectionDelayMax: 10_000 });
    socket.on('display.call', refresh);
    socket.on('display.refresh', refresh);
    socket.on('connect', refresh);
    return () => { clearInterval(poll); clearInterval(clock); clearTimeout(timer); socket.close(); window.speechSynthesis?.cancel(); };
  }, [load]);

  const enableSound = () => {
    setSoundOn(true);
    if (speechSupported) {
      // A silent utterance inside the click unlocks speech on browsers that require a gesture.
      const u = new SpeechSynthesisUtterance(' '); u.volume = 0; window.speechSynthesis.speak(u);
    }
  };
  const testVoice = () => { if (speechSupported) { speakQueue.current.push('Ticket C 12, please proceed to Room 1, Consultation. This is a test.'); pump(); } };

  const s = snap?.settings;
  const departments = useMemo(() => snap?.departments ?? [], [snap]);

  return (
    <div className="flex min-h-screen flex-col bg-ink-900 text-white" data-testid="display">
      <header className="flex items-center justify-between border-b border-white/10 px-8 py-4">
        <div className="flex items-center gap-4">
          {s?.logoUrl ? <img src={s.logoUrl} alt="" className="h-12" /> : <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand-500 text-2xl font-extrabold">A</span>}
          <h1 className="text-3xl font-bold">{s?.hospitalName ?? 'Hospital Queue'}</h1>
        </div>
        <div className="flex items-center gap-6">
          {offline && <span role="alert" className="rounded bg-amber-500 px-3 py-1 text-sm font-semibold text-black">Reconnecting…</span>}
          {s?.showClock !== false && <time className="text-4xl font-bold tabular-nums" dateTime={now.toISOString()}>{now.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}</time>}
        </div>
      </header>

      {banner && (
        <div role="status" aria-live="assertive" className="animate-pulse bg-brand-500 px-8 py-5 text-center text-5xl font-extrabold tracking-tight text-ink-900" data-testid="call-banner">{banner.text}</div>
      )}

      <main className="grid flex-1 gap-6 p-8 lg:grid-cols-3">
        <section className="lg:col-span-2" aria-label="Now serving">
          <h2 className="mb-4 text-2xl font-semibold uppercase tracking-widest text-brand-100">Now serving</h2>
          {!snap ? <p className="text-xl text-slate-400">Loading…</p> : snap.nowServing.length === 0 ? (
            <p className="text-2xl text-slate-400">No patients are being called right now.</p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2">
              {snap.nowServing.map((c, i) => (
                <li key={c.ticketId} className={`rounded-2xl border border-white/10 p-5 ${i === 0 ? 'bg-brand-600' : 'bg-ink-800'}`}>
                  <div className="font-display text-6xl font-extrabold tracking-tight tabular-nums">{c.displayNumber}</div>
                  <div className="mt-2 text-2xl font-semibold">{c.counter ?? '—'}</div>
                  <div className="text-lg text-white/70">{c.department}</div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Queues">
          <h2 className="mb-4 text-2xl font-semibold uppercase tracking-widest text-brand-100">Waiting</h2>
          <ul className="space-y-3">
            {departments.map((d) => (
              <li key={d.id} className="rounded-xl bg-ink-800 p-4">
                <div className="flex items-baseline justify-between"><span className="text-xl font-semibold">{d.name}</span><span className="text-3xl font-bold tabular-nums">{d.waiting}</span></div>
                {d.nextUp.length > 0 && <div className="mt-1 text-sm text-white/60">Next: {d.nextUp.join(' · ')}</div>}
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-8 py-3 text-lg text-white/70">
        <p>{s?.instructions}</p>
        <div className="flex items-center gap-2 text-sm">
          {!soundOn && speechSupported && <button className="rounded-lg bg-brand-500 px-4 py-2 font-bold text-ink-900" onClick={enableSound}>🔊 Enable voice announcements</button>}
          {!speechSupported && <span>Voice announcements are not supported in this browser; calls show on screen.</span>}
          {soundOn && <button className="rounded-lg border border-white/30 px-3 py-1.5" onClick={() => savePrefs({ ...prefs, muted: !prefs.muted })}>{prefs.muted ? '🔇 Unmute' : '🔊 Mute'}</button>}
          {soundOn && <button className="rounded-lg border border-white/30 px-3 py-1.5" onClick={() => setShowControls((v) => !v)} aria-expanded={showControls}>Voice settings</button>}
        </div>
      </footer>
      {showControls && soundOn && (
        <div className="flex flex-wrap items-center gap-4 border-t border-white/10 bg-ink-800 px-8 py-3 text-sm">
          <label className="flex items-center gap-2">Speed
            <input type="range" min={0.6} max={1.3} step={0.05} value={prefs.rate} onChange={(e) => savePrefs({ ...prefs, rate: Number(e.target.value) })} />
            <span>{prefs.rate.toFixed(2)}</span>
          </label>
          <label className="flex items-center gap-2">Language
            <select className="rounded bg-ink-700 px-2 py-1" value={prefs.lang} onChange={(e) => savePrefs({ ...prefs, lang: e.target.value })}>
              <option value="">Hospital default ({s?.language ?? 'en-KE'})</option><option value="en-KE">English (Kenya)</option><option value="en-GB">English (UK)</option><option value="en-US">English (US)</option><option value="sw-KE">Kiswahili</option>
            </select>
          </label>
          <button className="rounded-lg border border-white/30 px-3 py-1.5" onClick={testVoice}>Test voice</button>
        </div>
      )}
    </div>
  );
}
