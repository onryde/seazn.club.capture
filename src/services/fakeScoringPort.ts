import { EngineError, foldMatch, type EventEnvelope, type LineupPair } from '@seazn/engine/core';
import { badminton } from '@seazn/engine/sports/setbased';
import { isRecord } from '@/domain/credentials/wire';
import type { BadmintonTap } from '@/domain/scoring/badmintonPad';
import type { PadSide } from '@/domain/scoring/padView';
import type {
  AppendAnswer,
  AppendBody,
  Bootstrap,
  BootstrapContext,
  BootstrapScreen,
  BootstrapSide,
  Failure,
  LedgerEvent,
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
};

export type FakeScoringPort = ScoringPort & FakeServerControls;

/** The link the other scorers' events carry; never the phone's own. */
export const OTHER_SCORER_LINK_ID = 'fake-other-scorer';

const OFFLINE: Failure = { kind: 'offline' };
const REVOKED: Failure = { kind: 'linkDead', code: 'LINK_REVOKED' };
const NOT_FOUND: Failure = { kind: 'refused', status: 404, code: 'NOT_FOUND' };
/** Events are stamped from here, a second apart, so a ledger is the same on every run. */
const FIRST_EVENT_MS = Date.parse('2026-11-01T10:00:00.000Z');

const parseCfg = (raw: unknown) => badminton.configSchema.parse(raw);

type Server = {
  readonly seed: FakeMatchSeed;
  readonly lineups: LineupPair;
  readonly ledger: LedgerEvent[];
  /** Idempotency key → the event it wrote. */
  readonly keys: Map<string, { readonly seq: number; readonly eventId: string }>;
  rawCfg: unknown;
  cfg: ReturnType<typeof parseCfg>;
  rulesVersion: number;
  epochRequired: number;
  revoked: boolean;
  offline: boolean;
  dropNext: boolean;
};

export function createFakeScoringPort(seed: FakeMatchSeed): FakeScoringPort {
  const server: Server = {
    seed,
    lineups: { home: lineupOf(seed.sides.home), away: lineupOf(seed.sides.away) },
    ledger: [],
    keys: new Map(),
    rawCfg: seed.cfg,
    cfg: parseCfg(seed.cfg),
    rulesVersion: seed.rulesVersion,
    epochRequired: seed.epochRequired,
    revoked: false,
    offline: false,
    dropNext: false,
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
        server.cfg = parseCfg(cfg);
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
  };
}

/** What stops a call before it reaches the match: no network, a dead link, another fixture. */
function blocked(server: Server, fixtureId: string | null): Failure | null {
  if (server.offline) return OFFLINE;
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
  const refusal = preflight(server, body);
  if (refusal !== null) return refusal;
  const written = write(server, body.type, body.payload, server.seed.linkId, body.idempotency_key);
  if ('refused' in written)
    return { kind: 'refused', status: statusOf(written.refused), code: written.refused };
  return accepted(server, written.seq, written.id);
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

/** An engine refusal as the web maps it: a decided match is a conflict, every other word is unprocessable. */
const statusOf = (code: string): number => (code === 'ALREADY_DECIDED' ? 409 : 422);

/** Writes an event at the tip if the engine takes it: the event, or the engine's code. */
function write(
  server: Server,
  type: string,
  payload: unknown,
  deviceLinkId: string,
  key?: string,
): LedgerEvent | { readonly refused: string } {
  const seq = server.ledger.length + 1;
  const voids = voidTarget(type, payload);
  const event: LedgerEvent = {
    id: `fake-event-${seq}`,
    seq,
    type,
    payload,
    recordedAt: new Date(FIRST_EVENT_MS + seq * 1000).toISOString(),
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

/** The web reads a void's target from the payload's `event_id`. */
const voidTarget = (type: string, payload: unknown): string | null =>
  type === 'core.void' && isRecord(payload) && typeof payload.event_id === 'string'
    ? payload.event_id
    : null;

/** Folds the ledger with its last event under validation, as the server does; null when the engine takes it. */
function engineRefusal(server: Server, ledger: readonly LedgerEvent[]): string | null {
  const envelopes = ledger.map((event) => envelopeOf(server.seed.fixtureId, event));
  try {
    foldMatch(badminton, server.cfg, server.lineups, envelopes, { strictFromSeq: ledger.length });
    return null;
  } catch (error) {
    if (EngineError.is(error)) return error.code;
    throw error;
  }
}

function envelopeOf(fixtureId: string, event: LedgerEvent): EventEnvelope {
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
    status: tip === 0 ? 'scheduled' : decided(server) ? 'completed' : 'in_progress',
  };
}

const decided = (server: Server): boolean =>
  foldMatch(
    badminton,
    server.cfg,
    server.lineups,
    server.ledger.map((event) => envelopeOf(server.seed.fixtureId, event)),
  ).outcome !== null;

/** A side's lineup as the web builds it: every member starting, in pair order. */
function lineupOf(side: BootstrapSide): LineupPair['home'] {
  return {
    entrantId: side.entrantId,
    slots: side.lineup.map((slot, i) => ({
      personId: slot.personId,
      slot: 'starting' as const,
      orderNo: slot.pairOrder ?? i + 1,
    })),
  };
}

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
    cfg: parseCfg({}),
    rulesVersion: 1,
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
