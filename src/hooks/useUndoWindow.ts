import { useEffect, useMemo, useState } from 'react';
import type { PadStateCard } from '@/domain/scoring/padView';
import type { MatchPad } from '@/domain/scoring/scoringMatchView';
import type { SportTypes } from '@/domain/scoring/scoringSport';
import {
  advanceUndoWindow,
  undoWindowLeft,
  withUndoWindow,
  type UndoWindowSeen,
} from '@/domain/scoring/undoWindow';
import type { Ports } from '@/hooks/usePorts';

/**
 * The Undo window of a decided match (owner, 2026-11-03), for any sport's pad: 30 s from the moment this phone first shows
 * the result its own tap made, with the seconds counted on the result card. The rule is pure (`undoWindow.ts`); this hook
 * owns what is not: the phone's clock, the one timer, and where the window's start is kept.
 *
 * The start is held in memory per launch (the `Ports`) and per match, not by the screen: going Home and back within the
 * 30 s keeps the same window. It is not persisted, on purpose: after a restart a decided match shows no Undo at all, and
 * the window never reopens and never restarts. The timer ticks once a second only while the card is counting, and is
 * cleared when the window closes, when Undo reopens the match, and when the screen goes.
 */
const TICK_MS = 1000;

/** Where each launch keeps its windows' starts: the phone's clock when a match's window opened. */
const launches = new WeakMap<Ports, Map<string, number>>();

function startsOf(ports: Ports): Map<string, number> {
  const found = launches.get(ports);
  if (found !== undefined) return found;
  const made = new Map<string, number>();
  launches.set(ports, made);
  return made;
}

/** What a screen has seen of a match, when it opens: nothing, and the start this launch kept for it, if any. */
const unseen = (ports: Ports, fixtureId: string): UndoWindowSeen => ({
  phase: 'none',
  openedAt: startsOf(ports).get(fixtureId) ?? null,
});

/** Whether the card is counting down an open Undo. */
const counting = (card: PadStateCard | null | undefined): boolean =>
  card?.kind === 'resultRecorded' && card.undoLeft !== null;

type Held = { readonly fixtureId: string; readonly seen: UndoWindowSeen };

export function useUndoWindow<S extends SportTypes>(
  ports: Ports,
  fixtureId: string,
  pad: MatchPad<S> | null,
): MatchPad<S> | null {
  const { clock } = ports;
  const [held, setHeld] = useState<Held>(() => ({ fixtureId, seen: unseen(ports, fixtureId) }));
  const seen = held.fixtureId === fixtureId ? held.seen : unseen(ports, fixtureId);
  const advanced = pad === null ? seen : advanceUndoWindow(seen, pad.view, clock().getTime());
  // Adjusted while rendering, so the first frame of a decided match already says 30 and shows Undo. Another match's
  // `unseen` is a new object, so a screen told another match is held again by this alone.
  if (advanced !== held.seen) setHeld({ fixtureId, seen: advanced });
  const { openedAt } = advanced;
  useKeptStart(ports, fixtureId, openedAt);
  const [now, setNow] = useState(() => clock().getTime());
  const left = undoWindowLeft(openedAt, now);
  const windowed = useMemo(() => withWindow(pad, left), [pad, left]);
  useTicks(counting(windowed?.view.card), clock, setNow);
  return windowed;
}

/** The pad with the window applied; the same pad when it has none to apply. */
function withWindow<S extends SportTypes>(
  pad: MatchPad<S> | null,
  left: number | null,
): MatchPad<S> | null {
  if (pad === null) return null;
  const view = withUndoWindow(pad.view, left);
  return view === pad.view ? pad : { ...pad, view };
}

/** Keeps the window's start for the launch, so a screen that comes back finds it. */
function useKeptStart(ports: Ports, fixtureId: string, openedAt: number | null): void {
  useEffect(() => {
    if (openedAt !== null) startsOf(ports).set(fixtureId, openedAt);
  }, [ports, fixtureId, openedAt]);
}

/** Reads the phone's clock once a second while `running`, and once as it starts; nothing runs otherwise. */
function useTicks(running: boolean, clock: Ports['clock'], setNow: (now: number) => void): void {
  useEffect(() => {
    if (!running) return;
    setNow(clock().getTime());
    const timer = setInterval(() => setNow(clock().getTime()), TICK_MS);
    return () => clearInterval(timer);
  }, [running, clock, setNow]);
}
