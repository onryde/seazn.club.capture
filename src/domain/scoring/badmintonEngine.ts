import { EngineError, foldMatch, type EventEnvelope, type LineupPair } from '@seazn/engine/core';
import { badminton, type SetBasedCfg } from '@seazn/engine/sports/setbased';
import type { QueuedEvent } from '@/domain/scoring/queue';
import { voidTargetOf, type BootstrapSide, type LedgerEvent } from '@/domain/scoring/wire';

/**
 * The badminton engine as the phone and its fake server both reach it (plan S2-1 Task 7): the match's config read
 * through the engine's own schema, the lineups the web builds from a side, the ledger's events as the engine's
 * envelopes, and the server's judgement of one new event. One copy: `badmintonFold` and `fakeScoringPort` both fold
 * through here, so the phone and its fake can never judge an event two ways.
 */

/** What the engine needs to fold a match: its id (every envelope names it), its config and its two lineups. */
export type BadmintonEngineMatch = {
  readonly fixtureId: string;
  readonly cfg: SetBasedCfg;
  readonly lineups: LineupPair;
};

/** The match's config through the engine's schema, which fills what the organiser left out. Throws on a garbled one. */
export const badmintonCfg = (raw: unknown): SetBasedCfg => badminton.configSchema.parse(raw);

/** A side's lineup as the web builds it: every member starting, in pair order (else the order listed). */
export function lineupOf(side: BootstrapSide): LineupPair['home'] {
  return {
    entrantId: side.entrantId,
    slots: side.lineup.map((slot, i) => ({
      personId: slot.personId,
      slot: 'starting' as const,
      orderNo: slot.pairOrder ?? i + 1,
    })),
  };
}

/** A ledger event as the engine folds it: the void's target travels in the envelope, as the web's read path sends it. */
export function envelopeOf(fixtureId: string, event: LedgerEvent): EventEnvelope {
  return {
    id: event.id,
    fixtureId,
    seq: event.seq,
    type: event.type,
    payload: event.payload,
    recordedAt: event.recordedAt,
    recordedBy: null,
    ...(event.voids === null ? {} : { voids: event.voids }),
  };
}

/**
 * A queued tap as the engine would meet it at `seq`: its id is the queue's key, marked so it can never be a server's
 * event id (those are UUIDs), and its time the phone's clock. Nothing reads either but the fold's own bookkeeping.
 */
export function queuedEnvelopeOf(fixtureId: string, tap: QueuedEvent, seq: number): EventEnvelope {
  const voids = voidTargetOf(tap.type, tap.payload);
  return {
    id: queuedEventId(tap.key),
    fixtureId,
    seq,
    type: tap.type,
    payload: tap.payload,
    recordedAt: tap.createdAt,
    recordedBy: null,
    ...(voids === null ? {} : { voids }),
  };
}

/** The envelope id a queued tap folds under. */
export const queuedEventId = (key: string): string => `queued:${key}`;

/**
 * The engine's word against the last of `events`, judged as the server judges an append (`strictFromSeq` at its seq,
 * everything before it replayed), or null when the engine takes it. Anything but the engine's own refusal is thrown.
 */
export function refusalOf(
  match: BadmintonEngineMatch,
  events: readonly EventEnvelope[],
): string | null {
  const last = events[events.length - 1];
  if (last === undefined) return null;
  try {
    foldMatch(badminton, match.cfg, match.lineups, events, { strictFromSeq: last.seq });
    return null;
  } catch (error) {
    if (EngineError.is(error)) return error.code;
    throw error;
  }
}
