import { useCallback, useEffect, useRef, useState } from 'react';

/** Owner's call, 2026-09-12 (AGENTS §6): one length for Go live and Stop. */
export const HOLD_MS = 3000;

export type Hold = { readonly holding: boolean; pressIn(): void; pressOut(): void };

/**
 * A press held for HOLD_MS acts once. Release, disabling or unmounting before
 * then abandons it; a second press while one is running is ignored, so a
 * double press can never act twice. The hold does what was pressed: the
 * `onHeld` of the render the finger landed on.
 */
export function useHold(onHeld: () => void, enabled: boolean): Hold {
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
  useEffect(() => {
    if (!enabled) cancel();
  }, [enabled, cancel]);
  useEffect(() => cancel, [cancel]);
  return { holding, pressIn, pressOut: cancel };
}
