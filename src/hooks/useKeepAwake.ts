import { useEffect } from 'react';
import { selectStateKind } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { holdScreenOn } from '@/hooks/keepAwake';
import { usePorts } from '@/hooks/usePorts';

const TAG = 'seazn-capture-session';

/**
 * Holds the screen on for the length of a session.
 *
 * Derived from session state, never toggled on lifecycle transitions. That is
 * the point: there are no activate-on-foreground / deactivate-on-background
 * pairs to get wrong on a resume path, and the idle-timer override only applies
 * to the visible foreground window anyway, so the transitions need no handling.
 *
 * Off in `idle` and `ended` rather than always on: an operator who taps Stop at
 * four percent should not carry a lit screen home. "Keep-awake is off after
 * Stop" is also an assertion; "always on" is a hope.
 *
 * What it does NOT do, and no copy may promise otherwise: it defeats the idle
 * timer only. The side button, an incoming call and the app switcher all still
 * interrupt capture. Unverifiable without a device: whether the override
 * survives iOS Low Power Mode, or OEM battery savers on Android.
 *
 * The hold itself, its dynamic import and its warning when refused are
 * `holdScreenOn`'s, shared with the scoring pad's `useScreenAwake`.
 */
export function useKeepAwake(): void {
  const stateKind = useEngineSelector(selectStateKind);
  const shouldStayAwake = stateKind !== 'idle' && stateKind !== 'ended';
  const { logger } = usePorts();
  useEffect(
    () => (shouldStayAwake ? holdScreenOn(TAG, 'stream', logger) : undefined),
    [shouldStayAwake, logger],
  );
}
