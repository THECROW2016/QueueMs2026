import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startDbWatchdog } from '../src/db-watchdog.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('database watchdog', () => {
  it('gives up only after the configured number of consecutive failures', async () => {
    const onUnhealthy = vi.fn();
    const ping = vi.fn().mockRejectedValue(new Error('pool timeout'));
    startDbWatchdog({ ping, intervalMs: 1000, maxFailures: 3, onUnhealthy });
    await vi.advanceTimersByTimeAsync(2000);
    expect(onUnhealthy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onUnhealthy).toHaveBeenCalledTimes(1);
    expect(onUnhealthy.mock.calls[0]![0]).toBe(3);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onUnhealthy).toHaveBeenCalledTimes(1); // fires once
  });

  it('a success resets the count, so brief blips do not restart the service', async () => {
    const onUnhealthy = vi.fn(); const onRecovered = vi.fn();
    const ping = vi.fn()
      .mockRejectedValueOnce(new Error('x')).mockRejectedValueOnce(new Error('x'))
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('x')).mockRejectedValueOnce(new Error('x'))
      .mockResolvedValue(1);
    startDbWatchdog({ ping, intervalMs: 1000, maxFailures: 3, onUnhealthy, onRecovered });
    await vi.advanceTimersByTimeAsync(8000);
    expect(onUnhealthy).not.toHaveBeenCalled();
    expect(onRecovered).toHaveBeenCalledWith(2);
  });

  it('counts a ping that hangs as a failure', async () => {
    const onUnhealthy = vi.fn();
    const ping = vi.fn(() => new Promise(() => undefined));
    startDbWatchdog({ ping, intervalMs: 1000, maxFailures: 2, timeoutMs: 500, onUnhealthy });
    await vi.advanceTimersByTimeAsync(3000);
    expect(onUnhealthy).toHaveBeenCalledTimes(1);
    expect(String((onUnhealthy.mock.calls[0]![1] as Error).message)).toContain('timed out');
  });

  it('does nothing when disabled, and stop() ends checking', async () => {
    const ping = vi.fn().mockResolvedValue(1);
    startDbWatchdog({ ping, intervalMs: 1000, maxFailures: 0, onUnhealthy: vi.fn() });
    await vi.advanceTimersByTimeAsync(5000);
    expect(ping).not.toHaveBeenCalled();
    const w = startDbWatchdog({ ping, intervalMs: 1000, maxFailures: 3, onUnhealthy: vi.fn() });
    await vi.advanceTimersByTimeAsync(2000); w.stop();
    const n = ping.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(ping.mock.calls.length).toBe(n);
  });
});
