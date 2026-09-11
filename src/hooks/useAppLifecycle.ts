import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

export type LifecyclePhase = 'active' | 'inactive' | 'background';

export type Lifecycle = {
  readonly phase: LifecyclePhase;
  /** How long the last absence lasted, or null if there has not been one. */
  readonly lastAwayMs: number | null;
  /** How many times the app has left the foreground this session. */
  readonly absences: number;
};

/**
 * The two facts JavaScript owns about lifecycle: whether the app is on screen,
 * and how long it was away.
 *
 * Note what this type cannot express: anything shaped like a `SessionState`.
 * That is deliberate, and it is the guard against the trap here — building the
 * away-state machine in JS from `AppState`, running a `setInterval` countdown
 * of the hold window, and showing "ended" when it hits zero. That is the
 * obvious implementation, it demos perfectly against the fake, and it fails
 * three ways on hardware: on iOS the timer does not run while suspended, so
 * the operator returns after three minutes to "58s left"; on Android
 * backgrounding interrupts nothing, so it would show "holding" over a stream
 * that is publishing fine; and native's reconnect can succeed before JS
 * notices it left.
 *
 * So JS may report **how long you were away** — a fact it owns — and never
 * **how long is left**, a fact it does not. The hold countdown comes from
 * native's own `reconnecting` state, or it does not appear at all.
 *
 * iOS `inactive` (Control Centre, a banner, the app switcher) is NOT
 * backgrounding and does not open an absence. Treating it as one would fire a
 * false interruption every time a notification slid down.
 */
export function useAppLifecycle(): Lifecycle {
  const [phase, setPhase] = useState<LifecyclePhase>(() => normalise(AppState.currentState));
  const [lastAwayMs, setLastAwayMs] = useState<number | null>(null);
  const [absences, setAbsences] = useState(0);
  const leftAtMs = useRef<number | null>(null);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      const nextPhase = normalise(next);
      setPhase(nextPhase);

      if (nextPhase === 'background') {
        leftAtMs.current = Date.now();
        setAbsences((count) => count + 1);
        return;
      }

      if (nextPhase === 'active' && leftAtMs.current !== null) {
        setLastAwayMs(Date.now() - leftAtMs.current);
        leftAtMs.current = null;
      }
    });

    return () => subscription.remove();
  }, []);

  return { phase, lastAwayMs, absences };
}

function normalise(status: AppStateStatus | null): LifecyclePhase {
  if (status === 'active') return 'active';
  if (status === 'inactive') return 'inactive';
  return 'background';
}
