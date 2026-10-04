import { useCallback, useMemo } from 'react';
import type { SessionState } from '@/domain/session/SessionState';
import { selectPlaybackUrl, selectStateKind } from '@/hooks/engineSelectors';
import {
  blockerReason,
  goLiveBlocker,
  selectCameraReady,
  selectNetworkReachable,
  selectSoundReady,
  tallyPlateFor,
  type BlockerKey,
  type Chip,
  type Preflight,
  type TallyPlate,
} from '@/hooks/preflight';
import {
  selectHoldRemaining,
  selectHoldWindow,
  selectStatusKey,
  type StatusKey,
} from '@/hooks/statusKey';
import { useEngine, useEngineSelector } from '@/hooks/useCaptureEngine';
import { usePorts } from '@/hooks/usePorts';

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
  readonly action: ViewfinderAction;
  readonly onAir: boolean;
  /** On air with a viewer picture to play (carry 13): the peek's one gate. */
  readonly peekable: boolean;
  start(): void;
  stop(): void;
};

/**
 * Which control the column offers in each state: Go live before air, Stop on
 * it, none after. Arming and Armed hold a broadcast, so they offer Stop.
 */
const ACTION: Readonly<Record<Kind, ViewfinderAction>> = {
  idle: 'goLive',
  pairing: 'goLive',
  paired: 'goLive',
  arming: 'stop',
  armed: 'stop',
  connecting: 'stop',
  publishing: 'stop',
  degraded: 'stop',
  reconnecting: 'stop',
  ended: 'ended',
};

/**
 * M7: memoised on its inputs, so a re-render that changes none of them hands
 * the column the same object and its React.memo parts skip (AGENTS §8). A
 * visit never pairs (amendment §2): Home does, so nothing here sends one.
 */
export function useViewfinder(): Viewfinder {
  const kind = useEngineSelector(selectStateKind);
  const preflight = usePreflight();
  const engineKey = useEngineSelector(selectStatusKey);
  const countdown = useHoldCountdown();
  const intents = useIntents();
  const playable = useEngineSelector(selectPlaybackUrl) !== null;
  return useMemo(
    () => ({ ...project({ kind, preflight, engineKey, playable }), ...countdown, ...intents }),
    [kind, preflight, engineKey, playable, countdown, intents],
  );
}

type ProjectInput = {
  readonly kind: Kind;
  readonly preflight: Preflight;
  readonly engineKey: StatusKey;
  readonly playable: boolean;
};

/** The column's reading of native state. Pure: a projection, no state machine. */
function project(
  input: ProjectInput,
): Omit<Viewfinder, 'holdRemaining' | 'holdWindow' | 'start' | 'stop'> {
  const { kind, preflight } = input;
  const blocker = goLiveBlocker(preflight);
  const action = ACTION[kind];
  return {
    kind,
    plate: tallyPlateFor(kind, blocker === null),
    statusKey: input.engineKey,
    preflight,
    blocker,
    reason: blockerReason(blocker),
    action,
    onAir: action === 'stop',
    peekable: action === 'stop' && input.playable,
  };
}

/** Spec §1's three chips, from native's verdict (A11). Memoised (M7). */
function usePreflight(): Preflight {
  const camera = useEngineSelector(selectCameraReady);
  const network = useEngineSelector(selectNetworkReachable);
  const sound = useEngineSelector(selectSoundReady);
  return useMemo(() => ({ camera, network, sound }), [camera, network, sound]);
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
