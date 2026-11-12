import {
  withCard,
  type PadLastTap,
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
import { doneSaid, endingSaid, whoWord } from '@/domain/scoring/tennisHistory';
import { finalBoardOf, matchWinner, scoreboardOf } from '@/domain/scoring/tennisBoard';
import { LEVEL_CARDS, levelWord } from '@/domain/scoring/tennisLevels';
import { tennisRuleRows } from '@/domain/scoring/tennisRules';
import { TENNIS_TOOL_SLOTS, takesTaps, tennisTools } from '@/domain/scoring/tennisTools';
import type { TennisDisplay, TennisPadKey, TennisUndoneTap } from '@/domain/scoring/tennisTypes';

/**
 * Tennis on the pad (S2-7 Task 6; spec §5, rulings 219, 222, 223, 225, 228, 230): the view that draws a `TennisDisplay`.
 * Whoever keeps the score (the engine, through `foldTennis`) decides every field, the call, the serve and the change of
 * ends included; the pad only draws them. Functions only: the types are `tennisTypes`, the tools `tennisTools`, the rules
 * `tennisRules`, the words of History and the last-tap line `tennisHistory`.
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
 * the serve question (ruling 233), and no tools.
 */
export function tennisPad(display: TennisDisplay, sync: PadSync = SYNCED): PadView<TennisPadKey> {
  const view: PadView<TennisPadKey> = {
    halves: [half(display, 'first'), half(display, 'second')],
    tally: setBasedTally(TALLY, display.sides, display.setsWon),
    details: tennisDetails(display),
    start: start(display),
    strip: strip(display),
    lastTap: lastTap(display),
    sync,
    tools: tennisTools(display),
    toolSlots: TENNIS_TOOL_SLOTS,
    card: null,
    ...resultOf(display),
  };
  return withCard(view, cardOf(display));
}

/** The match's context and its rules, for MatchCard: the Start screen, the Not started card and the Match details sheet. */
export function tennisDetails(display: TennisDisplay): PadMatchDetails<TennisPadKey> {
  return { context: display.context, rules: tennisRuleRows(display.cfg) };
}

function half(display: TennisDisplay, side: PadSide): PadHalf<TennisPadKey> {
  const taps = takesTaps(display);
  const final = display.phase === 'decided' || display.phase === 'ended';
  const plate = taps && display.serving === side ? serving() : null;
  return {
    side,
    label: sideNames(display.sides[side]),
    value: final ? '' : display.call[side],
    periods: null,
    sub: null,
    // The doubles server's name when the engine names it (ruling 235), under the side's names; the plate marks the side alone otherwise.
    server: plate === null ? null : servingPerson(display),
    scoreboard: taps ? scoreboardOf(display, side) : null,
    finalBoard: final ? finalBoardOf(display, side) : null,
    marks: padMarks(violationCard(display, side), null),
    // The ball while play is on; once the match is won the winner's half carries WON in its place.
    serving: final ? won(display, side) : plate,
    plate: null,
    action: null,
    // The bar follows the ball: the serving side's is lit, neither while the engine names no server; the winner's once won.
    bar: (final ? matchWinner(display) === side : plate !== null) ? 'lit' : 'dim',
    foot: null,
    hint: { key: 'scoring.tennis.hint' },
    tappable: taps,
  };
}

/** The winner's plate, where the serving one sat; none for the other side and for a match the organiser ended. */
function won(display: TennisDisplay, side: PadSide): PadServing<TennisPadKey> | null {
  return matchWinner(display) === side
    ? { shown: { key: 'scoring.tennis.board.won' }, said: { key: 'scoring.tennis.board.won' } }
    : null;
}

const serving = (): PadServing<TennisPadKey> => ({
  shown: { key: 'scoring.tennis.serving' },
  said: { key: 'scoring.tennis.serving' },
});

/** The doubles server the engine names, by name (ruling 235); else nobody. */
function servingPerson(display: TennisDisplay): Text | null {
  return display.servingPerson === null
    ? null
    : { key: 'scoring.tennis.serverPerson', vars: { person: display.servingPerson } };
}

/** The side's heaviest violation of the set as a card, or none; its name is what a screen reader hears of it. */
function violationCard(display: TennisDisplay, side: PadSide): PadCardMark<TennisPadKey> | null {
  const level = display.heaviest[side];
  return level === null ? null : { cards: LEVEL_CARDS[level], said: levelWord(level) };
}

/**
 * Before the match starts: who serves first (ruling 233), the two names top first. A toss already held (another scorer's, or
 * this phone's after Undo took the start back and left it) is not asked again, since the engine takes one: Start match is
 * ready at once and the serving side carries its plate, as the halves will.
 */
function start(display: TennisDisplay): PadView<TennisPadKey>['start'] {
  if (display.phase !== 'notStarted') return null;
  const plate = (side: PadSide) => (display.toss === side ? serving().shown : null);
  return {
    ask: { key: 'scoring.tennis.start.ask' },
    needsToss: display.toss === null,
    sides: [
      { side: 'first', label: sideNames(display.sides.first), plate: plate('first') },
      { side: 'second', label: sideNames(display.sides.second), plate: plate('second') },
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
  const set: PadStripItem<TennisPadKey> = { slot: 'set', text: setText(display) };
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

/** "Set 2 of 3" while the match is on; "Final" once it is decided or ended (ruling 239). */
function setText(display: TennisDisplay): Text {
  if (display.phase === 'decided' || display.phase === 'ended')
    return { key: 'scoring.tennis.final' };
  return { key: 'scoring.tennis.setOf', vars: { set: display.set, bestOf: display.cfg.bestOf } };
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

/** The organiser's ending and the side at fault, in words; none while the match is not over by one. */
function endingText(display: TennisDisplay): Text | null {
  const { ending } = display;
  return ending === null ? null : endingSaid(ending.kind, display.sides, ending.side);
}

/**
 * The recorded result's card over the score, headed with the result in words: how the organiser ended it, or the winner and
 * the sets as the engine writes them ("7–6(5) 3–6 6–4", a match tie-break "[10–7]": ruling 225). None while the match is on.
 */
function cardOf(display: TennisDisplay): PadStateCard<TennisPadKey> | null {
  const title = resultText(display);
  return title === null ? null : { kind: 'resultRecorded', undoLeft: null, title };
}

/** The result in words: how the organiser ended it, or the winner and the sets; none while the match is on. */
function resultText(display: TennisDisplay): Text | null {
  if (display.phase === 'ended') return endingText(display);
  const winner = matchWinner(display);
  if (winner === null) return null;
  const sets = display.finished.map((one) => one.text).join(' ');
  return { key: 'scoring.tennis.result', vars: { side: sideNames(display.sides[winner]), sets } };
}

/** The result the carried-forward card carries (ruling 239), so a match the web moved on keeps its score on screen. */
function resultOf(display: TennisDisplay): { readonly result?: Text } {
  const result = resultText(display);
  return result === null ? {} : { result };
}

// ---------------------------------------------------------------------------------------------------------------
// The last tap
// ---------------------------------------------------------------------------------------------------------------

/** The last tap's line; none before the start (no event stands then, so the fold has no last tap either). */
function lastTap(display: TennisDisplay): PadLastTap<TennisPadKey> | null {
  if (display.lastTap === null) return null;
  const { lastTap: tap, sides } = display;
  return {
    text: tap.kind === 'undone' ? undoneSaid(display, tap.tap) : doneSaid(sides, tap),
    undo: display.undoable,
  };
}

/** What Undo took back, in the last-tap line's words ("Point undone — Ana Ruiz"). */
function undoneSaid(display: TennisDisplay, tap: TennisUndoneTap): Text {
  const { sides } = display;
  switch (tap.kind) {
    case 'point':
      return { key: 'scoring.tennis.undone.point', vars: { side: sideNames(sides[tap.side]) } };
    case 'setScore':
      return { key: 'scoring.tennis.undone.setScore' };
    case 'violation':
      return {
        key: 'scoring.tennis.undone.violation',
        vars: { level: levelWord(tap.level), person: whoWord(sides, tap.side, tap.person) },
      };
    case 'award':
      return { key: 'scoring.tennis.undone.award', vars: { side: sideNames(sides[tap.side]) } };
    case 'break':
      return { key: 'scoring.tennis.undone.break' };
  }
}
