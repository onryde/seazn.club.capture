import { describe, expect, it } from 'vitest';
import type { MatchQueue } from '@/domain/scoring/queue';
import { createLogger } from '@/services/logger';
import { createRingRecord } from '@/services/sessionRecord';
import { createTapQueueStore } from '@/services/tapQueueStore';
import { createMemoryQueueFiles } from '../../test/memoryQueueFiles';

// MD-2 final review I1: Match Day lets go of a match it opened that has NO queue. A folder the phone could not list is
// not an empty one, so `listKnown` says null for it where `list` says none.

const FIXTURE = '6f0c5a52-3d1e-4a0b-8f55-0c2f6d7b9e10';
const OTHER = '0b7f2c11-5e3a-4d2b-9a61-7c8e9f0a1b2c';

const queue = (fixtureId = FIXTURE): MatchQueue => ({
  fixtureId,
  label: 'Match 4',
  pending: [],
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

describe('listKnown', () => {
  it('lists what list lists: a queue and an unreadable one', async () => {
    const { store, files } = storeOver();
    await store.save(queue());
    files.files.set(`${OTHER}.json`, '{garbled');
    const known = await store.listKnown();
    expect(known).toEqual([
      { kind: 'unreadable', fixtureId: OTHER },
      { kind: 'queue', queue: { ...queue() } },
    ]);
  });

  it('an empty folder is an empty list, not null', async () => {
    expect(await storeOver().store.listKnown()).toEqual([]);
  });

  it('a folder that cannot be listed is null, never none; the next call lists again', async () => {
    const { store, files } = storeOver();
    await store.save(queue());
    files.failNext('names');
    expect(await store.listKnown()).toBeNull();
    expect(await store.listKnown()).toHaveLength(1);
  });

  it('list itself still reads a folder it cannot list as none', async () => {
    const { store, files } = storeOver();
    await store.save(queue());
    files.failNext('names');
    expect(await store.list()).toEqual([]);
  });
});
