import type { SavedCode } from '@/domain/mode/savedCode';
import type { MatchQueue } from '@/domain/scoring/queue';

/**
 * What Home's Remote Scoring cards say (design §5 and §6.3, ruling 29; plan S2-1 Task 10), pure: the saved match with
 * its unsent count, then every other match's queue that still holds taps. A queue the store could not read is a row of
 * its own, with no count. The words are the UI's; this decides which cards there are and what each is about.
 */

/** One match's queue as the store lists it: the shape of `QueueEntry`, which the domain may not import. */
export type QueueRow =
  | { readonly kind: 'queue'; readonly queue: MatchQueue }
  | { readonly kind: 'unreadable'; readonly fixtureId: string };

/**
 * The saved match. `dead`: its queue holds taps it can never send (the link is gone, the match is closed): the card
 * says so and Continue still opens the pad, which says why. `unreadable`: its file cannot be read, and the count is unknown.
 */
export type ScoringCurrent = {
  readonly fixtureId: string;
  readonly label: string;
  readonly unsent: number;
  readonly state: 'live' | 'dead' | 'unreadable';
};

/**
 * Another match's taps. `live` still send, in the background, while the app is open: no Dismiss, it would discard unsent
 * taps. `dead` can never send and `unreadable` cannot be read: each is told to the organiser and can be dismissed.
 */
export type ScoringLeftover =
  | {
      readonly kind: 'live';
      readonly fixtureId: string;
      readonly label: string;
      readonly unsent: number;
    }
  | {
      readonly kind: 'dead';
      readonly fixtureId: string;
      readonly label: string;
      readonly unsent: number;
    }
  | { readonly kind: 'unreadable'; readonly fixtureId: string };

export type ScoringHome = {
  readonly current: ScoringCurrent | null;
  readonly leftovers: readonly ScoringLeftover[];
};

export function scoringHome(saved: SavedCode | null, rows: readonly QueueRow[]): ScoringHome {
  const part = saved?.mode === 'scoring' ? saved.scoring : null;
  const fixtureId = part?.fixtureId ?? null;
  const own = rows.find((row) => idOf(row) === fixtureId);
  const current =
    part === null ? null : { fixtureId: part.fixtureId, label: part.label, ...stateOf(own) };
  const others = rows.filter((row) => idOf(row) !== fixtureId);
  return { current, leftovers: others.flatMap(leftoverOf) };
}

const idOf = (row: QueueRow): string =>
  row.kind === 'queue' ? row.queue.fixtureId : row.fixtureId;

/** A queue with taps in it and a way to send them is live; a dead word with nothing queued is no news. */
function stateOf(row: QueueRow | undefined): Pick<ScoringCurrent, 'unsent' | 'state'> {
  if (row === undefined) return { unsent: 0, state: 'live' };
  if (row.kind === 'unreadable') return { unsent: 0, state: 'unreadable' };
  const unsent = row.queue.pending.length;
  return { unsent, state: unsent > 0 && row.queue.dead !== null ? 'dead' : 'live' };
}

function leftoverOf(row: QueueRow): readonly ScoringLeftover[] {
  if (row.kind === 'unreadable') return [{ kind: 'unreadable', fixtureId: row.fixtureId }];
  const { queue } = row;
  const unsent = queue.pending.length;
  if (unsent === 0) return [];
  const { fixtureId, label } = queue;
  return [{ kind: queue.dead === null ? 'live' : 'dead', fixtureId, label, unsent }];
}

/** What would change a card: the same string is the same cards, so Home re-renders only when the disk really moved. */
export function rowsKey(rows: readonly QueueRow[]): string {
  return rows
    .map((row) =>
      row.kind === 'queue'
        ? `${row.queue.fixtureId}|${row.queue.label}|${row.queue.pending.length}|${row.queue.dead ?? ''}`
        : `!${row.fixtureId}`,
    )
    .join('\n');
}
