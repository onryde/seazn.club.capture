import type { EventEnvelope } from '@seazn/engine/core';
import { tabletennisPadRules } from '@seazn/engine/pad';
import type { PadSide } from '@/domain/scoring/padView';
import { field, summaryDone, type EventFacts } from '@/domain/scoring/setBasedLedgerHistory';
import { personName, sideOfEntrant, type SetBasedNames } from '@/domain/scoring/setBasedSides';
import type { TableTennisDone, TableTennisSanctionLevel } from '@/domain/scoring/tableTennisPad';

/**
 * What a table tennis event did, in the pad's words (design §6; plan S2-2 Task 3), badminton's twin
 * (`badmintonLedgerHistory`): the one vocabulary History and the last-tap line speak. The rest of History from the ledger
 * (the facts, the rows, the names, a set score) is the set-based sports' to share (`setBasedLedgerHistory`); this is the
 * part that is table tennis's: its event types, its two cards and the point that reached 13 returns.
 */

const R = tabletennisPadRules;

/**
 * What an event did, in the pad's words, or null for one it has no words for. `startServer` is the start's first
 * server when the ledger or this phone's pick says it.
 */
export function doneOf(
  envelope: EventEnvelope,
  facts: EventFacts,
  names: SetBasedNames,
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

/** A card level the engine lists for table tennis (`tabletennisPadRules.sanctionLevels`: yellow and red). */
const isCardLevel = (level: unknown): level is TableTennisSanctionLevel =>
  typeof level === 'string' && R.sanctionLevels.includes(level);

/** A point; one that reached the receiver's thirteenth return (under Expedite) says so, with the returns it carried. */
function rallyDone(
  names: SetBasedNames,
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

function sanctionDone(names: SetBasedNames, payload: unknown): TableTennisDone | null {
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
