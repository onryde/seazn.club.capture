import { describe, expect, it } from 'vitest';
import { foldFootball } from '@/domain/scoring/footballFold';
import type { AppendBody, Bootstrap, LedgerEvent } from '@/domain/scoring/wire';
import { AWAY_ENTRANT, HOME_ENTRANT, footballSeed } from '@/services/fakeFootballPad';
import { createFakeScoringPort } from '@/services/fakeScoringPort';
import type { ScoringLink } from '@/services/scoringPort';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';

const LINK: ScoringLink = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };

let keys = 0;
/** A body for the next tap: a key never seen before, football's epoch at engine 7.0.0 (5) and the seed's rules. */
const body = (expected_seq: number, type: string, payload: unknown = {}): AppendBody => {
  keys += 1;
  return {
    expected_seq,
    type,
    payload,
    idempotency_key: `football-key-${keys}`,
    engine_epoch: 5,
    rules_version: 0,
  };
};

async function bootstrapOf(port: ReturnType<typeof createFakeScoringPort>): Promise<Bootstrap> {
  const answer = await port.bootstrap(LINK);
  if (answer.kind !== 'ok') throw new Error(`no bootstrap: ${answer.kind}`);
  return answer.bootstrap;
}

async function ledgerOf(port: ReturnType<typeof createFakeScoringPort>, fixtureId: string) {
  const events = await port.events(LINK, fixtureId, 0);
  if (!Array.isArray(events)) throw new Error('the ledger did not read');
  return events as readonly LedgerEvent[];
}

describe('fakeFootballPad: the seed', () => {
  it('a seed folds notStarted: football, the engine’s epoch, no event, both team sheets', async () => {
    const port = createFakeScoringPort(footballSeed());
    const bootstrap = await bootstrapOf(port);
    expect(bootstrap).toMatchObject({
      fixtureId: 'fake-football',
      sportKey: 'football',
      epochRequired: 5,
      rulesVersion: 0,
      screen: 'pad',
      lastSeq: 0,
      status: 'scheduled',
    });
    const fold = foldFootball({ bootstrap, ledger: [], queued: [], ownEventIds: [], toss: null });
    if (fold.kind !== 'folded') throw new Error(`did not fold: ${fold.reason}`);
    expect(fold.display.phase).toBe('notStarted');
    expect([fold.display.sides.first.name, fold.display.sides.second.name]).toEqual([
      'Riverside FC',
      'Northgate United',
    ]);
    expect([fold.display.sides.first.sheet, fold.display.sides.second.sheet]).toEqual([true, true]);
  });

  it('sends a full sheet as 11 starting and 5 on the bench, each with a shirt', async () => {
    const { sides } = await bootstrapOf(createFakeScoringPort(footballSeed()));
    const rows = sides.home?.lineup ?? [];
    expect(rows).toHaveLength(16);
    expect(rows.filter((row) => row.slot === 'starting')).toHaveLength(11);
    expect(rows.filter((row) => row.slot === 'bench')).toHaveLength(5);
    expect(rows[0]).toEqual({
      personId: `${HOME_ENTRANT}-p1`,
      pairOrder: null,
      slot: 'starting',
      orderNo: 1,
      role: 'player',
      squadNumber: 1,
      positionKey: 'GK',
    });
    expect(sides.away?.members[11]).toEqual({
      personId: `${AWAY_ENTRANT}-p12`,
      fullName: 'N. Laurent',
    });
  });

  it.each([
    ['noSlots', 16],
    ['none', 0],
  ] as const)('with sheet %s the pad shows the team only (%i rows)', async (sheet, rows) => {
    const bootstrap = await bootstrapOf(createFakeScoringPort(footballSeed({ sheet })));
    expect(bootstrap.sides.home?.lineup).toHaveLength(rows);
    expect(bootstrap.sides.home?.lineup.some((row) => row.slot !== undefined)).toBe(false);
    const fold = foldFootball({ bootstrap, ledger: [], queued: [], ownEventIds: [], toss: null });
    if (fold.kind !== 'folded') throw new Error(`did not fold: ${fold.reason}`);
    expect(fold.display.sides.first.sheet).toBe(false);
  });

  it('starts over its own config and other scorers’ events', async () => {
    const seed = footballSeed({
      fixtureId: 'fx-other',
      cfg: { halves: 4, halfMinutes: 10 },
      events: [{ type: 'core.start', payload: {} }],
    });
    const bootstrap = await bootstrapOf(createFakeScoringPort(seed));
    expect(bootstrap).toMatchObject({
      fixtureId: 'fx-other',
      cfg: { halves: 4, halfMinutes: 10 },
      status: 'in_play',
      lastSeq: 1,
    });
  });
});

describe('the fake judges football with the engine, as staging does', () => {
  const FIXTURE = footballSeed().fixtureId;

  it('refuses a bench scorer as staging does (422 INVALID_EVENT), and takes a starter’s goal', async () => {
    const port = createFakeScoringPort(footballSeed());
    expect(await port.append(LINK, FIXTURE, body(0, 'core.start'))).toMatchObject({
      kind: 'accepted',
      seq: 1,
    });
    const bench = await port.append(
      LINK,
      FIXTURE,
      body(1, 'football.goal', { by: HOME_ENTRANT, scorer: `${HOME_ENTRANT}-p12` }),
    );
    expect(bench).toEqual({ kind: 'refused', status: 422, code: 'INVALID_EVENT' });
    const starter = await port.append(
      LINK,
      FIXTURE,
      body(1, 'football.goal', { by: HOME_ENTRANT, scorer: `${HOME_ENTRANT}-p9` }),
    );
    expect(starter).toMatchObject({ kind: 'accepted', seq: 2 });
    expect((await ledgerOf(port, FIXTURE)).map((event) => event.type)).toEqual([
      'core.start',
      'football.goal',
    ]);
  });

  it('refuses a goal before kick-off with the engine’s word', async () => {
    const port = createFakeScoringPort(footballSeed());
    expect(
      await port.append(LINK, FIXTURE, body(0, 'football.goal', { by: AWAY_ENTRANT })),
    ).toEqual({ kind: 'refused', status: 422, code: 'WRONG_PHASE' });
  });

  // A sheetless team starts every row (`teamSheetOf`), so the fake takes a goal by any of its players, as the
  // phone's fold does: the two must fold the same pitch.
  it('folds a sheetless team as all starting: a goal by the sixteenth player stands', async () => {
    const port = createFakeScoringPort(footballSeed({ sheet: 'noSlots' }));
    await port.append(LINK, FIXTURE, body(0, 'core.start'));
    expect(
      await port.append(
        LINK,
        FIXTURE,
        body(1, 'football.goal', { by: HOME_ENTRANT, scorer: `${HOME_ENTRANT}-p16` }),
      ),
    ).toMatchObject({ kind: 'accepted', seq: 2 });
  });

  it('decides a league match at full time and reads it decided', async () => {
    const port = createFakeScoringPort(
      footballSeed({ cfg: { extraTime: { enabled: false, halfMinutes: 15 }, shootout: false } }),
    );
    const types: readonly (readonly [string, unknown])[] = [
      ['core.start', {}],
      ['football.goal', { by: AWAY_ENTRANT }],
      ['football.period', { phase: 'HT' }],
      ['football.period', { phase: 'FT' }],
    ];
    for (const [i, [type, payload]] of types.entries()) {
      expect(await port.append(LINK, FIXTURE, body(i, type, payload))).toMatchObject({
        kind: 'accepted',
      });
    }
    expect((await bootstrapOf(port)).status).toBe('decided');
  });
});
