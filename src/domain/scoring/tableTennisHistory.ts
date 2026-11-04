import type { PadHistoryGroup, PadSide, PadText } from '@/domain/scoring/padView';
import { setBasedHistory, type SetBasedHistoryEntry } from '@/domain/scoring/setBasedHistory';
import { scoreText, sideNames } from '@/domain/scoring/setBasedSides';
import type {
  TableTennisDisplay,
  TableTennisDone,
  TableTennisPadKey,
  TableTennisSanctionLevel,
} from '@/domain/scoring/tableTennisPad';

type Text = PadText<TableTennisPadKey>;

/**
 * One entry on the match's sheet as whoever keeps the score recorded it (S2's ledger fold): what it did then, the game it
 * was recorded in, each side's points after it, whether this phone recorded it, whether Undo took it back, and whether
 * it is this phone's tap still on its way to the server (design §6.4). An entry Undo took back keeps what it did when it
 * was recorded.
 */
export type TableTennisHistoryEntry = SetBasedHistoryEntry<TableTennisDone>;

/**
 * History (owner ruling 21, 2026-10-31; view only), the same shape as badminton's: the entries grouped by the game they
 * were recorded in, the latest game first, each game's newest entry first, an entry Undo took back in its place. A point
 * (a 13 returns point included) gives the score after it, top first; a card, a timeout, Expedite and a set score (its
 * sentence says the score) give none. Nothing recorded, no group. The grouping is the set-based sports'
 * (`setBasedHistory`); the words are table tennis's.
 */
export function tableTennisHistory(
  entries: readonly TableTennisHistoryEntry[],
  sides: TableTennisDisplay['sides'],
): readonly PadHistoryGroup<TableTennisPadKey>[] {
  return setBasedHistory<TableTennisDone, TableTennisPadKey>(entries, {
    heading: (game) => ({ key: 'scoring.tabletennis.gameHeading', vars: { game } }),
    said: (did) => doneSaid(sides, did),
    scored: (did) => did.kind === 'rally' || did.kind === 'returns',
  });
}

/** A card level's word: the umpire's yellow (`warning`) and red (`penalty`). */
export const cardWord = (level: TableTennisSanctionLevel): Text => ({
  key: `scoring.tabletennis.card.${level}`,
});

/**
 * What a tap did, in the last-tap line's words ("Point recorded — A. Sharma"): the line says it of the last tap, and
 * History (owner ruling 21) of every tap, in the one vocabulary. A 13 returns point says its point first, then the
 * returns: "Point recorded — game 1 to A. Sharma · 13 shots".
 */
export function doneSaid(sides: TableTennisDisplay['sides'], tap: TableTennisDone): Text {
  const side = (of: PadSide) => sideNames(sides[of]);
  switch (tap.kind) {
    case 'start':
      return tap.server === null
        ? { key: 'scoring.tabletennis.last.startUnknownServer' }
        : { key: 'scoring.tabletennis.last.start', vars: { side: side(tap.server) } };
    case 'rally':
      return pointSaid(sides, tap);
    case 'returns':
      return {
        key: 'scoring.tabletennis.last.returns',
        vars: { point: pointSaid(sides, tap), returns: tap.returns },
      };
    case 'timeout':
      return { key: 'scoring.tabletennis.last.timeout', vars: { side: side(tap.side) } };
    case 'expedite':
      return { key: 'scoring.tabletennis.last.expedite' };
    case 'sanction':
      return {
        key: 'scoring.tabletennis.last.sanction',
        vars: { level: cardWord(tap.level), person: tap.person },
      };
    case 'setScore':
      return { key: 'scoring.tabletennis.last.setScore', vars: { score: scoreText(tap) } };
  }
}

/** A point: who won it, and whether it won a game or the match. */
function pointSaid(
  sides: TableTennisDisplay['sides'],
  tap: Extract<TableTennisDone, { readonly kind: 'rally' | 'returns' }>,
): Text {
  const side = sideNames(sides[tap.side]);
  if (tap.won === 'game') {
    return { key: 'scoring.tabletennis.last.game', vars: { game: tap.game, side } };
  }
  const key =
    tap.won === 'match' ? 'scoring.tabletennis.last.match' : 'scoring.tabletennis.last.rally';
  return { key, vars: { side } };
}
