import { describe, expect, it } from 'vitest';
import type { MatchQueue, QueuedEvent } from '@/domain/scoring/queue';
import { createLogger } from '@/services/logger';
import { createRingRecord, parseRecordLine } from '@/services/sessionRecord';
import { createTapQueueStore } from '@/services/tapQueueStore';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createMemoryQueueFiles } from '../../test/memoryQueueFiles';

const FIXTURE = '6f0c5a52-3d1e-4a0b-8f55-0c2f6d7b9e10';
const OTHER = '0b9f3c1e-77d2-4c8a-91aa-52f1d0c4be67';
/** Made up. The link's token, which the store has no way to be given and must refuse to write. */
const TOKEN = FAKE_SCORING_SECRET;

const tap = (overrides: Partial<QueuedEvent> = {}): QueuedEvent => ({
  key: 'a2f4c3d1-7a60-4d5e-9b0c-1e2f3a4b5c6d',
  type: 'badminton.rally',
  payload: { wonBy: 'ent-home' },
  rulesVersion: 2,
  createdAt: '2026-11-02T10:00:00.000Z',
  attempts: 0,
  ...overrides,
});

const queue = (overrides: Partial<MatchQueue> = {}): MatchQueue => ({
  fixtureId: FIXTURE,
  label: 'A. Sharma v L. Chen',
  pending: [
    tap(),
    tap({
      key: 'b3a5d4e2-8b71-4e6f-8c1d-2f3a4b5c6d7e',
      type: 'core.void',
      payload: { event_id: 'ev-3' },
      attempts: 3,
    }),
  ],
  ownEventIds: ['ev-1', 'ev-2'],
  dead: null,
  ...overrides,
});

function storeOver(files = createMemoryQueueFiles()) {
  const record = createRingRecord();
  const store = createTapQueueStore({ files, logger: createLogger({ record, now: () => 0 }) });
  const entries = () => record.lines().map(parseRecordLine);
  const unreadable = () => entries().filter((entry) => entry.event === 'scoring.queue.unreadable');
  return { store, files, record, entries, unreadable };
}

const nameOf = (fixtureId: string) => `${fixtureId}.json`;
const text = (value: unknown) => JSON.stringify(value);

describe('save and load', () => {
  it('round-trips a queue: every tap whole, in order, the own ids, the label, the dead word', async () => {
    const { store } = storeOver();
    await store.save(queue());
    expect(await store.load(FIXTURE)).toEqual(queue());
  });

  it('round-trips a dead queue for each word', async () => {
    for (const dead of ['LINK_INVALID', 'LINK_REVOKED', 'LINK_EXPIRED', 'finalized'] as const) {
      const { store } = storeOver();
      await store.save(queue({ dead }));
      expect((await store.load(FIXTURE))?.dead).toBe(dead);
    }
  });

  it('round-trips an empty queue: nothing pending is still a match held', async () => {
    const { store } = storeOver();
    await store.save(queue({ pending: [], ownEventIds: [], label: '' }));
    expect(await store.load(FIXTURE)).toEqual(queue({ pending: [], ownEventIds: [], label: '' }));
  });

  it('round-trips any JSON a payload holds, null included', async () => {
    const { store } = storeOver();
    const pending = [
      tap({ key: 'k1', payload: null }),
      tap({ key: 'k2', payload: { nested: { list: [1, 'two', null, true] } } }),
      tap({ key: 'k3', payload: 'text' }),
    ];
    await store.save(queue({ pending }));
    expect((await store.load(FIXTURE))?.pending).toEqual(pending);
  });

  it('a second save replaces the first whole', async () => {
    const { store } = storeOver();
    await store.save(queue());
    await store.save(queue({ pending: [], ownEventIds: ['ev-1', 'ev-2', 'ev-3'] }));
    expect(await store.load(FIXTURE)).toEqual(
      queue({ pending: [], ownEventIds: ['ev-1', 'ev-2', 'ev-3'] }),
    );
  });

  it('a queue for a match nobody saved is null, the empty input', async () => {
    const { store } = storeOver();
    expect(await store.load(FIXTURE)).toBeNull();
  });

  it('keeps one queue per match: saving one never touches another', async () => {
    const { store } = storeOver();
    await store.save(queue());
    await store.save(queue({ fixtureId: OTHER, label: 'Match 7', pending: [] }));
    expect((await store.load(FIXTURE))?.label).toBe('A. Sharma v L. Chen');
    expect((await store.load(OTHER))?.label).toBe('Match 7');
  });

  it('leaves no temporary file behind after a save', async () => {
    const { store, files } = storeOver();
    await store.save(queue());
    await store.save(queue());
    expect([...files.files.keys()]).toEqual([nameOf(FIXTURE)]);
  });
});

describe('the app killed and started again', () => {
  // Review Focus 1: a tap queued and the app killed before its send is still queued on reopen.
  it('a second store over the same folder reads what the first saved', async () => {
    const files = createMemoryQueueFiles();
    await storeOver(files).store.save(queue());
    const reopened = storeOver(files).store;
    expect(await reopened.load(FIXTURE)).toEqual(queue());
    expect(await reopened.list()).toEqual([queue()]);
  });

  it('a save interrupted after the temp write leaves the old file whole', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await store.save(queue());
    files.failNext('move');
    await expect(store.save(queue({ pending: [], ownEventIds: ['changed'] }))).rejects.toThrow();
    expect(files.files.has(`${nameOf(FIXTURE)}.tmp`)).toBe(true);
    const reopened = storeOver(files).store;
    expect(await reopened.load(FIXTURE)).toEqual(queue());
    expect(await reopened.list()).toEqual([queue()]);
  });

  it('a save that fails to write the temp file leaves the old file whole, and says so by rejecting', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await store.save(queue());
    files.failNext('write');
    await expect(store.save(queue({ pending: [] }))).rejects.toThrow();
    expect(await store.load(FIXTURE)).toEqual(queue());
  });

  it('a later save after an interrupted one succeeds and replaces the stale temp file', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await store.save(queue());
    files.failNext('move');
    await expect(store.save(queue({ pending: [] }))).rejects.toThrow();
    await store.save(queue({ pending: [], ownEventIds: ['after'] }));
    expect(await store.load(FIXTURE)).toEqual(queue({ pending: [], ownEventIds: ['after'] }));
    expect([...files.files.keys()]).toEqual([nameOf(FIXTURE)]);
  });

  it('a temp file with nothing else is no queue: never read as one', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(`${nameOf(FIXTURE)}.tmp`, text({ v: 1, ...queue() }));
    const { store, unreadable } = storeOver(files);
    expect(await store.load(FIXTURE)).toBeNull();
    expect(await store.list()).toEqual([]);
    expect(unreadable()).toEqual([]);
  });
});

describe('list', () => {
  it('returns every match, in a stable order, and ignores files that are not queues', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await store.save(queue());
    await store.save(queue({ fixtureId: OTHER, label: 'Match 7' }));
    files.files.set('notes.txt', 'hello');
    files.files.set('.DS_Store', '');
    files.files.set(`${nameOf(FIXTURE)}.tmp`, 'half');
    const listed = await store.list();
    expect(listed.map((q) => q.fixtureId)).toEqual([OTHER, FIXTURE]);
  });

  it('is empty when nothing is saved', async () => {
    expect(await storeOver().store.list()).toEqual([]);
  });

  it('skips a garbled queue and still lists the others', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await store.save(queue());
    files.files.set(nameOf(OTHER), '{"v":1,');
    expect((await store.list()).map((q) => q.fixtureId)).toEqual([FIXTURE]);
  });

  it('is empty, never thrown, when the folder cannot be listed', async () => {
    const files = createMemoryQueueFiles();
    const { store, unreadable } = storeOver(files);
    await store.save(queue());
    files.failNext('names');
    expect(await store.list()).toEqual([]);
    expect(unreadable()).toHaveLength(1);
  });
});

describe('a file that cannot be read', () => {
  const GARBLED: readonly (readonly [string, unknown])[] = [
    ['not JSON', '{"v":1,"fixtureId":'],
    ['an empty file', ''],
    ['an array', text([])],
    ['null', 'null'],
    ['another version', text({ ...queue(), v: 2 })],
    ['no version', text(queue())],
    ['no pending list', text({ v: 1, ...queue(), pending: undefined })],
    ['pending that is not a list', text({ v: 1, ...queue(), pending: {} })],
    ['a tap with no key', text({ v: 1, ...queue(), pending: [{ ...tap(), key: undefined }] })],
    ['a tap with an empty key', text({ v: 1, ...queue(), pending: [tap({ key: '' })] })],
    ['a tap with no type', text({ v: 1, ...queue(), pending: [{ ...tap(), type: undefined }] })],
    [
      'a tap with no payload at all',
      text({ v: 1, ...queue(), pending: [{ ...tap(), payload: undefined }] }),
    ],
    [
      'a tap with a rules version of text',
      text({ v: 1, ...queue(), pending: [{ ...tap(), rulesVersion: '2' }] }),
    ],
    [
      'a tap with a fractional attempts',
      text({ v: 1, ...queue(), pending: [tap({ attempts: 1.5 })] }),
    ],
    [
      'a tap with a negative rules version',
      text({ v: 1, ...queue(), pending: [tap({ rulesVersion: -1 })] }),
    ],
    ['a tap with negative attempts', text({ v: 1, ...queue(), pending: [tap({ attempts: -1 })] })],
    [
      'a tap with no created time',
      text({ v: 1, ...queue(), pending: [{ ...tap(), createdAt: undefined }] }),
    ],
    ['own ids that are not text', text({ v: 1, ...queue(), ownEventIds: [1] })],
    ['an own id that is empty', text({ v: 1, ...queue(), ownEventIds: [''] })],
    ['a dead word nobody knows', text({ v: 1, ...queue(), dead: 'gone' })],
    ['a dead word of the wrong type', text({ v: 1, ...queue(), dead: 5 })],
    ['no label', text({ v: 1, ...queue(), label: undefined })],
    ['a fixture id that is not the file’s', text({ v: 1, ...queue(), fixtureId: OTHER })],
    ['no fixture id', text({ v: 1, ...queue(), fixtureId: undefined })],
  ];

  it.each(GARBLED)('%s reads as null, once reported, never thrown', async (_name, content) => {
    const files = createMemoryQueueFiles();
    files.files.set(nameOf(FIXTURE), content as string);
    const { store, unreadable } = storeOver(files);
    expect(await store.load(FIXTURE)).toBeNull();
    expect(await store.load(FIXTURE)).toBeNull();
    expect(await store.list()).toEqual([]);
    expect(unreadable()).toHaveLength(1);
  });

  it('is reported at warn, with a closed word and never the file’s text', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(nameOf(FIXTURE), `{"v":1,"label":"${TOKEN}"`);
    const { store, unreadable, record } = storeOver(files);
    await store.load(FIXTURE);
    expect(unreadable()[0]).toMatchObject({ level: 'warn', event: 'scoring.queue.unreadable' });
    expect(record.lines().join('\n')).not.toContain(TOKEN);
  });

  it('is reported once per file: a second garbled file is its own report', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(nameOf(FIXTURE), 'x');
    files.files.set(nameOf(OTHER), 'y');
    const { store, unreadable } = storeOver(files);
    await store.list();
    await store.list();
    expect(unreadable()).toHaveLength(2);
  });

  it('a save over it makes the match readable again', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(nameOf(FIXTURE), 'x');
    const { store } = storeOver(files);
    await store.load(FIXTURE);
    await store.save(queue());
    expect(await store.load(FIXTURE)).toEqual(queue());
  });

  it('a new garble after a save is reported anew, though nothing read the good file between', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(nameOf(FIXTURE), 'x');
    const { store, unreadable } = storeOver(files);
    await store.load(FIXTURE);
    await store.save(queue());
    files.files.set(nameOf(FIXTURE), 'garbled again');
    expect(await store.load(FIXTURE)).toBeNull();
    expect(unreadable()).toHaveLength(2);
  });

  it('a new garble after a remove is reported anew', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(nameOf(FIXTURE), 'x');
    const { store, unreadable } = storeOver(files);
    await store.load(FIXTURE);
    await store.remove(FIXTURE);
    files.files.set(nameOf(FIXTURE), 'garbled again');
    expect(await store.load(FIXTURE)).toBeNull();
    expect(unreadable()).toHaveLength(2);
  });

  it('a read the disk refuses is null, once reported, never thrown', async () => {
    const files = createMemoryQueueFiles();
    const { store, unreadable } = storeOver(files);
    await store.save(queue());
    files.failNext('read');
    expect(await store.load(FIXTURE)).toBeNull();
    expect(unreadable()).toHaveLength(1);
    expect(await store.load(FIXTURE)).toEqual(queue());
  });

  it('is left on disk, not deleted: a person may still recover its taps', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(nameOf(FIXTURE), '{"v":1,');
    const { store } = storeOver(files);
    await store.load(FIXTURE);
    await store.list();
    expect(files.files.get(nameOf(FIXTURE))).toBe('{"v":1,');
  });
});

describe('the link’s token is never written', () => {
  it('a whole life of saves, loads and removes writes no token', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await store.save(queue());
    await store.load(FIXTURE);
    await store.save(queue({ dead: 'LINK_REVOKED' }));
    await store.list();
    await store.remove(FIXTURE);
    expect(files.written.length).toBeGreaterThan(0);
    expect(files.written.join('\n')).not.toContain(TOKEN);
    expect(files.written.join('\n')).not.toContain('dl_');
  });

  it.each([
    ['the label', queue({ label: `Match ${TOKEN}` })],
    ['a tap’s payload', queue({ pending: [tap({ payload: { note: { deep: [`x ${TOKEN}`] } } })] })],
    ['a tap’s type', queue({ pending: [tap({ type: TOKEN })] })],
    ['an own event id', queue({ ownEventIds: [TOKEN] })],
  ])('a queue carrying it in %s is refused: nothing is written', async (_name, bad) => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await expect(store.save(bad)).rejects.toThrow(/link/i);
    expect(files.ops.filter((op) => op.startsWith('write') || op.startsWith('move'))).toEqual([]);
    expect(files.files.size).toBe(0);
  });

  it('a refusal leaves the old file whole', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await store.save(queue());
    await expect(store.save(queue({ label: TOKEN }))).rejects.toThrow();
    expect(await store.load(FIXTURE)).toEqual(queue());
  });
});

describe('a queue the store could not read back is not written', () => {
  it('a tap with no payload would read as garbled: refused, the old file whole', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await store.save(queue());
    await expect(store.save(queue({ pending: [tap({ payload: undefined })] }))).rejects.toThrow();
    expect(await store.load(FIXTURE)).toEqual(queue());
  });

  it('a payload JSON cannot hold (a BigInt) is refused, the old file whole', async () => {
    const { store } = storeOver();
    await store.save(queue());
    await expect(store.save(queue({ pending: [tap({ payload: 10n })] }))).rejects.toThrow();
    expect(await store.load(FIXTURE)).toEqual(queue());
  });

  it('a fractional attempts count would read as garbled: refused', async () => {
    const { store } = storeOver();
    await expect(store.save(queue({ pending: [tap({ attempts: 1.5 })] }))).rejects.toThrow();
    expect(await store.load(FIXTURE)).toBeNull();
  });
});

describe('remove', () => {
  it('deletes the match’s queue, and its stale temp file, and only its own', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await store.save(queue());
    await store.save(queue({ fixtureId: OTHER }));
    files.files.set(`${nameOf(FIXTURE)}.tmp`, 'half');
    await store.remove(FIXTURE);
    expect(await store.load(FIXTURE)).toBeNull();
    expect((await store.load(OTHER))?.fixtureId).toBe(OTHER);
    expect([...files.files.keys()]).toEqual([nameOf(OTHER)]);
  });

  it('is a no-op for a match with no queue', async () => {
    const { store } = storeOver();
    await expect(store.remove(FIXTURE)).resolves.toBeUndefined();
  });

  it('twice is the same as once', async () => {
    const { store } = storeOver();
    await store.save(queue());
    await store.remove(FIXTURE);
    await expect(store.remove(FIXTURE)).resolves.toBeUndefined();
    expect(await store.load(FIXTURE)).toBeNull();
  });

  it('rejects when the disk refuses, so a Dismiss that did not happen is not shown as done', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await store.save(queue());
    files.failNext('remove');
    await expect(store.remove(FIXTURE)).rejects.toThrow();
    expect(await store.load(FIXTURE)).toEqual(queue());
  });
});

describe('a fixture id is a file name', () => {
  const BAD = ['', '.', '..', '../x', 'a/b', 'a\\b', 'x.json', 'a b', 'a\0b', 'é', 'a'.repeat(101)];

  it.each(BAD)('%j is refused by save, with nothing written', async (fixtureId) => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await expect(store.save(queue({ fixtureId }))).rejects.toThrow();
    expect(files.ops).toEqual([]);
  });

  it.each(BAD)('%j is no queue for load, and remove leaves the disk alone', async (fixtureId) => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    expect(await store.load(fixtureId)).toBeNull();
    await store.remove(fixtureId);
    expect(files.ops).toEqual([]);
  });

  it('an id of 100 letters, digits, underscores and hyphens is a file name', async () => {
    const { store } = storeOver();
    const id = `${'aB3_-'.repeat(20)}`;
    expect(id).toHaveLength(100);
    await store.save(queue({ fixtureId: id }));
    expect((await store.load(id))?.fixtureId).toBe(id);
  });
});

describe('one thing at a time', () => {
  it('two saves made together are written one after the other, the later one standing', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    const first = store.save(queue({ ownEventIds: ['first'] }));
    const second = store.save(queue({ ownEventIds: ['second'] }));
    await Promise.all([first, second]);
    expect(files.ops).toEqual([
      `write ${nameOf(FIXTURE)}.tmp`,
      `move ${nameOf(FIXTURE)}.tmp ${nameOf(FIXTURE)}`,
      `write ${nameOf(FIXTURE)}.tmp`,
      `move ${nameOf(FIXTURE)}.tmp ${nameOf(FIXTURE)}`,
    ]);
    expect((await store.load(FIXTURE))?.ownEventIds).toEqual(['second']);
  });

  it('a load made behind a save sees the save', async () => {
    const { store } = storeOver();
    const saving = store.save(queue());
    const loaded = store.load(FIXTURE);
    await saving;
    expect(await loaded).toEqual(queue());
  });

  it('a failed save does not stop the ones behind it', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    files.failNext('write');
    const failed = store.save(queue({ ownEventIds: ['lost'] }));
    const next = store.save(queue({ ownEventIds: ['kept'] }));
    await expect(failed).rejects.toThrow();
    await next;
    expect((await store.load(FIXTURE))?.ownEventIds).toEqual(['kept']);
  });
});
