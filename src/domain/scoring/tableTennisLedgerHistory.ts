import type { EventEnvelope } from '@seazn/engine/core';
import { tabletennisPadRules } from '@seazn/engine/pad';
import { isRecord } from '@/domain/credentials/wire';
import type { PadHistoryGroup, PadSide } from '@/domain/scoring/padView';
import { sideNames } from '@/domain/scoring/setBasedSides';
import { tableTennisHistory } from '@/domain/scoring/tableTennisHistory';
import type {
  TableTennisDisplay,
  TableTennisDone,
  TableTennisPadKey,
  TableTennisSanctionLevel,
  TableTennisSide,
} from '@/domain/scoring/tableTennisPad';
import type { BootstrapMember, BootstrapSide } from '@/domain/scoring/wire';

/**
 * History from the ledger (design §6; plan S2-2 Task 3), badminton's twin (`badmintonLedgerHistory`): every scorer's
 * events as the server holds them, this phone's queued taps on top marked as sending, an event another event voids
 * marked undone in its place, a void never a row of its own. What a row says comes from the event and its fold
 * (`doneOf`), the one vocabulary the last-tap line speaks too; the score after a point is the engine's fold of the ledger
 * up to it. Own is `ownEventIds` (the caller's), never the device link, which a browser on the same link shares.
 */

const R = tabletennisPadRules;

/** The sides as the pad names them: the entrant ids top first, the players as typed, and who plays for each. */
export type TableTennisNames = {
  readonly entrants: Readonly<Record<PadSide, string>>;
  readonly sides: Readonly<Record<PadSide, TableTennisSide>>;
  readonly members: Readonly<Record<PadSide, readonly BootstrapMember[]>>;
};

/** What the fold says of one event, from the match's state just after it. */
export type EventFacts = {
  /** The game it was recorded in: a point's own; anything else the game under way, or the next one between games. */
  readonly game: number;
  /** The points of the game it was recorded in, after it. */
  readonly after: Readonly<Record<PadSide, number>>;
  /** A point's: whether it won the game or the match. */
  readonly won: 'none' | 'game' | 'match';
};

/** One event of the match as History reads it: the ledger's in seq order, then this phone's legal queued taps. */
export type LedgerEntry = {
  readonly envelope: EventEnvelope;
  readonly own: boolean;
  readonly sending: boolean;
};

/** An event the pad has words for: what it did, and its facts. */
export type Recorded = { readonly did: TableTennisDone; readonly facts: EventFacts };

export function namesOf(seats: Readonly<Record<PadSide, BootstrapSide>>): TableTennisNames {
  const players = (seat: BootstrapSide): TableTennisSide => ({
    players: seat.members.length === 0 ? [seat.name] : seat.members.map((one) => one.fullName),
  });
  return {
    entrants: { first: seats.first.entrantId, second: seats.second.entrantId },
    sides: { first: players(seats.first), second: players(seats.second) },
    members: { first: seats.first.members, second: seats.second.members },
  };
}

/** The half an entrant id is, or null for an id that is neither side's. */
export function sideOfEntrant(names: TableTennisNames, entrantId: unknown): PadSide | null {
  if (entrantId === names.entrants.first) return 'first';
  return entrantId === names.entrants.second ? 'second' : null;
}

/** A carded person's name as typed; with none named (or one the side does not list), the side's names. */
function personName(names: TableTennisNames, side: PadSide, personId: unknown): string {
  const member = names.members[side].find((one) => one.personId === personId);
  return member?.fullName ?? sideNames(names.sides[side]);
}

/** A card level the engine lists for table tennis (`tabletennisPadRules.sanctionLevels`: yellow and red). */
const isCardLevel = (level: unknown): level is TableTennisSanctionLevel =>
  typeof level === 'string' && R.sanctionLevels.includes(level);

/**
 * What an event did, in the pad's words, or null for one it has no words for. `startServer` is the start's first
 * server when the ledger or this phone's pick says it.
 */
export function doneOf(
  envelope: EventEnvelope,
  facts: EventFacts,
  names: TableTennisNames,
  startServer: PadSide | null,
): TableTennisDone | null {
  const { payload } = envelope;
  switch (envelope.type) {
    case 'core.start':
      return { kind: 'start', server: startServer };
    case 'tabletennis.rally':
      return rallyDone(names, payload, facts);
    case 'tabletennis.timeout': {
      const side = sideOfEntrant(names, field(payload, 'by'));
      return side === null ? null : { kind: 'timeout', side };
    }
    case 'tabletennis.expedite.start':
      return { kind: 'expedite' };
    case 'tabletennis.sanction':
      return sanctionDone(names, payload);
    case 'tabletennis.game.summary':
      return summaryDone(names, payload);
    default:
      return null;
  }
}

/** A point; one that reached the receiver's thirteenth return (under Expedite) says so, with the returns it carried. */
function rallyDone(
  names: TableTennisNames,
  payload: unknown,
  facts: EventFacts,
): TableTennisDone | null {
  const side = sideOfEntrant(names, field(payload, 'wonBy'));
  if (side === null) return null;
  const point = { side, won: facts.won, game: facts.game };
  const returns = field(payload, 'returns');
  if (typeof returns === 'number' && returns >= R.expediteReturns) {
    return { kind: 'returns', ...point, returns };
  }
  return { kind: 'rally', ...point };
}

function sanctionDone(names: TableTennisNames, payload: unknown): TableTennisDone | null {
  const side = sideOfEntrant(names, field(payload, 'by'));
  const level = field(payload, 'level');
  if (side === null || !isCardLevel(level)) return null;
  return {
    kind: 'sanction',
    side,
    level,
    person: personName(names, side, field(payload, 'person')),
  };
}

/** A set score, top first: the positional form the pad writes, or the by-entrant form the engine also takes. */
function summaryDone(names: TableTennisNames, payload: unknown): TableTennisDone | null {
  const home = field(payload, 'home');
  const away = field(payload, 'away');
  if (typeof home === 'number' && typeof away === 'number') {
    return { kind: 'setScore', first: home, second: away };
  }
  const by = sideOfEntrant(names, field(payload, 'by'));
  const forBy = field(payload, 'forBy');
  const forOpp = field(payload, 'forOpp');
  if (by === null || typeof forBy !== 'number' || typeof forOpp !== 'number') return null;
  return by === 'first'
    ? { kind: 'setScore', first: forBy, second: forOpp }
    : { kind: 'setScore', first: forOpp, second: forBy };
}

const field = (payload: unknown, name: string): unknown =>
  isRecord(payload) ? payload[name] : undefined;

/**
 * History's groups: one row for each event the pad has words for (`recorded`, by envelope id), in the match's order,
 * undone when a void takes it back (`voided`), sending when it is this phone's queued tap. `tableTennisHistory` groups
 * them by game, newest first.
 */
export function ledgerHistory(
  entries: readonly LedgerEntry[],
  recorded: ReadonlyMap<string, Recorded>,
  voided: ReadonlySet<string>,
  sides: TableTennisDisplay['sides'],
): readonly PadHistoryGroup<TableTennisPadKey>[] {
  const rows = entries.flatMap((entry) => {
    const event = recorded.get(entry.envelope.id);
    if (event === undefined) return [];
    return [
      {
        did: event.did,
        game: event.facts.game,
        after: event.facts.after,
        own: entry.own,
        undone: voided.has(entry.envelope.id),
        sending: entry.sending,
      },
    ];
  });
  return tableTennisHistory(rows, sides);
}
