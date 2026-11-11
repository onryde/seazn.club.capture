import type { EventEnvelope } from '@seazn/engine/core';
import { volleyballPadRules } from '@seazn/engine/pad';
import type { PadSide } from '@/domain/scoring/padView';
import { field, summaryDone, type EventFacts } from '@/domain/scoring/setBasedLedgerHistory';
import { sideOfEntrant, type SetBasedNames } from '@/domain/scoring/setBasedSides';
import type {
  VolleyballDone,
  VolleyballPerson,
  VolleyballSanctionLevel,
} from '@/domain/scoring/volleyballTypes';

/**
 * What a volleyball event did, in the pad's words (S2-6 ruling 183), table tennis's twin (`tableTennisLedgerHistory`): the
 * one vocabulary History and the last-tap line speak. The facts, the rows and a set score are the set-based sports' to
 * share (`setBasedLedgerHistory`); this is volleyball's: its event types, its four sanction levels, the sub, and the
 * deciding set's toss riding a rally.
 */

/** A sanction level the engine lists for volleyball (`volleyballPadRules.sanctionLevels`). */
export const isSanctionLevel = (level: unknown): level is VolleyballSanctionLevel =>
  typeof level === 'string' && volleyballPadRules.sanctionLevels.includes(level);

/** The first set: its first rally carries Start's pick, which the start's own row says already. */
const FIRST_SET = 1;

/**
 * What an event did, or null for one the pad has no words for. `startServer` is the start's first server when the
 * ledger or this phone's pick says it.
 */
export function doneOf(
  envelope: EventEnvelope,
  facts: EventFacts,
  names: SetBasedNames,
  startServer: PadSide | null,
): VolleyballDone | null {
  const { payload } = envelope;
  switch (envelope.type) {
    case 'core.start':
      return { kind: 'start', server: startServer };
    case 'volleyball.rally':
      return rallyDone(names, payload, facts);
    case 'volleyball.timeout': {
      const side = sideOfEntrant(names, field(payload, 'by'));
      return side === null ? null : { kind: 'timeout', side };
    }
    case 'volleyball.sub':
      return subDone(names, payload);
    case 'volleyball.sanction':
      return sanctionDone(names, payload);
    case 'volleyball.set.summary':
      return summaryDone(names, payload);
    default:
      return null;
  }
}

/** A point; one that carried a serve answer in a set after the first is the deciding set's toss (ruling 183). */
function rallyDone(
  names: SetBasedNames,
  payload: unknown,
  facts: EventFacts,
): VolleyballDone | null {
  const side = sideOfEntrant(names, field(payload, 'wonBy'));
  if (side === null) return null;
  const serving = sideOfEntrant(names, field(payload, 'serving'));
  const toss = facts.game > FIRST_SET ? serving : null;
  return { kind: 'rally', side, won: facts.won, set: facts.game, toss };
}

/** The person an id names on `side`'s sheet; one the sheet does not list reads by no name; no id, none. */
function personOf(names: SetBasedNames, side: PadSide, id: unknown): VolleyballPerson | null {
  if (typeof id !== 'string') return null;
  const member = names.members[side].find((one) => one.personId === id);
  return { name: member?.fullName ?? null };
}

function subDone(names: SetBasedNames, payload: unknown): VolleyballDone | null {
  const side = sideOfEntrant(names, field(payload, 'by'));
  if (side === null) return null;
  return {
    kind: 'sub',
    side,
    off: personOf(names, side, field(payload, 'off')),
    on: personOf(names, side, field(payload, 'on')),
  };
}

function sanctionDone(names: SetBasedNames, payload: unknown): VolleyballDone | null {
  const side = sideOfEntrant(names, field(payload, 'by'));
  const level = field(payload, 'level');
  if (side === null || !isSanctionLevel(level)) return null;
  return { kind: 'sanction', side, level, person: personOf(names, side, field(payload, 'person')) };
}
