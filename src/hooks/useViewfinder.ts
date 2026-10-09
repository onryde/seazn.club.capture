import { useCallback, useMemo } from 'react';
import type { SessionState } from '@/domain/session/SessionState';
import { selectShedding } from '@/hooks/advisory';
import {
  selectAutomaticOn,
  selectDestination,
  selectPlaybackUrl,
  selectScheduledStartMs,
  selectStateKind,
  selectVenueZone,
} from '@/hooks/engineSelectors';
import { useEngineSilent } from '@/hooks/engineSilence';
import {
  blockerReason,
  selectBlocker,
  selectCameraReady,
  selectNetworkReachable,
  selectSoundReady,
  tallyPlateFor,
  type Blocker,
  type BlockerKey,
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
import { useFormatTime } from '@/hooks/useFormatTime';
import { usePorts } from '@/hooks/usePorts';

type Kind = SessionState['kind'];
export type ViewfinderAction = 'goLive' | 'stop' | 'none';

/** Everything the column shows, as a projection of native state (AGENTS §2). No state machine. */
export type Viewfinder = {
  readonly kind: Kind;
  readonly plate: TallyPlate;
  readonly statusKey: StatusKey;
  readonly holdRemaining: number | null;
  readonly holdWindow: number | null;
  readonly preflight: Preflight;
  /** Native's first failing check, in native's order (A11); held has no chip but blocks. */
  readonly blocker: Blocker | null;
  /** Why Go live is off, at the control (ruling I3); null with nothing blocking. */
  readonly reason: BlockerKey | null;
  readonly action: ViewfinderAction;
  /**
   * Stop ends the pairing too: the broadcast went live. Owner decision 1 (2026-10-05): a Stop before the first
   * frame (Arming, Armed, Connecting) ends the broadcast only, and the pairing stays Paired.
   */
  readonly stopUnpairs: boolean;
  readonly onAir: boolean;
  /** The camera picture shows, so Take photo is offered: Paired and on air (design follow-up §8, the owner's scope cut). */
  readonly shutter: boolean;
  /** A pairing is held, so Remote scoring is offered (spec §10, Q-C2): Paired and on air, before and during live. */
  readonly scoring: boolean;
  /** On air with a viewer picture to play (carry 13): the peek's one gate. */
  readonly peekable: boolean;
  /** The ladder shed (D2 §4.2): What viewers see is closed and disabled. */
  readonly shed: boolean;
  /**
   * "Starts {time}" in the venue's zone; null with no scheduled start. The
   * column shows it, and AUTO, only beside Go live (its one gate).
   */
  readonly startsAt: string | null;
  /** AUTO beside the chips (A4: on at both ends). */
  readonly auto: boolean;
  /** The pre-picked destination, uncut; the column cuts it for the line. Null with none. */
  readonly destination: string | null;
  start(): void;
  stop(): void;
};

/**
 * Which control the column offers in each state: Go live before air, Stop on
 * it, none after (an Ended leaves for Home, spec §5). Arming and Armed hold a
 * broadcast, so they offer Stop.
 */
/** The states that went live: the ones native reports with `sinceEpochMs`, which a Stop ends with the pairing. */
const LIVE: ReadonlySet<Kind> = new Set(['publishing', 'degraded', 'reconnecting']);

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
  ended: 'none',
};

/**
 * M7: memoised on its inputs, so a re-render that changes none of them hands
 * the column the same object and its React.memo parts skip (AGENTS §8). A
 * visit never pairs (amendment §2): Home does, so nothing here sends one.
 */
export function useViewfinder(): Viewfinder {
  const kind = useEngineSelector(selectStateKind);
  const preflight = usePreflight();
  const blocker = useEngineSelector(selectBlocker);
  const engineKey = useEngineSelector(selectStatusKey);
  const countdown = useHoldCountdown();
  const waiting = useWaitingFields();
  const intents = useIntents();
  const playable = useEngineSelector(selectPlaybackUrl) !== null;
  const shed = useEngineSelector(selectShedding);
  const engineSilent = useEngineSilent();
  return useMemo(
    () => ({
      ...project({ kind, preflight, blocker, engineKey, playable, shed, waiting, engineSilent }),
      ...countdown,
      ...intents,
    }),
    [
      kind,
      preflight,
      blocker,
      engineKey,
      playable,
      shed,
      waiting,
      engineSilent,
      countdown,
      intents,
    ],
  );
}

type ProjectInput = {
  readonly kind: Kind;
  readonly preflight: Preflight;
  readonly blocker: Blocker | null;
  readonly engineKey: StatusKey;
  readonly playable: boolean;
  readonly shed: boolean;
  readonly waiting: WaitingFields;
  /** CD17: no report for three seconds while native holds a pairing. */
  readonly engineSilent: boolean;
};

/**
 * The column's reading of native state. Pure: a projection, no state machine.
 * A silent engine reads TROUBLE with its own line (CD17, P2): TROUBLE is then
 * "broadcast degraded" or "engine silent", and the line tells them apart. A
 * display rule over the tables, applied last; native's state is untouched.
 */
function project(
  input: ProjectInput,
): Omit<Viewfinder, 'holdRemaining' | 'holdWindow' | 'start' | 'stop'> {
  const { kind, blocker, waiting, engineSilent } = input;
  const action = ACTION[kind];
  return {
    kind,
    plate: engineSilent ? 'trouble' : tallyPlateFor(kind, blocker === null),
    statusKey: engineSilent ? 'stream.status.engineSilent' : input.engineKey,
    preflight: input.preflight,
    blocker,
    reason: blockerReason(blocker),
    action,
    stopUnpairs: LIVE.has(kind),
    onAir: action === 'stop',
    shutter: kind === 'paired' || action === 'stop',
    scoring: kind === 'paired' || action === 'stop',
    peekable: action === 'stop' && input.playable,
    shed: input.shed,
    ...waiting,
  };
}

type WaitingFields = {
  readonly startsAt: string | null;
  readonly auto: boolean;
  readonly destination: string | null;
};

/**
 * Amendment §2, Viewfinder paired: "Starts {time}" in the venue's zone, AUTO,
 * and the destination. Primitives from the snapshot, formatted here, memoised
 * on them (M7): a 1 Hz tick that changes none of them changes nothing.
 */
function useWaitingFields(): WaitingFields {
  const startMs = useEngineSelector(selectScheduledStartMs);
  const zone = useEngineSelector(selectVenueZone);
  const auto = useEngineSelector(selectAutomaticOn);
  const destination = useEngineSelector(selectDestination);
  const formatTime = useFormatTime();
  return useMemo(
    () => ({
      startsAt: startMs === null ? null : formatTime(new Date(startMs), zone),
      auto,
      destination,
    }),
    [startMs, zone, auto, destination, formatTime],
  );
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
