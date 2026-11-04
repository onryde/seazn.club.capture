import { describe, expect, it } from 'vitest';
import type { AppendBody, Bootstrap, LedgerEvent } from '@/domain/scoring/wire';
import {
  AWAY_ENTRANT,
  ENTRANT_OF,
  HOME_ENTRANT,
  TABLE_TENNIS_DOUBLES_SEED,
  TABLE_TENNIS_SINGLES_SEED,
  TABLE_TENNIS_UNANCHORED_SEED,
  tableTennisSeed,
} from '@/services/fakeTableTennisPad';
import { createFakeScoringPort } from '@/services/fakeScoringPort';
import type { ScoringLink } from '@/services/scoringPort';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';

const LINK: ScoringLink = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const FIXTURE = TABLE_TENNIS_SINGLES_SEED.fixtureId;

let keys = 0;
/** A body for the next tap: a key never seen before, the epoch and rules the seeds have. */
const body = (
  expected_seq: number,
  type: string,
  payload: unknown = {},
  engine_epoch = 2,
): AppendBody => {
  keys += 1;
  return {
    expected_seq,
    type,
    payload,
    idempotency_key: `tt-key-${keys}`,
    engine_epoch,
    rules_version: 0,
  };
};

const ledgerOf = async (port: ReturnType<typeof createFakeScoringPort>, fixture = FIXTURE) => {
  const events = await port.events(LINK, fixture, 0);
  if (!Array.isArray(events)) throw new Error('the ledger did not read');
  return events as readonly LedgerEvent[];
};

describe('the table tennis seeds', () => {
  it('singles is a match nobody has touched: its bootstrap names the sport, the engine’s epoch and no event', async () => {
    const answer = await createFakeScoringPort(TABLE_TENNIS_SINGLES_SEED).bootstrap(LINK);
    expect(answer).toMatchObject({
      kind: 'ok',
      bootstrap: {
        fixtureId: 'fake-tt-singles',
        sportKey: 'tabletennis',
        epochRequired: 2,
        rulesVersion: 0,
        screen: 'pad',
        lastSeq: 0,
        status: 'scheduled',
      },
    });
    const { sides } = (answer as { bootstrap: Bootstrap }).bootstrap;
    expect(sides.home?.members).toEqual([{ personId: 'ent-home-p1', fullName: 'A. Sharma' }]);
    expect(sides.away?.lineup).toEqual([{ personId: 'ent-away-p1', pairOrder: null }]);
  });

  it('doubles declares the team sheet’s pair order, and a seed can leave it out', () => {
    expect(TABLE_TENNIS_DOUBLES_SEED.sides.home.lineup).toEqual([
      { personId: 'ent-home-p1', pairOrder: 1 },
      { personId: 'ent-home-p2', pairOrder: 2 },
    ]);
    const bare = tableTennisSeed(
      'fx',
      [
        ['A', 'B'],
        ['C', 'D'],
      ],
      { ordered: false },
    );
    expect(bare.sides.away.lineup).toEqual([
      { personId: 'ent-away-p1', pairOrder: null },
      { personId: 'ent-away-p2', pairOrder: null },
    ]);
    expect(bare.sides.away.kind).toBe('pair');
  });

  it('the unanchored seed has been started by someone else, and names no first server', async () => {
    const port = createFakeScoringPort(TABLE_TENNIS_UNANCHORED_SEED);
    const events = await ledgerOf(port, 'fake-tt-unanchored');
    expect(events.map((event) => [event.type, event.payload])).toEqual([['core.start', {}]]);
    expect(await port.bootstrap(LINK)).toMatchObject({
      kind: 'ok',
      bootstrap: { status: 'in_play', lastSeq: 1 },
    });
  });

  it('names the two entrants the pad’s halves are', () => {
    expect(ENTRANT_OF).toEqual({ first: HOME_ENTRANT, second: AWAY_ENTRANT });
    expect([HOME_ENTRANT, AWAY_ENTRANT]).toEqual(['ent-home', 'ent-away']);
  });
});

describe('the fake judges a table tennis match with the table tennis engine, as the web does', () => {
  it('takes a table tennis rally and refuses a badminton one: the engine’s word, not ours', async () => {
    const port = createFakeScoringPort(TABLE_TENNIS_SINGLES_SEED);
    expect(await port.append(LINK, FIXTURE, body(0, 'core.start'))).toMatchObject({
      kind: 'accepted',
    });
    const foreign = await port.append(
      LINK,
      FIXTURE,
      body(1, 'badminton.rally', { wonBy: HOME_ENTRANT }),
    );
    expect(foreign).toMatchObject({ kind: 'refused', status: 422 });
    const ours = await port.append(
      LINK,
      FIXTURE,
      body(1, 'tabletennis.rally', { wonBy: HOME_ENTRANT, serving: HOME_ENTRANT }),
    );
    expect(ours).toMatchObject({ kind: 'accepted', seq: 2 });
    expect((await ledgerOf(port)).map((event) => event.type)).toEqual([
      'core.start',
      'tabletennis.rally',
    ]);
  });

  it('takes a timeout for a side as often as it is sent: the engine accepts any number', async () => {
    const port = createFakeScoringPort(TABLE_TENNIS_SINGLES_SEED);
    await port.append(LINK, FIXTURE, body(0, 'core.start'));
    const timeout = (seq: number) =>
      port.append(LINK, FIXTURE, body(seq, 'tabletennis.timeout', { by: HOME_ENTRANT }));
    expect(await timeout(1)).toMatchObject({ kind: 'accepted', seq: 2 });
    expect(await timeout(2)).toMatchObject({ kind: 'accepted', seq: 3 });
  });

  /**
   * ITTF 2.15.2 under Expedite. The engine refuses a 13 returns point credited to the server only when the rally names
   * `serving`; one that does not is counted unchecked (kernel `checkExpedite`). The pad's 13 returns tap names none, and
   * the phone's own gate is the check, so the fake must take what staging takes: judging with the phone's check here
   * would refuse a point the real server accepts.
   */
  describe('a 13 returns point', () => {
    const expedited = async () => {
      const port = createFakeScoringPort(TABLE_TENNIS_SINGLES_SEED);
      await port.append(LINK, FIXTURE, body(0, 'core.start'));
      await port.append(
        LINK,
        FIXTURE,
        body(1, 'tabletennis.rally', { wonBy: HOME_ENTRANT, serving: HOME_ENTRANT }),
      );
      await port.append(LINK, FIXTURE, body(2, 'tabletennis.expedite.start'));
      return port;
    };

    it('credited to the server, naming no serving, is taken: the engine cannot check it', async () => {
      const port = await expedited();
      const answer = await port.append(
        LINK,
        FIXTURE,
        body(3, 'tabletennis.rally', { wonBy: HOME_ENTRANT, returns: 13 }),
      );
      expect(answer).toMatchObject({ kind: 'accepted', seq: 4 });
    });

    it('credited to the server, naming the serving side, is the engine’s EXPEDITE_WRONG_WINNER', async () => {
      const port = await expedited();
      const answer = await port.append(
        LINK,
        FIXTURE,
        body(3, 'tabletennis.rally', { wonBy: HOME_ENTRANT, serving: HOME_ENTRANT, returns: 13 }),
      );
      expect(answer).toEqual({ kind: 'refused', status: 422, code: 'EXPEDITE_WRONG_WINNER' });
      expect(await ledgerOf(port)).toHaveLength(3);
    });

    it('credited to the receiver is taken, and the status reads in play', async () => {
      const port = await expedited();
      const answer = await port.append(
        LINK,
        FIXTURE,
        body(3, 'tabletennis.rally', { wonBy: AWAY_ENTRANT, returns: 13 }),
      );
      expect(answer).toMatchObject({ kind: 'accepted' });
      expect(await port.bootstrap(LINK)).toMatchObject({ bootstrap: { status: 'in_play' } });
    });
  });

  it('a decided table tennis match reads decided, folded with its own engine', async () => {
    const wins = Array.from({ length: 33 }, (_, i) => ({
      type: 'tabletennis.rally',
      payload: i === 0 ? { wonBy: HOME_ENTRANT, serving: HOME_ENTRANT } : { wonBy: HOME_ENTRANT },
    }));
    const port = createFakeScoringPort({
      ...TABLE_TENNIS_SINGLES_SEED,
      events: [{ type: 'core.start', payload: {} }, ...wins],
    });
    expect(await port.bootstrap(LINK)).toMatchObject({ bootstrap: { status: 'decided' } });
  });

  it('a config the endpoint left empty is filled by table tennis’s own schema: 33 rallies to 11 decide a best of 5', async () => {
    const wins = Array.from({ length: 33 }, (_, i) => ({
      type: 'tabletennis.rally',
      payload: i === 0 ? { wonBy: HOME_ENTRANT, serving: HOME_ENTRANT } : { wonBy: HOME_ENTRANT },
    }));
    const port = createFakeScoringPort({
      ...TABLE_TENNIS_SINGLES_SEED,
      cfg: {},
      events: [{ type: 'core.start', payload: {} }, ...wins],
    });
    expect(await port.bootstrap(LINK)).toMatchObject({ bootstrap: { status: 'decided' } });
  });

  it('a doubles rally with a pair order in the bootstrap is taken like any other', async () => {
    const seed = TABLE_TENNIS_DOUBLES_SEED;
    const port = createFakeScoringPort(seed);
    await port.append(LINK, seed.fixtureId, body(0, 'core.start'));
    const answer = await port.append(
      LINK,
      seed.fixtureId,
      body(1, 'tabletennis.rally', {
        wonBy: HOME_ENTRANT,
        serving: HOME_ENTRANT,
        server: 'ent-home-p1',
      }),
    );
    expect(answer).toMatchObject({ kind: 'accepted', seq: 2 });
  });
});
