/** "RAD-012" -> "R A D 12", so speech reads the letters and the number clearly. */
export function spokenTicket(displayNumber: string): string {
  const m = /^([A-Za-z]+)-?0*(\d+)$/.exec(displayNumber.trim());
  if (!m) return displayNumber;
  return `${m[1]!.toUpperCase().split('').join(' ')} ${Number(m[2])}`;
}

export function announcementText(c: { displayNumber: string; department: string; counter: string | null }): string {
  const where = c.counter ? `${c.counter}, ${c.department}` : c.department;
  return `Ticket ${spokenTicket(c.displayNumber)}, please proceed to ${where}.`;
}

/** Remembers which calls were already announced so reconnects and refreshes never repeat them. */
export class AnnounceTracker {
  private seen = new Set<string>();
  /** Marks everything currently on screen as already handled (used on first load). */
  prime(keys: string[]) { keys.forEach((k) => this.seen.add(k)); }
  /** Returns true exactly once per key. */
  take(key: string): boolean {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    if (this.seen.size > 500) this.seen = new Set([...this.seen].slice(-250));
    return true;
  }
}
