import { describe, expect, it } from 'vitest';
import type { MatchQueue } from '@/domain/scoring/queue';
import type { ScoringSport } from '@/domain/scoring/scoringSport';
import { openMatch, step, wakeAt } from '@/domain/scoring/scoringMatch';
import type { MatchEvent, MatchHeld, MatchState } from '@/domain/scoring/scoringMatchState';
import type { Bootstrap } from '@/domain/scoring/wire';
import { SINGLES } from '../../../test/badmintonLedger';
import { firstTo3, type FirstTo3 } from '../../../test/firstTo3Sport';
import { drive, kinds, sendsOf } from '../../../test/scoringMatchFixtures';

// A tap the sport holds unsent for a moment (S2-7 ruling 234, Task 17), through the match reducer, with the made-up sport
// "first to 3" given a hold: the runtime knows nothing of tennis. The hold is the sport's (`SportEvent.hold`), the time the
// runner's clock (`now`), and the rules are the queue's (`syncHold.ts`): a held tap is folded at once and sent when its hold
// ends, when the next tap is made, when it is amended, when the match goes to the background, or when it is released.

const NOW = 1_000_000;
const AT = '2026-11-12T09:00:00.000Z';
const HOLD = 10_000;

/** First to 3, whose every point is held. */
const holding: ScoringSport<FirstTo3> = {
  ...firstTo3,
  eventFor: (tap) => ({ type: 'first3.point', payload: { side: tap.side }, hold: HOLD }),
};

const BOOT: Bootstrap = { ...SINGLES, sportKey: 'first3', cfg: {} };
const QUEUE: MatchQueue = {
  fixtureId: SINGLES.fixtureId,
  label: '',
  pending: [],
  ownEventIds: [],
  dead: null,
};

function readyMatch(sport: ScoringSport<FirstTo3> = holding): MatchState<FirstTo3> {
  const held: MatchHeld<FirstTo3> = {
    sport,
    queue: QUEUE,
    ledger: [],
    bootstrap: BOOT,
    toss: null,
    judge: 'fold',
    foreground: true,
    rulesVersion: 1,
    decidedAt: null,
  };
  return step(openMatch(held, NOW).state, { kind: 'fetched', events: [] }, NOW).state;
}

const point = (key: string, side: 'first' | 'second' = 'first'): MatchEvent<FirstTo3> => ({
  kind: 'tap',
  tap: { side },
  key,
  at: AT,
});
const SAVED = (n: number): MatchEvent<FirstTo3> => ({ kind: 'saved', n });

/** One held point, made and saved at NOW: nothing has been sent. */
function heldPoint() {
  const { state, steps } = drive(readyMatch(), [point('p1'), SAVED(1)], NOW);
  return { state, steps };
}

describe('a held tap through the reducer', () => {
  it('is queued held for the sport’s time, folded at once, and not sent when its save lands', () => {
    const { state, steps } = heldPoint();
    expect(state.sync.queue.pending).toMatchObject([
      { key: 'p1', payload: { side: 'first' }, holdUntil: NOW + HOLD },
    ]);
    expect(sendsOf(steps[1].effects)).toEqual([]);
  });

  it('asks the runner to wake when the hold ends, and is sent then', () => {
    const { state } = heldPoint();
    expect(wakeAt(state, NOW)).toBe(NOW + HOLD);
    const due = step(state, { kind: 'tick' }, NOW + HOLD);
    expect(sendsOf(due.effects).map((send) => send.body.idempotency_key)).toEqual(['p1']);
  });

  it('is sent as before by a sport that sets no hold', () => {
    const { state, steps } = drive(readyMatch(firstTo3), [point('p1'), SAVED(1)], NOW);
    expect(state.sync.queue.pending[0]).not.toHaveProperty('holdUntil');
    expect(sendsOf(steps[1].effects).map((send) => send.body.idempotency_key)).toEqual(['p1']);
  });

  it('is let go by the next tap, which is held in its turn (a second point while the first is held)', () => {
    const { state, steps } = drive(heldPoint().state, [point('p2', 'second'), SAVED(2)], NOW);
    expect(state.sync.queue.pending[0]).not.toHaveProperty('holdUntil');
    expect(sendsOf(steps[1].effects).map((send) => send.body.idempotency_key)).toEqual(['p1']);
    expect(state.sync.queue.pending[1]).toMatchObject({ key: 'p2', holdUntil: NOW + HOLD });
  });

  it('takes an amended payload and sends it at once, saved first, before the hold would have ended', () => {
    const amended = { side: 'first', note: 'ace' };
    const { state, steps } = drive(
      heldPoint().state,
      [{ kind: 'amend', key: 'p1', payload: amended }],
      NOW + 1_000,
    );
    expect(steps[0].outcome).toEqual({ ok: true });
    expect(kinds(steps[0].effects)).toEqual(['save', 'send']);
    const [save] = steps[0].effects;
    expect(save.kind === 'save' && save.queue?.pending[0].payload).toMatchObject(amended);
    expect(sendsOf(steps[0].effects)[0].body.payload).toMatchObject(amended);
    expect(state.sync.inFlight).toBe('p1');
  });

  it('refuses an amend once the tap has gone, and changes nothing (a chip after the hold expired)', () => {
    const sent = step(heldPoint().state, { kind: 'tick' }, NOW + HOLD).state;
    const late = step(sent, { kind: 'amend', key: 'p1', payload: { side: 'first' } }, NOW + HOLD);
    expect(late.outcome).toEqual({ ok: false, refusal: 'notNow' });
    expect(late.state.sync).toBe(sent.sync);
    expect(late.effects).toEqual([]);
  });

  it('refuses an amend the match would not take, and keeps the tap held as it was', () => {
    const { state } = heldPoint();
    const bad = step(state, { kind: 'amend', key: 'p1', payload: { side: 'nowhere' } }, NOW);
    expect(bad.outcome).toEqual({ ok: false, refusal: 'notNow' });
    expect(bad.state.sync).toBe(state.sync);
  });

  it('is let go when the match goes to the background, so the return sends it at once', () => {
    const away = drive(heldPoint().state, [{ kind: 'background' }, SAVED(2)], NOW).state;
    expect(away.sync.queue.pending[0]).not.toHaveProperty('holdUntil');
    const back = step(away, { kind: 'foreground' }, NOW + 1);
    expect(sendsOf(back.effects).map((send) => send.body.idempotency_key)).toEqual(['p1']);
  });

  it('is let go and sent at once when released (the scorer turned the details off)', () => {
    const released = step(heldPoint().state, { kind: 'release' }, NOW + 1);
    expect(sendsOf(released.effects).map((send) => send.body.idempotency_key)).toEqual(['p1']);
  });

  it('leaves the queue untouched when released with nothing held', () => {
    const state = readyMatch();
    expect(step(state, { kind: 'release' }, NOW).state.sync).toBe(state.sync);
  });

  it('is taken back by Undo before anything is sent', () => {
    const { state, steps } = drive(heldPoint().state, [{ kind: 'undo', key: 'u1', at: AT }], NOW);
    expect(steps[0].outcome).toEqual({ ok: true });
    expect(state.sync.queue.pending).toEqual([]);
    expect(steps.flatMap((one) => sendsOf(one.effects))).toEqual([]);
  });
});
