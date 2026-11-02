import { foldMatch, type EventEnvelope } from '@seazn/engine/core';
import { badminton } from '@seazn/engine/sports/setbased';
import { describe, expect, it } from 'vitest';
import type { AppendBody, Bootstrap, BootstrapSide, LedgerEvent } from '@/domain/scoring/wire';
import {
  DOUBLES_SEED,
  SINGLES_SEED,
  createFakeScoringPort,
  seedFromPadSample,
  type FakeMatchSeed,
} from '@/services/fakeScoringPort';
import type { ScoringLink } from '@/services/scoringPort';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';

const LINK: ScoringLink = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const HOME = 'ent-home';
const AWAY = 'ent-away';

/** A match nobody has touched: the start is the phone's first tap. */
const FRESH: FakeMatchSeed = {
  fixtureId: 'fixture-1',
  linkId: 'link-phone',
  cfg: { bestOf: 3, setTo: 21, finalSetTo: 21, winBy: 2, cap: 30 },
  rulesVersion: 2,
  epochRequired: 2,
  screen: 'pad',
  context: { competition: 'Spring Open 2026', division: null, round: null, match: 'Match 4' },
  sides: {
    home: member('home', 'A. Sharma'),
    away: member('away', 'L. Chen'),
  },
  events: [],
};

function member(seat: 'home' | 'away', name: string) {
  const entrantId = seat === 'home' ? HOME : AWAY;
  return {
    entrantId,
    name,
    kind: 'individual',
    members: [{ personId: `${entrantId}-p`, fullName: name }],
    lineup: [{ personId: `${entrantId}-p`, pairOrder: null }],
  };
}

let keys = 0;
/** A body for the next tap: a key never seen before, the epoch and rules the seed has. */
const tap = (
  overrides: Partial<AppendBody> & Pick<AppendBody, 'expected_seq' | 'type'>,
): AppendBody => {
  keys += 1;
  return {
    payload: {},
    idempotency_key: `key-${keys}`,
    engine_epoch: 2,
    rules_version: 2,
    ...overrides,
  };
};
const start = (expected_seq = 0) => tap({ expected_seq, type: 'core.start' });
const rally = (expected_seq: number, wonBy: string, extra: object = {}) =>
  tap({ expected_seq, type: 'badminton.rally', payload: { wonBy, ...extra } });

const ledgerOf = async (port: ReturnType<typeof createFakeScoringPort>, since = 0) => {
  const events = await port.events(LINK, 'fixture-1', since);
  if (!Array.isArray(events)) throw new Error('the ledger did not read');
  return events as readonly LedgerEvent[];
};

describe('the fake reads like the server', () => {
  it('bootstrap is the seed: the match, its sides, the rules and the tip', async () => {
    const port = createFakeScoringPort(FRESH);
    const answer = await port.bootstrap(LINK);
    expect(answer).toEqual({
      kind: 'ok',
      bootstrap: {
        fixtureId: 'fixture-1',
        linkId: 'link-phone',
        sportKey: 'badminton',
        moduleVersion: '1.0.0',
        cfg: FRESH.cfg,
        rulesVersion: 2,
        epochRequired: 2,
        screen: 'pad',
        viewOnlyReason: null,
        context: FRESH.context,
        sides: FRESH.sides,
        lastSeq: 0,
        status: 'scheduled',
      },
    });
  });

  it('bootstrap follows the ledger: the tip moves with every accepted tap', async () => {
    const port = createFakeScoringPort(FRESH);
    await port.append(LINK, 'fixture-1', start());
    const answer = await port.bootstrap(LINK);
    expect(answer).toMatchObject({ kind: 'ok', bootstrap: { lastSeq: 1, status: 'in_progress' } });
  });

  it('events: the ledger after a seq, in order, ids and numbers made by the server', async () => {
    const port = createFakeScoringPort(FRESH);
    await port.append(LINK, 'fixture-1', start());
    await port.append(LINK, 'fixture-1', rally(1, HOME, { serving: HOME }));
    await port.append(LINK, 'fixture-1', rally(2, AWAY));
    const all = await ledgerOf(port);
    expect(all.map((e) => [e.seq, e.type])).toEqual([
      [1, 'core.start'],
      [2, 'badminton.rally'],
      [3, 'badminton.rally'],
    ]);
    expect(new Set(all.map((e) => e.id)).size).toBe(3);
    expect((await ledgerOf(port, 1)).map((e) => e.seq)).toEqual([2, 3]);
    expect(await ledgerOf(port, 3)).toEqual([]);
  });

  it('rules: the cfg and its version now', async () => {
    const port = createFakeScoringPort(FRESH);
    expect(await port.rules(LINK, 'fixture-1')).toEqual({
      cfg: FRESH.cfg,
      rulesVersion: 2,
      formatLine: null,
    });
  });

  it('realtime token: a grant for the fixture’s channel', async () => {
    const port = createFakeScoringPort(FRESH);
    expect(await port.realtimeToken(LINK, 'fixture-1')).toMatchObject({
      channel: 'fixture:fixture-1',
    });
  });

  it('a call for another fixture is the server’s 404, whichever call it is', async () => {
    const port = createFakeScoringPort(FRESH);
    const notFound = { kind: 'refused', status: 404, code: 'NOT_FOUND' };
    expect(await port.events(LINK, 'fixture-9', 0)).toEqual(notFound);
    expect(await port.rules(LINK, 'fixture-9')).toEqual(notFound);
    expect(await port.append(LINK, 'fixture-9', start())).toEqual(notFound);
    expect(await port.realtimeToken(LINK, 'fixture-9')).toBeNull();
    expect(await ledgerOf(port)).toEqual([]);
  });
});

describe('append: the server’s order of questions', () => {
  it('accepts a tap at the tip: the next seq, a new event id, the rules version, the phone’s link', async () => {
    const port = createFakeScoringPort(FRESH);
    const answer = await port.append(LINK, 'fixture-1', start());
    expect(answer).toMatchObject({ kind: 'accepted', seq: 1, rulesVersion: 2 });
    const [event] = await ledgerOf(port);
    expect(event).toMatchObject({
      seq: 1,
      type: 'core.start',
      deviceLinkId: 'link-phone',
      voids: null,
    });
    expect(answer).toMatchObject({ eventId: event.id });
  });

  it('a stale expected_seq is a seqConflict that names the tip; nothing is written', async () => {
    const port = createFakeScoringPort(FRESH);
    await port.append(LINK, 'fixture-1', start());
    await port.append(LINK, 'fixture-1', rally(1, HOME, { serving: HOME }));
    const stale = await port.append(LINK, 'fixture-1', rally(1, AWAY));
    expect(stale).toEqual({ kind: 'seqConflict', currentSeq: 2 });
    expect(await ledgerOf(port)).toHaveLength(2);
  });

  it('an expected_seq ahead of the tip is a conflict too', async () => {
    const port = createFakeScoringPort(FRESH);
    expect(await port.append(LINK, 'fixture-1', start(5))).toEqual({
      kind: 'seqConflict',
      currentSeq: 0,
    });
  });

  it('another scorer’s tap moves the tip: this phone’s next send, at its old tip, conflicts', async () => {
    const port = createFakeScoringPort(FRESH);
    await port.append(LINK, 'fixture-1', start());
    port.addOtherScorerEvent('badminton.rally', { wonBy: HOME, serving: HOME });
    const stale = await port.append(LINK, 'fixture-1', rally(1, AWAY));
    expect(stale).toEqual({ kind: 'seqConflict', currentSeq: 2 });
    const [, theirs] = await ledgerOf(port);
    expect(theirs).toMatchObject({ seq: 2, deviceLinkId: 'fake-other-scorer' });
    expect(await port.append(LINK, 'fixture-1', rally(2, AWAY))).toMatchObject({
      kind: 'accepted',
      seq: 3,
    });
  });

  it('the same key twice is the same event: 201 with the original id, one event in the ledger', async () => {
    const port = createFakeScoringPort(FRESH);
    const first = start();
    const one = await port.append(LINK, 'fixture-1', first);
    const two = await port.append(LINK, 'fixture-1', first);
    expect(two).toEqual(one);
    expect(await ledgerOf(port)).toHaveLength(1);
  });

  it('a replayed key is answered even after a conflict: the ledger answers, not the seq', async () => {
    const port = createFakeScoringPort(FRESH);
    const first = start();
    const one = await port.append(LINK, 'fixture-1', first);
    port.addOtherScorerEvent('badminton.rally', { wonBy: HOME, serving: HOME });
    const again = await port.append(LINK, 'fixture-1', first);
    expect(again).toEqual(one);
    expect(await ledgerOf(port)).toHaveLength(2);
  });

  it('dropNextAnswer: the server accepts, the phone hears nothing; the resend with the key counts once', async () => {
    const port = createFakeScoringPort(FRESH);
    const first = start();
    port.dropNextAnswer();
    expect(await port.append(LINK, 'fixture-1', first)).toEqual({ kind: 'offline' });
    expect(await ledgerOf(port)).toHaveLength(1);
    const resent = await port.append(LINK, 'fixture-1', first);
    expect(resent).toMatchObject({ kind: 'accepted', seq: 1 });
    expect(await ledgerOf(port)).toHaveLength(1);
    const [event] = await ledgerOf(port);
    expect(resent).toMatchObject({ eventId: event.id });
  });

  it('dropNextAnswer drops one answer only', async () => {
    const port = createFakeScoringPort(FRESH);
    port.dropNextAnswer();
    await port.append(LINK, 'fixture-1', start());
    expect(await port.append(LINK, 'fixture-1', rally(1, HOME, { serving: HOME }))).toMatchObject({
      kind: 'accepted',
    });
  });

  it('a tap the engine refuses is refused 422 with the engine’s word, and writes nothing', async () => {
    const port = createFakeScoringPort(FRESH);
    expect(await port.append(LINK, 'fixture-1', rally(0, HOME))).toEqual({
      kind: 'refused',
      status: 422,
      code: 'WRONG_PHASE',
    });
    await port.append(LINK, 'fixture-1', start());
    expect(await port.append(LINK, 'fixture-1', rally(1, 'ent-nobody'))).toEqual({
      kind: 'refused',
      status: 422,
      code: 'INVALID_EVENT',
    });
    expect(await ledgerOf(port)).toHaveLength(1);
  });

  it('a refused tap does not use its key: the same key is tried again, not replayed', async () => {
    const port = createFakeScoringPort(FRESH);
    const early = rally(0, HOME);
    expect(await port.append(LINK, 'fixture-1', early)).toMatchObject({ kind: 'refused' });
    await port.append(LINK, 'fixture-1', start());
    const retried = { ...early, expected_seq: 1 };
    expect(await port.append(LINK, 'fixture-1', retried)).toMatchObject({
      kind: 'accepted',
      seq: 2,
    });
  });

  it('after a black card only the ending is taken: ENDING_SANCTION_PENDING until it is recorded', async () => {
    const port = createFakeScoringPort(FRESH);
    await port.append(LINK, 'fixture-1', start());
    await port.append(LINK, 'fixture-1', rally(1, HOME, { serving: HOME }));
    const card = tap({
      expected_seq: 2,
      type: 'badminton.sanction',
      payload: { by: AWAY, level: 'disqualification' },
    });
    expect(await port.append(LINK, 'fixture-1', card)).toMatchObject({ kind: 'accepted', seq: 3 });
    expect(await port.append(LINK, 'fixture-1', rally(3, HOME))).toEqual({
      kind: 'refused',
      status: 422,
      code: 'ENDING_SANCTION_PENDING',
    });
    const ending = tap({
      expected_seq: 3,
      type: 'core.forfeit',
      payload: { by: AWAY, reason: 'disqualified' },
    });
    expect(await port.append(LINK, 'fixture-1', ending)).toMatchObject({
      kind: 'accepted',
      seq: 4,
    });
  });

  it('once the match is decided another rally is 409 ALREADY_DECIDED', async () => {
    const port = createFakeScoringPort(decided());
    expect(await port.append(LINK, 'fixture-1', rally(43, HOME))).toEqual({
      kind: 'refused',
      status: 409,
      code: 'ALREADY_DECIDED',
    });
  });

  it('an undo is a core.void of an event: accepted, and the ledger names the event it voids', async () => {
    const port = createFakeScoringPort(FRESH);
    await port.append(LINK, 'fixture-1', start());
    await port.append(LINK, 'fixture-1', rally(1, HOME, { serving: HOME }));
    const [, rallyEvent] = await ledgerOf(port);
    const undo = tap({ expected_seq: 2, type: 'core.void', payload: { event_id: rallyEvent.id } });
    expect(await port.append(LINK, 'fixture-1', undo)).toMatchObject({ kind: 'accepted', seq: 3 });
    const [, , voidEvent] = await ledgerOf(port);
    expect(voidEvent).toMatchObject({ type: 'core.void', voids: rallyEvent.id });
  });

  it('a void of an event that is not there is refused by the engine', async () => {
    const port = createFakeScoringPort(FRESH);
    await port.append(LINK, 'fixture-1', start());
    const undo = tap({ expected_seq: 1, type: 'core.void', payload: { event_id: 'nothing' } });
    expect(await port.append(LINK, 'fixture-1', undo)).toEqual({
      kind: 'refused',
      status: 422,
      code: 'INVALID_EVENT',
    });
  });

  it('a seed’s own ledger is folded under the same rules: the next tap is judged against it', async () => {
    const port = createFakeScoringPort(DOUBLES_SEED);
    const id = DOUBLES_SEED.fixtureId;
    const rules = DOUBLES_SEED.rulesVersion;
    expect(await port.append(LINK, id, { ...start(5), rules_version: rules })).toMatchObject({
      kind: 'refused',
      code: 'WRONG_PHASE',
    });
    const next = { ...rally(5, 'ent-home'), rules_version: rules };
    expect(await port.append(LINK, id, next)).toMatchObject({ kind: 'accepted', seq: 6 });
  });
});

describe('append: rules and epoch', () => {
  it('a format correction: the old rules_version is rulesChanged with the new one, nothing written', async () => {
    const port = createFakeScoringPort(FRESH);
    port.setRulesVersion(3);
    expect(await port.append(LINK, 'fixture-1', start())).toEqual({
      kind: 'rulesChanged',
      rulesVersion: 3,
    });
    expect(await ledgerOf(port)).toEqual([]);
    expect(await port.rules(LINK, 'fixture-1')).toMatchObject({ rulesVersion: 3 });
    expect(await port.append(LINK, 'fixture-1', { ...start(), rules_version: 3 })).toMatchObject({
      kind: 'accepted',
      rulesVersion: 3,
    });
  });

  it('rules are asked before the seq: a stale tap under old rules is rulesChanged, not seqConflict', async () => {
    const port = createFakeScoringPort(FRESH);
    port.setRulesVersion(3);
    expect(await port.append(LINK, 'fixture-1', start(7))).toMatchObject({ kind: 'rulesChanged' });
  });

  it('a correction can carry the corrected cfg, which the next fold uses', async () => {
    const port = createFakeScoringPort(FRESH);
    port.setRulesVersion(3, { bestOf: 1, setTo: 11, finalSetTo: 11, winBy: 2, cap: 15 });
    expect(await port.rules(LINK, 'fixture-1')).toMatchObject({ cfg: { bestOf: 1, setTo: 11 } });
    await port.append(LINK, 'fixture-1', { ...start(), rules_version: 3 });
    const first = { ...rally(1, HOME, { serving: HOME }), rules_version: 3 };
    expect(await port.append(LINK, 'fixture-1', first)).toMatchObject({ kind: 'accepted' });
  });

  // The server folds the ledger as it stands and judges only the new tap strictly (`strictFromSeq: candidate.seq`).
  it('after a correction only the new tap is judged strictly: an earlier event the new rules would not record stands', async () => {
    const port = createFakeScoringPort(FRESH);
    await port.append(LINK, 'fixture-1', start());
    await port.append(LINK, 'fixture-1', rally(1, HOME, { serving: HOME }));
    const card = tap({
      expected_seq: 2,
      type: 'badminton.sanction',
      payload: { by: AWAY, level: 'warning' },
    });
    expect(await port.append(LINK, 'fixture-1', card)).toMatchObject({ kind: 'accepted' });
    const noCards = { timeouts: false, sanctions: false, substitutions: false, expedite: false };
    port.setRulesVersion(3, { ...(FRESH.cfg as object), records: noCards });
    const next = { ...rally(3, AWAY), rules_version: 3 };
    expect(await port.append(LINK, 'fixture-1', next)).toMatchObject({ kind: 'accepted', seq: 4 });
    const another = {
      ...tap({
        expected_seq: 4,
        type: 'badminton.sanction',
        payload: { by: AWAY, level: 'warning' },
      }),
      rules_version: 3,
    };
    expect(await port.append(LINK, 'fixture-1', another)).toMatchObject({
      kind: 'refused',
      status: 422,
      code: 'INVALID_EVENT',
    });
  });

  it('an outdated engine: epoch below the floor is outdated with the floor; nothing written', async () => {
    const port = createFakeScoringPort(FRESH);
    port.setEpochRequired(3);
    expect(await port.append(LINK, 'fixture-1', start())).toEqual({
      kind: 'outdated',
      required: 3,
    });
    expect(await ledgerOf(port)).toEqual([]);
    expect(await port.bootstrap(LINK)).toMatchObject({ bootstrap: { epochRequired: 3 } });
  });

  it('an epoch at or above the floor is taken', async () => {
    const port = createFakeScoringPort(FRESH);
    port.setEpochRequired(3);
    expect(await port.append(LINK, 'fixture-1', { ...start(), engine_epoch: 3 })).toMatchObject({
      kind: 'accepted',
    });
  });

  it('a refused-for-epoch key is not consumed; a key already accepted is answered after the epoch moves', async () => {
    const port = createFakeScoringPort(FRESH);
    const first = start();
    const one = await port.append(LINK, 'fixture-1', first);
    port.setEpochRequired(3);
    expect(await port.append(LINK, 'fixture-1', first)).toEqual(one);
    const second = rally(1, HOME, { serving: HOME });
    expect(await port.append(LINK, 'fixture-1', second)).toMatchObject({ kind: 'outdated' });
    port.setEpochRequired(2);
    expect(await port.append(LINK, 'fixture-1', second)).toMatchObject({
      kind: 'accepted',
      seq: 2,
    });
  });

  it('a replay carries the rules version now', async () => {
    const port = createFakeScoringPort(FRESH);
    const first = start();
    await port.append(LINK, 'fixture-1', first);
    port.setRulesVersion(3);
    expect(await port.append(LINK, 'fixture-1', first)).toMatchObject({
      kind: 'accepted',
      rulesVersion: 3,
    });
  });
});

describe('the link and the network', () => {
  it('revoke: every call answers a dead link, nothing is written, there is no realtime grant', async () => {
    const port = createFakeScoringPort(FRESH);
    port.revoke();
    const dead = { kind: 'linkDead', code: 'LINK_REVOKED' };
    expect(await port.bootstrap(LINK)).toEqual(dead);
    expect(await port.events(LINK, 'fixture-1', 0)).toEqual(dead);
    expect(await port.rules(LINK, 'fixture-1')).toEqual(dead);
    expect(await port.append(LINK, 'fixture-1', start())).toEqual(dead);
    expect(await port.realtimeToken(LINK, 'fixture-1')).toBeNull();
  });

  it('goOffline: every call answers offline, nothing is written, and coming back works', async () => {
    const port = createFakeScoringPort(FRESH);
    port.goOffline(true);
    expect(await port.bootstrap(LINK)).toEqual({ kind: 'offline' });
    expect(await port.events(LINK, 'fixture-1', 0)).toEqual({ kind: 'offline' });
    expect(await port.rules(LINK, 'fixture-1')).toEqual({ kind: 'offline' });
    expect(await port.append(LINK, 'fixture-1', start())).toEqual({ kind: 'offline' });
    expect(await port.realtimeToken(LINK, 'fixture-1')).toBeNull();
    port.goOffline(false);
    expect(await ledgerOf(port)).toEqual([]);
    expect(await port.append(LINK, 'fixture-1', start())).toMatchObject({ kind: 'accepted' });
  });

  it('addOtherScorerEvent is the engine’s too: an illegal event is a test’s mistake, thrown', () => {
    const port = createFakeScoringPort(FRESH);
    expect(() => port.addOtherScorerEvent('badminton.rally', { wonBy: HOME })).toThrow(
      /WRONG_PHASE/,
    );
  });
});

describe('a seed that cannot be', () => {
  it('a seed whose ledger the engine refuses is thrown at once, not served', () => {
    const bad = { ...FRESH, events: [{ type: 'badminton.rally', payload: { wonBy: HOME } }] };
    expect(() => createFakeScoringPort(bad)).toThrow(/WRONG_PHASE/);
  });

  it('a decided match reads as completed', async () => {
    const answer = await createFakeScoringPort(decided()).bootstrap(LINK);
    expect(answer).toMatchObject({ kind: 'ok', bootstrap: { status: 'completed', lastSeq: 43 } });
  });
});

describe('the preview samples as seeds', () => {
  it('the singles sample: two names as typed, the context, nothing yet on the sheet', async () => {
    const port = createFakeScoringPort(SINGLES_SEED);
    const answer = await port.bootstrap(LINK);
    expect(answer).toMatchObject({
      kind: 'ok',
      bootstrap: {
        screen: 'pad',
        context: {
          competition: 'Spring Open 2026',
          division: 'U15 Boys Singles',
          round: 'Round 1',
          match: 'Match 4',
        },
        sides: { home: { name: 'A. Sharma' }, away: { name: 'L. Chen' } },
        lastSeq: 0,
      },
    });
    expect(await port.events(LINK, SINGLES_SEED.fixtureId, 0)).toEqual([]);
  });

  it('the doubles sample: both players a side, joined at 3-1 by another scorer, the server named on the first rally', async () => {
    const port = createFakeScoringPort(DOUBLES_SEED);
    const answer = await port.bootstrap(LINK);
    expect(answer).toMatchObject({
      kind: 'ok',
      bootstrap: {
        sides: {
          home: { kind: 'pair', members: [{ fullName: 'A. Sharma' }, { fullName: 'R. Iyer' }] },
          away: { kind: 'pair', members: [{ fullName: 'L. Chen' }, { fullName: 'M. Wong' }] },
        },
        lastSeq: 5,
      },
    });
    expect(answer).toMatchObject({
      bootstrap: {
        sides: {
          home: { lineup: [{ pairOrder: 1 }, { pairOrder: 2 }] },
          away: { lineup: [{ pairOrder: 1 }, { pairOrder: 2 }] },
        },
      },
    });
    const events = (await port.events(LINK, DOUBLES_SEED.fixtureId, 0)) as readonly LedgerEvent[];
    expect(events.map((e) => e.type)).toEqual([
      'core.start',
      'badminton.rally',
      'badminton.rally',
      'badminton.rally',
      'badminton.rally',
    ]);
    expect(events.slice(1).map((e) => e.payload)).toEqual([
      { wonBy: 'ent-home', serving: 'ent-home' },
      { wonBy: 'ent-away' },
      { wonBy: 'ent-home' },
      { wonBy: 'ent-home' },
    ]);
    expect(events.every((e) => e.deviceLinkId === 'fake-other-scorer')).toBe(true);
    const envelopes: EventEnvelope[] = events.map((e) => ({
      id: e.id,
      fixtureId: DOUBLES_SEED.fixtureId,
      seq: e.seq,
      type: e.type,
      payload: e.payload,
      recordedAt: e.recordedAt,
      recordedBy: null,
    }));
    const { sides } = (answer as { bootstrap: Bootstrap }).bootstrap;
    const lineups = { home: lineupOf(sides.home), away: lineupOf(sides.away) };
    const state = foldMatch(
      badminton,
      badminton.configSchema.parse(DOUBLES_SEED.cfg),
      lineups,
      envelopes,
      {
        strictFromSeq: 1,
      },
    );
    expect(state.sets).toEqual([{ home: 3, away: 1, closed: false }]);
  });

  it('a sample that holds a tap the fake cannot write as an event is refused, not guessed', () => {
    const odd = {
      sides: { first: { players: ['A'] }, second: { players: ['B'] } },
      context: { competition: 'C', division: null, round: null, match: null },
      others: [{ kind: 'setScore', first: 5, second: 5 }],
    } as const;
    expect(() => seedFromPadSample(odd)).toThrow(/setScore/);
  });
});

/** A side's lineup as the engine folds it: the bootstrap's own slots, all starting. */
function lineupOf(side: BootstrapSide | null) {
  if (side === null) throw new Error('the seed has both sides');
  return {
    entrantId: side.entrantId,
    slots: side.lineup.map((slot, i) => ({
      personId: slot.personId,
      slot: 'starting' as const,
      orderNo: slot.pairOrder ?? i + 1,
    })),
  };
}

/** Home wins two games 21-0: decided by the 42nd rally. */
function decided(): FakeMatchSeed {
  const rallies = Array.from({ length: 42 }, (_, i) => ({
    type: 'badminton.rally',
    payload: i === 0 ? { wonBy: HOME, serving: HOME } : { wonBy: HOME },
  }));
  return { ...FRESH, events: [{ type: 'core.start', payload: {} }, ...rallies] };
}
