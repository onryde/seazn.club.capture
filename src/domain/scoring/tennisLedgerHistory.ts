import type { EventEnvelope } from '@seazn/engine/core';
import { tennisPadRules } from '@seazn/engine/pad';
import { isRecord } from '@/domain/credentials/wire';
import type { PadSide } from '@/domain/scoring/padView';
import { field } from '@/domain/scoring/setBasedLedgerHistory';
import { sideOfEntrant, type SetBasedNames } from '@/domain/scoring/setBasedSides';
import type {
  TennisBreakKind,
  TennisDone,
  TennisPerson,
  TennisSeenLevel,
  TennisWon,
} from '@/domain/scoring/tennisTypes';

/**
 * What a tennis event did, in the pad's words (S2-7 Task 4; ruling 226): the one vocabulary History and the last-tap line
 * speak, volleyball's twin (`volleyballLedgerHistory`). The facts are tennis's own: the set an event was recorded in and
 * whether a point won a game, a set or the match. Task 8 adds the organiser's forfeit and abandon to it.
 */

/** What the fold says of one event, from the match's state just after it. */
export type TennisFacts = {
  /** The set it was recorded in: a point's own, anything else the set under way, or the next one between sets. */
  readonly set: number;
  /** A point's: whether it won the game, the set or the match. */
  readonly won: TennisWon;
};

/** A level the engine lists for tennis (`tennisPadRules.sanctionLevels`), `default` included: the web may write it. */
export const isSeenLevel = (level: unknown): level is TennisSeenLevel =>
  typeof level === 'string' && tennisPadRules.sanctionLevels.includes(level);

/** A break kind the engine lists (`tennisPadRules.interruptionKinds`). */
export const isBreakKind = (kind: unknown): kind is TennisBreakKind =>
  typeof kind === 'string' && tennisPadRules.interruptionKinds.includes(kind);

/** The person an id names on `side`'s sheet; one the sheet does not list reads by no name; no id, none. */
function personOf(names: SetBasedNames, side: PadSide, id: unknown): TennisPerson | null {
  if (typeof id !== 'string') return null;
  const member = names.members[side].find((one) => one.personId === id);
  return { name: member?.fullName ?? null };
}

/** What an event did, or null for one the pad has no words for. */
export function tennisDoneOf(
  envelope: EventEnvelope,
  facts: TennisFacts,
  names: SetBasedNames,
): TennisDone | null {
  const { payload } = envelope;
  switch (envelope.type) {
    case 'core.start':
      return { kind: 'start' };
    case 'tennis.point': {
      const side = sideOfEntrant(names, field(payload, 'by'));
      return side === null ? null : { kind: 'point', side, set: facts.set, won: facts.won };
    }
    case 'tennis.set_summary':
      return setScoreDone(payload);
    case 'tennis.sanction': {
      const side = sideOfEntrant(names, field(payload, 'by'));
      const level = field(payload, 'level');
      if (side === null || !isSeenLevel(level)) return null;
      return {
        kind: 'violation',
        side,
        level,
        person: personOf(names, side, field(payload, 'person')),
      };
    }
    case 'tennis.game.award': {
      const side = sideOfEntrant(names, field(payload, 'winner'));
      return side === null ? null : { kind: 'award', side };
    }
    case 'tennis.interruption':
      return breakDone(names, payload);
    default:
      return null;
  }
}

function setScoreDone(payload: unknown): TennisDone | null {
  const home = field(payload, 'home');
  const away = field(payload, 'away');
  if (typeof home !== 'number' || typeof away !== 'number') return null;
  const tb = field(payload, 'tb');
  const points =
    isRecord(tb) && typeof tb.home === 'number' && typeof tb.away === 'number'
      ? { first: tb.home, second: tb.away }
      : null;
  return { kind: 'setScore', first: home, second: away, tb: points };
}

function breakDone(names: SetBasedNames, payload: unknown): TennisDone | null {
  const breakKind = field(payload, 'kind');
  if (!isBreakKind(breakKind)) return null;
  return { kind: 'break', breakKind, side: sideOfEntrant(names, field(payload, 'by')) };
}
