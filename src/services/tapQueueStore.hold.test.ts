import { describe, expect, it } from 'vitest';
import type { MatchQueue, QueuedEvent } from '@/domain/scoring/queue';
import { createLogger } from '@/services/logger';
import { createRingRecord } from '@/services/sessionRecord';
import { createTapQueueStore } from '@/services/tapQueueStore';
import { createMemoryQueueFiles } from '../../test/memoryQueueFiles';

// S2-7 ruling 234 (Task 17): a tennis point held unsent while its chips show. The tap itself is durable at once, as every
// tap is; its hold is not. The hold is a time on the runner's clock, which a kill does not keep, so the file never holds
// one: a held tap read back after process death is an ordinary tap, sent as it stands (untagged, if no chip was tapped).
// No FILE_VERSION change: nothing is added to the file.

const FIXTURE = '6f0c5a52-3d1e-4a0b-8f55-0c2f6d7b9e10';

const point: QueuedEvent = {
  key: 'a2f4c3d1-7a60-4d5e-9b0c-1e2f3a4b5c6d',
  type: 'tennis.point',
  payload: { by: 'ent-home', server: 'p-home-1' },
  rulesVersion: 2,
  createdAt: '2026-11-12T09:27:44.000Z',
  attempts: 0,
};

const queue = (pending: readonly QueuedEvent[]): MatchQueue => ({
  fixtureId: FIXTURE,
  label: 'A. Sharma v L. Chen',
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

describe('a held tap in the queue file', () => {
  it('is written at once with everything but its hold, and reads back unheld', async () => {
    const { store, files } = storeOver();
    await store.save(queue([{ ...point, holdUntil: 1_010_000 }]));
    const written = files.files.get(`${FIXTURE}.json`) ?? '';
    expect(written).toContain('a2f4c3d1-7a60-4d5e-9b0c-1e2f3a4b5c6d');
    expect(written).not.toContain('holdUntil');
    const back = await store.load(FIXTURE);
    expect(back?.pending).toEqual([point]);
  });

  it('reads a file that names a hold as an unheld tap, kept whole', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(
      `${FIXTURE}.json`,
      JSON.stringify({ v: 1, ...queue([]), pending: [{ ...point, holdUntil: 1_010_000 }] }),
    );
    const back = await storeOver(files).store.load(FIXTURE);
    expect(back?.pending).toEqual([point]);
  });
});
