import type { EventEnvelope } from '@seazn/engine/core';
import { SANCTION_LEVELS, type BadmintonDone } from '@/domain/scoring/badmintonPad';
import type { PadSide } from '@/domain/scoring/padView';
import { field, summaryDone, type EventFacts } from '@/domain/scoring/setBasedLedgerHistory';
import { personName, sideOfEntrant, type SetBasedNames } from '@/domain/scoring/setBasedSides';

/**
 * What a badminton event did, in the pad's words (design §6.4; plan S2-1 Task 7): the one vocabulary History and the
 * last-tap line speak. The rest of History from the ledger (the facts, the rows, the names, a set score) is the
 * set-based sports' to share (`setBasedLedgerHistory`); this is the part that is badminton's: its event types, its four
 * sanction levels and a disqualification's ending.
 */

/**
 * What an event did, in the pad's words, or null for one it has no words for. `startServer` is the start's first
 * server when the ledger or this phone's pick says it.
 */
export function doneOf(
  envelope: EventEnvelope,
  facts: EventFacts,
  names: SetBasedNames,
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
  names: SetBasedNames,
  payload: unknown,
  facts: EventFacts,
): BadmintonDone | null {
  const side = sideOfEntrant(names, field(payload, 'wonBy'));
  return side === null ? null : { kind: 'rally', side, won: facts.won, game: facts.game };
}

function sanctionDone(names: SetBasedNames, payload: unknown): BadmintonDone | null {
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

/** A disqualification's ending names the person disqualified; any other forfeit (the organiser's) has no words here. */
function endingDone(
  names: SetBasedNames,
  payload: unknown,
  facts: EventFacts,
): BadmintonDone | null {
  const side = sideOfEntrant(names, field(payload, 'by'));
  if (side === null || field(payload, 'reason') !== 'disqualified') return null;
  return { kind: 'ending', side, person: personName(names, side, facts.sanctionedPerson) };
}
