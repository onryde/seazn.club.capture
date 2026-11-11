import { describe, expect, it } from 'vitest';
import type { MatchQueue, QueuedEvent } from '@/domain/scoring/queue';
import type { LedgerEvent } from '@/domain/scoring/wire';
import { createLogger } from '@/services/logger';
import { createRingRecord } from '@/services/sessionRecord';
import { createTapQueueStore } from '@/services/tapQueueStore';
import { createMemoryQueueFiles } from '../../test/memoryQueueFiles';

// Ruling 149: a tap is stamped on the server's clock when an offset is known, and says so (`stampedOn: 'server'`); with
// none it is the phone's own clock and carries no mark. Files written before the ruling (v1.0.6 on the internal track:
// stamped on the wall clock; this branch's builds before it: on the steady clock) carry no mark either, and read as the
// phone's own clock, which is what they are. The mark rides the queue file and, on the stand-in an accepted tap leaves
// in the ledger, the ledger cache.

const FIXTURE = '6f0c5a52-3d1e-4a0b-8f55-0c2f6d7b9e10';

const tap = (overrides: Partial<QueuedEvent> = {}): QueuedEvent => ({
  key: 'a2f4c3d1-7a60-4d5e-9b0c-1e2f3a4b5c6d',
  type: 'football.clock',
  payload: { running: true, at: { period: 'H1', elapsed: 0 } },
  rulesVersion: 2,
  createdAt: '2026-11-11T09:27:44.000Z',
  attempts: 0,
  ...overrides,
});

const queue = (pending: readonly QueuedEvent[]): MatchQueue => ({
  fixtureId: FIXTURE,
  label: 'Hillcrest Sevens v Lakeside Rangers',
  pending,
  ownEventIds: [],
  dead: null,
});

const standIn = (overrides: Partial<LedgerEvent> = {}): LedgerEvent => ({
  id: 'ev-1',
  seq: 1,
  type: 'football.clock',
  payload: { running: true, at: { period: 'H1', elapsed: 0 } },
  recordedAt: '2026-11-11T09:27:44.000Z',
  voids: null,
  deviceLinkId: null,
  ...overrides,
});

function storeOver(files = createMemoryQueueFiles()) {
  const store = createTapQueueStore({
    files,
    logger: createLogger({ record: createRingRecord(), now: () => 0 }),
  });
  return { store, files };
}

const text = (value: unknown) => JSON.stringify(value);

describe('the clock a tap was stamped on, in the queue file', () => {
  it('round-trips a server stamp, and writes no mark for a stamp on the phone’s own clock', async () => {
    const { store, files } = storeOver();
    const server = tap({ stampedOn: 'server' });
    const own = tap({ key: 'b3a5d4e2-8b71-4e6f-8c1d-2f3a4b5c6d7e' });
    await store.save(queue([server, own]));
    const back = await store.load(FIXTURE);
    expect(back?.pending).toEqual([server, own]);
    expect(back?.pending[1]).not.toHaveProperty('stampedOn');
    expect(files.files.get(`${FIXTURE}.json`)).not.toContain('"stampedOn":"device"');
  });

  it('reads a file written before ruling 149 (no mark) as the phone’s own clock, every tap kept', async () => {
    const files = createMemoryQueueFiles();
    // As v1.0.6 wrote it: no `stampedOn` key anywhere.
    files.files.set(`${FIXTURE}.json`, text({ v: 1, ...queue([tap()]) }));
    const back = await storeOver(files).store.load(FIXTURE);
    expect(back?.pending).toEqual([tap()]);
    expect(back?.pending[0]).not.toHaveProperty('stampedOn');
  });

  it.each(['device', 'SERVER', 1, null, {}])(
    'reads a mark of %j as no mark, and keeps the tap',
    async (garbled) => {
      const files = createMemoryQueueFiles();
      files.files.set(
        `${FIXTURE}.json`,
        text({ v: 1, ...queue([]), pending: [{ ...tap(), stampedOn: garbled }] }),
      );
      const back = await storeOver(files).store.load(FIXTURE);
      expect(back?.pending).toEqual([tap()]);
    },
  );
});

describe('the clock a stand-in was stamped on, in the ledger cache', () => {
  it('round-trips a server-stamped stand-in, and writes no mark for the rest', async () => {
    const { store } = storeOver();
    const ledger = [standIn({ stampedOn: 'server' }), standIn({ id: 'ev-2', seq: 2 })];
    await store.saveLedger(FIXTURE, ledger);
    const back = await store.loadLedger(FIXTURE);
    expect(back).toEqual(ledger);
    expect(back?.[1]).not.toHaveProperty('stampedOn');
  });

  it('reads a ledger cache written before ruling 149 as the phone’s own clock', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(
      `${FIXTURE}.ledger.json`,
      text({ v: 1, fixtureId: FIXTURE, events: [standIn()] }),
    );
    const back = await storeOver(files).store.loadLedger(FIXTURE);
    expect(back).toEqual([standIn()]);
  });
});
