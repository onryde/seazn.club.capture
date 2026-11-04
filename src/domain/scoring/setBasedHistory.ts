import type { PadHistoryGroup, PadHistoryRow, PadSide, PadText } from '@/domain/scoring/padView';
import { scoreText } from '@/domain/scoring/setBasedSides';

/**
 * History (owner ruling 21, 2026-10-31; view only) for the set-based sports (badminton, table tennis; plan S2-2 Task 3,
 * lifted from badminton's): the same shape word for word. A generic file: it names no sport, and a sport's own history
 * file (`badmintonHistory`) says only its words.
 *
 * One entry on the match's sheet as whoever keeps the score recorded it (the preview's fake; S2's ledger fold): what it
 * did then (`D`, the sport's own type), the game it was recorded in, each side's points after it, whether this phone
 * recorded it, whether Undo took it back, and whether it is this phone's tap still on its way to the server (design
 * §6.4). An entry Undo took back keeps what it did when it was recorded.
 */
export type SetBasedHistoryEntry<D> = {
  readonly did: D;
  readonly game: number;
  readonly after: Readonly<Record<PadSide, number>>;
  readonly own: boolean;
  readonly undone: boolean;
  readonly sending: boolean;
};

/** What a sport says: its game heading, what a tap did in the last-tap line's words, and which taps show a score. */
export type SetBasedHistoryWords<D, K extends string> = {
  readonly heading: (game: number) => PadText<K>;
  readonly said: (did: D) => PadText<K>;
  /** A point gives the score after it, top first; a card, a timeout, a set score (its sentence says it) give none. */
  readonly scored: (did: D) => boolean;
};

/**
 * The entries grouped by the game they were recorded in, the latest game first, each game's newest entry first, an
 * entry Undo took back in its place. Nothing recorded, no group.
 */
export function setBasedHistory<D, K extends string>(
  entries: readonly SetBasedHistoryEntry<D>[],
  words: SetBasedHistoryWords<D, K>,
): readonly PadHistoryGroup<K>[] {
  const games = [...new Set(entries.map((entry) => entry.game))].sort((a, b) => b - a);
  return games.map((game) => ({
    heading: words.heading(game),
    rows: entries
      .filter((entry) => entry.game === game)
      .reverse()
      .map((entry) => historyRow(entry, words)),
  }));
}

function historyRow<D, K extends string>(
  entry: SetBasedHistoryEntry<D>,
  words: SetBasedHistoryWords<D, K>,
): PadHistoryRow<K> {
  return {
    said: words.said(entry.did),
    score: words.scored(entry.did) ? scoreText(entry.after) : null,
    by: entry.own ? 'thisPhone' : 'otherScorer',
    undone: entry.undone,
    sending: entry.sending,
  };
}
