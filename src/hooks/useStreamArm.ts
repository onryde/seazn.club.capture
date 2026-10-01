import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { SavedCode } from '@/domain/mode/savedCode';
import { sessionFromSaved } from '@/domain/mode/savedSession';
import { selectStateKind } from '@/hooks/engineSelectors';
import { useEngine, useEngineSelector } from '@/hooks/useCaptureEngine';
import { usePorts } from '@/hooks/usePorts';

/**
 * Arms the engine with the saved stream code on entering the viewfinder
 * (spec §1). Once per visit and code. Ruling I1: a visit that finds native's
 * session (armed, on air or ended) adopts it as its arm, since the engine wins
 * at reopen; and once the visit has started to leave (`departed`), it never
 * arms, so the reset that clears a failed session is never followed by an arm
 * under Home. An engine that falls back to idle mid-visit is recovered by
 * leaving and Continue.
 */
export function useStreamArm(departed: () => boolean): { readonly unusable: boolean } {
  const { logger, hosts } = usePorts();
  const engine = useEngine();
  const saved = useSavedStream();
  // seaznHosts gives a build exactly one host; an empty list trusts nothing.
  const host = hosts[0] ?? '';
  const session = useMemo(
    () => (saved === null ? null : sessionFromSaved(saved, host)),
    [saved, host],
  );
  const kind = useEngineSelector(selectStateKind);
  const armedFor = useRef<string | null>(null);
  useEffect(() => {
    if (saved === null || session === null) return;
    if (armedFor.current === saved.raw || departed()) return;
    armedFor.current = saved.raw;
    if (kind !== 'idle') return;
    // Carry 6: the problem's name only, never the error or the code.
    if (!session.ok) return logger.warn('stream.unusable-code', { problem: session.error });
    const { value } = session;
    const heartbeat = { url: value.descriptor.heartbeatUrl, token: value.token };
    engine.send({ kind: 'arm', session: value, heartbeat });
    logger.info('intent.arm', { slot: value.slot });
  }, [saved, session, kind, engine, logger, departed]);
  return { unusable: session !== null && !session.ok };
}

/** The saved stream code, or null before the store has loaded and when none is saved. */
function useSavedStream(): SavedCode | null {
  const { modeStore } = usePorts();
  const store = useSyncExternalStore(modeStore.subscribe, modeStore.getSnapshot);
  return store.status === 'ready' ? (store.saved.codes.stream ?? null) : null;
}
