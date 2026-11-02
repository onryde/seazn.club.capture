import { describe, expect, it } from 'vitest';
import { step, wakeAt } from '@/domain/scoring/scoringMatch';
import type { MatchState } from '@/domain/scoring/scoringMatchState';
import { queuedOf, rally } from '../../../test/badmintonLedger';
import {
  NOW,
  opened,
  ready,
  savesOf,
  sendsOf,
  sentOnce,
  tapped,
} from '../../../test/scoringMatchFixtures';

// What the reducer waits for, as one time (plan S2-1 Task 9 review, item 3): the runner arms ONE timer at it after every
// step, so no later wait is left without a timer. Times are the caller's clock (NOW is 1_000_000 ms).

describe('wakeAt: the next time something is due', () => {
  it('is nothing with nothing waited for', () => {
    expect(wakeAt(ready(), NOW)).toBeNull();
  });

  it('after a send with no answer is the end of the first backoff, one second on', () => {
    const { state, sent } = sentOnce();
    const down = step(state, { kind: 'answered', sent, answer: { kind: 'offline' } }, NOW);
    expect(wakeAt(down.state, NOW)).toBe(NOW + 1000);
  });

  it('is the earliest wait ahead of now, and the later one once that is past', () => {
    const { state, sent } = sentOnce();
    const limited = step(
      state,
      { kind: 'answered', sent, answer: { kind: 'rateLimited', retryAfterMs: 15_000 } },
      NOW,
    );
    const failed = step(limited.state, { kind: 'saveFailed', key: null }, NOW);
    expect(wakeAt(failed.state, NOW)).toBe(NOW + 5000);
    const due = step(failed.state, { kind: 'tick' }, NOW + 5000);
    expect(savesOf(due.effects)).toHaveLength(1);
    expect(wakeAt(due.state, NOW + 5000)).toBe(NOW + 15_000);
    const sendsAt = step(due.state, { kind: 'tick' }, NOW + 15_000);
    expect(sendsOf(sendsAt.effects)).toHaveLength(0);
  });

  it('a wait that has come is not ahead: nothing is armed for it', () => {
    const { state, sent } = sentOnce();
    const down = step(state, { kind: 'answered', sent, answer: { kind: 'offline' } }, NOW);
    expect(wakeAt(down.state, NOW + 1000)).toBeNull();
  });

  it('is the rules read asked again, 15 s after it failed, with nothing queued', () => {
    const state = ready();
    const failed = step(state, { kind: 'rulesFailed', failure: { kind: 'offline' } }, NOW);
    expect(wakeAt(failed.state, NOW)).toBeNull();
    const held = step(
      state,
      {
        kind: 'answered',
        sent: queuedOf('x', rally('H')),
        answer: { kind: 'rulesChanged', rulesVersion: 2 },
      },
      NOW,
    );
    const failedAfterAsk = step(
      held.state,
      { kind: 'rulesFailed', failure: { kind: 'offline' } },
      NOW,
    );
    expect(wakeAt(failedAfterAsk.state, NOW)).toBe(NOW + 15_000);
  });

  it('a send’s wait is not one with nothing queued to send', () => {
    const state = opened(tapped([queuedOf('k1', rally('H'))]));
    const failed = step(state, { kind: 'fetchFailed', failure: { kind: 'offline' } }, NOW).state;
    expect(wakeAt(failed, NOW)).toBe(NOW + 5000);
    const emptied: MatchState = {
      ...failed,
      sync: { ...failed.sync, queue: { ...failed.sync.queue, pending: [] } },
    };
    expect(wakeAt(emptied, NOW)).toBeNull();
  });

  it('is nothing in the background, and the wait again on the return', () => {
    const { state, sent } = sentOnce();
    const down = step(state, { kind: 'answered', sent, answer: { kind: 'offline' } }, NOW).state;
    const away = step(down, { kind: 'background' }, NOW).state;
    expect(wakeAt(away, NOW)).toBeNull();
    expect(wakeAt(step(away, { kind: 'foreground' }, NOW).state, NOW)).toBe(NOW + 1000);
  });

  it('is nothing for a queue that is dead: its taps are never sent', () => {
    const { state, sent } = sentOnce();
    const down = step(state, { kind: 'answered', sent, answer: { kind: 'offline' } }, NOW);
    const dead = step(
      down.state,
      { kind: 'answered', sent, answer: { kind: 'linkDead', code: 'LINK_REVOKED' } },
      NOW,
    );
    expect(wakeAt(dead.state, NOW)).toBeNull();
  });
});
