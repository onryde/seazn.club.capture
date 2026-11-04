import {
  doneSaid,
  type BadmintonDisplay,
  type BadmintonDone,
  type BadmintonPadKey,
} from '@/domain/scoring/badmintonPad';
import type { PadHistoryGroup } from '@/domain/scoring/padView';
import { setBasedHistory, type SetBasedHistoryEntry } from '@/domain/scoring/setBasedHistory';

/**
 * One entry on the match's sheet as whoever keeps the score recorded it (the preview's fake; S2's ledger fold): what it
 * did then, the game it was recorded in, each side's points after it, whether this phone recorded it, whether Undo
 * took it back, and whether it is this phone's tap still on its way to the server (design §6.4). An entry Undo took
 * back keeps what it did when it was recorded.
 */
export type BadmintonHistoryEntry = SetBasedHistoryEntry<BadmintonDone>;

/**
 * History (owner ruling 21, 2026-10-31; view only): the entries grouped by the game they were recorded in, the latest
 * game first, each game's newest entry first, an entry Undo took back in its place. A rally gives the score after it,
 * top first; a sanction, a set score (its sentence says the score) and an ending give none. Nothing recorded, no group.
 * The grouping is the set-based sports' (`setBasedHistory`); the words are badminton's.
 */
export function badmintonHistory(
  entries: readonly BadmintonHistoryEntry[],
  sides: BadmintonDisplay['sides'],
): readonly PadHistoryGroup<BadmintonPadKey>[] {
  return setBasedHistory<BadmintonDone, BadmintonPadKey>(entries, {
    heading: (game) => ({ key: 'scoring.badminton.gameHeading', vars: { game } }),
    said: (did) => doneSaid(sides, did),
    scored: (did) => did.kind === 'rally',
  });
}
