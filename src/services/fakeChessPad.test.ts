import { describe, expect, it } from 'vitest';
import type { AppendBody, Bootstrap, LedgerEvent } from '@/domain/scoring/wire';
import { AWAY_ENTRANT, HOME_ENTRANT, chessSeed } from '@/services/fakeChessPad';
import { createFakeScoringPort } from '@/services/fakeScoringPort';
import type { ScoringLink } from '@/services/scoringPort';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';

const LINK: ScoringLink = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };

let keys = 0;
/** A body for the next tap: a key never seen before, the epoch the seed requires and its rules. */
const body = (expected_seq: number, type: string, payload: unknown = {}): AppendBody => {
  keys += 1;
  return {
    expected_seq,
    type,
    payload,
    idempotency_key: `chess-key-${keys}`,
    engine_epoch: 5,
    rules_version: 0,
  };
};

const ledgerOf = async (port: ReturnType<typeof createFakeScoringPort>) => {
  const events = await port.events(LINK, chessSeed().fixtureId, 0);
  if (!Array.isArray(events)) throw new Error('the ledger did not read');
  return events as readonly LedgerEvent[];
};

describe('the chess seed', () => {
  it('is a game nobody has touched: its bootstrap names the boardgame sport, the engine’s epoch and no event', async () => {
    const answer = await createFakeScoringPort(chessSeed()).bootstrap(LINK);
    expect(answer).toMatchObject({
      kind: 'ok',
      bootstrap: {
        fixtureId: 'fake-chess',
        sportKey: 'boardgame',
        epochRequired: 5,
        rulesVersion: 0,
        screen: 'pad',
        lastSeq: 0,
        status: 'scheduled',
      },
    });
    const { sides } = (answer as { bootstrap: Bootstrap }).bootstrap;
    expect(sides.home).toMatchObject({ entrantId: HOME_ENTRANT, kind: 'individual' });
    expect(sides.home?.members).toEqual([{ personId: 'ent-home-p1', fullName: 'A. Sharma' }]);
    expect(sides.away?.members).toEqual([{ personId: 'ent-away-p1', fullName: 'L. Chen' }]);
  });

  it('can start started, with other scorers’ events, and over its fixture and config', async () => {
    const seed = chessSeed({
      fixtureId: 'fx-other',
      cfg: { colors: false },
      events: [{ type: 'core.start', payload: {} }],
    });
    const answer = await createFakeScoringPort(seed).bootstrap(LINK);
    expect(answer).toMatchObject({
      kind: 'ok',
      bootstrap: { fixtureId: 'fx-other', cfg: { colors: false }, status: 'in_play', lastSeq: 1 },
    });
  });
});

describe('the fake judges a chess game with the boardgame engine, as the web does', () => {
  const FIXTURE = chessSeed().fixtureId;

  it('refuses a result before the start with the engine’s word, and takes it after', async () => {
    const port = createFakeScoringPort(chessSeed());
    const early = await port.append(
      LINK,
      FIXTURE,
      body(0, 'boardgame.result', { winner: HOME_ENTRANT }),
    );
    expect(early).toMatchObject({ kind: 'refused', status: 422, code: 'WRONG_PHASE' });
    expect(await port.append(LINK, FIXTURE, body(0, 'core.start'))).toMatchObject({
      kind: 'accepted',
    });
    const result = await port.append(
      LINK,
      FIXTURE,
      body(1, 'boardgame.result', { winner: HOME_ENTRANT, method: 'checkmate' }),
    );
    expect(result).toMatchObject({ kind: 'accepted', seq: 2 });
    expect(await port.bootstrap(LINK)).toMatchObject({
      kind: 'ok',
      bootstrap: { status: 'decided', lastSeq: 2 },
    });
  });

  it('refuses a method that contradicts the winner on write, which only a strict fold does', async () => {
    const port = createFakeScoringPort(chessSeed());
    await port.append(LINK, FIXTURE, body(0, 'core.start'));
    const answer = await port.append(
      LINK,
      FIXTURE,
      body(1, 'boardgame.result', { winner: null, method: 'checkmate' }),
    );
    expect(answer).toMatchObject({
      kind: 'refused',
      status: 422,
      code: 'RESULT_METHOD_CONTRADICTS_WINNER',
    });
  });

  it('takes a pairing before the result and a void of the result, and refuses a pairing after it', async () => {
    const port = createFakeScoringPort(chessSeed());
    await port.append(LINK, FIXTURE, body(0, 'core.start'));
    expect(
      await port.append(LINK, FIXTURE, body(1, 'boardgame.pairing', { white: AWAY_ENTRANT })),
    ).toMatchObject({ kind: 'accepted', seq: 2 });
    expect(
      await port.append(LINK, FIXTURE, body(2, 'boardgame.result', { winner: AWAY_ENTRANT })),
    ).toMatchObject({ kind: 'accepted', seq: 3 });
    expect(
      await port.append(LINK, FIXTURE, body(3, 'boardgame.pairing', { white: HOME_ENTRANT })),
    ).toMatchObject({ kind: 'refused', status: 422, code: 'ALREADY_DECIDED' });
    const events = await ledgerOf(port);
    const resultId = events.find((event) => event.type === 'boardgame.result')?.id;
    expect(
      await port.append(LINK, FIXTURE, body(3, 'core.void', { event_id: resultId })),
    ).toMatchObject({ kind: 'accepted', seq: 4 });
    expect(await port.bootstrap(LINK)).toMatchObject({
      kind: 'ok',
      bootstrap: { status: 'in_play' },
    });
  });

  it('reads the seed’s config through the engine’s schema: a garbled one fails at creation, not at the first tap', () => {
    expect(() => createFakeScoringPort(chessSeed({ cfg: { colors: 'sometimes' } }))).toThrow();
    expect(() => createFakeScoringPort(chessSeed({ cfg: {} }))).not.toThrow();
  });

  it('refuses a table tennis rally: it judges the game it was seeded with', async () => {
    const port = createFakeScoringPort(chessSeed());
    await port.append(LINK, FIXTURE, body(0, 'core.start'));
    expect(
      await port.append(LINK, FIXTURE, body(1, 'tabletennis.rally', { wonBy: HOME_ENTRANT })),
    ).toMatchObject({ kind: 'refused', status: 422 });
  });

  // The web reads a settled level game as decided (`outcomeOf` puts the settlement over the module's own outcome), as the
  // phone does.
  it('reads a settled drawn bracket game as decided, and a still level one as in play', async () => {
    const seed = chessSeed({
      cfg: { tiebreak: true },
      events: [
        { type: 'core.start', payload: {} },
        { type: 'boardgame.result', payload: { winner: null } },
      ],
    });
    const port = createFakeScoringPort(seed);
    expect(await port.bootstrap(LINK)).toMatchObject({
      kind: 'ok',
      bootstrap: { status: 'in_play' },
    });
    port.addOtherScorerEvent('core.settle', { winner: HOME_ENTRANT, method: 'lot' });
    expect(await port.bootstrap(LINK)).toMatchObject({
      kind: 'ok',
      bootstrap: { status: 'decided' },
    });
  });

  it('lets a test play the organiser: finalize locks a decided game', async () => {
    const port = createFakeScoringPort(chessSeed());
    await port.append(LINK, FIXTURE, body(0, 'core.start'));
    await port.append(LINK, FIXTURE, body(1, 'boardgame.result', { winner: null }));
    port.finalize();
    expect(await port.bootstrap(LINK)).toMatchObject({
      kind: 'ok',
      bootstrap: { status: 'finalized' },
    });
  });
});
