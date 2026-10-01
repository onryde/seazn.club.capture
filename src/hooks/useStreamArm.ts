import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { visitArm } from '@/domain/mode/reopen';
import type { SavedCode } from '@/domain/mode/savedCode';
import { sessionFromSaved } from '@/domain/mode/savedSession';
import type { CaptureEnginePort } from '@/engine/CaptureEnginePort';
import { selectEngineStatus } from '@/hooks/engineSelectors';
import { useEngine } from '@/hooks/useCaptureEngine';
import { usePorts } from '@/hooks/usePorts';

/**
 * Arms the engine with the saved stream code on entering the viewfinder
 * (spec §1). Once per visit and code. Batch 8's I1: a visit that finds this
 * code's session (armed, on air or ended) adopts it as its arm, since the
 * engine wins at reopen; and once the visit has started to leave (`departed`),
 * it never arms, so the reset that clears a failed session is never followed
 * by an arm under Home. Batch 9's I1: another code's session is reset first
 * (`visitArm`). An engine that falls back to idle mid-visit is recovered by
 * leaving and Continue.
 */
export function useStreamArm(departed: () => boolean): { readonly unusable: boolean } {
  const { hosts } = usePorts();
  const saved = useSavedStream();
  // seaznHosts gives a build exactly one host; an empty list trusts nothing.
  const host = hosts[0] ?? '';
  const session = useMemo(
    () => (saved === null ? null : sessionFromSaved(saved, host)),
    [saved, host],
  );
  useArmOnce(saved, session, departed);
  return { unusable: session !== null && !session.ok };
}

type SavedSession = ReturnType<typeof sessionFromSaved>;

/** The one arm per visit and code, or the adoption of this code's session in its place. */
function useArmOnce(
  saved: SavedCode | null,
  session: SavedSession | null,
  departed: () => boolean,
): void {
  const { logger } = usePorts();
  const engine = useEngine();
  const armedFor = useRef<string | null>(null);
  useEffect(() => {
    if (saved === null || session === null) return;
    if (armedFor.current === saved.raw || departed()) return;
    armedFor.current = saved.raw;
    const plan = planFor(engine, saved);
    if (plan === 'adopt') return;
    if (plan === 'replace') engine.send({ kind: 'reset' });
    // Carry 6: the problem's name only, never the error or the code.
    if (!session.ok) return logger.warn('stream.unusable-code', { problem: session.error });
    const { value } = session;
    const heartbeat = { url: value.descriptor.heartbeatUrl, token: value.token };
    engine.send({ kind: 'arm', session: value, heartbeat });
    logger.info('intent.arm', { slot: value.slot });
  }, [saved, session, engine, logger, departed]);
}

/** Read at the visit's first decision, from one snapshot: whose session native holds. */
function planFor(engine: CaptureEnginePort, saved: SavedCode) {
  const snapshot = engine.getSnapshot();
  return visitArm({
    engine: selectEngineStatus(snapshot),
    engineSid: snapshot.descriptor?.sid ?? null,
    engineSlot: snapshot.slot,
    codeSid: saved.descriptor?.sid ?? null,
    codeSlot: saved.slot,
  });
}

/** The saved stream code, or null before the store has loaded and when none is saved. */
function useSavedStream(): SavedCode | null {
  const { modeStore } = usePorts();
  const store = useSyncExternalStore(modeStore.subscribe, modeStore.getSnapshot);
  return store.status === 'ready' ? (store.saved.codes.stream ?? null) : null;
}
