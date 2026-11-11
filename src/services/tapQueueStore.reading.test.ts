import { describe, expect, it } from 'vitest';
import type { MatchQueue, QueuedEvent } from '@/domain/scoring/queue';
import { createLogger } from '@/services/logger';
import { createRingRecord } from '@/services/sessionRecord';
import { createTapQueueStore } from '@/services/tapQueueStore';
import { createMemoryQueueFiles } from '../../test/memoryQueueFiles';

// Ruling 154 (review M1): a football sub that joined a stoppage is queued with the stoppage's stamp, and keeps its own
// reading beside it (`reading`), local to the phone and never sent, so its send can fall back to it when the stoppage is
// gone. The reading rides the queue file across a kill. A file written before it has none, and reads as before (the
// payload's stamp stands); a garbled one reads as absent and the tap is kept. No FILE_VERSION change: an optional field,
// as `base` was.

const FIXTURE = '6f0c5a52-3d1e-4a0b-8f55-0c2f6d7b9e10';

const tap = (overrides: Partial<QueuedEvent> = {}): QueuedEvent => ({
  key: 'a2f4c3d1-7a60-4d5e-9b0c-1e2f3a4b5c6d',
  type: 'football.sub',
  payload: { by: 'ent-home', off: 'H-p7', on: 'H-p13', at: { period: 'H1', elapsed: 600 } },
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

function storeOver(files = createMemoryQueueFiles()) {
  const store = createTapQueueStore({
    files,
    logger: createLogger({ record: createRingRecord(), now: () => 0 }),
  });
  return { store, files };
}

const text = (value: unknown) => JSON.stringify(value);

describe('a joined sub’s own reading, in the queue file', () => {
  it('round-trips the reading, 0 s included, and writes none for a tap with none', async () => {
    const { store } = storeOver();
    const joined = tap({ reading: { period: 'H1', elapsed: 700 } });
    const atZero = tap({
      key: 'b3a5d4e2-8b71-4e6f-8c1d-2f3a4b5c6d7e',
      reading: { period: 'H2', elapsed: 0 },
    });
    const plain = tap({ key: 'c4b6e5f3-9c82-4f70-9d2e-3a4b5c6d7e8f' });
    await store.save(queue([joined, atZero, plain]));
    const back = await store.load(FIXTURE);
    expect(back?.pending).toEqual([joined, atZero, plain]);
    expect(back?.pending[2]).not.toHaveProperty('reading');
  });

  it('reads a file written before the reading was kept as before, every tap kept', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(`${FIXTURE}.json`, text({ v: 1, ...queue([tap()]) }));
    const back = await storeOver(files).store.load(FIXTURE);
    expect(back?.pending).toEqual([tap()]);
  });

  it.each([
    null,
    'H1 700',
    { period: 'H1' },
    { elapsed: 700 },
    { period: 1, elapsed: 700 },
    { period: 'H1', elapsed: -1 },
    { period: 'H1', elapsed: 1.5 },
  ])('reads a reading of %j as absent, and keeps the tap', async (garbled) => {
    const files = createMemoryQueueFiles();
    files.files.set(
      `${FIXTURE}.json`,
      text({ v: 1, ...queue([]), pending: [{ ...tap(), reading: garbled }] }),
    );
    const back = await storeOver(files).store.load(FIXTURE);
    expect(back?.pending).toEqual([tap()]);
  });

  it('keeps only the period and the seconds of a reading', async () => {
    const files = createMemoryQueueFiles();
    const reading = { period: 'H1', elapsed: 700, minute: 12 };
    files.files.set(
      `${FIXTURE}.json`,
      text({ v: 1, ...queue([]), pending: [{ ...tap(), reading }] }),
    );
    const back = await storeOver(files).store.load(FIXTURE);
    expect(back?.pending).toEqual([tap({ reading: { period: 'H1', elapsed: 700 } })]);
  });
});
