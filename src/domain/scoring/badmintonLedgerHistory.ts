import type { EventEnvelope } from '@seazn/engine/core';
import { isRecord } from '@/domain/credentials/wire';
import { badmintonHistory } from '@/domain/scoring/badmintonHistory';
import {
  SANCTION_LEVELS,
  sideNames,
  type BadmintonDisplay,
  type BadmintonDone,
  type BadmintonPadKey,
  type BadmintonSide,
} from '@/domain/scoring/badmintonPad';
import type { PadHistoryGroup, PadSide } from '@/domain/scoring/padView';
import type { BootstrapMember, BootstrapSide } from '@/domain/scoring/wire';

/**
 * History from the ledger (design §6.4; plan S2-1 Task 7): every scorer's events as the server holds them, this phone's
 * queued taps on top marked as sending, an event another event voids marked undone in its place, a void never a row of
 * its own. What a row says comes from the event and its fold (`doneOf`), the one vocabulary the last-tap line speaks
 * too; the score after a rally is the engine's fold of the ledger up to it. Own is `ownEventIds` (the caller's), never
 * the device link, which a browser on the same link shares.
 */

/** The sides as the pad names them: the entrant ids top first, the players as typed, and who plays for each. */
export type BadmintonNames = {
  readonly entrants: Readonly<Record<PadSide, string>>;
  readonly sides: Readonly<Record<PadSide, BadmintonSide>>;
  readonly members: Readonly<Record<PadSide, readonly BootstrapMember[]>>;
};

/** What the fold says of one event, from the match's state just after it. */
export type EventFacts = {
  /** The game it was recorded in: a rally's own; anything else the game under way, or the next one between games. */
  readonly game: number;
  /** The points of the game it was recorded in, after it. */
  readonly after: Readonly<Record<PadSide, number>>;
  /** A rally's: whether it won the game or the match. */
  readonly won: 'none' | 'game' | 'match';
  /** The person of the latest sanction standing then, or null: a disqualification's ending names them. */
  readonly sanctionedPerson: string | null;
};

/** One event of the match as History reads it: the ledger's in seq order, then this phone's legal queued taps. */
export type LedgerEntry = {
  readonly envelope: EventEnvelope;
  readonly own: boolean;
  readonly sending: boolean;
};

/** An event the pad has words for: what it did, and its facts. */
export type Recorded = { readonly did: BadmintonDone; readonly facts: EventFacts };

export function namesOf(seats: Readonly<Record<PadSide, BootstrapSide>>): BadmintonNames {
  const players = (seat: BootstrapSide): BadmintonSide => ({
    players: seat.members.length === 0 ? [seat.name] : seat.members.map((one) => one.fullName),
  });
  return {
    entrants: { first: seats.first.entrantId, second: seats.second.entrantId },
    sides: { first: players(seats.first), second: players(seats.second) },
    members: { first: seats.first.members, second: seats.second.members },
  };
}

/** The half an entrant id is, or null for an id that is neither side's. */
export function sideOfEntrant(names: BadmintonNames, entrantId: unknown): PadSide | null {
  if (entrantId === names.entrants.first) return 'first';
  return entrantId === names.entrants.second ? 'second' : null;
}

/** A sanctioned person's name as typed; with none named (or one the side does not list), the side's names. */
export function personName(names: BadmintonNames, side: PadSide, personId: unknown): string {
  const member = names.members[side].find((one) => one.personId === personId);
  return member?.fullName ?? sideNames(names.sides[side]);
}

/**
 * What an event did, in the pad's words, or null for one it has no words for. `startServer` is the start's first
 * server when the ledger or this phone's pick says it.
 */
export function doneOf(
  envelope: EventEnvelope,
  facts: EventFacts,
  names: BadmintonNames,
  startServer: PadSide | null,
): BadmintonDone | null {
  const { payload } = envelope;
  switch (envelope.type) {
    case 'core.start':
      return { kind: 'start', server: startServer };
    case 'badminton.rally':
      return rallyDone(names, payload, facts);
    case 'badminton.sanction':
      return sanctionDone(names, payload);
    case 'badminton.game.summary':
      return summaryDone(names, payload);
    case 'core.forfeit':
      return endingDone(names, payload, facts);
    default:
      return null;
  }
}

function rallyDone(
  names: BadmintonNames,
  payload: unknown,
  facts: EventFacts,
): BadmintonDone | null {
  const side = sideOfEntrant(names, field(payload, 'wonBy'));
  return side === null ? null : { kind: 'rally', side, won: facts.won, game: facts.game };
}

function sanctionDone(names: BadmintonNames, payload: unknown): BadmintonDone | null {
  const side = sideOfEntrant(names, field(payload, 'by'));
  const level = SANCTION_LEVELS.find((known) => known === field(payload, 'level'));
  if (side === null || level === undefined) return null;
  return {
    kind: 'sanction',
    side,
    level,
    person: personName(names, side, field(payload, 'person')),
  };
}

/** A set score, top first: the positional form the pad writes, or the by-entrant form the engine also takes. */
function summaryDone(names: BadmintonNames, payload: unknown): BadmintonDone | null {
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

/** A disqualification's ending names the person disqualified; any other forfeit (the organiser's) has no words here. */
function endingDone(
  names: BadmintonNames,
  payload: unknown,
  facts: EventFacts,
): BadmintonDone | null {
  const side = sideOfEntrant(names, field(payload, 'by'));
  if (side === null || field(payload, 'reason') !== 'disqualified') return null;
  return { kind: 'ending', side, person: personName(names, side, facts.sanctionedPerson) };
}

const field = (payload: unknown, name: string): unknown =>
  isRecord(payload) ? payload[name] : undefined;

/**
 * History's groups: one row for each event the pad has words for (`recorded`, by envelope id), in the match's order,
 * undone when a void takes it back (`voided`), sending when it is this phone's queued tap. `badmintonHistory` groups
 * them by game, newest first.
 */
export function ledgerHistory(
  entries: readonly LedgerEntry[],
  recorded: ReadonlyMap<string, Recorded>,
  voided: ReadonlySet<string>,
  sides: BadmintonDisplay['sides'],
): readonly PadHistoryGroup<BadmintonPadKey>[] {
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
  return badmintonHistory(rows, sides);
}
