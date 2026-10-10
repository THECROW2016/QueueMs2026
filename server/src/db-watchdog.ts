/**
 * Restarts the process when the database stays unreachable.
 *
 * A database that is redeployed or restarted can leave the connection pool unable to hand out connections even
 * after the database is back (seen on Railway: "pool timeout ... active=0 idle=0" until the app was restarted).
 * Every request then fails with a 500. If several pings in a row fail, the watchdog calls `onUnhealthy`, and the
 * platform's restart policy brings up a fresh process with a fresh pool.
 */
export interface WatchdogOptions {
  ping: () => Promise<unknown>;
  intervalMs: number;
  /** Consecutive failed pings before giving up. 0 disables the watchdog. */
  maxFailures: number;
  /** A ping that takes longer than this counts as failed. */
  timeoutMs?: number;
  onUnhealthy: (failures: number, lastError: unknown) => void;
  onRecovered?: (failures: number) => void;
}

export function startDbWatchdog(opts: WatchdogOptions): { stop: () => void } {
  if (opts.maxFailures <= 0) return { stop: () => undefined };
  const timeoutMs = opts.timeoutMs ?? 8_000;
  let failures = 0;
  let running = false;
  let fired = false;

  const tick = async () => {
    if (running || fired) return; // never overlap checks
    running = true;
    try {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('database ping timed out')), timeoutMs); });
      try { await Promise.race([opts.ping(), timeout]); } finally { clearTimeout(timer); }
      if (failures > 0) opts.onRecovered?.(failures);
      failures = 0;
    } catch (err) {
      failures += 1;
      if (failures >= opts.maxFailures) { fired = true; opts.onUnhealthy(failures, err); }
    } finally {
      running = false;
    }
  };

  const handle = setInterval(() => void tick(), opts.intervalMs);
  handle.unref();
  return { stop: () => clearInterval(handle) };
}
