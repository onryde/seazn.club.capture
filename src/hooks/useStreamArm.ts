import { useEffect, useMemo, useRef, useState } from 'react';
import { savedCodeName } from '@/domain/mode/codeName';
import {
  replaceStep,
  stillReplacing,
  visitArm,
  type EngineStatus,
  type ReplaceStep,
  type VisitArm,
} from '@/domain/mode/reopen';
import type { SavedCode } from '@/domain/mode/savedCode';
import { sessionFromSaved } from '@/domain/mode/savedSession';
import type { CaptureEnginePort, EngineSnapshot } from '@/engine/CaptureEnginePort';
import { selectEngineStatus } from '@/hooks/engineSelectors';
import { useEngine, useEngineSelector } from '@/hooks/useCaptureEngine';
import { usePorts } from '@/hooks/usePorts';
import { useOwnSession, useSavedStream } from '@/hooks/useSavedStream';
import type { Logger } from '@/services/logger';

export type StreamArm = {
  readonly unusable: boolean;
  /** N3: on the way from another code's session to this one's arm (`stillReplacing`). */
  readonly replacing: boolean;
};

/**
 * Arms the engine with the saved stream code on entering the viewfinder
 * (spec §1). Once per visit and code. Batch 8's I1: a visit that finds this
 * code's session (armed, on air or ended) adopts it as its arm, since the
 * engine wins at reopen; and once the visit has started to leave (`departed`),
 * it sends nothing more, so no arm follows the leave under Home. Batch 9's I1:
 * another code's session is replaced first (`visitArm`), by native's own path
 * (N1, `replaceStep`). An engine that falls back to idle mid-visit is
 * recovered by leaving and Continue.
 */
export function useStreamArm(departed: () => boolean): StreamArm {
  const { hosts } = usePorts();
  const saved = useSavedStream();
  // seaznHosts gives a build exactly one host; an empty list trusts nothing.
  const host = hosts[0] ?? '';
  const session = useMemo(
    () => (saved === null ? null : sessionFromSaved(saved, host)),
    [saved, host],
  );
  const visit = useVisit(saved);
  const status = useEngineSelector(selectEngineStatus);
  useReconcile(visit, session, status, departed);
  const own = useOwnSession(saved);
  const unusable = session !== null && !session.ok;
  const plan = visit?.plan ?? 'arm';
  return { unusable, replacing: stillReplacing({ plan, own, unusable, engine: status }) };
}

type SavedSession = ReturnType<typeof sessionFromSaved>;
type Visit = { readonly raw: string; readonly plan: VisitArm };

/**
 * The visit's decision, made once per code from the snapshot at its first
 * render (React's "adjusting state while rendering"), so the first frame of a
 * replacing visit already reads not ready (N3), never the session it replaces.
 */
function useVisit(saved: SavedCode | null): Visit | null {
  const engine = useEngine();
  const [visit, setVisit] = useState<Visit | null>(null);
  if (saved === null) return null;
  if (visit?.raw === saved.raw) return visit;
  const decided = { raw: saved.raw, plan: planFor(engine.getSnapshot(), saved) };
  setVisit(decided);
  return decided;
}

/** Whose session native holds, against this code (I1, C7, N2). */
function planFor(snapshot: EngineSnapshot, saved: SavedCode): VisitArm {
  return visitArm({
    engine: selectEngineStatus(snapshot),
    held: {
      sid: snapshot.descriptor?.sid ?? null,
      slot: snapshot.slot,
      tokenTag: snapshot.tokenTag,
    },
    code: savedCodeName(saved),
  });
}

type Progress = { readonly raw: string; acted: EngineStatus | null; done: boolean };

/**
 * One intent per engine status, reconciled against the next snapshot
 * (intents, not RPC; AGENTS §2): stop an armed session, reset an ended one,
 * arm at idle (`replaceStep`). An adopted session needs none. A status
 * already acted on is not acted on again, so an intent native ignores is
 * never repeated, and once the arm is sent the visit sends nothing more.
 */
function useReconcile(
  visit: Visit | null,
  session: SavedSession | null,
  status: EngineStatus,
  departed: () => boolean,
): void {
  const { logger } = usePorts();
  const engine = useEngine();
  const progress = useRef<Progress | null>(null);
  useEffect(() => {
    if (visit === null || session === null || departed()) return;
    if (progress.current?.raw !== visit.raw) {
      progress.current = { raw: visit.raw, acted: null, done: visit.plan === 'adopt' };
    }
    const step = progress.current;
    if (step.done || step.acted === status) return;
    step.acted = status;
    sendStep(replaceStep(status), step, session, { engine, logger });
  }, [visit, session, status, engine, logger, departed]);
}

/** The step's one intent; the arm, or the unusable code's record, ends the visit's sending. */
function sendStep(
  next: ReplaceStep,
  progress: Progress,
  session: SavedSession,
  { engine, logger }: { engine: CaptureEnginePort; logger: Logger },
): void {
  if (next === 'stop' || next === 'reset') {
    logger.info('intent.replace', { step: next });
    return engine.send({ kind: next });
  }
  if (next !== 'arm') return;
  progress.done = true;
  // Carry 6: the problem's name only, never the error or the code.
  if (!session.ok) return logger.warn('stream.unusable-code', { problem: session.error });
  const { value } = session;
  const heartbeat = { url: value.descriptor.heartbeatUrl, token: value.token };
  engine.send({ kind: 'arm', session: value, heartbeat });
  logger.info('intent.arm', { slot: value.slot });
}
