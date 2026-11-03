/**
 * The screen's hold as a routed test reads it. A test file replaces `holdScreenOn` (`@/hooks/keepAwake`) with a function
 * that pushes `'hold'` when a screen takes the hold and `'let'` when it lets it go, into a log from `vi.hoisted`. What
 * the phone's native module does with a hold is `keepAwake.test.ts`'s; here it is which screens hold it. (The module
 * itself is not mocked: vitest hands a second import() of a mocked module, made while the first is in flight, the real
 * module, and a release and a hold in one commit make two.)
 */
export type HoldLog = ('hold' | 'let')[];

/** The `holdScreenOn` stand-in for a log: records the hold, and the release it returns. */
export const recordingHold =
  (log: HoldLog) =>
  (_tag: string): (() => void) => {
    log.push('hold');
    return () => {
      log.push('let');
    };
  };

/** Whether the screen is held now: more holds than releases. A screen that changes under the scorer lets go and holds again. */
export const screenIsHeld = (log: HoldLog): boolean =>
  log.filter((what) => what === 'hold').length > log.filter((what) => what === 'let').length;
