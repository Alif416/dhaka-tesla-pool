import { useEffect, useRef, useState } from 'react';

const POLL_INTERVAL_MS = 3000;

/**
 * Polls `fetchFn` every 3 seconds, scheduling the next call only after the previous one
 * finishes (never `setInterval`, so requests cannot overlap). Pauses while the tab is hidden
 * and refetches immediately when it becomes visible. Stops entirely when `enabled` is false.
 * A failed poll keeps the last good data and reports the error separately; it never blanks the
 * screen.
 * @param {() => Promise<unknown>} fetchFn
 * @param {{ enabled?: boolean }} [options]
 * @returns {{ data: unknown, error: Error | null, loading: boolean, refetch: () => void }}
 */
export function usePolling(fetchFn, { enabled = true } = {}) {
  const [data, setData] = useState(undefined);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const fetchFnRef = useRef(fetchFn);
  const timeoutRef = useRef(null);
  const abortRef = useRef(null);
  const refetchNowRef = useRef(() => {});

  // Keeps the ref pointing at the latest closure without mutating it during render.
  useEffect(() => {
    fetchFnRef.current = fetchFn;
  });

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let cancelled = false;

    async function runOnce() {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const result = await fetchFnRef.current(controller.signal);
        if (cancelled) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (cancelled || err.name === 'AbortError') return;
        setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    function scheduleNext() {
      timeoutRef.current = setTimeout(async () => {
        if (!document.hidden) {
          await runOnce();
        }
        scheduleNext();
      }, POLL_INTERVAL_MS);
    }

    function onVisibilityChange() {
      if (!document.hidden) {
        runOnce();
      }
    }

    refetchNowRef.current = () => {
      runOnce();
    };

    runOnce().then(scheduleNext);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      clearTimeout(timeoutRef.current);
      abortRef.current?.abort();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled]);

  return {
    data,
    error,
    loading: enabled ? loading : false,
    refetch: () => refetchNowRef.current(),
  };
}
