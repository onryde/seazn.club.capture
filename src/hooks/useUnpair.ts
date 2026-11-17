import { useCallback, useEffect, useRef } from 'react';
import type { EngineStatus } from '@/domain/mode/reopen';
import type { CaptureEnginePort } from '@/engine/CaptureEnginePort';
import { selectEngineStatus, selectStarting } from '@/hooks/engineSelectors';
import { usePorts } from '@/hooks/usePorts';
import type { Logger } from '@/services/logger';

/** CD26: an unpair native never answers is given up, so the engine is never locked for good. */
export const UNPAIR_GIVE_UP_MS = 5_000;

/**
 * Court stream Task 13 fix round 1 (the controller's ruling): native ignores an unpair while the operator's start is in
 * flight (`Pairings.unpair`), so a clearing waits for native's answer to it, then acts on what it finds. Native answers a
 * start within its HTTP bound (8 s, `Http.TIMEOUT_MS`), and at the latest at its bridge backstop (16 s,
 * `BridgeCore.ANSWER_BACKSTOP_MS`), as failed when the server does not; 17 s outlasts the backstop (fix round 2 m3, the
 * controller's ruling), and a wait past it is given up as an unanswered unpair is. The unpair then has its own 5 s.
 */
export const START_ANSWER_WAIT_MS = 17_000;

/** Why the engine is cleared: its code was forgotten, no saved code owns it, or another mode is opening (A7). */
export type UnpairCause = 'forget' | 'orphan' | 'otherMode';
/**
 * `held`: a broadcast is held (a remote Go live raced the unpair, and native ignored it): it stands. `gave-up`: native
 * did not answer within 5 s. `left`: the caller unmounted first, which ends its clearing with no record line.
 */
export type UnpairOutcome = 'idle' | 'held' | 'gave-up' | 'left';
type Done = (outcome: UnpairOutcome) => void;

/**
 * Whether a Forget or a court Leave keeps the code it was asked to drop: a broadcast is held (`held`), or the 5 s
 * bound gave up with the engine still not Idle. The clearing waits out the operator's start in flight (Task 13 fix
 * round 1), so a give-up now means native left the start or the unpair unanswered past its bound: the engine may yet
 * arm with its code, and the operator has one more tap to try again (P4 review I1). A caller that unmounted first (`left`) keeps it on the same terms: its
 * screen went with the unpair unanswered, and an engine still not Idle may be ignoring it (whole-branch review I2).
 */
export const codeStays = (outcome: UnpairOutcome, engine: CaptureEnginePort): boolean =>
  outcome === 'held' ||
  ((outcome === 'gave-up' || outcome === 'left') &&
    selectEngineStatus(engine.getSnapshot()) !== 'idle');

/**
 * The clearing under way on each engine, whoever started it (final fix round
 * 2, M-d). Forget and the reopen gate both clear; keyed by the engine, which
 * is built once with the ports, so a foreground during Forget's unanswered
 * unpair sends no second one, and a test's engine never meets another's.
 */
const underWay = new WeakMap<CaptureEnginePort, () => void>();

/** Whether a clearing is under way on this engine: its snapshot shows a pairing about to go (C4b-N1). */
export const clearingUnderWay = (engine: CaptureEnginePort): boolean => underWay.has(engine);

/**
 * Moves the engine to Idle without touching a broadcast, by native's own path
 * (`clearStep`): `unpair` while paired, `reset` once Ended, one intent per
 * snapshot (intents, not RPC; AGENTS §2). It never pairs. One clearing per
 * engine at a time: a call while one is under way, from any caller, is
 * dropped. Bounded at 5 s (CD26, P9). A caller that unmounts ends the clearing
 * it started, as `left` with no record line, and frees the engine.
 */
export function useUnpair(): (cause: UnpairCause, done?: Done) => void {
  const { engine, logger } = usePorts();
  const mine = useRef<(() => void) | null>(null);
  useEffect(() => () => mine.current?.(), []);
  return useCallback(
    (cause: UnpairCause, done?: Done) => {
      if (underWay.has(engine)) return;
      const finished = () => {
        underWay.delete(engine);
        mine.current = null;
      };
      const end = clear({ engine, logger }, cause, (outcome) => {
        finished();
        done?.(outcome);
      });
      if (end === null) return;
      underWay.set(engine, end);
      mine.current = end;
    },
    [engine, logger],
  );
}

/** The one intent that moves this engine toward Idle, or how the clearing ends. */
function clearStep(status: EngineStatus): 'unpair' | 'reset' | UnpairOutcome {
  if (status === 'paired') return 'unpair';
  if (status === 'stopped' || status === 'failed') return 'reset';
  return status === 'live' ? 'held' : 'idle';
}

/**
 * Each intent reconciled against the next snapshot, so a status already acted
 * on is never acted on again. While the operator's start is in flight nothing is
 * sent: the clearing waits for its answer (`START_ANSWER_WAIT_MS`), then unpairs a
 * failed one or answers `held` for one that armed. Returns how to end it early
 * (unmount), or null when it ended before returning: the fake answers synchronously.
 */
function clear(
  { engine, logger }: { engine: CaptureEnginePort; logger: Logger },
  cause: UnpairCause,
  onDone: Done,
): (() => void) | null {
  let acted: EngineStatus | null = null;
  let ended = false;
  let waiting = false;
  let unsubscribe: () => void = () => undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const end = (outcome: UnpairOutcome) => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    unsubscribe();
    onDone(outcome);
  };
  const giveUpIn = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      logger.warn('unpair.gave-up', { action: cause });
      end('gave-up');
    }, ms);
  };
  // Armed before the first step: `end` may run inside it (P9).
  giveUpIn(UNPAIR_GIVE_UP_MS);
  const step = () => {
    const snapshot = engine.getSnapshot();
    const status = selectEngineStatus(snapshot);
    // The start in flight: wait for its answer, on a bound of its own; the unpair, once sent, has its own 5 s.
    if (selectStarting(snapshot)) {
      if (!waiting) giveUpIn(START_ANSWER_WAIT_MS);
      waiting = true;
      // An unpair sent just before the start showed reached native while it was in flight and was ignored: once the
      // start is answered, the same status is asked again (fix round 2 m2).
      acted = null;
      return;
    }
    if (waiting) giveUpIn(UNPAIR_GIVE_UP_MS);
    waiting = false;
    if (status === acted) return;
    acted = status;
    const next = clearStep(status);
    if (next !== 'unpair' && next !== 'reset') return end(next);
    logger.info(`intent.${next}`, { action: cause });
    engine.send({ kind: next });
  };
  unsubscribe = engine.subscribe(step);
  step();
  return ended ? null : () => end('left');
}
