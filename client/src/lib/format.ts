export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
export const dateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
export const timeOnly = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : '—');
export const money = (minor: number, currency = 'KES') => new Intl.NumberFormat('en-KE', { style: 'currency', currency }).format(minor / 100);
export const humanize = (s: string | null | undefined) => (s ? s.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '—');
export const todayKey = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
export const PRIORITY_LABEL = ['Routine', 'Urgent', 'Emergency'];
