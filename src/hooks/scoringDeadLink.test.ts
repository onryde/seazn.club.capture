import { describe, expect, it, vi } from 'vitest';
import { watchDeadLink } from '@/hooks/scoringDeadLink';
import type { RunnerSnapshot, ScoringRunner } from '@/hooks/scoringRunner';
import { createFakePorts } from '../../test/fakePorts';
import { LINK, STORED_LINK, linkKey } from '../../test/scoringHomeFixtures';

// The watch on a focused runner (plan S2-1 Task 10; design §4.3), on its own, over a runner that says what it is told.
// The hub test drives it over a real runner; this one pins the three things only a stub can order.

const MATCH = 'fx-watch';

/** A runner whose snapshot is whatever the test last set: only what the watch reads of it. */
function stubRunner(first: RunnerSnapshot) {
  let snapshot = first;
  const listeners = new Set<() => void>();
  const runner = {
    fixtureId: MATCH,
    snapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as ScoringRunner;
  return {
    runner,
    listeners,
    set(next: RunnerSnapshot) {
      snapshot = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

const LOADING = { kind: 'loading' } as unknown as RunnerSnapshot;
/** A ready match whose queue died on its link with nothing in it. */
const DEAD = {
  kind: 'ready',
  state: { sync: { queue: { dead: 'LINK_REVOKED', pending: [] } }, closed: null },
} as unknown as RunnerSnapshot;

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

async function rig() {
  const fakes = createFakePorts();
  await fakes.kv.set(linkKey(MATCH), STORED_LINK);
  return fakes;
}

describe('watchDeadLink', () => {
  it('looks at once: a runner already ready and dead is forgotten without waiting for the next change', async () => {
    const fakes = await rig();
    watchDeadLink(fakes.ports, stubRunner(DEAD).runner);
    await settle();
    expect(fakes.kv.entries.has(linkKey(MATCH))).toBe(false);
  });

  it('forgets the switches set for the match with its link (S2-7 ruling 234)', async () => {
    const fakes = await rig();
    await fakes.kv.set(`scoring.switch.pointDetails.${MATCH}`, 'on');
    watchDeadLink(fakes.ports, stubRunner(DEAD).runner);
    await settle();
    expect(fakes.kv.entries.has(`scoring.switch.pointDetails.${MATCH}`)).toBe(false);
  });

  it('forgets once, however many times the runner says more afterwards', async () => {
    const fakes = await rig();
    const stub = stubRunner(LOADING);
    watchDeadLink(fakes.ports, stub.runner);
    stub.set(DEAD);
    await settle();
    const del = vi.spyOn(fakes.kv, 'delete');
    stub.set(DEAD);
    stub.set(DEAD);
    await settle();
    expect(del).not.toHaveBeenCalled();
  });

  it('stops when it is told to: a later death forgets nothing and the runner keeps no listener of it', async () => {
    const fakes = await rig();
    const stub = stubRunner(LOADING);
    const stop = watchDeadLink(fakes.ports, stub.runner);
    expect(stub.listeners.size).toBe(1);
    stop();
    expect(stub.listeners.size).toBe(0);
    stub.set(DEAD);
    await settle();
    expect(fakes.kv.entries.has(linkKey(MATCH))).toBe(true);
  });
});
