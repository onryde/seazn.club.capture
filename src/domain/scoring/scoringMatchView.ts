import type { BadmintonFold, BadmintonUnfoldable } from '@/domain/scoring/badmintonFold';
import {
  badmintonPad,
  type BadmintonDisplay,
  type BadmintonPadKey,
} from '@/domain/scoring/badmintonPad';
import { noteLine, type PadLineWords } from '@/domain/scoring/padLine';
import {
  withCard,
  type PadHistoryGroup,
  type PadSide,
  type PadStateCard,
  type PadSync,
  type PadView,
} from '@/domain/scoring/padView';
import type { QueueDead } from '@/domain/scoring/queue';
import {
  SPORT,
  deadOf,
  foldOfState,
  isOutdated,
  signatureOf,
  undoTargetOf,
  type MatchState,
} from '@/domain/scoring/scoringMatchState';

/**
 * What the screen shows of a match (plan S2-1 Task 9), read off its state: the pad, or one of the states that take its
 * place and that the operator is told in words, never met as a blank or a crash. Pure, like the reducer.
 */
export type MatchView =
  /** No bootstrap yet: the first read is on its way (`offline: false`) or could not be made (`offline: true`). */
  | { readonly kind: 'loading'; readonly offline: boolean }
  /** The link is gone and nothing of the match is known: the bad-link state (the pad's card needs a bootstrap). */
  | { readonly kind: 'linkGone' }
  /** The match is a sport this build does not score. */
  | { readonly kind: 'unsupportedSport'; readonly sportKey: string }
  /** The ledger is over the read's size cap: the phone cannot know where the match stands. */
  | { readonly kind: 'tooLarge' }
  /** The match cannot be folded (a seat with no entrant, a config or a ledger the engine refuses). */
  | { readonly kind: 'unfoldable'; readonly reason: BadmintonUnfoldable }
  /** The server needs a newer app, and the match cannot be folded to show behind the banner. */
  | { readonly kind: 'outdated'; readonly unsent: number }
  | {
      readonly kind: 'pad';
      readonly view: PadView<BadmintonPadKey>;
      readonly display: BadmintonDisplay;
      readonly history: readonly PadHistoryGroup<BadmintonPadKey>[];
      readonly line: PadLineWords;
      /** The Start screen's pick, while the match has not started. */
      readonly toss: PadSide | null;
    };

/** The words that mean the match is closed to this phone because of the match, not because of the link. */
const MATCH_CLOSED: ReadonlySet<QueueDead> = new Set<QueueDead>(['finalized', 'cancelled']);

/** The screens the server gives that are a card in place of the pad. */
const NOT_STARTED_SCREENS: ReadonlySet<string> = new Set(['divisionNotStarted', 'waiting']);

export function viewOf(state: MatchState): MatchView {
  const { bootstrap } = state;
  if (bootstrap === null) return withoutBootstrap(state);
  if (bootstrap.sportKey !== SPORT)
    return { kind: 'unsupportedSport', sportKey: bootstrap.sportKey };
  if (state.sync.status === 'tooLarge') return { kind: 'tooLarge' };
  const fold = foldOfState(state);
  if (fold === null || fold.kind === 'unfoldable') {
    const unsent = state.sync.queue.pending.length;
    if (isOutdated(state)) return { kind: 'outdated', unsent };
    return { kind: 'unfoldable', reason: fold === null ? 'cfg' : fold.reason };
  }
  return padOf(state, fold);
}

function withoutBootstrap(state: MatchState): MatchView {
  return deadOf(state) === null
    ? { kind: 'loading', offline: state.bootOffline }
    : { kind: 'linkGone' };
}

function padOf(state: MatchState, fold: Extract<BadmintonFold, { kind: 'folded' }>): MatchView {
  const display = shown(state, fold.display);
  const view = badmintonPad(display, syncOf(state));
  const card = cardOf(state);
  return {
    kind: 'pad',
    view: withCard(view, card),
    display,
    history: fold.history,
    line: lineOf(state, fold),
    toss: display.phase === 'notStarted' ? state.toss : null,
  };
}

/** The display with the "undone" line of a discarded tap, while the match is as it was left (`state.undone`). */
function shown(state: MatchState, display: BadmintonDisplay): BadmintonDisplay {
  const { undone } = state;
  if (undone === null || undone.over !== signatureOf(state)) return display;
  return { ...display, lastTap: { kind: 'undone', tap: undone.tap } };
}

function syncOf(state: MatchState): PadSync {
  const count = state.sync.queue.pending.length;
  if (count === 0) return { kind: 'synced' };
  if (deadOf(state) !== null) return { kind: 'refused', count };
  const { status } = state.sync;
  return status === 'offline' || status === 'outdated'
    ? { kind: 'offline', count }
    : { kind: 'sending', count };
}

/**
 * The card over the pad, in the order of what matters most: a link the door does not take; a match closed to this phone
 * (finalized or cancelled, or the server's own view-only screen); an app too old; a match not yet on the schedule.
 * A decided match is `badmintonPad`'s own card (result recorded), which none of these replaces unless one applies.
 */
function cardOf(state: MatchState): PadStateCard | null {
  const dead = deadOf(state);
  const screen = state.bootstrap?.screen ?? '';
  if (dead !== null && !MATCH_CLOSED.has(dead)) return { kind: 'linkInvalid' };
  if (dead !== null || screen === 'viewOnly') return { kind: 'viewOnly' };
  if (isOutdated(state)) return { kind: 'updateNeeded', unsent: state.sync.queue.pending.length };
  return NOT_STARTED_SCREENS.has(screen) ? { kind: 'notStarted' } : null;
}

/**
 * What the last-tap line says besides the sentence: the reducer's own words (a refusal, the bounce's note), else the
 * standing note that an Undo waits for its tap's answer, else that Undo is off because another scorer has scored since.
 * A note stands as long as it is true.
 */
function lineOf(state: MatchState, fold: Extract<BadmintonFold, { kind: 'folded' }>): PadLineWords {
  if (state.line !== null) return state.line;
  if (state.sync.queue.pending.some((tap) => tap.voidsKey !== undefined)) {
    return noteLine('scoring.pad.undoWaiting');
  }
  const target = undoTargetOf(state, fold);
  return target.kind === 'blocked' && target.reason === 'otherScorer'
    ? noteLine('scoring.pad.otherScorerSince')
    : null;
}
