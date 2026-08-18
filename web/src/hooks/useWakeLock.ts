import { useEffect } from 'react';

/**
 * Keeps the screen awake while a round is live.
 *
 * The screen sleeping between shots is the single most annoying thing about
 * using a phone as a scorecard — you unlock it on every green. The Screen Wake
 * Lock API covers Safari 16.4+ and Chrome; where it's missing this quietly does
 * nothing.
 *
 * The lock is released by the browser whenever the page is hidden, so it has to
 * be re-acquired on visibility change.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (!('wakeLock' in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const request = async () => {
      try {
        sentinel = await navigator.wakeLock.request('screen');
      } catch {
        // Denied (low battery, background tab). Not worth surfacing — the app
        // works fine, the screen just sleeps normally.
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !cancelled) void request();
    };

    void request();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void sentinel?.release().catch(() => undefined);
    };
  }, [active]);
}
