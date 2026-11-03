import { foldMatch, type LineupPair } from '@seazn/engine/core';
import { badminton } from '@seazn/engine/sports/setbased';
import {
  badmintonCfg,
  refusalOf,
  type BadmintonEngineMatch,
} from '@/domain/scoring/badmintonEngine';
import type { BadmintonTap } from '@/domain/scoring/badmintonPad';
import type { PadSide } from '@/domain/scoring/padView';
import { envelopeOf, lineupOf } from '@/domain/scoring/setBasedEngine';
import {
  voidTargetOf,
  type AppendAnswer,
  type AppendBody,
  type Bootstrap,
  type BootstrapContext,
  type BootstrapScreen,
  type BootstrapSide,
  type Failure,
  type LedgerEvent,
} from '@/domain/scoring/wire';
import { DOUBLES_SAMPLE, SINGLES_SAMPLE, type FakePadSample } from '@/services/fakeBadmintonPad';
import type { ScoringPort } from '@/services/scoringPort';

/**
 * A FAKE scoring server for a laptop (AGENTS §10: build the fake first): the five calls of `ScoringPort`, answered as
 * the web answers them for one badminton match, folded with the REAL engine, so a tap the engine refuses is refused
 * here with the engine's own word. It keeps the server's order of questions (design §6.3, §7.3): the network, the
 * link, the fixture, a replayed key (answered from the ledger, even after the seq or the epoch has moved), the engine
 * epoch (the key is not consumed), the rules version (before the seq), the seq, and last the engine's fold.
 *
 * Not copied from the web: its undo target rules (`UNDO_*`), which the pad's own Undo never offends (design §6.2).
 */
export type FakeSeedEvent = { readonly type: string; readonly payload: unknown };

export type FakeMatchSeed = {
  readonly fixtureId: string;
  readonly linkId: string;
  /** The match's badminton config, as the endpoint sends it; the engine's schema fills what it leaves out. */
  readonly cfg: unknown;
  readonly rulesVersion: number;
  readonly epochRequired: number;
  readonly screen: BootstrapScreen;
  readonly viewOnlyReason?: string | null;
  readonly context: BootstrapContext;
  readonly sides: { readonly home: BootstrapSide; readonly away: BootstrapSide };
  /** What other scorers wrote before this phone met the match, in order. Folded strictly: a bad seed throws. */
  readonly events: readonly FakeSeedEvent[];
};

/** What a test does to the server. */
export type FakeServerControls = {
  /** Another scorer's event (the organiser's, a browser's): written now, judged by the engine; an illegal one throws. */
  addOtherScorerEvent(type: string, payload: unknown): LedgerEvent;
  /** The link is revoked: every call answers `LINK_REVOKED`. */
  revoke(): void;
  /** The organiser corrected the format: older `rules_version`s are refused; `cfg` is the corrected one, if it changed. */
  setRulesVersion(rulesVersion: number, cfg?: unknown): void;
  /** The server's floor for the engine epoch: a tap below it is `outdated`. */
  setEpochRequired(epoch: number): void;
  /** The next append is written, and its answer is lost: `offline`. */
  dropNextAnswer(): void;
  /** No network: every call is `offline` and nothing is written. */
  goOffline(on: boolean): void;
  /**
   * The organiser locks the result: a `core.finalize` from another scorer, then every new tap is 422 `ALREADY_DECIDED`
   * (`LOCKED_FIXTURE_STATUSES`, before the seq is looked at). A replayed key is still answered. The engine must take
   * the finalize, so a match nothing has decided throws.
   */
  finalize(): void;
  /**
   * Every new tap is refused 403 with this word, as the web does for `FORBIDDEN` (an organiser-only event, a finalized
   * fixture's undo) and `RESULT_CARRIED_FORWARD`; null lifts it. A replayed key is still answered.
   */
  forbid(code: string | null): void;
  /** The next call, of any kind, is the door's 429 and waits this long; the call after it is answered as before. */
  rateLimit(retryAfterMs: number): void;
};

export type FakeScoringPort = ScoringPort & FakeServerControls;

/** The link the other scorers' events carry; never the phone's own. */
export const OTHER_SCORER_LINK_ID = 'fake-other-scorer';

const OFFLINE: Failure = { kind: 'offline' };
const REVOKED: Failure = { kind: 'linkDead', code: 'LINK_REVOKED' };
const NOT_FOUND: Failure = { kind: 'refused', status: 404, code: 'NOT_FOUND' };
/** Events are stamped from here, a second apart, so a ledger is the same on every run. */
const FIRST_EVENT_MS = Date.parse('2026-11-01T10:00:00.000Z');

type Server = {
  readonly seed: FakeMatchSeed;
  readonly lineups: LineupPair;
  readonly ledger: LedgerEvent[];
  /** Idempotency key → the event it wrote. */
  readonly keys: Map<string, { readonly seq: number; readonly eventId: string }>;
  rawCfg: unknown;
  cfg: ReturnType<typeof badmintonCfg>;
  rulesVersion: number;
  epochRequired: number;
  revoked: boolean;
  offline: boolean;
  dropNext: boolean;
  finalized: boolean;
  forbidden: string | null;
  limitMs: number | null;
  /** Where an event's `recordedAt` comes from, in epoch ms; null: a second apart from `FIRST_EVENT_MS`. */
  readonly stamp: (() => number) | null;
};

/** Options of the fake server. */
export type FakeScoringOptions = {
  /**
   * Stamps each event the server writes (epoch ms), for a test on a clock of its own: the reconnect question counts only
   * what was recorded since the phone's taps (`CLOCK_SKEW_MS`), so such a test's server events and taps share one clock.
   * Unset, events are a second apart from a fixed start and a ledger is the same on every run.
   */
  readonly stamp?: () => number;
};

export function createFakeScoringPort(
  seed: FakeMatchSeed,
  options: FakeScoringOptions = {},
): FakeScoringPort {
  const server: Server = {
    seed,
    lineups: { home: lineupOf(seed.sides.home), away: lineupOf(seed.sides.away) },
    ledger: [],
    keys: new Map(),
    rawCfg: seed.cfg,
    cfg: badmintonCfg(seed.cfg),
    rulesVersion: seed.rulesVersion,
    epochRequired: seed.epochRequired,
    revoked: false,
    offline: false,
    dropNext: false,
    finalized: false,
    forbidden: null,
    limitMs: null,
    stamp: options.stamp ?? null,
  };
  for (const event of seed.events) writeOther(server, event.type, event.payload);
  return {
    ...reads(server),
    ...controls(server),
    append: async (_link, fixtureId, body) => append(server, fixtureId, body),
  };
}

function reads(server: Server): Omit<ScoringPort, 'append'> {
  const { seed } = server;
  return {
    bootstrap: async () => blocked(server, null) ?? { kind: 'ok', bootstrap: bootstrapOf(server) },
    events: async (_link, fixtureId, sinceSeq) =>
      blocked(server, fixtureId) ?? server.ledger.filter((event) => event.seq > sinceSeq),
    rules: async (_link, fixtureId) =>
      blocked(server, fixtureId) ?? {
        cfg: server.rawCfg,
        rulesVersion: server.rulesVersion,
        formatLine: null,
      },
    realtimeToken: async (_link, fixtureId) =>
      blocked(server, fixtureId) !== null
        ? null
        : {
            token: 'fake-realtime-token',
            channel: `fixture:${seed.fixtureId}`,
            url: 'https://fake.supabase.test',
            apikey: 'fake-anon-key',
          },
  };
}

function controls(server: Server): FakeServerControls {
  return {
    addOtherScorerEvent: (type, payload) => writeOther(server, type, payload),
    revoke: () => {
      server.revoked = true;
    },
    setRulesVersion: (rulesVersion, cfg) => {
      server.rulesVersion = rulesVersion;
      if (cfg !== undefined) {
        server.rawCfg = cfg;
        server.cfg = badmintonCfg(cfg);
      }
    },
    setEpochRequired: (epoch) => {
      server.epochRequired = epoch;
    },
    dropNextAnswer: () => {
      server.dropNext = true;
    },
    goOffline: (on) => {
      server.offline = on;
    },
    finalize: () => {
      writeOther(server, 'core.finalize', {});
      server.finalized = true;
    },
    forbid: (code) => {
      server.forbidden = code;
    },
    rateLimit: (retryAfterMs) => {
      server.limitMs = retryAfterMs;
    },
  };
}

/** What stops a call before it reaches the match: no network, a throttle, a dead link, another fixture. */
function blocked(server: Server, fixtureId: string | null): Failure | null {
  if (server.offline) return OFFLINE;
  if (server.limitMs !== null) {
    const retryAfterMs = server.limitMs;
    server.limitMs = null;
    return { kind: 'rateLimited', retryAfterMs };
  }
  if (server.revoked) return REVOKED;
  return fixtureId !== null && fixtureId !== server.seed.fixtureId ? NOT_FOUND : null;
}

function append(server: Server, fixtureId: string, body: AppendBody): AppendAnswer {
  const answer = judged(server, fixtureId, body);
  if (!server.dropNext) return answer;
  server.dropNext = false;
  return OFFLINE;
}

/** The server's order of questions, ending in the engine. */
function judged(server: Server, fixtureId: string, body: AppendBody): AppendAnswer {
  const stopped = blocked(server, fixtureId);
  if (stopped !== null) return stopped;
  const replay = server.keys.get(body.idempotency_key);
  if (replay !== undefined) return accepted(server, replay.seq, replay.eventId);
  const refusal = locked(server) ?? preflight(server, body);
  if (refusal !== null) return refusal;
  const written = write(server, body.type, body.payload, server.seed.linkId, body.idempotency_key);
  if ('refused' in written) return { kind: 'refused', status: 422, code: written.refused };
  return accepted(server, written.seq, written.id);
}

/**
 * What the web refuses before the epoch, the rules and the seq: a forbidden writer (403), a locked fixture (422
 * `ALREADY_DECIDED`, as `appendEvent` does for `finalized` and `cancelled`).
 */
function locked(server: Server): Failure | null {
  if (server.forbidden !== null) return { kind: 'refused', status: 403, code: server.forbidden };
  return server.finalized ? { kind: 'refused', status: 422, code: 'ALREADY_DECIDED' } : null;
}

/** The epoch (the key is not consumed), the rules version (before the seq), then the seq. */
function preflight(server: Server, body: AppendBody): Failure | null {
  if (body.engine_epoch < server.epochRequired) {
    return { kind: 'outdated', required: server.epochRequired };
  }
  if (body.rules_version !== server.rulesVersion) {
    return { kind: 'rulesChanged', rulesVersion: server.rulesVersion };
  }
  const tip = server.ledger.length;
  return body.expected_seq === tip ? null : { kind: 'seqConflict', currentSeq: tip };
}

const accepted = (server: Server, seq: number, eventId: string): AppendAnswer => ({
  kind: 'accepted',
  seq,
  eventId,
  rulesVersion: server.rulesVersion,
});

/** Writes an event at the tip if the engine takes it: the event, or the engine's code. */
function write(
  server: Server,
  type: string,
  payload: unknown,
  deviceLinkId: string,
  key?: string,
): LedgerEvent | { readonly refused: string } {
  const seq = server.ledger.length + 1;
  const voids = voidTargetOf(type, payload);
  const event: LedgerEvent = {
    id: `fake-event-${seq}`,
    seq,
    type,
    payload,
    recordedAt: new Date(server.stamp?.() ?? FIRST_EVENT_MS + seq * 1000).toISOString(),
    voids,
    deviceLinkId,
  };
  const code = engineRefusal(server, [...server.ledger, event]);
  if (code !== null) return { refused: code };
  server.ledger.push(event);
  if (key !== undefined) server.keys.set(key, { seq, eventId: event.id });
  return event;
}

/** An event from another scorer, which the engine must take: a refusal is the test's or the seed's mistake. */
function writeOther(server: Server, type: string, payload: unknown): LedgerEvent {
  const event = write(server, type, payload, OTHER_SCORER_LINK_ID);
  if ('refused' in event)
    throw new Error(`the fake refused another scorer's ${type}: ${event.refused}`);
  return event;
}

/** Folds the ledger with its last event under validation, as the server does; null when the engine takes it. */
function engineRefusal(server: Server, ledger: readonly LedgerEvent[]): string | null {
  const envelopes = ledger.map((event) => envelopeOf(server.seed.fixtureId, event));
  return refusalOf(engineMatch(server), envelopes);
}

const engineMatch = (server: Server): BadmintonEngineMatch => ({
  fixtureId: server.seed.fixtureId,
  cfg: server.cfg,
  lineups: server.lineups,
});

function bootstrapOf(server: Server): Bootstrap {
  const { seed } = server;
  const tip = server.ledger.length;
  return {
    fixtureId: seed.fixtureId,
    linkId: seed.linkId,
    sportKey: 'badminton',
    moduleVersion: '1.0.0',
    cfg: server.rawCfg,
    rulesVersion: server.rulesVersion,
    epochRequired: server.epochRequired,
    screen: seed.screen,
    viewOnlyReason: seed.viewOnlyReason ?? null,
    context: seed.context,
    sides: seed.sides,
    lastSeq: tip,
    status: statusOf(server),
  };
}

/** `fixtures.status` as the web derives it from the ledger (`fixtureStatusFromFold`): the first rule that matches. */
function statusOf(server: Server): string {
  if (server.finalized) return 'finalized';
  const voided = new Set(
    server.ledger.flatMap((event) => (event.voids === null ? [] : [event.voids])),
  );
  const has = (type: string) =>
    server.ledger.some((event) => event.type === type && !voided.has(event.id));
  if (has('core.forfeit')) return 'forfeited';
  if (decided(server)) return 'decided';
  return has('core.start') ? 'in_play' : 'scheduled';
}

const decided = (server: Server): boolean =>
  foldMatch(
    badminton,
    server.cfg,
    server.lineups,
    server.ledger.map((event) => envelopeOf(server.seed.fixtureId, event)),
  ).outcome !== null;

// ---------------------------------------------------------------------------------------------------------------
// The preview's two matches, as seeds
// ---------------------------------------------------------------------------------------------------------------

const ENTRANT: Readonly<Record<PadSide, string>> = { first: 'ent-home', second: 'ent-away' };

function sideOf(sample: FakePadSample, side: PadSide): BootstrapSide {
  const entrantId = ENTRANT[side];
  const players = sample.sides[side].players;
  const pair = players.length > 1;
  return {
    entrantId,
    name: players.join(' / '),
    kind: pair ? 'pair' : 'individual',
    members: players.map((fullName, i) => ({ personId: `${entrantId}-p${i + 1}`, fullName })),
    lineup: players.map((_, i) => ({
      personId: `${entrantId}-p${i + 1}`,
      pairOrder: pair ? i + 1 : null,
    })),
  };
}

/**
 * The taps already on a sample's sheet, as the events a server would hold. The first rally after the start carries the
 * server picked at the start (`serving`, design §7.3); a tap with no event shape here is refused, never guessed.
 */
function eventsOfTaps(taps: readonly BadmintonTap[]): FakeSeedEvent[] {
  let serving: string | null = null;
  return taps.map((tap): FakeSeedEvent => {
    if (tap.kind === 'start') {
      serving = ENTRANT[tap.server];
      return { type: 'core.start', payload: {} };
    }
    if (tap.kind !== 'rally')
      throw new Error(`the fake cannot write a ${tap.kind} tap as an event`);
    const payload = { wonBy: ENTRANT[tap.side], ...(serving === null ? {} : { serving }) };
    serving = null;
    return { type: 'badminton.rally', payload };
  });
}

/** A preview sample as a seed: the same names and context, the other scorers' taps as the ledger. */
export function seedFromPadSample(
  sample: FakePadSample,
  ids: { readonly fixtureId?: string; readonly linkId?: string } = {},
): FakeMatchSeed {
  return {
    fixtureId: ids.fixtureId ?? 'fake-fixture',
    linkId: ids.linkId ?? 'fake-link',
    cfg: badmintonCfg({}),
    rulesVersion: 0,
    epochRequired: 2,
    screen: 'pad',
    context: sample.context,
    sides: { home: sideOf(sample, 'first'), away: sideOf(sample, 'second') },
    events: eventsOfTaps(sample.others ?? []),
  };
}

export const SINGLES_SEED: FakeMatchSeed = seedFromPadSample(SINGLES_SAMPLE, {
  fixtureId: 'fake-singles',
  linkId: 'fake-link-singles',
});
export const DOUBLES_SEED: FakeMatchSeed = seedFromPadSample(DOUBLES_SAMPLE, {
  fixtureId: 'fake-doubles',
  linkId: 'fake-link-doubles',
});
