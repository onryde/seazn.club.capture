import {
  doneSaid,
  scoreText,
  type BadmintonDisplay,
  type BadmintonDone,
  type BadmintonPadKey,
} from '@/domain/scoring/badmintonPad';
import type { PadHistoryGroup, PadHistoryRow, PadSide } from '@/domain/scoring/padView';

/**
 * One entry on the match's sheet as whoever keeps the score recorded it (the preview's fake; S2's ledger fold): what it
 * did then, the game it was recorded in, each side's points after it, whether this phone recorded it, whether Undo
 * took it back, and whether it is this phone's tap still on its way to the server (design §6.4). An entry Undo took
 * back keeps what it did when it was recorded.
 */
export type BadmintonHistoryEntry = {
  readonly did: BadmintonDone;
  readonly game: number;
  readonly after: Readonly<Record<PadSide, number>>;
  readonly own: boolean;
  readonly undone: boolean;
  readonly sending: boolean;
};

/**
 * History (owner ruling 21, 2026-10-31; view only): the entries grouped by the game they were recorded in, the latest
 * game first, each game's newest entry first, an entry Undo took back in its place. A rally gives the score after it,
 * top first; a sanction, a set score (its sentence says the score) and an ending give none. Nothing recorded, no group.
 */
export function badmintonHistory(
  entries: readonly BadmintonHistoryEntry[],
  sides: BadmintonDisplay['sides'],
): readonly PadHistoryGroup<BadmintonPadKey>[] {
  const games = [...new Set(entries.map((entry) => entry.game))].sort((a, b) => b - a);
  return games.map((game) => ({
    heading: { key: 'scoring.badminton.gameHeading', vars: { game } },
    rows: entries
      .filter((entry) => entry.game === game)
      .reverse()
      .map((entry) => historyRow(entry, sides)),
  }));
}

function historyRow(
  entry: BadmintonHistoryEntry,
  sides: BadmintonDisplay['sides'],
): PadHistoryRow<BadmintonPadKey> {
  return {
    said: doneSaid(sides, entry.did),
    score: entry.did.kind === 'rally' ? scoreText(entry.after) : null,
    by: entry.own ? 'thisPhone' : 'otherScorer',
    undone: entry.undone,
    sending: entry.sending,
  };
}
