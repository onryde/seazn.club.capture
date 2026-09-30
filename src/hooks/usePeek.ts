import { useCallback, useEffect, useRef, useState } from 'react';
import { usePorts } from '@/hooks/usePorts';

/** Spec §4: the player stays warm this long after release. */
export const PEEK_WARM_MS = 30_000;

export type Peek = {
  readonly showing: boolean;
  /** The player exists: showing, or cooling down. */
  readonly mounted: boolean;
  pressIn(): void;
  pressOut(): void;
};

/**
 * The hold here IS the feature (AGENTS §6): it answers the instant the finger
 * lands and stops a billed preview running unattended. No confirmation delay.
 * Off air (`available` false) a press does nothing, and a peek already open is
 * let go at once, warm player and all. The same happens when the app leaves
 * the foreground (ruling M5): nothing is left frozen over the camera on return.
 */
export function usePeek(available: boolean): Peek {
  const { foreground } = usePorts();
  const [showing, setShowing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const cooling = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopCooling = useCallback(() => {
    if (cooling.current !== null) clearTimeout(cooling.current);
    cooling.current = null;
  }, []);
  const letGo = useCallback(() => {
    stopCooling();
    setShowing(false);
    setMounted(false);
  }, [stopCooling]);
  const pressIn = useCallback(() => {
    if (!available) return;
    stopCooling();
    setMounted(true);
    setShowing(true);
  }, [available, stopCooling]);
  const pressOut = useCallback(() => {
    setShowing(false);
    stopCooling();
    cooling.current = setTimeout(() => {
      cooling.current = null;
      setMounted(false);
    }, PEEK_WARM_MS);
  }, [stopCooling]);
  useEffect(() => {
    if (!available) letGo();
  }, [available, letGo]);
  useEffect(() => foreground.subscribeBackground(letGo), [foreground, letGo]);
  useEffect(() => stopCooling, [stopCooling]);
  return { showing, mounted, pressIn, pressOut };
}
