import type { PadStateCard, PadView } from '@/domain/scoring/padView';

/**
 * How long Undo stays open on a decided match (owner, 2026-11-03: "go"): 30 s from the moment this phone first shows
 * the result its own tap made. The end of a game is not this: Undo has no limit there. Sport-agnostic, like the card.
 *
 * Pure: the clock is the caller's. Time comes in as milliseconds on the phone's clock, and the window's start is held
 * by the caller, in memory (`useUndoWindow`), so it survives the screen but not a restart: after a restart a decided
 * match shows no Undo at all, and the window never reopens.
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
 * What a screen has seen of a match, for the window: `none` before any pad (a restart, a screen opened late), `playing`
 * while the match is open, `decided` under a recorded result. `openedAt` is the phone's clock when the window opened.
 */
export type UndoWindowSeen = {
  readonly phase: 'none' | 'playing' | 'decided';
  readonly openedAt: number | null;
};

/** The facts of a pad the window reads. */
type UndoFacts = {
  readonly card: PadStateCard | null;
  readonly lastTap: { readonly undo: boolean } | null;
};

/**
 * The window after the pad shows `view` at `now`. It opens only at the moment a match this screen saw in play is first
 * shown decided with Undo on, which only this phone's own latest tap gives (another scorer's result offers none): a
 * decided match seen first (a restart, a return to the pad) opens nothing. A card that is not the result (the
 * organiser's lock, a link that died) is neither a match in play nor a loss of where it stood, so a result coming back
 * from under one does not start again. Undo reopening the match is `playing`, and the next decision opens a fresh window.
 * The same object while nothing changed.
 */
export function advanceUndoWindow(
  seen: UndoWindowSeen,
  view: UndoFacts,
  now: number,
): UndoWindowSeen {
  const phase = phaseAfter(seen.phase, view.card);
  if (phase === seen.phase) return seen;
  const opens = seen.phase === 'playing' && phase === 'decided' && view.lastTap?.undo === true;
  return { phase, openedAt: opens ? now : seen.openedAt };
}

function phaseAfter(
  phase: UndoWindowSeen['phase'],
  card: PadStateCard | null,
): UndoWindowSeen['phase'] {
  if (card === null) return 'playing';
  return card.kind === 'resultRecorded' ? 'decided' : phase;
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
