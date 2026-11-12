import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { PadSide } from '@/domain/scoring/padView';
import { heldTapOf } from '@/domain/scoring/syncHold';
import {
  pointChips,
  withPointKind,
  type TennisPointKind,
} from '@/domain/scoring/tennisPointDetails';
import type { TennisDisplay } from '@/domain/scoring/tennisTypes';
import type { RunnerSnapshot, ScoringRunner } from '@/hooks/scoringRunner';
import type { Ports } from '@/hooks/usePorts';
import { readPointDetails, savePointDetails } from '@/services/tennisPointDetailsStore';

/**
 * A tennis match's point details (S2-7 ruling 234, the owner's): the per-match "Point details" switch, off by default and
 * kept in the key-value store, and the chips of the point held for them. The rules are the domain's (`pointChips`,
 * `withPointKind`, the queue's `heldTapOf`); the hold's time is the runner's clock, the steady clock, and this hook owns
 * the one timer that hides the chips when the hold runs out. A chip amends the held point (the reducer's `amend`), which
 * sends it at once; turning the switch off lets a held point go.
 */
export type TennisPointDetails = {
  /** The switch, as kept for the match (off until read, and whenever it cannot be read). */
  readonly on: boolean;
  readonly toggle: () => void;
  /** The chips of the point held now, or none: nothing held, the hold run out, or a chip already tapped. */
  readonly chips: readonly TennisPointKind[] | null;
  /** A point the match took, made on `display` (the view before it): its chips, when the switch is on. */
  readonly pointed: (side: PadSide, display: TennisDisplay) => void;
  /** A chip tapped: the held point is tagged with it and sent. Too late (the point has gone) changes nothing, and says so in the record. */
  readonly chip: (kind: TennisPointKind) => void;
};

export function useTennisPointDetails(
  ports: Ports,
  runner: ScoringRunner | null,
): TennisPointDetails {
  const { on, toggle } = useSwitch(ports, runner);
  const [made, setMade] = useState<readonly TennisPointKind[] | null>(null);
  const held = useHeldTap(ports, runner);
  // Only a point made with the switch on is held, so a point's chips show only then (`chips` below).
  const pointed = useCallback(
    (side: PadSide, display: TennisDisplay) => setMade(pointChips(display.serving, side)),
    [],
  );
  const chip = useCallback(
    (kind: TennisPointKind) => {
      const tap = runner === null ? null : heldIn(runner.snapshot(), ports.steadyClock.nowMs());
      const outcome =
        runner === null || tap === null
          ? null
          : runner.dispatch({
              kind: 'amend',
              key: tap.key,
              payload: withPointKind(tap.payload, kind),
            });
      if (outcome?.ok !== true) ports.logger.warn('scoring.point-detail-dropped', { kind });
    },
    [runner, ports],
  );
  const chips = held ? made : null;
  return useMemo(() => ({ on, toggle, chips, pointed, chip }), [on, toggle, chips, pointed, chip]);
}

/**
 * The switch: read once the match's runner is there, written on each toggle. A read that lands after the scorer has
 * toggled is late news and is dropped. Turned off, a point held for its chips is let go at once (`release`).
 */
function useSwitch(ports: Ports, runner: ScoringRunner | null) {
  const [on, setOn] = useState(false);
  const touched = useRef(false);
  const fixtureId = runner?.fixtureId ?? null;
  const { kv, logger } = ports;
  useEffect(() => {
    if (fixtureId === null) return;
    let live = true;
    void readPointDetails(kv, fixtureId).then((kept) => {
      if (live && !touched.current) setOn(kept);
    });
    return () => {
      live = false;
    };
  }, [kv, fixtureId]);
  const toggle = useCallback(() => {
    if (fixtureId === null) return;
    touched.current = true;
    const next = !on;
    setOn(next);
    savePointDetails(kv, fixtureId, next).catch(() =>
      logger.warn('scoring.point-details-not-saved'),
    );
    if (!next) runner?.dispatch({ kind: 'release' });
  }, [on, kv, logger, fixtureId, runner]);
  return { on, toggle };
}

const noSubscribe = (): (() => void) => () => undefined;
const LOADING: RunnerSnapshot = { kind: 'loading' };
const loading = (): RunnerSnapshot => LOADING;

/** The held, unsent tap in a runner's snapshot at `now`, or null. */
function heldIn(snapshot: RunnerSnapshot, now: number) {
  return snapshot.kind === 'ready' ? heldTapOf(snapshot.state.sync, now) : null;
}

/**
 * Whether a tap is held now, on the runner's clock: read on every snapshot, and once more when the hold runs out (the one
 * timer), so the chips go with the hold even when nothing else moves (offline, the send waits).
 */
function useHeldTap(ports: Ports, runner: ScoringRunner | null): boolean {
  const snapshot = useSyncExternalStore(
    runner?.subscribe ?? noSubscribe,
    runner?.snapshot ?? loading,
  );
  const { steadyClock } = ports;
  const [, setRanOut] = useState(0);
  const until = heldIn(snapshot, steadyClock.nowMs())?.holdUntil ?? null;
  useEffect(() => {
    if (until === null) return;
    const timer = setTimeout(
      () => setRanOut((count) => count + 1),
      Math.max(0, until - steadyClock.nowMs()),
    );
    return () => clearTimeout(timer);
  }, [until, steadyClock]);
  return until !== null;
}
