import type { EventEnvelope, LineupPair } from '@seazn/engine/core';
import {
  cricket,
  orderFromLineup,
  type CricketCfg,
  type CricketState,
} from '@seazn/engine/sports/cricket';
import { engineRefusalOf, type EngineRefusal } from '@/domain/scoring/engineRefusal';
import type { SportEvent } from '@/domain/scoring/scoringSport';
import type { EngineMatch } from '@/domain/scoring/setBasedEngine';
import { teamSheetOf } from '@/domain/scoring/teamSheet';
import type { Bootstrap } from '@/domain/scoring/wire';

/**
 * Cricket's engine input (S2-4 spec §6, plan Task 4): its config through the engine's schema, its two lineups from the
 * bootstraps' team sheets (`teamSheetOf`, the web's `buildLineup`), and the server's word on one new event. One copy: the
 * phone's fold and its fake server both judge through here.
 */

/** What the engine needs to fold a cricket match: its id (every envelope names it), its config and its two lineups. */
export type CricketEngineMatch = EngineMatch<CricketCfg>;

/**
 * The match's config through the engine's schema, which fills what the organiser left out, or null for one it refuses.
 * A short format must say `minOversForResult`: the default (5) is longer than a two-over innings, and the schema refuses.
 */
export function cricketCfg(raw: unknown): CricketCfg | null {
  try {
    return cricket.configSchema.parse(raw);
  } catch {
    return null;
  }
}

/** The match as the engine folds it, or null with a seat empty or a config the engine refuses. */
export function cricketMatchOf(bootstrap: Bootstrap): CricketEngineMatch | null {
  const { home, away } = bootstrap.sides;
  const cfg = cricketCfg(bootstrap.cfg);
  if (home === null || away === null || cfg === null) return null;
  return {
    fixtureId: bootstrap.fixtureId,
    cfg,
    lineups: { home: teamSheetOf(home).lineup, away: teamSheetOf(away).lineup },
  };
}

/** The engine's word against the last of `events`, judged as the server judges an append, or null when it takes it. */
export const cricketRefusalOf = (
  match: CricketEngineMatch,
  events: readonly EventEnvelope[],
): EngineRefusal | null => engineRefusalOf(cricket, match, events);

/**
 * The state after one candidate event, judged strictly as the server judges an append, or null when the engine refuses it:
 * a trial, nothing is recorded (the wicket steps' `endsInnings`, the over totals' `totalsTap`). `apply` parses the payload
 * itself, as the server's fold does: its type is the module's to check, not this caller's.
 */
export function cricketTrial(state: CricketState, event: SportEvent): CricketState | null {
  const envelope = {
    id: 'pad-trial',
    fixtureId: '',
    seq: Number.MAX_SAFE_INTEGER,
    type: event.type,
    payload: event.payload,
    recordedAt: new Date(0).toISOString(),
    recordedBy: null,
  } satisfies EventEnvelope as Parameters<typeof cricket.apply>[1];
  try {
    return cricket.apply(state, envelope, { strict: true });
  } catch {
    return null;
  }
}

/** The fewest players a side bats with: an innings opens with two at the crease (engine `createInnings`). */
const OPENING_PAIR = 2;

/**
 * Whether each side's players are entered, so the pad can name them: at least two in its batting order, the engine's
 * (`orderFromLineup`: starting players, not the bench, not staff). `first` is the home side's, `second` the away side's.
 * A side not entered is scored in over totals (ruling 66).
 */
export function playersEntered(lineups: LineupPair): { first: boolean; second: boolean } {
  return {
    first: orderFromLineup(lineups.home).length >= OPENING_PAIR,
    second: orderFromLineup(lineups.away).length >= OPENING_PAIR,
  };
}
