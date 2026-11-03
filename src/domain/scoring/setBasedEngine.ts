import type { EventEnvelope, LineupPair } from '@seazn/engine/core';
import type { QueuedEvent } from '@/domain/scoring/queue';
import { voidTargetOf, type BootstrapSide, type LedgerEvent } from '@/domain/scoring/wire';

/**
 * What every set-based sport (badminton, table tennis) shares of the engine's input (plan S2-2 Task 2): the lineups the
 * web builds from a side, and the ledger's events as the engine's envelopes. A generic file: it names no sport, so a
 * sport's own engine file (`badmintonEngine`) adds only what is the sport's, and the phone and its fake server fold
 * through the same copy.
 */

/**
 * A side's lineup for the engine. The web's browser pad builds each slot from the row's own `slot` and `order_no`
 * (`toLineupSlot`, web scorepad/registry.tsx); the device-link bootstrap sends neither, so the phone marks every row
 * starting and numbers `orderNo` by pair order, else by the order listed. It also carries the pair order itself when
 * the team sheet declared one: the engine names a doubles server from it (`pairOrderOf`, engine
 * sports/squad-state.ts), for the sports that rotate the pair; a slot with none declares none, as the web leaves it
 * out.
 */
export function lineupOf(side: BootstrapSide): LineupPair['home'] {
  return {
    entrantId: side.entrantId,
    slots: side.lineup.map((slot, i) => ({
      personId: slot.personId,
      slot: 'starting' as const,
      orderNo: slot.pairOrder ?? i + 1,
      ...(slot.pairOrder === null ? {} : { pairOrder: slot.pairOrder }),
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
