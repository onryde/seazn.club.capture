import { noteLine, type PadLineWords } from '@/domain/scoring/padLine';
import {
  withCard,
  type PadAsk,
  type PadHistoryGroup,
  type PadSide,
  type PadStateCard,
  type PadSync,
  type PadView,
} from '@/domain/scoring/padView';
import type { QueueDead } from '@/domain/scoring/queue';
import {
  deadOf,
  foldOfState,
  isOutdated,
  scoredAs,
  signatureOf,
  undoTargetOf,
  type MatchState,
} from '@/domain/scoring/scoringMatchState';
import { askOf } from '@/domain/scoring/scoringMatchAsk';
import { stallOf } from '@/domain/scoring/scoringMatchStall';
import type {
  ScoringSport,
  SportFold,
  SportTypes,
  Unfoldable,
} from '@/domain/scoring/scoringSport';

/**
 * What the screen shows of a match (plan S2-1 Task 9), read off its state: the pad, or one of the states that take its
 * place and that the operator is told in words, never met as a blank or a crash. Pure, like the reducer. The pad is
 * the match's sport's (`S`): its display, its pad and its history.
 */
export type MatchView<S extends SportTypes = SportTypes> =
  /** No bootstrap yet: the first read is on its way (`offline: false`) or could not be made (`offline: true`). */
  | { readonly kind: 'loading'; readonly offline: boolean }
  /** The link is gone and nothing of the match is known: the bad-link state (the pad's card needs a bootstrap). */
  | { readonly kind: 'linkGone' }
  /** The match is a sport this build, or this screen, does not score. */
  | { readonly kind: 'unsupportedSport'; readonly sportKey: string }
  /** The ledger is over the read's size cap: the phone cannot know where the match stands. */
  | { readonly kind: 'tooLarge' }
  /** The match cannot be folded (a seat with no entrant, a config or a ledger the engine refuses). */
  | { readonly kind: 'unfoldable'; readonly reason: Unfoldable }
  /** The server needs a newer app, and the match cannot be folded to show behind the banner. */
  | { readonly kind: 'outdated'; readonly unsent: number }
  | MatchPad<S>;

/** The pad, as the match's sport draws it, and what the screen needs beside it. */
export type MatchPad<S extends SportTypes = SportTypes> = {
  readonly kind: 'pad';
  readonly view: PadView<S['padKey']>;
  readonly display: S['display'];
  readonly history: readonly PadHistoryGroup<S['padKey']>[];
  readonly line: PadLineWords;
  /** The Start screen's pick, while the match has not started. */
  readonly toss: PadSide | null;
  /** The reconnect question, while it stands: other scorers' events landed on this phone's queued taps. */
  readonly ask: PadAsk | null;
  /** When this phone's own tap decided the match, on the phone's clock (ms): the start of Undo's 45 s; null if none did. */
  readonly decidedAt: number | null;
};

type Folded<S extends SportTypes> = Extract<SportFold<S>, { kind: 'folded' }>;

/** The words that mean the match is closed to this phone because of the match, not because of the link. */
const MATCH_CLOSED: ReadonlySet<QueueDead> = new Set<QueueDead>(['finalized', 'cancelled']);

/** The screens the server gives that are a card in place of the pad. */
const NOT_STARTED_SCREENS: ReadonlySet<string> = new Set(['divisionNotStarted', 'waiting']);

export function viewOf<S extends SportTypes>(state: MatchState<S>): MatchView<S> {
  const { bootstrap } = state;
  if (bootstrap === null) return withoutBootstrap(state);
  if (bootstrap.sportKey !== state.sport.key) {
    return { kind: 'unsupportedSport', sportKey: bootstrap.sportKey };
  }
  if (state.sync.status === 'tooLarge') return { kind: 'tooLarge' };
  const fold = foldOfState(state);
  if (fold === null || fold.kind === 'unfoldable') {
    const unsent = state.sync.queue.pending.length;
    if (isOutdated(state)) return { kind: 'outdated', unsent };
    return { kind: 'unfoldable', reason: fold === null ? 'cfg' : fold.reason };
  }
  return padOf(state, fold);
}

/**
 * The match as `sport`'s screen shows it. The runner holds a match of any sport; a screen holds its own sport, and
 * reads a match through it, typed by it. A match opened as another sport is not this screen's to draw: it reads
 * `unsupportedSport`, naming the sport the match opened as, and is never folded by the wrong sport.
 */
export function viewAs<S extends SportTypes>(
  sport: ScoringSport<S>,
  state: MatchState,
): MatchView<S> {
  if (scoredAs(state, sport)) return viewOf(state);
  return { kind: 'unsupportedSport', sportKey: state.sport.key };
}

function withoutBootstrap<S extends SportTypes>(state: MatchState<S>): MatchView<S> {
  return deadOf(state) === null
    ? { kind: 'loading', offline: state.bootOffline }
    : { kind: 'linkGone' };
}

function padOf<S extends SportTypes>(state: MatchState<S>, fold: Folded<S>): MatchPad<S> {
  const { sport } = state;
  const display = shown(state, fold.display);
  const view = sport.pad(display, syncOf(state));
  const card = cardOf(state);
  return {
    kind: 'pad',
    view: withCard(view, card),
    display,
    history: fold.history,
    line: lineOf(state, fold),
    toss: sport.notStarted(display) ? state.toss : null,
    ask: askViewOf(state),
    decidedAt: state.decidedAt,
  };
}

/**
 * The reconnect question as the sheet asks it: the counts, and the score as the server has it, which is the match
 * folded with none of this phone's taps (the pad itself shows them on top). The sides are the pad's halves, so every
 * sport names them its own way.
 */
function askViewOf<S extends SportTypes>(state: MatchState<S>): PadAsk | null {
  const ask = askOf(state);
  if (ask === null) return null;
  const fold = foldOfState(state, []);
  if (fold === null || fold.kind !== 'folded') return null;
  const [top, bottom] = state.sport.pad(fold.display, { kind: 'synced' }).halves;
  return {
    ...ask,
    score: [
      { label: top.label, value: top.value },
      { label: bottom.label, value: bottom.value },
    ],
  };
}

/** The display with the "undone" line of a discarded tap, while the match is as it was left (`state.undone`). */
function shown<S extends SportTypes>(state: MatchState<S>, display: S['display']): S['display'] {
  const { undone } = state;
  if (undone === null || undone.over !== signatureOf(state)) return display;
  return state.sport.showUndone(display, undone.tap);
}

function syncOf(state: MatchState): PadSync {
  const count = state.sync.queue.pending.length;
  if (count === 0) return { kind: 'synced' };
  if (deadOf(state) !== null) return { kind: 'refused', count };
  if (isOutdated(state)) return { kind: 'outdated', count };
  // The question first: a phone that dropped and came back is waiting for the scorer's answer, not for a signal.
  if (askOf(state) !== null) return { kind: 'asked', count };
  if (state.sync.status === 'offline') return { kind: 'offline', count };
  // The network is named first: a refusal run left over from before it dropped is not what is stopping the taps now.
  return stallOf(state) === null ? { kind: 'sending', count } : { kind: 'stalled', count };
}

/**
 * The card over the pad, in the order of what matters most: a link the door does not take; a match closed to this phone
 * (finalized or cancelled, or the server's own view-only screen); an app too old; a match not yet on the schedule.
 * A decided match is the sport's own card (badminton's: result recorded), which none of these replaces unless one applies.
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
function lineOf<S extends SportTypes>(state: MatchState<S>, fold: Folded<S>): PadLineWords {
  if (state.line !== null) return state.line;
  if (state.sync.queue.pending.some((tap) => tap.voidsKey !== undefined)) {
    return noteLine('scoring.pad.undoWaiting');
  }
  const target = undoTargetOf(state, fold);
  return target.kind === 'blocked' && target.reason === 'otherScorer'
    ? noteLine('scoring.pad.otherScorerSince')
    : null;
}
