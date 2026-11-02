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
 * What the phone's own files say of a match that is over (`finishOf`): the sport's line of the games ("21–15, 21–18").
 * It names the match, so a result read for one match is never taken for another's.
 */
export type MatchFinish = { readonly fixtureId: string; readonly score: string };

/**
 * The saved match. `dead`: its queue holds taps it can never send (the link is gone, the match is closed): the card
 * says so and Continue still opens the pad, which says why. `unreadable`: its file cannot be read, and the count is unknown.
 * `finished`: the match is over and every tap of this phone has reached the server (owner ruling 41, 2026-11-02): the card
 * says Finished with the score and offers Close, and nothing is lost by closing it. Null while a tap is unsent, dead or
 * unreadable, and while the files do not say the match is over.
 */
export type ScoringCurrent = {
  readonly fixtureId: string;
  readonly label: string;
  readonly unsent: number;
  readonly state: 'live' | 'dead' | 'unreadable';
  readonly finished: { readonly score: string } | null;
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

export function scoringHome(
  saved: SavedCode | null,
  rows: readonly QueueRow[],
  finish: MatchFinish | null = null,
): ScoringHome {
  const part = saved?.mode === 'scoring' ? saved.scoring : null;
  const fixtureId = part?.fixtureId ?? null;
  const own = rows.find((row) => idOf(row) === fixtureId);
  const current =
    part === null
      ? null
      : { fixtureId: part.fixtureId, label: part.label, ...finishedOf(stateOf(own), finish, part) };
  const others = rows.filter((row) => idOf(row) !== fixtureId);
  return { current, leftovers: others.flatMap(leftoverOf) };
}

/** Over, with nothing unsent and every tap able to go: the one state that is finished. Anything else is as it was. */
function finishedOf(
  own: Pick<ScoringCurrent, 'unsent' | 'state'>,
  finish: MatchFinish | null,
  match: { readonly fixtureId: string },
): Pick<ScoringCurrent, 'unsent' | 'state' | 'finished'> {
  const over =
    finish !== null &&
    finish.fixtureId === match.fixtureId &&
    own.state === 'live' &&
    own.unsent === 0;
  return { ...own, finished: over ? { score: finish.score } : null };
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
