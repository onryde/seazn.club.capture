import { useCallback, useEffect, useRef } from 'react';
import { replaceStep, type EngineStatus } from '@/domain/mode/reopen';
import type { CaptureEnginePort } from '@/engine/CaptureEnginePort';
import { selectEngineStatus } from '@/hooks/engineSelectors';
import { usePorts } from '@/hooks/usePorts';
import type { Logger } from '@/services/logger';

/** Why a session is cleared: its code was forgotten, or no saved code owns it. */
export type DisarmCause = 'forget' | 'orphan';

/**
 * I1 (final review, owner-visible): clears a session that no saved code owns,
 * by native's own path (N1, `replaceStep`): an armed session is stopped, and
 * reset once native reports it Ended; an ended one is reset. It never arms and
 * never touches a broadcast. One clearing at a time: a call while one is under
 * way is dropped. It stops listening on unmount.
 */
export function useDisarm(): (cause: DisarmCause) => void {
  const { engine, logger } = usePorts();
  const underWay = useRef<(() => void) | null>(null);
  useEffect(() => () => underWay.current?.(), []);
  return useCallback(
    (cause: DisarmCause) => {
      if (underWay.current !== null) return;
      const done = () => {
        underWay.current = null;
      };
      underWay.current = clearSession({ engine, logger }, cause, done);
    },
    [engine, logger],
  );
}

/**
 * One intent per engine status, each reconciled against the next snapshot
 * (intents, not RPC; AGENTS §2), so a status already acted on is never acted
 * on again. It ends at idle or on air. Returns how to stop listening early,
 * or null when it ended before returning: the fake answers synchronously.
 */
function clearSession(
  { engine, logger }: { engine: CaptureEnginePort; logger: Logger },
  cause: DisarmCause,
  onDone: () => void,
): (() => void) | null {
  let acted: EngineStatus | null = null;
  let ended = false;
  let unsubscribe: () => void = () => undefined;
  const end = () => {
    ended = true;
    unsubscribe();
    onDone();
  };
  const step = () => {
    const status = selectEngineStatus(engine.getSnapshot());
    if (status === acted) return;
    acted = status;
    const next = replaceStep(status);
    if (next !== 'stop' && next !== 'reset') return end();
    logger.info(`intent.${next}`, { action: cause });
    engine.send({ kind: next });
  };
  unsubscribe = engine.subscribe(step);
  step();
  return ended ? null : end;
}
