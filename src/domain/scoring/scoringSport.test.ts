import { describe, expect, it } from 'vitest';
import { badmintonSport } from '@/domain/scoring/badmintonSport';
import type { MatchQueue } from '@/domain/scoring/queue';
import { openMatch, step } from '@/domain/scoring/scoringMatch';
import type { MatchEffect, MatchHeld, MatchState } from '@/domain/scoring/scoringMatchState';
import { viewAs, viewOf, type MatchView } from '@/domain/scoring/scoringMatchView';
import type { Bootstrap } from '@/domain/scoring/wire';
import { SINGLES } from '../../../test/badmintonLedger';
import { firstTo3, type FirstTo3 } from '../../../test/firstTo3Sport';

// The match runtime is sport-agnostic (owner, 2026-11-02: "pad per sport must"): a sport is a module behind
// `ScoringSport`, and the reducer, its pump and its view run any of them. Proved with a made-up sport no build ships,
// "first to 3" (`test/firstTo3Sport.ts`); only the bootstrap's shape (the server's, for any sport) is borrowed from the
// badminton fixture.

const NOW = 1_000_000;
const AT = '2026-11-02T09:00:00.000Z';

const BOOT: Bootstrap = { ...SINGLES, sportKey: 'first3', cfg: {} };

const QUEUE: MatchQueue = {
  fixtureId: SINGLES.fixtureId,
  label: '',
  pending: [],
  ownEventIds: [],
  dead: null,
};

const HELD: MatchHeld<FirstTo3> = {
  sport: firstTo3,
  queue: QUEUE,
  ledger: [],
  bootstrap: BOOT,
  toss: null,
  judge: 'fold',
  foreground: true,
  rulesVersion: 1,
};

/** The match opened and its first ledger read answered with nothing: a scorer's empty pad. */
function readyMatch(held: MatchHeld<FirstTo3> = HELD): MatchState<FirstTo3> {
  const opened = openMatch(held, NOW);
  return step(opened.state, { kind: 'fetched', events: [] }, NOW).state;
}

const sends = (effects: readonly MatchEffect[]) =>
  effects.flatMap((effect) => (effect.kind === 'send' ? [effect] : []));

function padOf<S extends FirstTo3>(view: MatchView<S>) {
  if (view.kind !== 'pad') throw new Error(`expected the pad, got ${view.kind}`);
  return view;
}

describe('a sport the runtime has never heard of', () => {
  it('opens under its own engine epoch, the one every tap is sent with', () => {
    expect(openMatch(HELD, NOW).state.sync.engineEpoch).toBe(7);
  });

  it('goes through a tap, its answer and an Undo of it, folded and sent by that sport alone', () => {
    const ready = readyMatch();
    const tapped = step(ready, { kind: 'tap', tap: { side: 'first' }, key: 'k1', at: AT }, NOW);
    expect(tapped.outcome).toEqual({ ok: true });
    expect(tapped.state.sync.queue.pending.map((tap) => [tap.key, tap.type, tap.payload])).toEqual([
      ['k1', 'first3.point', { side: 'first' }],
    ]);
    expect(padOf(viewOf(tapped.state)).view.halves.map((h) => h.value)).toEqual(['1', '0']);

    const saved = step(tapped.state, { kind: 'saved', n: 1 }, NOW);
    const [send] = sends(saved.effects);
    expect(send.body).toMatchObject({
      type: 'first3.point',
      payload: { side: 'first', seen: 0 },
      engine_epoch: 7,
      idempotency_key: 'k1',
    });

    const answered = step(
      saved.state,
      {
        kind: 'answered',
        sent: send.sent,
        answer: { kind: 'accepted', seq: 1, eventId: 'ev-1', rulesVersion: 1 },
      },
      NOW,
    );
    expect(answered.state.sync.queue.pending).toEqual([]);
    expect(answered.state.sync.queue.ownEventIds).toEqual(['ev-1']);
    expect(padOf(viewOf(answered.state)).display.points).toEqual({ first: 1, second: 0 });

    const undone = step(answered.state, { kind: 'undo', key: 'u1', at: AT }, NOW);
    expect(undone.outcome).toEqual({ ok: true });
    expect(undone.state.sync.queue.pending.map((tap) => [tap.key, tap.type, tap.payload])).toEqual([
      ['u1', 'core.void', { event_id: 'ev-1' }],
    ]);
    expect(padOf(viewOf(undone.state)).display.points).toEqual({ first: 0, second: 0 });
  });

  it('says what an Undo took back while it was only queued, in that sport’s own words', () => {
    const tapped = step(
      readyMatch(),
      { kind: 'tap', tap: { side: 'second' }, key: 'k1', at: AT },
      NOW,
    );
    const undone = step(tapped.state, { kind: 'undo', key: 'u1', at: AT }, NOW);
    expect(undone.state.sync.queue.pending).toEqual([]);
    expect(undone.state.undone).toEqual({ tap: 'second', over: '0:' });
    expect(padOf(viewOf(undone.state)).view.lastTap).toEqual({
      text: { key: 'first3.undone', vars: { side: 'second' } },
      undo: true,
    });
  });

  it('is never folded as another: a bootstrap naming badminton reads as a sport this match does not score', () => {
    const ready = readyMatch({ ...HELD, bootstrap: SINGLES });
    expect(viewOf(ready)).toEqual({ kind: 'unsupportedSport', sportKey: 'badminton' });
    const tapped = step(ready, { kind: 'tap', tap: { side: 'first' }, key: 'k1', at: AT }, NOW);
    expect(tapped.outcome).toEqual({ ok: false, refusal: 'notNow' });
  });

  it('never judges its queue on another sport’s bootstrap: kept taps are held, never sent', () => {
    const kept = {
      key: 'k1',
      type: 'first3.point',
      payload: { side: 'first' },
      rulesVersion: 1,
      createdAt: AT,
      attempts: 0,
    };
    const held = { ...HELD, bootstrap: SINGLES, queue: { ...QUEUE, pending: [kept] } };
    const opened = openMatch(held, NOW);
    const read = step(opened.state, { kind: 'fetched', events: [] }, NOW);
    expect(sends(read.effects)).toEqual([]);
    expect(read.state.sync.queue.pending).toEqual([kept]);
  });
});

describe('viewAs: a screen sees only a match of its own sport', () => {
  it('draws the match scored as its sport', () => {
    expect(viewAs(firstTo3, readyMatch()).kind).toBe('pad');
  });

  it('says a match scored as another sport is not its to draw, naming the match’s sport', () => {
    expect(viewAs(badmintonSport, readyMatch())).toEqual({
      kind: 'unsupportedSport',
      sportKey: 'first3',
    });
  });
});
