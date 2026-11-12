import {
  withCard,
  type PadFoot,
  type PadHalf,
  type PadMatchDetails,
  type PadServing,
  type PadSide,
  type PadStateCard,
  type PadStripItem,
  type PadSync,
  type PadText,
  type PadView,
} from '@/domain/scoring/padView';
import { padMarks, setBasedTally, type PadCardMark } from '@/domain/scoring/setBasedPad';
import { sideNames } from '@/domain/scoring/setBasedSides';
import { LEVEL_CARDS, levelWord } from '@/domain/scoring/tennisLevels';
import { tennisRuleRows } from '@/domain/scoring/tennisRules';
import { TENNIS_TOOL_SLOTS, takesTaps, tennisTools } from '@/domain/scoring/tennisTools';
import type { TennisDisplay, TennisEnding, TennisPadKey } from '@/domain/scoring/tennisTypes';

/**
 * Tennis on the pad (S2-7 Task 6; spec §5, rulings 219, 222, 223, 225, 228, 230): the view that draws a `TennisDisplay`.
 * Whoever keeps the score (the engine, through `foldTennis`) decides every field, the call, the serve and the change of
 * ends included; the pad only draws them. Functions only: the types are `tennisTypes`, the tools `tennisTools`, the rules
 * `tennisRules`. The last-tap line is History's words (Task 8) and is wired with them.
 */

type Text = PadText<TennisPadKey>;

const SYNCED: PadSync = { kind: 'synced' };

/** The words a set-based pad names alike, in tennis's own namespace (`setBasedPad`). */
const TALLY = 'scoring.tennis.setsTally';

/**
 * The pad for a tennis match: the first side on top, the second below, each with the game's call large, the serve ball on
 * the serving side, the heaviest violation of the set as a card and its games in the set at the foot; the set of how many,
 * the breaker or the note and "Change ends" in the strip; and the four tools. A match over is the recorded result's card
 * (the winner and the sets, or how the organiser ended it) over the final score. Before the start, the Start screen with
 * no serve question (ruling 216), and no tools.
 */
export function tennisPad(display: TennisDisplay, sync: PadSync = SYNCED): PadView<TennisPadKey> {
  const view: PadView<TennisPadKey> = {
    halves: [half(display, 'first'), half(display, 'second')],
    tally: setBasedTally(TALLY, display.sides, display.setsWon),
    details: tennisDetails(display),
    start: start(display),
    strip: strip(display),
    lastTap: null,
    sync,
    tools: tennisTools(display),
    toolSlots: TENNIS_TOOL_SLOTS,
    card: null,
  };
  return withCard(view, cardOf(display));
}

/** The match's context and its rules, for MatchCard: the Start screen, the Not started card and the Match details sheet. */
export function tennisDetails(display: TennisDisplay): PadMatchDetails<TennisPadKey> {
  return { context: display.context, rules: tennisRuleRows(display.cfg) };
}

function half(display: TennisDisplay, side: PadSide): PadHalf<TennisPadKey> {
  const plate = takesTaps(display) && display.serving === side ? serving() : null;
  return {
    side,
    label: sideNames(display.sides[side]),
    value: display.call[side],
    periods: null,
    // The serve ball marks the side, never a person: the phone sends no server (rulings 217, 223).
    sub: null,
    marks: padMarks(violationCard(display, side), null),
    serving: plate,
    plate: null,
    action: null,
    // The bar follows the ball: the serving side's is lit, neither while the engine names no server.
    bar: plate === null ? 'dim' : 'lit',
    foot: foot(display, side),
    hint: { key: 'scoring.tennis.hint' },
    tappable: takesTaps(display),
  };
}

const serving = (): PadServing<TennisPadKey> => ({
  shown: { key: 'scoring.tennis.serving' },
  said: { key: 'scoring.tennis.serving' },
});

/** The side's games in the set, "Games 4"; none in a match tie-break (it has none), before the start or once the match is over. */
function foot(display: TennisDisplay, side: PadSide): PadFoot<TennisPadKey> | null {
  if (!takesTaps(display) || display.breaker === 'matchTiebreak') return null;
  const vars = { games: display.games[side] };
  return {
    text: { key: 'scoring.tennis.foot.games', vars },
    said: { key: 'scoring.tennis.foot.gamesSaid', vars },
    place: 'slot',
    caution: false,
  };
}

/** The side's heaviest violation of the set as a card, or none; its name is what a screen reader hears of it. */
function violationCard(display: TennisDisplay, side: PadSide): PadCardMark<TennisPadKey> | null {
  const level = display.heaviest[side];
  return level === null ? null : { cards: LEVEL_CARDS[level], said: levelWord(level) };
}

/** Before the match starts: the two names, top first. No serve to pick (ruling 216), so Start match is ready at once. */
function start(display: TennisDisplay): PadView<TennisPadKey>['start'] {
  if (display.phase !== 'notStarted') return null;
  return {
    ask: { key: 'scoring.tennis.start.ask' },
    needsToss: false,
    sides: [
      { side: 'first', label: sideNames(display.sides.first) },
      { side: 'second', label: sideNames(display.sides.second) },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The strip
// ---------------------------------------------------------------------------------------------------------------

/** What a waiting default or an ending says in the strip: two lines, in the room of two slots. */
const SAID_LINES = 2;

/**
 * "Set 2 of 3", then the breaker or the note, then "Change ends": three slots, always the same, so no fact coming or going
 * moves a thing (ruling 222). A default waiting for the organiser, or an ending, takes the two slots' room for one line of
 * its own: no tap is taken then, so nothing is under a thumb to move.
 */
function strip(display: TennisDisplay): readonly PadStripItem<TennisPadKey>[] {
  const set: PadStripItem<TennisPadKey> = {
    slot: 'set',
    text: { key: 'scoring.tennis.setOf', vars: { set: display.set, bestOf: display.cfg.bestOf } },
  };
  const said: Text | null = display.endingPending
    ? { key: 'scoring.tennis.endingPending' }
    : endingText(display);
  if (said !== null) return [set, { slot: 'note', text: said, lines: SAID_LINES }];
  return [
    set,
    { slot: 'note', text: noteOf(display) },
    { slot: 'ends', text: display.endsChanged ? { key: 'scoring.tennis.endsChange' } : null },
  ];
}

/** The breaker's name, else deuce or the deciding point (never at advantage: the half shows AD), else nothing. */
function noteOf(display: TennisDisplay): Text | null {
  if (display.breaker === 'tiebreak') return { key: 'scoring.tennis.breaker.tiebreak' };
  if (display.breaker === 'matchTiebreak') return { key: 'scoring.tennis.breaker.matchTiebreak' };
  if (display.note === 'deuce') return { key: 'scoring.tennis.note.deuce' };
  return display.note === 'decidingPoint' ? { key: 'scoring.tennis.note.decidingPoint' } : null;
}

// ---------------------------------------------------------------------------------------------------------------
// The card over a finished match
// ---------------------------------------------------------------------------------------------------------------

/** "Retired · Bea Lund": the organiser's ending and the side at fault; with no side (an abandon), the word alone. */
function endingText(display: TennisDisplay): Text | null {
  const { ending } = display;
  if (ending === null) return null;
  const word: Text = { key: `scoring.tennis.ending.${ending.kind}` };
  if (ending.side === null) return word;
  return {
    key: 'scoring.tennis.ending.by',
    vars: { ending: word, side: sideNames(display.sides[ending.side]) },
  };
}

/**
 * The recorded result's card over the score, headed with the result in words: how the organiser ended it, or the winner and
 * the sets as the engine writes them ("7–6(5) 3–6 6–4", a match tie-break "[10–7]": ruling 225). None while the match is on.
 */
function cardOf(display: TennisDisplay): PadStateCard<TennisPadKey> | null {
  if (display.phase === 'ended') {
    const title = endingText(display);
    return title === null ? null : { kind: 'resultRecorded', undoLeft: null, title };
  }
  if (display.phase !== 'decided') return null;
  const winner: PadSide = display.setsWon.first > display.setsWon.second ? 'first' : 'second';
  const sets = display.finished.map((one) => one.text).join(' ');
  const title: Text = {
    key: 'scoring.tennis.result',
    vars: { side: sideNames(display.sides[winner]), sets },
  };
  return { kind: 'resultRecorded', undoLeft: null, title };
}
