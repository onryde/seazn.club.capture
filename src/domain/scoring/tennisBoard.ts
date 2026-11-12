import type {
  PadFinalBoard,
  PadFinalBox,
  PadScoreboard,
  PadSide,
  PadText,
} from '@/domain/scoring/padView';
import type { TennisDisplay, TennisPadKey } from '@/domain/scoring/tennisTypes';

/**
 * Tennis's halves as a scoreboard (S2-7 Task 18; rulings 235, 239, 240), the pad's own words and numbers: whoever keeps the
 * score (the engine, through `foldTennis`) decides every fact, this only lays them out. Live, a half is one row of the
 * reference board: a box of this side's games for each set over, a box of its games in the set under way, and the numbered
 * dots of the games it won. Once the match is decided or ended, a half is its final board: a box for each set, then the sets
 * won. Functions only; the types are `padView`'s, the display `tennisTypes`'.
 */

type Text = PadText<TennisPadKey>;

const SETS: Text = { key: 'scoring.tennis.board.sets' };
const GAMES: Text = { key: 'scoring.tennis.board.games' };
const MTB: Text = { key: 'scoring.tennis.board.mtb' };
const setLabel = (set: number): Text => ({ key: 'scoring.tennis.board.set', vars: { set } });

/** A label and its value as a screen reader hears them: "Sets: 6". */
const said = (label: Text, value: string): Text => ({
  key: 'scoring.tennis.board.said',
  vars: { label, value },
});

/**
 * The side's row while the match takes taps. The dots are the set's games the side won, so a match tie-break (no games) has
 * none; a side that has won no game has an empty row of dots, which keeps its height. A screen reader hears the sets, then
 * the games count and which games ("Games 3: 1, 3, 4").
 */
export function scoreboardOf(display: TennisDisplay, side: PadSide): PadScoreboard<TennisPadKey> {
  const sets = display.finished.map((one) => String(one[side]));
  const dots = display.breaker === 'matchTiebreak' ? null : dotsOf(display, side);
  return {
    setsLabel: SETS,
    sets,
    dots,
    said: [
      ...(sets.length === 0 ? [] : [said(SETS, sets.join(', '))]),
      ...(dots === null ? [] : [gamesSaid(dots)]),
    ],
  };
}

const gamesSaid = (dots: readonly number[]): Text =>
  dots.length === 0
    ? said(GAMES, '0')
    : {
        key: 'scoring.tennis.board.gamesWon',
        vars: { count: dots.length, games: dots.join(', ') },
      };

/** The numbers (1-based, every game of the set counted) of the games `side` won in the set under way. */
const dotsOf = (display: TennisDisplay, side: PadSide): readonly number[] =>
  display.gameWins.flatMap((winner, at) => (winner === side ? [at + 1] : []));

/** The side's final board: a box for each set (the set under way too, once the organiser ended the match), then the sets won. */
export function finalBoardOf(display: TennisDisplay, side: PadSide): PadFinalBoard<TennisPadKey> {
  const boxes = [...setBoxes(display, side), totalBox(display, side)];
  return { boxes, said: boxes.map((box) => said(box.label, boxValue(box))) };
}

/** A box's value as it is heard: the games, then the tie-break's points in brackets when it shows them. */
const boxValue = (box: PadFinalBox<TennisPadKey>): string =>
  box.bracket === undefined ? box.value : `${box.value} (${box.bracket})`;

function setBoxes(display: TennisDisplay, side: PadSide): readonly PadFinalBox<TennisPadKey>[] {
  const over = display.finished.map((one, at): PadFinalBox<TennisPadKey> => {
    const won = one.winner === side;
    const bracket = one.tiebreak !== null && !won ? { bracket: String(one.tiebreak[side]) } : {};
    return {
      label: one.matchTiebreak ? MTB : setLabel(at + 1),
      value: String(one[side]),
      ...bracket,
      tone: won ? 'won' : 'plain',
    };
  });
  return [...over, ...underWay(display, side)];
}

/** The set the organiser ended the match in, when a point was played in it: its games (0 and 0 before a game is won), or the match tie-break's points. */
function underWay(display: TennisDisplay, side: PadSide): readonly PadFinalBox<TennisPadKey>[] {
  if (display.phase !== 'ended') return [];
  if (display.breaker === 'matchTiebreak')
    return display.call.first === '0' && display.call.second === '0'
      ? []
      : [{ label: MTB, value: display.call[side], tone: 'plain' }];
  // A point played in the set counts though no game is won yet (15-0 at a retirement): its box shows 0 and 0.
  const played =
    display.games.first + display.games.second > 0 ||
    display.call.first !== '0' ||
    display.call.second !== '0';
  if (!played) return [];
  return [
    {
      label: setLabel(display.finished.length + 1),
      value: String(display.games[side]),
      tone: 'plain',
    },
  ];
}

/** The sets won: the lime plate for the match's winner, plain for the other side and for a match nobody won. */
function totalBox(display: TennisDisplay, side: PadSide): PadFinalBox<TennisPadKey> {
  const winner = matchWinner(display);
  return {
    label: SETS,
    value: String(display.setsWon[side]),
    tone: winner === side ? 'plate' : 'plain',
  };
}

/** The side that won the match on court; none while it is on or once the organiser ended it. */
export function matchWinner(display: TennisDisplay): PadSide | null {
  if (display.phase !== 'decided') return null;
  return display.setsWon.first > display.setsWon.second ? 'first' : 'second';
}
