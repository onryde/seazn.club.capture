import { useEffect, useMemo, useState } from 'react';
import type { MatchPad } from '@/domain/scoring/scoringMatchView';
import type { SportTypes } from '@/domain/scoring/scoringSport';
import { undoWindowChangesAt, undoWindowLeft, withUndoWindow } from '@/domain/scoring/undoWindow';
import type { Ports } from '@/hooks/usePorts';

/**
 * The Undo window of a decided match (owner, 2026-11-03), for any sport's pad: 45 s from the moment this phone's own tap
 * decided it, with the seconds counted on the result card. Where the window starts is not this hook's to say: the
 * reducer dates the dispatched tap that decides the match (`scoringMatchWindow.ts`) and the hub keeps it between screens,
 * so it arrives with the pad as `decidedAt`, and a rescan, a restart or a ledger read that lands late never starts one.
 * The rule is pure (`undoWindow.ts`); this hook owns the phone's clock and one timer, and applies the window to the pad.
 *
 * The timer is set for the moment the card next changes (`undoWindowChangesAt`), counted from the tap and not from when
 * this screen drew it, so every digit changes on the tap's own second and the last change is the close itself, to the
 * millisecond. Only one is ever pending, only while the card counts, and it is cleared when the window closes, when Undo
 * reopens the match and when the screen goes. A press of Undo is checked against the clock again by the reducer
 * (`undoRunOut`), so it cannot land after the 45 s however late this timer or the screen is.
 */
export function useUndoWindow<S extends SportTypes>(
  ports: Ports,
  pad: MatchPad<S> | null,
): MatchPad<S> | null {
  const { clock } = ports;
  const openedAt = pad?.decidedAt ?? null;
  // The clock is read by every render, so what the card says is always the clock's, however long since the last timer.
  const left = undoWindowLeft(openedAt, clock().getTime());
  const windowed = useMemo(() => withWindow(pad, left), [pad, left]);
  useNextChange(counting(windowed), openedAt, clock);
  return windowed;
}

/** Whether the card is counting down an open Undo. */
const counting = <S extends SportTypes>(pad: MatchPad<S> | null): boolean => {
  const card = pad?.view.card;
  return card?.kind === 'resultRecorded' && card.undoLeft !== null;
};

/** The pad with the window applied; the same pad when it has none to apply. */
function withWindow<S extends SportTypes>(
  pad: MatchPad<S> | null,
  left: number | null,
): MatchPad<S> | null {
  if (pad === null) return null;
  const view = withUndoWindow(pad.view, left);
  return view === pad.view ? pad : { ...pad, view };
}

/**
 * Renders again when the card next changes, while it counts; no timer is set otherwise. Each firing is a render, which
 * sets the next timer: one is pending at a time. A timer that fires a hair early renders the same second and sets the rest.
 */
function useNextChange(running: boolean, openedAt: number | null, clock: Ports['clock']): void {
  const [fired, setFired] = useState(0);
  useEffect(() => {
    if (!running) return;
    const current = clock().getTime();
    const at = undoWindowChangesAt(openedAt, current);
    const timer = setTimeout(
      () => setFired((count) => count + 1),
      at === null ? 0 : Math.max(0, at - current),
    );
    return () => clearTimeout(timer);
  }, [running, openedAt, fired, clock]);
}
