import { useCallback, useEffect, useRef } from 'react';
import type { EngineStatus } from '@/domain/mode/reopen';
import type { CaptureEnginePort } from '@/engine/CaptureEnginePort';
import { selectEngineStatus } from '@/hooks/engineSelectors';
import { usePorts } from '@/hooks/usePorts';
import type { Logger } from '@/services/logger';

/** CD26: an unpair native never answers is given up, so the engine is never locked for good. */
export const UNPAIR_GIVE_UP_MS = 5_000;

/** Why the engine is cleared: its code was forgotten, no saved code owns it, or another mode is opening (A7). */
export type UnpairCause = 'forget' | 'orphan' | 'otherMode';
/** `held`: a broadcast is held (a remote Go live raced the unpair, and native ignored it): it stands. */
export type UnpairOutcome = 'idle' | 'held' | 'gave-up';
type Done = (outcome: UnpairOutcome) => void;

/**
 * The clearing under way on each engine, whoever started it (final fix round
 * 2, M-d). Forget and the reopen gate both clear; keyed by the engine, which
 * is built once with the ports, so a foreground during Forget's unanswered
 * unpair sends no second one, and a test's engine never meets another's.
 */
const underWay = new WeakMap<CaptureEnginePort, () => void>();

/**
 * Moves the engine to Idle without touching a broadcast, by native's own path
 * (`clearStep`): `unpair` while paired, `reset` once Ended, one intent per
 * snapshot (intents, not RPC; AGENTS §2). It never pairs. One clearing per
 * engine at a time: a call while one is under way, from any caller, is
 * dropped. Bounded at 5 s (CD26, P9). A caller that unmounts ends the clearing
 * it started, as `gave-up` with no record line, and frees the engine.
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
 * on is never acted on again. Returns how to end it early (unmount), or null
 * when it ended before returning: the fake answers synchronously.
 */
function clear(
  { engine, logger }: { engine: CaptureEnginePort; logger: Logger },
  cause: UnpairCause,
  onDone: Done,
): (() => void) | null {
  let acted: EngineStatus | null = null;
  let ended = false;
  let unsubscribe: () => void = () => undefined;
  const end = (outcome: UnpairOutcome) => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    unsubscribe();
    onDone(outcome);
  };
  // Created before the first step: `end` may run inside it (P9).
  const timer = setTimeout(() => {
    logger.warn('unpair.gave-up', { action: cause });
    end('gave-up');
  }, UNPAIR_GIVE_UP_MS);
  const step = () => {
    const status = selectEngineStatus(engine.getSnapshot());
    if (status === acted) return;
    acted = status;
    const next = clearStep(status);
    if (next !== 'unpair' && next !== 'reset') return end(next);
    logger.info(`intent.${next}`, { action: cause });
    engine.send({ kind: next });
  };
  unsubscribe = engine.subscribe(step);
  step();
  return ended ? null : () => end('gave-up');
}
