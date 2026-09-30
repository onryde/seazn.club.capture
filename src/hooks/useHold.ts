import { useCallback, useEffect, useRef, useState } from 'react';
import { usePorts } from '@/hooks/usePorts';
import { useTurnCardShowing } from '@/hooks/useTurnCard';

/** Owner's call, 2026-09-12 (AGENTS §6): one length for Go live and Stop. */
export const HOLD_MS = 3000;

export type Hold = { readonly holding: boolean; pressIn(): void; pressOut(): void };

/**
 * A press held for HOLD_MS acts once. Release, disabling, unmounting, the
 * turn card covering it or the app leaving the foreground before then
 * abandons it; a second press while one is running is ignored, so a double
 * press can never act twice. The hold does what was pressed: the `onHeld` of
 * the render the finger landed on.
 *
 * Leaving the foreground (a call, the lock, Home) cancels at once, in the
 * port's own callback (ruling M5): Android keeps JS timers paused while away,
 * so a pending hold would otherwise act on the return with no finger down.
 */
export function useHold(onHeld: () => void, enabledByOwner: boolean): Hold {
  // Ruling N4: under the turn card nothing acts, as if disabled.
  const enabled = enabledByOwner && !useTurnCardShowing();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [holding, setHolding] = useState(false);
  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  }, []);
  const pressIn = useCallback(() => {
    if (!enabled || timer.current !== null) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onHeld();
    }, HOLD_MS);
  }, [enabled, onHeld]);
  useAbandon(enabled, cancel);
  return { holding, pressIn, pressOut: cancel };
}

/** Abandons a hold once disabled, the moment the app leaves (M5), and on unmount. */
function useAbandon(enabled: boolean, cancel: () => void): void {
  const { foreground } = usePorts();
  useEffect(() => {
    if (!enabled) cancel();
  }, [enabled, cancel]);
  useEffect(() => foreground.subscribeBackground(cancel), [foreground, cancel]);
  useEffect(() => cancel, [cancel]);
}
