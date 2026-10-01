import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePorts } from '@/hooks/usePorts';
import { useTurnCardShowing } from '@/hooks/useTurnCard';

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
 * the foreground (ruling M5) and while the turn card covers the stage (ruling
 * N4): nothing is left playing where the operator cannot see it.
 */
export function usePeek(available: boolean): Peek {
  const playable = available && !useTurnCardShowing();
  const [showing, setShowing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const cooling = useCooling(setMounted);
  const letGo = useCallback(() => {
    cooling.stop();
    setShowing(false);
    setMounted(false);
  }, [cooling]);
  const { pressIn, pressOut } = usePresses(playable, cooling, setShowing, setMounted);
  useLetGo(playable, letGo);
  // M7: the same object until a field changes, so the memoised stage and peek skip.
  return useMemo(
    () => ({ showing, mounted, pressIn, pressOut }),
    [showing, mounted, pressIn, pressOut],
  );
}

type SetFlag = (value: boolean) => void;

/** The finger landing opens the player at once; lifting starts the warm 30 s. */
function usePresses(playable: boolean, cooling: Cooling, setShowing: SetFlag, setMounted: SetFlag) {
  const pressIn = useCallback(() => {
    if (!playable) return;
    cooling.stop();
    setMounted(true);
    setShowing(true);
  }, [playable, cooling, setShowing, setMounted]);
  const pressOut = useCallback(() => {
    setShowing(false);
    cooling.start();
  }, [cooling, setShowing]);
  return { pressIn, pressOut };
}

/** Lets go the moment the peek cannot play, and whenever the app leaves (ruling M5). */
function useLetGo(playable: boolean, letGo: () => void): void {
  const { foreground } = usePorts();
  useEffect(() => {
    if (!playable) letGo();
  }, [playable, letGo]);
  useEffect(() => foreground.subscribeBackground(letGo), [foreground, letGo]);
}

type Cooling = { start(): void; stop(): void };

/**
 * The warm player's 30 s after a release, counted from the latest one. It
 * never outlives the hook (N3): React tears an owner down before its
 * children, so a control unmounting with it lets go into a hook already gone,
 * and that release must not start a timer nothing will clear.
 */
function useCooling(setMounted: (mounted: boolean) => void): Cooling {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(false);
  const stop = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const start = useCallback(() => {
    stop();
    if (!alive.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      setMounted(false);
    }, PEEK_WARM_MS);
  }, [stop, setMounted]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stop();
    };
  }, [stop]);
  return useMemo(() => ({ start, stop }), [start, stop]);
}
