import type {
  PadCard,
  PadMarks,
  PadSide,
  PadStart,
  PadStateCard,
  PadStripItem,
  PadTally,
  PadText,
} from '@/domain/scoring/padView';
import type { SetBasedGame, SetBasedPhase } from '@/domain/scoring/setBasedBoard';
import { sideNames, type SetBasedSide } from '@/domain/scoring/setBasedSides';

/**
 * The pieces of a pad the set-based sports (badminton, table tennis) draw alike (plan S2-2 Task 5, lifted from
 * badminton's pad): the games tally, the Start question, a half's hint, the strip's game slot, a finished game's box and
 * words, and the card a decided match shows. A generic file: it names no sport, and each sport hands in its own
 * dictionary keys (`K` is the sport's key union), so the words stay the sport's.
 */

type Sides = Readonly<Record<PadSide, SetBasedSide>>;

/** The games each side has won, top first. */
export function gamesWon(finished: readonly SetBasedGame[]): Readonly<Record<PadSide, number>> {
  const count = (side: PadSide) => finished.filter((game) => game.winner === side).length;
  return { first: count('first'), second: count('second') };
}

/** The header's tally: the games won, top side first ("1:0"), and said with the sides' names. */
export function setBasedTally<K extends string>(
  key: K,
  sides: Sides,
  won: Readonly<Record<PadSide, number>>,
): PadTally<K> {
  return {
    shown: `${won.first}:${won.second}`,
    said: {
      key,
      vars: {
        first: sideNames(sides.first),
        firstGames: won.first,
        second: sideNames(sides.second),
        secondGames: won.second,
      },
    },
  };
}

/** Before the match starts: who serves first, from the two sides as typed, top first. Once it has started, none. */
export function setBasedStart<K extends string>(
  ask: K,
  sides: Sides,
  phase: SetBasedPhase,
): PadStart<K> | null {
  if (phase !== 'notStarted') return null;
  return {
    ask: { key: ask },
    needsToss: true,
    sides: [
      { side: 'first', label: sideNames(sides.first) },
      { side: 'second', label: sideNames(sides.second) },
    ],
  };
}

/**
 * The heaviest of the levels a side holds, by the sport's order (lightest first), or none: a side shows one sanction,
 * the heaviest (owner ruling 16; ruling 56 draws it as cards). A level the order does not list is no level: it never
 * outweighs a known one.
 */
export function heaviestLevel<L extends string>(
  order: readonly L[],
  levels: readonly string[],
): L | null {
  const at = levels.reduce(
    (top, level) =>
      Math.max(
        top,
        order.findIndex((known) => known === level),
      ),
    -1,
  );
  return order[at] ?? null;
}

/** A sanction as marks: the cards drawn for its level, and its name said to a screen reader. */
export type PadCardMark<K extends string> = {
  readonly cards: readonly PadCard[];
  readonly said: PadText<K>;
};

/**
 * A half's marks (owner ruling 56): the side's card, if any, and the clock's words when the clock is drawn. The card
 * comes first in what a screen reader hears, and the clock is drawn before the cards.
 */
export function padMarks<K extends string>(
  card: PadCardMark<K> | null,
  clock: PadText<K> | null,
): PadMarks<K> {
  return {
    clock: clock !== null,
    cards: card === null ? [] : card.cards,
    said: [...(card === null ? [] : [card.said]), ...(clock === null ? [] : [clock])],
  };
}

/** "Game 2 of 3": the strip's game slot ("of 3" is the best of 3). */
export function setBasedGameItem<K extends string>(
  key: K,
  game: number,
  bestOf: number,
): PadStripItem<K> {
  return { slot: 'game', text: { key, vars: { game, bestOf } } };
}

/** A game won on points, as the side's box: its score in it, lime when the side won it. */
export function playedScore(
  game: SetBasedGame,
  side: PadSide,
): { readonly value: string; readonly won: boolean } {
  return { value: String(game.points[side]), won: game.winner === side };
}

/**
 * The side's scores in the games won on points, said in game order ("Games: 11, 9"): the key names the `.other` plural
 * form, and the count picks the language's form.
 */
export function playedSaid<K extends string>(
  key: Extract<K, `${string}.other`>,
  played: readonly SetBasedGame[],
  side: PadSide,
): PadText<K> {
  return {
    key,
    count: played.length,
    vars: { scores: played.map((game) => game.points[side]).join(', ') },
  };
}

/** A decided match is the recorded result's card over the final score; any other phase, no card. */
export function resultCardOf(phase: SetBasedPhase): PadStateCard | null {
  return phase === 'decided' ? { kind: 'resultRecorded', undoLeft: null } : null;
}
