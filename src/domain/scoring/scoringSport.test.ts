import { describe, expect, it } from 'vitest';
import { isRecord } from '@/domain/credentials/wire';
import { badmintonSport } from '@/domain/scoring/badmintonSport';
import type { MatchContext } from '@/domain/scoring/matchContext';
import type { PadHalf, PadSide, PadSync, PadView } from '@/domain/scoring/padView';
import type { MatchQueue } from '@/domain/scoring/queue';
import { openMatch, step } from '@/domain/scoring/scoringMatch';
import type { MatchEffect, MatchHeld, MatchState } from '@/domain/scoring/scoringMatchState';
import { viewAs, viewOf, type MatchView } from '@/domain/scoring/scoringMatchView';
import type { ScoringSport, SportFold, SportFoldInput } from '@/domain/scoring/scoringSport';
import { matchContextOf, type Bootstrap } from '@/domain/scoring/wire';
import { SINGLES } from '../../../test/badmintonLedger';

// The match runtime is sport-agnostic (owner, 2026-11-02: "pad per sport must"): a sport is a module behind
// `ScoringSport`, and the reducer, its pump and its view run any of them. Proved with a made-up sport no build ships,
// "first to 3": a tap is a point to a side, the first side to 3 wins, and nothing else. It shares no code with
// badminton; only the bootstrap's shape (the server's, for any sport) is borrowed from the badminton fixture.

type Point = { readonly side: PadSide };
type FirstTo3Key = 'first3.point' | 'first3.undone' | 'first3.hint' | 'first3.tally';
type FirstTo3Display = {
  readonly points: Readonly<Record<PadSide, number>>;
  readonly context: MatchContext;
  readonly lastTap: { readonly kind: 'point' | 'undone'; readonly side: PadSide } | null;
};
type FirstTo3 = {
  readonly tap: Point;
  readonly display: FirstTo3Display;
  readonly padKey: FirstTo3Key;
  readonly undone: PadSide;
};

const POINT = 'first3.point';
const VOID = 'core.void';
const NOW = 1_000_000;
const AT = '2026-11-02T09:00:00.000Z';

const sideOf = (payload: unknown): PadSide | null =>
  isRecord(payload) && (payload.side === 'first' || payload.side === 'second')
    ? payload.side
    : null;

const voidedBy = (payload: unknown): string | null =>
  isRecord(payload) && typeof payload.event_id === 'string' ? payload.event_id : null;

/** The ledger's standing points, then each queued tap judged on them: a point while nobody has 3, a void of one standing. */
function foldFirstTo3({ bootstrap, ledger, queued }: SportFoldInput): SportFold<FirstTo3> {
  const voided = new Set(ledger.flatMap((event) => (event.voids === null ? [] : [event.voids])));
  const standing = new Map<string, PadSide>();
  for (const event of ledger) {
    const side = event.type === POINT && !voided.has(event.id) ? sideOf(event.payload) : null;
    if (side !== null) standing.set(event.id, side);
  }
  const points = { first: 0, second: 0 };
  standing.forEach((side) => (points[side] += 1));
  let lastTap: FirstTo3Display['lastTap'] = null;
  const legalQueued: string[] = [];
  for (const tap of queued) {
    const target = tap.type === VOID ? voidedBy(tap.payload) : null;
    const taken = target === null ? undefined : standing.get(target);
    const side = tap.type === POINT ? sideOf(tap.payload) : null;
    if (target !== null && taken !== undefined) {
      standing.delete(target);
      points[taken] -= 1;
    } else if (side !== null && Math.max(points.first, points.second) < 3) {
      points[side] += 1;
      lastTap = { kind: 'point', side };
    } else continue;
    legalQueued.push(tap.key);
  }
  const display = { points, context: matchContextOf(bootstrap) ?? CONTEXT, lastTap };
  return { kind: 'folded', display, legalQueued, history: [] };
}

const CONTEXT: MatchContext = {
  competition: 'Made-up Cup',
  division: null,
  round: null,
  match: null,
  sides: ['Top', 'Bottom'],
};

function half(display: FirstTo3Display, side: PadSide): PadHalf<FirstTo3Key> {
  return {
    side,
    label: display.context.sides[side === 'first' ? 0 : 1],
    value: String(display.points[side]),
    periods: null,
    sub: null,
    serving: null,
    hint: { key: 'first3.hint' },
    hintLine: { key: 'first3.hint' },
    tappable: true,
  };
}

function padFirstTo3(display: FirstTo3Display, sync: PadSync): PadView<FirstTo3Key> {
  const { lastTap } = display;
  return {
    halves: [half(display, 'first'), half(display, 'second')],
    tally: { shown: '0:0', said: { key: 'first3.tally' } },
    details: { context: display.context, rules: [] },
    start: null,
    strip: [],
    lastTap:
      lastTap === null
        ? null
        : { text: { key: `first3.${lastTap.kind}`, vars: { side: lastTap.side } }, undo: true },
    sync,
    tools: [],
    card: null,
  };
}

const firstTo3: ScoringSport<FirstTo3> = {
  key: 'first3',
  epoch: 7,
  fold: foldFirstTo3,
  eventFor: (tap) => ({ type: POINT, payload: { side: tap.side } }),
  /** What the pump sends, marked, so a send shows it was this sport's decision. */
  payloadForSend: (queued, ledger) =>
    isRecord(queued.payload) ? { ...queued.payload, seen: ledger.length } : queued.payload,
  tossOf: () => null,
  refusalFor: () => 'notNow',
  notStarted: () => false,
  decided: (display) => Math.max(display.points.first, display.points.second) >= 3,
  awaitingEnding: () => false,
  undoneOf: (display) => (display.lastTap?.kind === 'point' ? display.lastTap.side : null),
  showUndone: (display, side) => ({ ...display, lastTap: { kind: 'undone', side } }),
  pad: padFirstTo3,
};

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
