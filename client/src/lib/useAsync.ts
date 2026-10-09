import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from './api';

/** Loads data on mount and whenever `deps` change; `reload` refetches without clearing what is on screen. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const d = await fnRef.current();
      if (mine === seq.current) { setData(d); setError(null); }
    } catch (e) {
      if (mine === seq.current) setError(errorMessage(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setLoading(true); void reload(); }, deps);
  return { data, error, loading, reload, setData };
}
