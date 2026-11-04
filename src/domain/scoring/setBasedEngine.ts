import {
  EngineError,
  foldMatch,
  type EventEnvelope,
  type FoldableModule,
  type LineupPair,
} from '@seazn/engine/core';
import type { SetBasedCfg, SetBasedModule } from '@seazn/engine/sports/setbased';
import type { QueuedEvent } from '@/domain/scoring/queue';
import { voidTargetOf, type BootstrapSide, type LedgerEvent } from '@/domain/scoring/wire';

/**
 * What every set-based sport (badminton, table tennis) shares of the engine's input (plan S2-2 Task 2): the lineups the
 * web builds from a side, and the ledger's events as the engine's envelopes. A generic file: it names no sport, so a
 * sport's own engine file (`badmintonEngine`) adds only what is the sport's, and the phone and its fake server fold
 * through the same copy.
 */

/**
 * What the engine needs to fold a match: its id (every envelope names it), its config and its two lineups. Any
 * one-against-one sport's: chess (the boardgame module) is not set-based and shares it, and the refusal below.
 */
export type EngineMatch<Cfg> = {
  readonly fixtureId: string;
  readonly cfg: Cfg;
  readonly lineups: LineupPair;
};

/** What the engine needs to fold a set-based match. */
export type SetBasedEngineMatch = EngineMatch<SetBasedCfg>;

/**
 * The engine's word against the last of `events`, judged as the server judges an append (`strictFromSeq` at its seq,
 * everything before it replayed), or null when the engine takes it. Anything but the engine's own refusal is thrown.
 * `module` is the sport's engine module (`badminton`, `tabletennis`, chess's `boardgame`): the sport's own engine file
 * passes it.
 */
export function setBasedRefusalOf<Cfg, State>(
  module: FoldableModule<Cfg, State>,
  match: EngineMatch<Cfg>,
  events: readonly EventEnvelope[],
): string | null {
  const last = events[events.length - 1];
  if (last === undefined) return null;
  try {
    foldMatch(module, match.cfg, match.lineups, events, { strictFromSeq: last.seq });
    return null;
  } catch (error) {
    if (EngineError.is(error)) return error.code;
    throw error;
  }
}

/** The match's config through the sport's schema, or null for one it refuses (the schema's refusal is all a throw can be). */
export function setBasedCfgOf(module: SetBasedModule, raw: unknown): SetBasedCfg | null {
  try {
    return module.configSchema.parse(raw);
  } catch {
    return null;
  }
}

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
