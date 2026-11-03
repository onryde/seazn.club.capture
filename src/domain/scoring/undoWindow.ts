import type { PadView } from '@/domain/scoring/padView';

/**
 * How long Undo stays open on a decided match (owner, 2026-11-03: "go"): 30 s from the moment this phone's own tap
 * decided it. The end of a game is not this: Undo has no limit there. Sport-agnostic, like the card.
 *
 * Pure: the clock is the caller's. Time comes in as milliseconds on the phone's clock. The window's start is the
 * reducer's (`scoringMatchWindow.ts`: the dispatched tap that decides the match) and the hub's to keep in memory, so it
 * survives the screen but not a restart: after a restart, a leave or a Dismiss a decided match shows no Undo at all.
 */
export const UNDO_WINDOW_MS = 30_000;
export const UNDO_WINDOW_SECONDS = UNDO_WINDOW_MS / 1000;

/**
 * The whole seconds of Undo left, 30 down to 1, rounded up; null once the window is closed, and when it never opened.
 * A clock set back before the start gives 30, never more.
 */
export function undoWindowLeft(openedAt: number | null, now: number): number | null {
  if (openedAt === null) return null;
  const gone = Math.max(0, now - openedAt);
  return gone >= UNDO_WINDOW_MS ? null : Math.ceil((UNDO_WINDOW_MS - gone) / 1000);
}

/**
 * The moment on the phone's clock when the seconds `undoWindowLeft` gives next change, which for the last second is the
 * close itself: a timer set for it fires when the card is due to change, never a tick late. Null when there is no
 * window or it is closed.
 */
export function undoWindowChangesAt(openedAt: number | null, now: number): number | null {
  const left = undoWindowLeft(openedAt, now);
  return openedAt === null || left === null ? null : openedAt + UNDO_WINDOW_MS - (left - 1) * 1000;
}

/**
 * The pad with the window applied: under a recorded result, `left` seconds on its card and Undo kept while it is open;
 * with it closed, or Undo not on (a result that is not this phone's to take back), the card closed and Undo off. Any
 * other pad is returned as it is.
 */
export function withUndoWindow<K extends string>(
  view: PadView<K>,
  left: number | null,
): PadView<K> {
  const { card, lastTap } = view;
  if (card?.kind !== 'resultRecorded') return view;
  const open = left !== null && lastTap?.undo === true;
  return {
    ...view,
    card: { kind: 'resultRecorded', undoLeft: open ? left : null },
    lastTap: lastTap === null || open ? lastTap : { ...lastTap, undo: false },
  };
}
