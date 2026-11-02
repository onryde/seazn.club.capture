import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BadmintonTap } from '@/domain/scoring/badmintonPad';
import { bootstrapToWire, type AppendAnswer, type LedgerEvent } from '@/domain/scoring/wire';
import { createScoringRunner, type ScoringRunner } from '@/hooks/scoringRunner';
import { SINGLES_SEED, createFakeScoringPort } from '@/services/fakeScoringPort';
import { createFetchScoringPort, type ScoringFetch } from '@/services/fetchScoringPort';
import type { FetchResponse } from '@/services/httpAsk';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { queuedOf, rally } from '../../test/badmintonLedger';
import { createFakePorts, readRecord, timerClock, type FakePorts } from '../../test/fakePorts';

// The same device stall (see scoringRunner.rules.test.ts) over the web's wire: the real port, its parsers and its
// reporter, against a stand-in for the web that answers in the v1 envelope, refuses a version but its own and says
// what version it holds in the 409 and on GET /rules (`apps/web/src/server/engine-db/append-event.ts`,
// `usecases/fixtures.ts getFixtureRules`; read from web origin/main, 2026-11-02). Only the engine's judgement of a tap
// is the fake port's.

const FIXTURE = SINGLES_SEED.fixtureId;
const HOST = 'stg.seazn.club';
const ORIGIN = 'https://stg.seazn.club';
const LINK = { origin: ORIGIN, token: FAKE_SCORING_SECRET };
const HOME = SINGLES_SEED.sides.home.entrantId;
const RALLY: BadmintonTap = { kind: 'rally', side: 'first' };

const json = (status: number, body: unknown): FetchResponse => ({
  status,
  headers: { get: () => null },
  text: async () => JSON.stringify(body),
});
const ok = (data: unknown) => ({ ok: true, data, requestId: 'req-1' });
const failure = (code: string, extras: Record<string, unknown>) => ({
  ok: false,
  error: { code, message: 'a developer string', ...extras },
  requestId: 'req-1',
});

const eventWire = (event: LedgerEvent) => ({
  id: event.id,
  seq: event.seq,
  type: event.type,
  payload: event.payload,
  recorded_at: event.recordedAt,
  recorded_by: null,
  voids_event_id: event.voids,
  device_link_id: event.deviceLinkId,
});

/** An append's answer as the web words it. */
function appendWire(answer: AppendAnswer, rulesVersion: number): FetchResponse {
  if (answer.kind === 'accepted') {
    return json(
      201,
      ok({
        seq: answer.seq,
        state_summary: {},
        outcome: null,
        status: 'in_play',
        event_id: answer.eventId,
        rules_version: answer.rulesVersion,
      }),
    );
  }
  if (answer.kind === 'rulesChanged') {
    return json(
      409,
      failure('FIXTURE_RULES_CHANGED', { rules_version: rulesVersion, format: null }),
    );
  }
  if (answer.kind === 'seqConflict') {
    return json(409, failure('SEQ_CONFLICT', { current_seq: answer.currentSeq }));
  }
  throw new Error(`the stand-in has no wording for ${answer.kind}`);
}

type Web = { readonly fetch: ScoringFetch; readonly posts: () => number };

/** The web's four routes the phone calls, over a fake port that holds the match. */
function webOver(match: ReturnType<typeof createFakeScoringPort>, rulesVersion: () => number): Web {
  let posts = 0;
  const route: ScoringFetch = async (url, init) => {
    const path = url.slice(ORIGIN.length);
    if (path === '/api/v1/device-link') {
      const read = await match.bootstrap(LINK);
      if (read.kind !== 'ok') throw new Error('the stand-in match is closed');
      return json(200, bootstrapToWire(read.bootstrap));
    }
    if (path.startsWith(`/api/v1/fixtures/${FIXTURE}/events?since_seq=`)) {
      const since = Number(path.slice(path.indexOf('=') + 1));
      const read = await match.events(LINK, FIXTURE, since);
      if (!Array.isArray(read)) throw new Error('the stand-in ledger is closed');
      return json(200, ok(read.map(eventWire)));
    }
    if (path === `/api/v1/fixtures/${FIXTURE}/rules`) {
      const read = await match.rules(LINK, FIXTURE);
      if (!('cfg' in read)) throw new Error('the stand-in rules are closed');
      return json(
        200,
        ok({ cfg: read.cfg, rules_version: read.rulesVersion, format_line: read.formatLine }),
      );
    }
    if (path === `/api/v1/fixtures/${FIXTURE}/events` && init.method === 'POST') {
      posts += 1;
      const answer = await match.append(LINK, FIXTURE, JSON.parse(init.body ?? '{}'));
      return appendWire(answer, rulesVersion());
    }
    throw new Error(`the stand-in has no route for ${init.method} ${path}`);
  };
  return { fetch: route, posts: () => posts };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 400; i += 1) await Promise.resolve();
}

async function wait(seconds: number): Promise<void> {
  for (let s = 0; s < seconds; s += 1) {
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
  }
}

type Rig = { readonly fakes: FakePorts; readonly runner: ScoringRunner; readonly web: Web };

/** A mid-match fixture at the web's default rules_version 0, a queue the broken build left (stamped 1), the real port. */
async function rig(): Promise<Rig> {
  const server = createFakeScoringPort(SINGLES_SEED);
  server.setRulesVersion(0);
  server.addOtherScorerEvent('core.start', {});
  server.addOtherScorerEvent('badminton.rally', { wonBy: HOME, serving: HOME });
  server.addOtherScorerEvent('badminton.rally', { wonBy: HOME });
  const web = webOver(server, () => 0);
  const fakes = createFakePorts({ clock: timerClock });
  // The real port, over the same logger the record is read from.
  Object.assign(fakes.ports, {
    scoring: createFetchScoringPort({
      fetch: web.fetch,
      logger: fakes.ports.logger,
      host: HOST,
      now: () => Date.now(),
    }),
  });
  await saveScoringLink(fakes.kv, FIXTURE, LINK, HOST, 'badminton');
  await fakes.tapQueue.save({
    fixtureId: FIXTURE,
    label: '',
    pending: [{ ...queuedOf('k1', rally('H')), payload: { wonBy: HOME } }],
    ownEventIds: [],
    dead: null,
  });
  const runner = createScoringRunner(fakes.ports, { fixtureId: FIXTURE, mode: 'focused' });
  await runner.start();
  await flush();
  return { fakes, runner, web };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-02T20:34:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a queue stamped under the guessed version 1, a match at the web’s 0, over the web’s wire', () => {
  it('is refused once, said once in the record, and then goes: the rules read names the same 0', async () => {
    const { fakes, runner, web } = await rig();
    await wait(40);
    const snapshot = runner.snapshot();
    expect(snapshot.kind === 'ready' ? snapshot.state.sync.queue.pending : 'not ready').toEqual([]);
    expect(web.posts()).toBe(2);
    const lines = readRecord(fakes.record).filter((line) => line.event.startsWith('scoring.'));
    expect(lines.map((line) => line.event)).toEqual(['scoring.answer']);
    expect(lines[0].fields).toMatchObject({ op: 'append', kind: 'rulesChanged', status: 409 });
  });

  it('the tap the phone then makes is accepted under 0 and the record stays quiet', async () => {
    const { fakes, runner, web } = await rig();
    await wait(40);
    runner.dispatch({ kind: 'tap', tap: RALLY, key: 'k2', at: '2026-11-02T20:35:00.000Z' });
    await wait(5);
    expect(web.posts()).toBe(3);
    expect(
      readRecord(fakes.record).filter((line) => line.event.startsWith('scoring.')),
    ).toHaveLength(1);
  });
});
