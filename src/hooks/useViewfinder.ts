import { useCallback, useMemo } from 'react';
import type { SessionState } from '@/domain/session/SessionState';
import {
  selectPlaybackUrl,
  selectStateKind,
  selectVenueZone,
  selectWarmingDeadlineMs,
} from '@/hooks/engineSelectors';
import {
  blockerReason,
  CODE_READS,
  codeCheck,
  goLiveBlocker,
  selectCameraReady,
  selectNetworkReachable,
  selectSoundReady,
  tallyPlateFor,
  type BlockerKey,
  type Chip,
  type CodeCheck,
  type Preflight,
  type TallyPlate,
} from '@/hooks/preflight';
import {
  selectHoldRemaining,
  selectHoldWindow,
  selectStatusKey,
  viewfinderStatusKey,
  type StatusKey,
} from '@/hooks/statusKey';
import { useEngine, useEngineSelector } from '@/hooks/useCaptureEngine';
import { useDeadlinePassed } from '@/hooks/useDeadlinePassed';
import { useFormatTime } from '@/hooks/useFormatTime';
import { usePorts } from '@/hooks/usePorts';
import { useStreamArm } from '@/hooks/useStreamArm';

type Kind = SessionState['kind'];
export type ViewfinderAction = 'goLive' | 'stop' | 'ended';

/** Everything the column shows, as a projection of native state (AGENTS §2). No state machine. */
export type Viewfinder = {
  readonly kind: Kind;
  readonly plate: TallyPlate;
  readonly statusKey: StatusKey;
  readonly holdRemaining: number | null;
  readonly holdWindow: number | null;
  readonly preflight: Preflight;
  readonly blocker: Chip | null;
  /** Why Go live is off, at the control (ruling I3); null with nothing blocking. */
  readonly reason: BlockerKey | null;
  readonly goLiveBy: string | null;
  readonly action: ViewfinderAction;
  readonly onAir: boolean;
  /** On air with a viewer picture to play (carry 13): the peek's one gate. */
  readonly peekable: boolean;
  start(): void;
  stop(): void;
};

/** Which control the column offers in each state: Go live before air, Stop on it, none after. */
const ACTION: Readonly<Record<Kind, ViewfinderAction>> = {
  idle: 'goLive',
  armed: 'goLive',
  connecting: 'stop',
  publishing: 'stop',
  degraded: 'stop',
  reconnecting: 'stop',
  ended: 'ended',
};

/**
 * `departed`: the visit has started to leave, so it never arms again (ruling
 * I1). M7: memoised on its inputs, so a re-render that changes none of them
 * hands the column the same object and its React.memo parts skip (AGENTS §8).
 */
export function useViewfinder(departed: () => boolean): Viewfinder {
  const { unusable } = useStreamArm(departed);
  const kind = useEngineSelector(selectStateKind);
  const checks = usePreflight(unusable);
  const engineKey = useEngineSelector(selectStatusKey);
  const countdown = useHoldCountdown();
  const intents = useIntents();
  const playable = useEngineSelector(selectPlaybackUrl) !== null;
  return useMemo(
    () => ({
      ...project({ kind, unusable, checks, engineKey, playable }),
      ...countdown,
      ...intents,
    }),
    [kind, unusable, checks, engineKey, playable, countdown, intents],
  );
}

type ProjectInput = {
  readonly kind: Kind;
  readonly unusable: boolean;
  readonly checks: PreflightView;
  readonly engineKey: StatusKey;
  readonly playable: boolean;
};

/** The column's reading of native state and the saved code. Pure: a projection, no state machine. */
function project(
  input: ProjectInput,
): Omit<Viewfinder, 'holdRemaining' | 'holdWindow' | 'start' | 'stop'> {
  const { kind, checks } = input;
  const blocker = goLiveBlocker(checks.preflight);
  const action = ACTION[kind];
  return {
    kind,
    plate: input.unusable && kind === 'idle' ? 'notReady' : tallyPlateFor(kind, blocker === null),
    statusKey: viewfinderStatusKey(input.engineKey, { kind, code: checks.code }),
    preflight: checks.preflight,
    blocker,
    reason: blockerReason(blocker, checks.code),
    goLiveBy: action === 'goLive' ? checks.goLiveBy : null,
    action,
    onAir: action === 'stop',
    peekable: action === 'stop' && input.playable,
  };
}

type PreflightView = {
  readonly preflight: Preflight;
  readonly code: CodeCheck;
  readonly goLiveBy: string | null;
};

/** Spec §1's four chips; the code chip is `CODE_READS`', as the status line is (R3). Memoised (M7). */
function usePreflight(unusable: boolean): PreflightView {
  const camera = useEngineSelector(selectCameraReady);
  const network = useEngineSelector(selectNetworkReachable);
  const sound = useEngineSelector(selectSoundReady);
  const deadlineMs = useEngineSelector(selectWarmingDeadlineMs);
  const zone = useEngineSelector(selectVenueZone);
  const passed = useDeadlinePassed(deadlineMs);
  const format = useFormatTime();
  const code = codeCheck({ unusable, deadlineKnown: deadlineMs !== null, passed });
  const chip = CODE_READS[code].chip;
  const goLiveBy = chip && deadlineMs !== null ? format(new Date(deadlineMs), zone) : null;
  return useMemo(
    () => ({ preflight: { code: chip, camera, network, sound }, code, goLiveBy }),
    [chip, camera, network, sound, code, goLiveBy],
  );
}

/** The reconnect hold's countdown, for the `holding*` lines; null otherwise. Memoised (M7). */
function useHoldCountdown() {
  const holdRemaining = useEngineSelector(selectHoldRemaining);
  const holdWindow = useEngineSelector(selectHoldWindow);
  return useMemo(() => ({ holdRemaining, holdWindow }), [holdRemaining, holdWindow]);
}

/** Intents, not RPC (AGENTS §2): they return nothing and are reconciled against native state. */
function useIntents() {
  const engine = useEngine();
  const { logger } = usePorts();
  const start = useCallback(() => {
    logger.info('intent.start');
    engine.send({ kind: 'start' });
  }, [engine, logger]);
  const stop = useCallback(() => {
    logger.info('intent.stop');
    engine.send({ kind: 'stop' });
  }, [engine, logger]);
  return useMemo(() => ({ start, stop }), [start, stop]);
}
