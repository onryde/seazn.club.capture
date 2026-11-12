import type { AwardReason, EventEnvelope } from '@seazn/engine/core';
import { tennisPadRules } from '@seazn/engine/pad';
import { isRecord } from '@/domain/credentials/wire';
import type { PadSide } from '@/domain/scoring/padView';
import { field } from '@/domain/scoring/setBasedLedgerHistory';
import { sideOfEntrant, type SetBasedNames } from '@/domain/scoring/setBasedSides';
import type {
  TennisBreakKind,
  TennisDone,
  TennisEnding,
  TennisPerson,
  TennisSeenLevel,
  TennisWon,
} from '@/domain/scoring/tennisTypes';

/**
 * What a tennis event did, in the pad's words (S2-7 Task 4; ruling 226): the one vocabulary History and the last-tap line
 * speak, volleyball's twin (`volleyballLedgerHistory`). The facts are tennis's own: the set an event was recorded in and
 * whether a point won a game, a set or the match; the organiser's forfeit and abandon are rows of it too (Task 8).
 */

/** What the fold says of one event, from the match's state just after it. */
export type TennisFacts = {
  /** The set it was recorded in: a point's own, anything else the set under way, or the next one between sets. */
  readonly set: number;
  /** A point's: whether it won the game, the set or the match. */
  readonly won: TennisWon;
  /**
   * What the event left on the board, for a point's History row: the games when it closed a game or a set ("3–2", "6–4"),
   * else the game's call ("30–15", "AD–40") or a breaker's points ("4–3"). First side's first, joined by an en dash.
   */
  readonly after: string;
};

/**
 * How the engine's award reasons read in the pad's words, typed over every one it lists (`AwardReason`, `bye` the system's
 * included): a reason added to the engine does not compile until it is given an ending, and a reason an older or newer
 * engine wrote that this table lacks falls back to a walkover (`endingKindOf`), never to a match read as decided.
 */
const ENDING_KINDS = {
  walkover: 'walkover',
  retired: 'retired',
  disqualified: 'defaulted',
  withdrew: 'withdrew',
  bye: 'walkover',
} as const satisfies Readonly<Record<AwardReason, TennisEnding['kind']>>;

const isAwardReason = (reason: string): reason is AwardReason =>
  Object.hasOwn(ENDING_KINDS, reason);

/**
 * The ending an award's or a forfeit's reason is: a walkover for a reason this build does not know, so an ended match
 * always has words (the sweep over the engine's reasons is `tennisFold.reasons.test.ts`).
 */
export const endingKindOf = (reason: string): TennisEnding['kind'] =>
  isAwardReason(reason) ? ENDING_KINDS[reason] : 'walkover';

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
    case 'core.forfeit': {
      const reason = field(payload, 'reason');
      if (typeof reason !== 'string') return null;
      return {
        kind: 'ending',
        ending: endingKindOf(reason),
        side: sideOfEntrant(names, field(payload, 'by')),
      };
    }
    case 'core.abandon':
      return { kind: 'ending', ending: 'abandoned', side: null };
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
