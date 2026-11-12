import type { PadHistoryGroup, PadSide, PadText, PadVar } from '@/domain/scoring/padView';
import { sideNames } from '@/domain/scoring/setBasedSides';
import { levelWord } from '@/domain/scoring/tennisLevels';
import type {
  TennisDisplay,
  TennisDone,
  TennisEnding,
  TennisPadKey,
  TennisPerson,
} from '@/domain/scoring/tennisTypes';

type Text = PadText<TennisPadKey>;

/**
 * One entry on the match's sheet as whoever keeps the score recorded it (S2-7 Task 8; rulings 225, 226): what it did then,
 * the set it was recorded in, what a point left on the board (`TennisFacts.after`), whether this phone recorded it, whether
 * Undo took it back, and whether it is this phone's tap still on its way to the server (design §6.4).
 */
export type TennisHistoryEntry = {
  readonly did: TennisDone;
  readonly set: number;
  readonly after: string;
  readonly own: boolean;
  readonly undone: boolean;
  readonly sending: boolean;
};

/**
 * History (owner ruling 21; view only), the set-based sports' shape over tennis's own entries: grouped by the set they
 * were recorded in, the latest set first, each set's newest entry first, an entry Undo took back in its place. A point
 * gives what it left on the board, the call after it or the games when it closed a game; every other row gives none (its
 * sentence says what it did). The organiser's forfeit and abandon are rows like any other.
 */
export function tennisHistory(
  entries: readonly TennisHistoryEntry[],
  sides: TennisDisplay['sides'],
): readonly PadHistoryGroup<TennisPadKey>[] {
  const sets = [...new Set(entries.map((entry) => entry.set))].sort((a, b) => b - a);
  return sets.map((set) => ({
    heading: { key: 'scoring.tennis.setHeading', vars: { set } },
    rows: entries
      .filter((entry) => entry.set === set)
      .reverse()
      .map((entry) => ({
        said: doneSaid(sides, entry.did),
        score: entry.did.kind === 'point' ? entry.after : null,
        by: entry.own ? ('thisPhone' as const) : ('otherScorer' as const),
        undone: entry.undone,
        sending: entry.sending,
      })),
  }));
}

/** A person as typed, or "Player" for one the sheet no longer lists: never blank. */
export const personWord = (person: TennisPerson): PadVar<TennisPadKey> =>
  person.name ?? { key: 'scoring.tennis.player' };

/** Who a violation was for: the person named, else the side. */
export function whoWord(
  sides: TennisDisplay['sides'],
  side: PadSide,
  person: TennisPerson | null,
): PadVar<TennisPadKey> {
  return person === null ? sideNames(sides[side]) : personWord(person);
}

/**
 * What a tap did, in the last-tap line's words ("Point recorded — Ana Ruiz"): the line says it of the last tap, and History
 * of every tap, in the one vocabulary. A point that closed a game, a set or the match says so; the organiser's forfeit reads
 * "Retired · Bea Lund" and an abandon "Abandoned", as the pad's own result card does.
 */
export function doneSaid(sides: TennisDisplay['sides'], tap: TennisDone): Text {
  const side = (of: PadSide) => sideNames(sides[of]);
  switch (tap.kind) {
    case 'start':
      return { key: 'scoring.tennis.last.start' };
    case 'toss':
      return { key: 'scoring.tennis.last.toss', vars: { side: side(tap.side) } };
    case 'point':
      return pointSaid(side(tap.side), tap);
    case 'setScore':
      return { key: 'scoring.tennis.last.setScore', vars: { score: setScoreText(tap) } };
    case 'violation':
      return {
        key: 'scoring.tennis.last.violation',
        vars: { level: levelWord(tap.level), person: whoWord(sides, tap.side, tap.person) },
      };
    case 'award':
      return { key: 'scoring.tennis.last.award', vars: { side: side(tap.side) } };
    case 'break':
      return breakSaid(tap, tap.side === null ? null : side(tap.side));
    case 'ending':
      return endingSaid(tap.ending, sides, tap.side);
  }
}

/** A set score as it is written: the games, a tie-break set with the loser's points ("7–6(5)"). */
export function setScoreText(tap: {
  readonly first: number;
  readonly second: number;
  readonly tb: { readonly first: number; readonly second: number } | null;
}): string {
  const games = `${tap.first}–${tap.second}`;
  return tap.tb === null ? games : `${games}(${Math.min(tap.tb.first, tap.tb.second)})`;
}

function pointSaid(side: string, tap: Extract<TennisDone, { readonly kind: 'point' }>): Text {
  switch (tap.won) {
    case 'game':
      return { key: 'scoring.tennis.last.game', vars: { side } };
    case 'set':
      return { key: 'scoring.tennis.last.set', vars: { set: tap.set, side } };
    case 'match':
      return { key: 'scoring.tennis.last.match', vars: { side } };
    case 'none':
      return { key: 'scoring.tennis.last.point', vars: { side } };
  }
}

/** The break's kind in its sheet's word, with the side it was for when it had one. */
function breakSaid(
  tap: Extract<TennisDone, { readonly kind: 'break' }>,
  side: string | null,
): Text {
  const kind: Text = { key: `scoring.tennis.break.kind.${tap.breakKind}` };
  return side === null
    ? { key: 'scoring.tennis.last.break', vars: { kind } }
    : { key: 'scoring.tennis.last.breakFor', vars: { kind, side } };
}

/** "Retired · Bea Lund": the organiser's ending and the side at fault; with no side (an abandon), the word alone. */
export function endingSaid(
  ending: TennisEnding['kind'],
  sides: TennisDisplay['sides'],
  side: PadSide | null,
): Text {
  const word: Text = { key: `scoring.tennis.ending.${ending}` };
  if (side === null) return word;
  return { key: 'scoring.tennis.ending.by', vars: { ending: word, side: sideNames(sides[side]) } };
}
