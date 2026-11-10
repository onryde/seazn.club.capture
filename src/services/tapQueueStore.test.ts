import { describe, expect, it } from 'vitest';
import { NO_PICKS } from '@/domain/scoring/pendingPicks';
import type { BootCache, MatchQueue, QueuedEvent } from '@/domain/scoring/queue';
import { bootstrapToWire, type LedgerEvent } from '@/domain/scoring/wire';
import { createLogger } from '@/services/logger';
import { createRingRecord, parseRecordLine } from '@/services/sessionRecord';
import { createTapQueueStore, queueSaveProblemOf, type QueueEntry } from '@/services/tapQueueStore';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { DOUBLES, SINGLES } from '../../test/badmintonLedger';
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

const event = (seq: number, overrides: Partial<LedgerEvent> = {}): LedgerEvent => ({
  id: `ev-${seq}`,
  seq,
  type: 'badminton.rally',
  payload: { wonBy: 'ent-home' },
  recordedAt: '2026-11-02T10:00:00.000Z',
  voids: null,
  deviceLinkId: null,
  ...overrides,
});
const EVENT_1 = event(1, { type: 'core.start', payload: {}, deviceLinkId: 'link-1' });
const LEDGER: readonly LedgerEvent[] = [EVENT_1, event(2), event(3, { voids: 'ev-2' })];

function storeOver(files = createMemoryQueueFiles()) {
  const record = createRingRecord();
  const store = createTapQueueStore({ files, logger: createLogger({ record, now: () => 0 }) });
  const entries = () => record.lines().map(parseRecordLine);
  const unreadable = () => entries().filter((entry) => entry.event === 'scoring.queue.unreadable');
  return { store, files, record, entries, unreadable };
}

const nameOf = (fixtureId: string) => `${fixtureId}.json`;
const tmpOf = (fixtureId: string) => `${fixtureId}.json.tmp`;
const badOf = (fixtureId: string) => `${fixtureId}.json.bad`;
const ledgerOf = (fixtureId: string) => `${fixtureId}.ledger.json`;
const text = (value: unknown) => JSON.stringify(value);
/** A file as the store writes it, for a test to place on the disk by hand. */
const asFile = (q: MatchQueue) => text({ v: 1, ...q });
const entryIds = (entries: readonly QueueEntry[]) =>
  entries.map((entry) => (entry.kind === 'queue' ? entry.queue.fixtureId : entry.fixtureId));
const queues = (list: readonly MatchQueue[]): QueueEntry[] =>
  list.map((found) => ({ kind: 'queue', queue: found }));

describe('save and load', () => {
  it('round-trips a queue: every tap whole, in order, the own ids, the label, the dead word', async () => {
    const { store } = storeOver();
    await store.save(queue());
    expect(await store.load(FIXTURE)).toEqual(queue());
  });

  it('round-trips an Undo that waits for its tap’s answer: the key of the tap it takes back, and no field when none', async () => {
    const { store } = storeOver();
    const waiting = tap({
      key: 'c4b6e5f3-9c82-4f70-9d2e-3a4b5c6d7e8f',
      type: 'core.void',
      payload: { event_id: '' },
      voidsKey: 'a2f4c3d1-7a60-4d5e-9b0c-1e2f3a4b5c6d',
    });
    await store.save(queue({ pending: [tap({ attempts: 1 }), waiting] }));
    const back = await store.load(FIXTURE);
    expect(back?.pending[1]).toEqual(waiting);
    expect(back?.pending[0]).not.toHaveProperty('voidsKey');
  });

  // Plan S2-2 Task 4 fix round 1: a table tennis tap that names `serving` keeps the score count it was made at, across a
  // kill, so its first send can still judge whether the score has moved. 0 is a count, not an absence.
  it('round-trips the score count a tap was made at, 0 included, and no field when none', async () => {
    const { store } = storeOver();
    const made = tap({ key: 'd5c7f6a4-0d93-4081-8e3f-4b5c6d7e8f90', base: 2 });
    const atStart = tap({ key: 'e6d8a7b5-1ea4-4192-9f40-5c6d7e8f9aa1', base: 0 });
    await store.save(queue({ pending: [tap(), made, atStart] }));
    const back = await store.load(FIXTURE);
    expect(back?.pending[1]).toEqual(made);
    expect(back?.pending[2]).toEqual(atStart);
    expect(back?.pending[2]).toHaveProperty('base', 0);
    expect(back?.pending[0]).not.toHaveProperty('base');
  });

  it('loads a queue written before taps carried a score count, every tap as it was', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(nameOf(FIXTURE), asFile(queue()));
    const { store, unreadable } = storeOver(files);
    const back = await store.load(FIXTURE);
    expect(back).toEqual(queue());
    expect(back?.pending.some((one) => 'base' in one)).toBe(false);
    expect(unreadable()).toHaveLength(0);
  });

  // A count that is not a whole number cannot be trusted, and the tap is still the scorer's: it is kept, and reads as a
  // tap with no count (the send then keeps only the rule that needs none).
  it.each([-1, 1.5, '2', null, {}])(
    'reads a score count of %j as absent and keeps the tap',
    async (garbled) => {
      const files = createMemoryQueueFiles();
      files.files.set(
        nameOf(FIXTURE),
        text({ v: 1, ...queue(), pending: [{ ...tap(), base: garbled }] }),
      );
      const { store, unreadable } = storeOver(files);
      const back = await store.load(FIXTURE);
      expect(back?.pending).toEqual([tap()]);
      expect(back?.pending[0]).not.toHaveProperty('base');
      expect(unreadable()).toHaveLength(0);
    },
  );

  // Owner ruling 43 (2026-11-02): the reconnect question stands across a kill, in the queue's own file.
  it('round-trips the reconnect question: the ids it is about, and no field when none stands', async () => {
    const { store } = storeOver();
    await store.save(queue({ askedAbout: ['ev-9', 'ev-10'] }));
    expect((await store.load(FIXTURE))?.askedAbout).toEqual(['ev-9', 'ev-10']);
    await store.save(queue({ askedAbout: undefined }));
    expect(await store.load(FIXTURE)).not.toHaveProperty('askedAbout');
    await store.save(queue({ askedAbout: [] }));
    expect(await store.load(FIXTURE)).not.toHaveProperty('askedAbout');
  });

  // Round 4, item 1b: the scorer's Send covers the queue as it stood, across a kill mid-drain.
  it('round-trips the answer to the question: the keys it covered, and no field when none stands', async () => {
    const { store } = storeOver();
    await store.save(queue({ answeredSend: ['k1', 'k2'] }));
    expect((await store.load(FIXTURE))?.answeredSend).toEqual(['k1', 'k2']);
    await store.save(queue({ answeredSend: undefined }));
    expect(await store.load(FIXTURE)).not.toHaveProperty('answeredSend');
    await store.save(queue({ answeredSend: [] }));
    expect(await store.load(FIXTURE)).not.toHaveProperty('answeredSend');
  });

  it('round-trips a dead queue for each word', async () => {
    const words = [
      'LINK_INVALID',
      'LINK_REVOKED',
      'LINK_EXPIRED',
      'finalized',
      'forbidden',
      'gone',
      'payment',
      'cancelled',
      'carriedForward',
    ] as const;
    for (const dead of words) {
      const { store } = storeOver();
      await store.save(queue({ dead }));
      expect((await store.load(FIXTURE))?.dead).toBe(dead);
    }
  });

  // Task 8d. The word a cold start reads is the file's own spelling, so it is written out here, not taken from the
  // store: a file saved with `carriedForward` reads it back, and a file an earlier build wrote for the same refusal
  // (it said `finalized`) still reads as it said, never as the new word.
  it.each([
    ['carriedForward', 'carriedForward'],
    ['finalized', 'finalized'],
  ] as const)('reads a file that says dead %s as %s', async (written, read) => {
    const files = createMemoryQueueFiles();
    files.files.set(nameOf(FIXTURE), text({ v: 1, ...queue(), dead: written }));
    const { store, unreadable } = storeOver(files);
    const back = await store.load(FIXTURE);
    expect(back).toEqual(queue({ dead: read }));
    expect(back?.pending).toHaveLength(2);
    expect(unreadable()).toHaveLength(0);
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
    expect(await reopened.list()).toEqual(queues([queue()]));
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
    expect(await reopened.list()).toEqual(queues([queue()]));
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

  // expo-file-system 57.0.7 on Android deletes the target and then renames (CopyMoveStrategy.kt), so a kill between
  // the two leaves the new queue only as `{id}.json.tmp`: the save's temp file is then the one copy there is.
  it('a kill between the delete and the rename leaves only the temp file: it is the queue, and is promoted', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await store.save(queue());
    files.failNext('moveAfterDelete');
    const newer = queue({ pending: [], ownEventIds: ['ev-1', 'ev-2', 'ev-3'] });
    await expect(store.save(newer)).rejects.toThrow();
    expect([...files.files.keys()]).toEqual([tmpOf(FIXTURE)]);
    const reopened = storeOver(files);
    expect(await reopened.store.load(FIXTURE)).toEqual(newer);
    expect([...files.files.keys()]).toEqual([nameOf(FIXTURE)]);
    expect(reopened.unreadable()).toEqual([]);
    expect(await reopened.store.load(FIXTURE)).toEqual(newer);
  });

  it('list promotes it too, and lists the match: a temp-only id is not lost from Home', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(tmpOf(FIXTURE), asFile(queue()));
    const { store } = storeOver(files);
    expect(await store.list()).toEqual(queues([queue()]));
    expect([...files.files.keys()]).toEqual([nameOf(FIXTURE)]);
  });

  it('a good file wins over a temp file beside it: the temp is a save that never finished', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(nameOf(FIXTURE), asFile(queue()));
    files.files.set(tmpOf(FIXTURE), asFile(queue({ ownEventIds: ['never-acknowledged'] })));
    const { store } = storeOver(files);
    expect(await store.load(FIXTURE)).toEqual(queue());
    expect(await store.list()).toEqual(queues([queue()]));
    expect(files.files.get(nameOf(FIXTURE))).toBe(asFile(queue()));
  });

  it('a torn temp file alone is no queue, said once, and the next save goes on as normal', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(tmpOf(FIXTURE), '{"v":1,"fixtureId":');
    const { store, unreadable } = storeOver(files);
    expect(await store.load(FIXTURE)).toBeNull();
    expect(await store.load(FIXTURE)).toBeNull();
    expect(await store.list()).toEqual([]);
    expect(unreadable()).toHaveLength(1);
    await store.save(queue());
    expect(await store.load(FIXTURE)).toEqual(queue());
  });

  it('a garbled file with a good temp file: the temp is promoted and the garbled one is kept aside', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(nameOf(FIXTURE), '{"v":1,');
    files.files.set(tmpOf(FIXTURE), asFile(queue()));
    const { store } = storeOver(files);
    expect(await store.load(FIXTURE)).toEqual(queue());
    expect(files.files.get(nameOf(FIXTURE))).toBe(asFile(queue()));
    expect(files.files.get(badOf(FIXTURE))).toBe('{"v":1,');
    expect(files.files.has(tmpOf(FIXTURE))).toBe(false);
    expect(await store.list()).toEqual(queues([queue()]));
  });

  it('a promotion the disk refuses still answers the queue, says so, and is done at the next read', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(tmpOf(FIXTURE), asFile(queue()));
    const { store, unreadable } = storeOver(files);
    files.failNext('move');
    expect(await store.load(FIXTURE)).toEqual(queue());
    expect(unreadable()).toHaveLength(1);
    expect(files.files.has(nameOf(FIXTURE))).toBe(false);
    expect(await store.load(FIXTURE)).toEqual(queue());
    expect([...files.files.keys()]).toEqual([nameOf(FIXTURE)]);
  });

  it('a kill during the promotion itself changes nothing: the next read promotes again', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(tmpOf(FIXTURE), asFile(queue()));
    const { store } = storeOver(files);
    files.failNext('moveAfterDelete');
    expect(await store.load(FIXTURE)).toEqual(queue());
    expect([...files.files.keys()]).toEqual([tmpOf(FIXTURE)]);
    expect(await storeOver(files).store.load(FIXTURE)).toEqual(queue());
    expect([...files.files.keys()]).toEqual([nameOf(FIXTURE)]);
  });

  it('a garbled file that cannot be set aside still gives the good temp file’s queue, and the next read finishes the job', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(nameOf(FIXTURE), '{"v":1,');
    files.files.set(tmpOf(FIXTURE), asFile(queue()));
    const { store, unreadable } = storeOver(files);
    files.failNext('move');
    expect(await store.load(FIXTURE)).toEqual(queue());
    expect(unreadable()).toHaveLength(1);
    expect(files.files.get(nameOf(FIXTURE))).toBe('{"v":1,');
    expect(await store.load(FIXTURE)).toEqual(queue());
    expect(files.files.get(badOf(FIXTURE))).toBe('{"v":1,');
    expect(files.files.get(nameOf(FIXTURE))).toBe(asFile(queue()));
  });

  it('a temp file the disk refuses to read is said once, and is no queue', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(tmpOf(FIXTURE), asFile(queue()));
    const read = files.read;
    files.read = async (name) =>
      name === tmpOf(FIXTURE) ? Promise.reject(new Error('refused')) : read(name);
    const { store, unreadable } = storeOver(files);
    expect(await store.load(FIXTURE)).toBeNull();
    expect(await store.load(FIXTURE)).toBeNull();
    expect(unreadable()).toHaveLength(1);
  });

  it('a good read after a promotion clears what was said: the next garble is reported anew', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(nameOf(FIXTURE), 'x');
    const { store, unreadable } = storeOver(files);
    await store.load(FIXTURE);
    files.failNext('moveAfterDelete');
    await expect(store.save(queue())).rejects.toThrow();
    expect(await store.load(FIXTURE)).toEqual(queue());
    files.files.set(nameOf(FIXTURE), 'y');
    await store.load(FIXTURE);
    expect(unreadable()).toHaveLength(2);
  });

  it('saves go on after a promotion: the next save and a reopen read the newest', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(tmpOf(FIXTURE), asFile(queue()));
    const { store } = storeOver(files);
    await store.load(FIXTURE);
    await store.save(queue({ ownEventIds: ['after'] }));
    expect((await storeOver(files).store.load(FIXTURE))?.ownEventIds).toEqual(['after']);
    expect([...files.files.keys()]).toEqual([nameOf(FIXTURE)]);
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
    files.files.set(ledgerOf(FIXTURE), 'cache');
    files.files.set(`${ledgerOf(FIXTURE)}.tmp`, 'cache');
    const listed = await store.list();
    expect(entryIds(listed)).toEqual([OTHER, FIXTURE]);
  });

  it('is empty when nothing is saved', async () => {
    expect(await storeOver().store.list()).toEqual([]);
  });

  it('names a garbled queue as unreadable and still lists the others: never silently skipped', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await store.save(queue());
    files.files.set(nameOf(OTHER), '{"v":1,');
    expect(await store.list()).toEqual([
      { kind: 'unreadable', fixtureId: OTHER },
      { kind: 'queue', queue: queue() },
    ]);
  });

  it('keeps naming it on every list, and on a reopened app: the aside file stands until Dismiss', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(nameOf(OTHER), '{"v":1,');
    const { store, unreadable } = storeOver(files);
    const first = await store.list();
    expect(first).toEqual([{ kind: 'unreadable', fixtureId: OTHER }]);
    expect(await store.list()).toEqual(first);
    expect(await storeOver(files).store.list()).toEqual(first);
    expect(unreadable()).toHaveLength(1);
  });

  it('lists an aside file whose queue is not even looked at again: list alone sets it aside', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(badOf(OTHER), 'earlier');
    const { store } = storeOver(files);
    expect(await store.list()).toEqual([{ kind: 'unreadable', fixtureId: OTHER }]);
  });

  it('an aside file the disk will not read is still named: unreadable is the safe word', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(badOf(OTHER), 'earlier');
    const read = files.read;
    files.read = async (name) =>
      name === badOf(OTHER) ? Promise.reject(new Error('refused')) : read(name);
    expect(await storeOver(files).store.list()).toEqual([{ kind: 'unreadable', fixtureId: OTHER }]);
  });

  // list never skips a match it cannot read: a match that is only absent from Home is a match lost.
  it('names a match whose main file the disk refuses to read: no .bad exists, and it is still listed', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await store.save(queue());
    const read = files.read;
    files.read = async (name) =>
      name === nameOf(FIXTURE) ? Promise.reject(new Error('refused')) : read(name);
    expect(await storeOver(files).store.list()).toEqual([
      { kind: 'unreadable', fixtureId: FIXTURE },
    ]);
  });

  it('names a match whose only copy is a temp file the disk refuses to read', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(tmpOf(FIXTURE), asFile(queue()));
    const read = files.read;
    files.read = async (name) =>
      name === tmpOf(FIXTURE) ? Promise.reject(new Error('refused')) : read(name);
    const { store } = storeOver(files);
    expect(await store.list()).toEqual([{ kind: 'unreadable', fixtureId: FIXTURE }]);
    files.read = read;
    expect(await store.list()).toEqual(queues([queue()]));
  });

  it('names a garbled match that could not be set aside, and no older .bad exists', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(nameOf(FIXTURE), '{"v":1,');
    const { store } = storeOver(files);
    files.failNext('move');
    expect(await store.list()).toEqual([{ kind: 'unreadable', fixtureId: FIXTURE }]);
    expect(files.files.has(badOf(FIXTURE))).toBe(false);
  });

  it('a refused read does not name a match that reads well the next time', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await store.save(queue());
    const read = files.read;
    let refuse = true;
    files.read = async (name) =>
      refuse && name === nameOf(FIXTURE) ? Promise.reject(new Error('refused')) : read(name);
    expect(await store.list()).toEqual([{ kind: 'unreadable', fixtureId: FIXTURE }]);
    refuse = false;
    expect(await store.list()).toEqual(queues([queue()]));
  });

  it('a torn temp file alone is no match: it was never a queue', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(tmpOf(FIXTURE), '{"v":1,');
    expect(await storeOver(files).store.list()).toEqual([]);
  });

  it('a queue saved over an unreadable one is a queue again, and Dismiss clears the aside file too', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(nameOf(FIXTURE), 'x');
    const { store } = storeOver(files);
    expect(await store.list()).toEqual([{ kind: 'unreadable', fixtureId: FIXTURE }]);
    await store.save(queue());
    expect(await store.list()).toEqual(queues([queue()]));
    await store.remove(FIXTURE);
    expect(await store.list()).toEqual([]);
    expect(files.files.size).toBe(0);
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
      'a tap waiting for a tap whose key is not text',
      text({ v: 1, ...queue(), pending: [{ ...tap(), voidsKey: 5 }] }),
    ],
    [
      'a tap waiting for a tap whose key is empty',
      text({ v: 1, ...queue(), pending: [tap({ voidsKey: '' })] }),
    ],
    [
      'a tap with no created time',
      text({ v: 1, ...queue(), pending: [{ ...tap(), createdAt: undefined }] }),
    ],
    ['own ids that are not text', text({ v: 1, ...queue(), ownEventIds: [1] })],
    ['a question about ids that are not text', text({ v: 1, ...queue(), askedAbout: [1] })],
    ['a question that is not a list', text({ v: 1, ...queue(), askedAbout: 'ev-9' })],
    ['an answer covering keys that are not text', text({ v: 1, ...queue(), answeredSend: [1] })],
    ['an answer that is not a list', text({ v: 1, ...queue(), answeredSend: 'k1' })],
    ['an own id that is empty', text({ v: 1, ...queue(), ownEventIds: [''] })],
    ['a dead word nobody knows', text({ v: 1, ...queue(), dead: 'vanished' })],
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
    expect(await store.list()).toEqual([{ kind: 'unreadable', fixtureId: FIXTURE }]);
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

  // The garbled file is moved aside before anything can write over it: a save for the match goes to a fresh file.
  it('is moved aside to .bad, whole and not deleted: a person may still recover its taps', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(nameOf(FIXTURE), '{"v":1,');
    const { store } = storeOver(files);
    await store.load(FIXTURE);
    await store.list();
    expect(files.files.get(badOf(FIXTURE))).toBe('{"v":1,');
    expect(files.files.has(nameOf(FIXTURE))).toBe(false);
  });

  it('a save after it cannot overwrite the garbled text: it was set aside first', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(nameOf(FIXTURE), '{"v":1,');
    const { store } = storeOver(files);
    await store.load(FIXTURE);
    await store.save(queue());
    expect(files.files.get(badOf(FIXTURE))).toBe('{"v":1,');
    expect(await store.load(FIXTURE)).toEqual(queue());
  });

  it('a newer garble replaces the older aside file, reported anew', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(nameOf(FIXTURE), 'first');
    const { store, unreadable } = storeOver(files);
    await store.load(FIXTURE);
    await store.save(queue());
    files.files.set(nameOf(FIXTURE), 'second');
    await store.load(FIXTURE);
    expect(files.files.get(badOf(FIXTURE))).toBe('second');
    expect(unreadable()).toHaveLength(2);
  });

  it('when it cannot be set aside it is reported, left where it is, and the match is still unreadable', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(nameOf(FIXTURE), '{"v":1,');
    const { store, unreadable } = storeOver(files);
    files.failNext('move');
    expect(await store.load(FIXTURE)).toBeNull();
    expect(unreadable()).toHaveLength(1);
    expect(files.files.get(nameOf(FIXTURE))).toBe('{"v":1,');
    expect(await store.load(FIXTURE)).toBeNull();
    expect(files.files.get(badOf(FIXTURE))).toBe('{"v":1,');
  });

  it('never writes into a file name from the garbled text: only the id the file name gives', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(nameOf(FIXTURE), text({ v: 1, ...queue(), fixtureId: OTHER }));
    const { store } = storeOver(files);
    expect(await store.load(FIXTURE)).toBeNull();
    expect([...files.files.keys()]).toEqual([badOf(FIXTURE)]);
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
  it('deletes the match’s queue, its temp, aside and ledger files, and only its own', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await store.save(queue());
    await store.save(queue({ fixtureId: OTHER }));
    await store.saveLedger(FIXTURE, [EVENT_1]);
    files.files.set(`${nameOf(FIXTURE)}.tmp`, 'half');
    files.files.set(badOf(FIXTURE), 'earlier');
    files.files.set(`${ledgerOf(FIXTURE)}.tmp`, 'half');
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

describe('the ledger beside the queue', () => {
  const ledgerUnreadable = (entries: () => ReturnType<typeof parseRecordLine>[]) =>
    entries().filter((entry) => entry.event === 'scoring.ledger.unreadable');

  it('round-trips the events whole, in order, voids and device link included', async () => {
    const { store } = storeOver();
    await store.saveLedger(FIXTURE, LEDGER);
    expect(await store.loadLedger(FIXTURE)).toEqual(LEDGER);
  });

  it('round-trips a long ledger and an empty one', async () => {
    const { store } = storeOver();
    const long = Array.from({ length: 400 }, (_, i) => event(i + 1));
    await store.saveLedger(FIXTURE, long);
    expect(await store.loadLedger(FIXTURE)).toEqual(long);
    await store.saveLedger(OTHER, []);
    expect(await store.loadLedger(OTHER)).toEqual([]);
  });

  it('is null for a match with none, the empty input', async () => {
    expect(await storeOver().store.loadLedger(FIXTURE)).toBeNull();
  });

  it('a second save replaces the first whole, and leaves no temp file', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await store.saveLedger(FIXTURE, LEDGER);
    await store.saveLedger(FIXTURE, LEDGER.slice(0, 1));
    expect(await store.loadLedger(FIXTURE)).toEqual(LEDGER.slice(0, 1));
    expect([...files.files.keys()]).toEqual([ledgerOf(FIXTURE)]);
  });

  it('is kept in a file of its own: the queue is untouched by it, and it is no queue in the list', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await store.save(queue());
    await store.saveLedger(FIXTURE, LEDGER);
    await store.saveLedger(OTHER, LEDGER);
    expect(await store.load(FIXTURE)).toEqual(queue());
    expect(entryIds(await store.list())).toEqual([FIXTURE]);
    expect(await store.loadLedger(OTHER)).toEqual(LEDGER);
  });

  it('survives the app being killed: a second store over the same folder reads it', async () => {
    const files = createMemoryQueueFiles();
    await storeOver(files).store.saveLedger(FIXTURE, LEDGER);
    expect(await storeOver(files).store.loadLedger(FIXTURE)).toEqual(LEDGER);
  });

  it('a save cut before its rename leaves the old ledger whole', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await store.saveLedger(FIXTURE, LEDGER.slice(0, 2));
    files.failNext('move');
    await expect(store.saveLedger(FIXTURE, LEDGER)).rejects.toThrow();
    expect(await storeOver(files).store.loadLedger(FIXTURE)).toEqual(LEDGER.slice(0, 2));
  });

  it('a kill between the delete and the rename leaves only the temp file: it is promoted', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await store.saveLedger(FIXTURE, LEDGER.slice(0, 2));
    files.failNext('moveAfterDelete');
    await expect(store.saveLedger(FIXTURE, LEDGER)).rejects.toThrow();
    expect([...files.files.keys()]).toEqual([`${ledgerOf(FIXTURE)}.tmp`]);
    expect(await storeOver(files).store.loadLedger(FIXTURE)).toEqual(LEDGER);
    expect([...files.files.keys()]).toEqual([ledgerOf(FIXTURE)]);
  });

  it.each([
    ['not JSON', '{"v":1,'],
    ['another version', text({ v: 2, fixtureId: FIXTURE, events: [] })],
    ['a fixture id that is not the file’s', text({ v: 1, fixtureId: OTHER, events: [] })],
    ['no events list', text({ v: 1, fixtureId: FIXTURE })],
    [
      'an event with no payload',
      text({ v: 1, fixtureId: FIXTURE, events: [{ ...EVENT_1, payload: undefined }] }),
    ],
    ['an event with no id', text({ v: 1, fixtureId: FIXTURE, events: [{ ...EVENT_1, id: '' }] })],
    ['a first seq of 2: a hole', text({ v: 1, fixtureId: FIXTURE, events: [event(2)] })],
    ['a hole in the middle', text({ v: 1, fixtureId: FIXTURE, events: [event(1), event(3)] })],
    ['a repeat', text({ v: 1, fixtureId: FIXTURE, events: [event(1), event(1)] })],
    ['an empty voids word', text({ v: 1, fixtureId: FIXTURE, events: [event(1, { voids: '' })] })],
  ])('%s is no ledger: null, said once, left on disk', async (_name, content) => {
    const files = createMemoryQueueFiles();
    files.files.set(ledgerOf(FIXTURE), content);
    const { store, entries } = storeOver(files);
    expect(await store.loadLedger(FIXTURE)).toBeNull();
    expect(await store.loadLedger(FIXTURE)).toBeNull();
    expect(ledgerUnreadable(entries)).toHaveLength(1);
    expect(files.files.get(ledgerOf(FIXTURE))).toBe(content);
  });

  it('a save over a garbled ledger is read again, and a new garble is reported anew', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(ledgerOf(FIXTURE), 'x');
    const { store, entries } = storeOver(files);
    await store.loadLedger(FIXTURE);
    await store.saveLedger(FIXTURE, LEDGER);
    expect(await store.loadLedger(FIXTURE)).toEqual(LEDGER);
    files.files.set(ledgerOf(FIXTURE), 'y');
    await store.loadLedger(FIXTURE);
    expect(ledgerUnreadable(entries)).toHaveLength(2);
  });

  it('a new garble after a save is reported anew, though nothing read the good ledger between', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(ledgerOf(FIXTURE), 'x');
    const { store, entries } = storeOver(files);
    await store.loadLedger(FIXTURE);
    await store.saveLedger(FIXTURE, LEDGER);
    files.files.set(ledgerOf(FIXTURE), 'y');
    expect(await store.loadLedger(FIXTURE)).toBeNull();
    expect(ledgerUnreadable(entries)).toHaveLength(2);
  });

  it('a garbled ledger with a good temp file: the temp is promoted', async () => {
    const files = createMemoryQueueFiles();
    files.files.set(ledgerOf(FIXTURE), 'x');
    files.files.set(`${ledgerOf(FIXTURE)}.tmp`, text({ v: 1, fixtureId: FIXTURE, events: LEDGER }));
    const { store } = storeOver(files);
    expect(await store.loadLedger(FIXTURE)).toEqual(LEDGER);
  });

  it('a ledger with a hole is refused on save, the old one whole: the cache never holds what it could not read', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await store.saveLedger(FIXTURE, LEDGER);
    await expect(store.saveLedger(FIXTURE, [event(1), event(3)])).rejects.toThrow();
    await expect(store.saveLedger(FIXTURE, [event(2)])).rejects.toThrow();
    expect(await store.loadLedger(FIXTURE)).toEqual(LEDGER);
  });

  it('a ledger naming the link’s secret anywhere is refused: nothing is written', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await expect(
      store.saveLedger(FIXTURE, [event(1, { payload: { note: [`x ${TOKEN}`] } })]),
    ).rejects.toThrow(/link/i);
    expect(files.files.size).toBe(0);
    expect(files.written.join('\n')).not.toContain(TOKEN);
  });

  it('removeLedger deletes the file and its temp, and only its match’s; twice is once', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await store.save(queue());
    await store.saveLedger(FIXTURE, LEDGER);
    await store.saveLedger(OTHER, LEDGER);
    files.files.set(`${ledgerOf(FIXTURE)}.tmp`, text({ v: 1, fixtureId: FIXTURE, events: LEDGER }));
    await store.removeLedger(FIXTURE);
    await expect(store.removeLedger(FIXTURE)).resolves.toBeUndefined();
    expect(await store.loadLedger(FIXTURE)).toBeNull();
    expect(await store.loadLedger(OTHER)).toEqual(LEDGER);
    expect(await store.load(FIXTURE)).toEqual(queue());
  });

  it('removing the queue removes the ledger with it', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await store.save(queue());
    await store.saveLedger(FIXTURE, LEDGER);
    await store.remove(FIXTURE);
    expect(await store.loadLedger(FIXTURE)).toBeNull();
    expect(files.files.size).toBe(0);
  });

  it('a fixture id that is no file name: no ledger, nothing read or written, no throw but a save', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    expect(await store.loadLedger('../x')).toBeNull();
    await expect(store.removeLedger('../x')).resolves.toBeUndefined();
    await expect(store.saveLedger('../x', LEDGER)).rejects.toThrow();
    expect(files.ops).toEqual([]);
  });

  it('a load made behind a save sees the save, and a refused save rejects without stopping the next', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    files.failNext('write');
    const failed = store.saveLedger(FIXTURE, LEDGER.slice(0, 1));
    const next = store.saveLedger(FIXTURE, LEDGER);
    const loaded = store.loadLedger(FIXTURE);
    await expect(failed).rejects.toThrow();
    await next;
    expect(await loaded).toEqual(LEDGER);
  });

  it('a read the disk refuses is null, once reported, never thrown', async () => {
    const files = createMemoryQueueFiles();
    const { store, entries } = storeOver(files);
    await store.saveLedger(FIXTURE, LEDGER);
    files.failNext('read');
    expect(await store.loadLedger(FIXTURE)).toBeNull();
    expect(ledgerUnreadable(entries)).toHaveLength(1);
    expect(await store.loadLedger(FIXTURE)).toEqual(LEDGER);
  });
});

describe('the bootstrap cache beside the queue (plan S2-1 Task 9)', () => {
  const bootOf = (fixtureId: string) => `${fixtureId}.boot.json`;
  const cacheOf = (fixtureId: string, toss: BootCache['toss'] = 'second'): BootCache => ({
    bootstrap: { ...SINGLES, fixtureId },
    toss,
    picks: NO_PICKS,
  });
  const CACHE = cacheOf(FIXTURE);
  const bootUnreadable = (entries: () => ReturnType<typeof parseRecordLine>[]) =>
    entries().filter((entry) => entry.event === 'scoring.boot.unreadable');

  it('round-trips a bootstrap and the Start screen’s pick, a pick of none included', async () => {
    const { store } = storeOver();
    await store.saveBoot(FIXTURE, CACHE);
    expect(await store.loadBoot(FIXTURE)).toEqual(CACHE);
    const doubles = { bootstrap: { ...DOUBLES, fixtureId: OTHER }, toss: null, picks: NO_PICKS };
    await store.saveBoot(OTHER, doubles);
    expect(await store.loadBoot(OTHER)).toEqual(doubles);
  });

  it('is null for a match with none, the empty input', async () => {
    expect(await storeOver().store.loadBoot(FIXTURE)).toBeNull();
  });

  // Pending picks (S2-4 plan Task 3, Review Focus 3): a kill between an over's end and its first ball keeps the next
  // bowler, the batting order and the openers.
  it('picks round-trip the boot file', async () => {
    const { store } = storeOver();
    const picked: BootCache = {
      ...CACHE,
      picks: { 'order.first': ['p-3', 'p-1', 'p-2'], 'bowler.i1.2': ['p-9'] },
    };
    await store.saveBoot(FIXTURE, picked);
    expect(await store.loadBoot(FIXTURE)).toStrictEqual(picked);
  });

  // A boot file written before picks existed has no `picks` key, and the file's version is unchanged.
  it('a boot file without picks reads as none', async () => {
    const files = createMemoryQueueFiles();
    const { store, entries } = storeOver(files);
    files.files.set(
      bootOf(FIXTURE),
      wired({ toss: 'second', bootstrap: bootstrapToWire(CACHE.bootstrap) }),
    );
    expect(await store.loadBoot(FIXTURE)).toStrictEqual({
      bootstrap: CACHE.bootstrap,
      toss: 'second',
      picks: {},
    });
    expect(bootUnreadable(entries)).toHaveLength(0);
  });

  it('a garbled picks key makes the boot file unreadable', async () => {
    const files = createMemoryQueueFiles();
    const { store, entries } = storeOver(files);
    const content = wired({
      bootstrap: bootstrapToWire(CACHE.bootstrap),
      picks: { '1x': ['p-1'] },
    });
    files.files.set(bootOf(FIXTURE), content);
    expect(await store.loadBoot(FIXTURE)).toBeNull();
    expect(bootUnreadable(entries)).toHaveLength(1);
    expect(files.files.get(bootOf(FIXTURE))).toBe(content);
  });

  it('refuses to write picks it could not read back: nothing is written', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await expect(store.saveBoot(FIXTURE, { ...CACHE, picks: { '1x': ['p-1'] } })).rejects.toThrow();
    expect(files.files.size).toBe(0);
  });

  it('is a file of its own: no queue in the list, the queue and the ledger untouched', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await store.saveBoot(FIXTURE, CACHE);
    expect(entryIds(await store.list())).toEqual([]);
    await store.save(queue());
    await store.saveLedger(FIXTURE, LEDGER);
    expect(await store.load(FIXTURE)).toEqual(queue());
    expect(await store.loadLedger(FIXTURE)).toEqual(LEDGER);
    expect(await store.loadBoot(FIXTURE)).toEqual(CACHE);
  });

  it('a second save replaces the first whole and leaves no temp file', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await store.saveBoot(FIXTURE, CACHE);
    await store.saveBoot(FIXTURE, cacheOf(FIXTURE, 'first'));
    expect(await store.loadBoot(FIXTURE)).toEqual(cacheOf(FIXTURE, 'first'));
    expect([...files.files.keys()]).toEqual([bootOf(FIXTURE)]);
  });

  it('survives the app being killed, and a save cut inside its move is promoted from the temp file', async () => {
    const files = createMemoryQueueFiles();
    await storeOver(files).store.saveBoot(FIXTURE, CACHE);
    expect(await storeOver(files).store.loadBoot(FIXTURE)).toEqual(CACHE);
    files.failNext('moveAfterDelete');
    await expect(
      storeOver(files).store.saveBoot(FIXTURE, cacheOf(FIXTURE, 'first')),
    ).rejects.toThrow();
    expect([...files.files.keys()]).toEqual([`${bootOf(FIXTURE)}.tmp`]);
    expect(await storeOver(files).store.loadBoot(FIXTURE)).toEqual(cacheOf(FIXTURE, 'first'));
  });

  const wired = (over: Record<string, unknown>) =>
    JSON.stringify({ v: 1, fixtureId: FIXTURE, toss: null, ...over });
  it.each([
    ['text that is not JSON', 'not json'],
    ['a file of another version', wired({ v: 2 })],
    ['a file of another match', wired({ fixtureId: OTHER })],
    ['a pick that is no side', wired({ toss: 'both', bootstrap: {} })],
    ['no bootstrap', wired({})],
    ['a bootstrap the endpoint’s parser refuses', wired({ bootstrap: { ok: true, data: {} } })],
  ])('%s is no cache: null, said once, left on disk', async (_name, content) => {
    const files = createMemoryQueueFiles();
    const { store, entries } = storeOver(files);
    files.files.set(bootOf(FIXTURE), content);
    expect(await store.loadBoot(FIXTURE)).toBeNull();
    expect(await store.loadBoot(FIXTURE)).toBeNull();
    expect(bootUnreadable(entries)).toHaveLength(1);
    expect(files.files.get(bootOf(FIXTURE))).toBe(content);
  });

  it('refuses to write a bootstrap that names the link’s secret anywhere: nothing is written', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    const leaking = { ...CACHE, bootstrap: { ...CACHE.bootstrap, cfg: { note: TOKEN } } };
    await expect(store.saveBoot(FIXTURE, leaking)).rejects.toThrow();
    expect(files.written.join('')).not.toContain(TOKEN);
    expect(files.files.size).toBe(0);
  });

  it('refuses a bootstrap of another match, and an id unfit for a file name', async () => {
    const { store, files } = storeOver();
    await expect(store.saveBoot(OTHER, CACHE)).rejects.toThrow();
    await expect(store.saveBoot('../x', cacheOf('../x'))).rejects.toThrow();
    expect(await store.loadBoot('../x')).toBeNull();
    await expect(store.removeBoot('../x')).resolves.toBeUndefined();
    expect(files.ops).toEqual([]);
  });

  it('removeBoot deletes it and its temp file, and only its own', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await store.saveBoot(FIXTURE, CACHE);
    await store.saveBoot(OTHER, cacheOf(OTHER));
    files.files.set(`${bootOf(FIXTURE)}.tmp`, 'half');
    await store.removeBoot(FIXTURE);
    expect([...files.files.keys()]).toEqual([bootOf(OTHER)]);
  });

  it('remove (Dismiss) deletes the boot cache with the queue and the ledger', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await store.save(queue());
    await store.saveLedger(FIXTURE, LEDGER);
    await store.saveBoot(FIXTURE, CACHE);
    files.files.set(`${bootOf(FIXTURE)}.tmp`, 'half');
    await store.remove(FIXTURE);
    expect([...files.files.keys()]).toEqual([]);
  });

  it('a read the disk refuses is null, once reported, never thrown', async () => {
    const files = createMemoryQueueFiles();
    const { store, entries } = storeOver(files);
    await store.saveBoot(FIXTURE, CACHE);
    files.failNext('read');
    expect(await store.loadBoot(FIXTURE)).toBeNull();
    expect(bootUnreadable(entries)).toHaveLength(1);
    expect(await store.loadBoot(FIXTURE)).toEqual(CACHE);
  });
});

describe('leaving a match keeps this phone’s own tap ids for a day (owner ruling 46, 2026-11-03)', () => {
  const keptOf = (fixtureId: string) => `${fixtureId}.own.json`;
  const HOUR = 3_600_000;
  const LEFT = 1_700_000_000_000;
  /** A match as a pad leaves it: the queue file with nothing pending, its ledger and its boot cache. */
  async function played(store: ReturnType<typeof storeOver>['store'], fixtureId = FIXTURE) {
    await store.save(queue({ fixtureId, pending: [], ownEventIds: ['ev-1', 'ev-2'] }));
    await store.saveLedger(fixtureId, LEDGER);
    await store.saveBoot(fixtureId, {
      bootstrap: { ...SINGLES, fixtureId },
      toss: null,
      picks: NO_PICKS,
    });
  }
  const placed = (over: Record<string, unknown>) =>
    text({ v: 1, fixtureId: FIXTURE, ownEventIds: ['ev-1'], leftAt: LEFT, ...over });
  const keptUnreadable = (entries: () => ReturnType<typeof parseRecordLine>[]) =>
    entries().filter((entry) => entry.event === 'scoring.kept.unreadable');

  it('deletes the queue, ledger and boot cache as a remove does, and keeps the ids in a file of their own', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await played(store);
    await store.leave(FIXTURE, LEFT);
    expect(await store.load(FIXTURE)).toBeNull();
    expect(await store.loadLedger(FIXTURE)).toBeNull();
    expect(await store.loadBoot(FIXTURE)).toBeNull();
    expect([...files.files.keys()]).toEqual([keptOf(FIXTURE)]);
    expect(await store.loadKept(FIXTURE, LEFT + HOUR)).toEqual(['ev-1', 'ev-2']);
  });

  it('is no queue: the list does not name it, so no leftover card and nothing unsent can come of it', async () => {
    const { store } = storeOver();
    await played(store);
    await store.leave(FIXTURE, LEFT);
    expect(await store.list()).toEqual([]);
    expect(await store.load(FIXTURE)).toBeNull();
  });

  it('reads back after the app is killed and started again', async () => {
    const files = createMemoryQueueFiles();
    await played(storeOver(files).store);
    await storeOver(files).store.leave(FIXTURE, LEFT);
    expect(await storeOver(files).store.loadKept(FIXTURE, LEFT + 2 * HOUR)).toEqual([
      'ev-1',
      'ev-2',
    ]);
  });

  it('keeps them for 24 h to the millisecond, and no longer', async () => {
    const { store } = storeOver();
    await played(store);
    await store.leave(FIXTURE, LEFT);
    expect(await store.loadKept(FIXTURE, LEFT + 24 * HOUR)).toEqual(['ev-1', 'ev-2']);
    expect(await store.loadKept(FIXTURE, LEFT + 24 * HOUR + 1)).toBeNull();
  });

  // Review of 956ce30: a phone clock set back after leaving still reads the ids, and one set back by more than a day
  // does not, so a stamp far from now is never kept for ever.
  it('keeps them when the clock is set back, within a day either way', async () => {
    const { store } = storeOver();
    await played(store);
    await store.leave(FIXTURE, LEFT);
    expect(await store.loadKept(FIXTURE, LEFT - HOUR)).toEqual(['ev-1', 'ev-2']);
    expect(await store.loadKept(FIXTURE, LEFT - 24 * HOUR - 1)).toBeNull();
  });

  it('has nothing to keep for a match with no own taps: no file is written, and an older one goes', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await store.save(queue({ pending: [], ownEventIds: [] }));
    await store.leave(FIXTURE, LEFT);
    expect(files.files.size).toBe(0);
    files.files.set(keptOf(FIXTURE), placed({}));
    await store.save(queue({ pending: [], ownEventIds: [] }));
    await store.leave(FIXTURE, LEFT + HOUR);
    expect(files.files.size).toBe(0);
  });

  it('is a no-op for a match with no files at all, and twice is the same as once', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await expect(store.leave(FIXTURE, LEFT)).resolves.toBeUndefined();
    await played(store);
    await store.leave(FIXTURE, LEFT);
    await store.leave(FIXTURE, LEFT);
    expect([...files.files.keys()]).toEqual([keptOf(FIXTURE)]);
    expect(await store.loadKept(FIXTURE, LEFT)).toEqual(['ev-1', 'ev-2']);
  });

  it('leaving again, with only the kept ids left to keep (nothing tapped since), stamps them again', async () => {
    const { store } = storeOver();
    await played(store);
    await store.leave(FIXTURE, LEFT);
    await store.leave(FIXTURE, LEFT + 20 * HOUR);
    expect(await store.loadKept(FIXTURE, LEFT + 40 * HOUR)).toEqual(['ev-1', 'ev-2']);
    expect(await store.loadKept(FIXTURE, LEFT + 44 * HOUR + 1)).toBeNull();
  });

  it('leaving a match that has a queue again takes the queue’s ids, which hold the kept ones and the new', async () => {
    const { store } = storeOver();
    await played(store);
    await store.leave(FIXTURE, LEFT);
    await store.save(queue({ pending: [], ownEventIds: ['ev-1', 'ev-2', 'ev-9'] }));
    await store.leave(FIXTURE, LEFT + HOUR);
    expect(await store.loadKept(FIXTURE, LEFT + 2 * HOUR)).toEqual(['ev-1', 'ev-2', 'ev-9']);
  });

  it('keeps a second match’s ids beside the first: each is its own file and its own day', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await played(store);
    await played(store, OTHER);
    await store.leave(FIXTURE, LEFT);
    await store.leave(OTHER, LEFT + 20 * HOUR);
    expect([...files.files.keys()].sort()).toEqual([keptOf(FIXTURE), keptOf(OTHER)].sort());
    expect(await store.loadKept(FIXTURE, LEFT + 21 * HOUR)).toEqual(['ev-1', 'ev-2']);
    expect(await store.loadKept(OTHER, LEFT + 21 * HOUR)).toEqual(['ev-1', 'ev-2']);
    expect(await store.loadKept(FIXTURE, LEFT + 25 * HOUR)).toBeNull();
    expect(await store.loadKept(OTHER, LEFT + 25 * HOUR)).toEqual(['ev-1', 'ev-2']);
  });

  it('is null for a match nothing was kept for, the empty input', async () => {
    const { store } = storeOver();
    expect(await store.loadKept(FIXTURE, LEFT)).toBeNull();
  });

  it('a remove (Dismiss, Forget, Close) takes the kept ids and their temp file too, and only its own', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await played(store);
    await played(store, OTHER);
    await store.leave(FIXTURE, LEFT);
    await store.leave(OTHER, LEFT);
    files.files.set(`${keptOf(FIXTURE)}.tmp`, 'half');
    await store.remove(FIXTURE);
    expect([...files.files.keys()]).toEqual([keptOf(OTHER)]);
  });

  it('refuses ids that name the link’s secret: nothing is deleted, nothing is written', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    files.files.set(nameOf(FIXTURE), asFile(queue({ pending: [], ownEventIds: [TOKEN] })));
    await expect(store.leave(FIXTURE, LEFT)).rejects.toThrow(/link/i);
    expect(files.written.join('')).not.toContain(TOKEN);
    expect([...files.files.keys()]).toEqual([nameOf(FIXTURE)]);
  });

  it.each([
    ['not a number', Number.NaN],
    ['below zero', -1],
    ['not whole', 1.5],
  ])(
    'a stamp that is %s would not read back: refused, and nothing is deleted',
    async (_name, stamp) => {
      const files = createMemoryQueueFiles();
      const { store } = storeOver(files);
      await played(store);
      await expect(store.leave(FIXTURE, stamp)).rejects.toThrow(/read back/);
      expect(await store.load(FIXTURE)).not.toBeNull();
      expect(files.files.has(keptOf(FIXTURE))).toBe(false);
    },
  );

  it('rejects when the kept file cannot be written, and deletes nothing: the queue is still there to be left again', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    await played(store);
    files.failNext('write');
    await expect(store.leave(FIXTURE, LEFT)).rejects.toThrow();
    expect(await store.load(FIXTURE)).not.toBeNull();
    expect(await store.loadLedger(FIXTURE)).toEqual(LEDGER);
    expect(await store.loadBoot(FIXTURE)).not.toBeNull();
    expect(await store.loadKept(FIXTURE, LEFT)).toBeNull();
    await store.leave(FIXTURE, LEFT);
    expect(await store.loadKept(FIXTURE, LEFT)).toEqual(['ev-1', 'ev-2']);
  });

  it('killed between the kept file and the delete: both stand, and leaving again finishes it', async () => {
    const files = createMemoryQueueFiles();
    await played(storeOver(files).store);
    files.failNext('remove');
    await expect(storeOver(files).store.leave(FIXTURE, LEFT)).rejects.toThrow();
    const again = storeOver(files).store;
    expect(await again.loadKept(FIXTURE, LEFT + HOUR)).toEqual(['ev-1', 'ev-2']);
    expect((await again.load(FIXTURE))?.ownEventIds).toEqual(['ev-1', 'ev-2']);
    await again.leave(FIXTURE, LEFT + HOUR);
    expect([...files.files.keys()]).toEqual([keptOf(FIXTURE)]);
  });

  it('a kept file whose save was cut inside its move is promoted from the temp file', async () => {
    const files = createMemoryQueueFiles();
    await played(storeOver(files).store);
    files.failNext('moveAfterDelete');
    await expect(storeOver(files).store.leave(FIXTURE, LEFT)).rejects.toThrow();
    expect(files.files.has(`${keptOf(FIXTURE)}.tmp`)).toBe(true);
    expect(await storeOver(files).store.loadKept(FIXTURE, LEFT + HOUR)).toEqual(['ev-1', 'ev-2']);
  });

  it.each([
    ['text that is not JSON', 'not json'],
    ['a file of another version', placed({ v: 2 })],
    ['a file of another match', placed({ fixtureId: OTHER })],
    ['ids that are no list', placed({ ownEventIds: 'ev-1' })],
    ['an empty id', placed({ ownEventIds: ['ev-1', ''] })],
    ['no ids', placed({ ownEventIds: [] })],
    ['a stamp that is no number', placed({ leftAt: '2026-11-03T10:00:00.000Z' })],
    ['a stamp that is not whole', placed({ leftAt: 1.5 })],
    ['a stamp below zero', placed({ leftAt: -1 })],
    ['no stamp', text({ v: 1, fixtureId: FIXTURE, ownEventIds: ['ev-1'] })],
  ])('%s is no kept entry: null, said once, never thrown', async (_name, content) => {
    const files = createMemoryQueueFiles();
    const { store, entries } = storeOver(files);
    files.files.set(keptOf(FIXTURE), content);
    expect(await store.loadKept(FIXTURE, LEFT)).toBeNull();
    expect(await store.loadKept(FIXTURE, LEFT)).toBeNull();
    expect(keptUnreadable(entries)).toHaveLength(1);
    expect(keptUnreadable(entries)[0]?.fields).toEqual({ problem: 'garbled' });
    expect(await store.list()).toEqual([]);
  });

  it('a trouble said once is said again after the file has been cleared away, by a remove or an expiry', async () => {
    const files = createMemoryQueueFiles();
    const { store, entries } = storeOver(files);
    files.files.set(keptOf(FIXTURE), 'not json');
    await store.loadKept(FIXTURE, LEFT);
    await store.remove(FIXTURE);
    files.files.set(keptOf(FIXTURE), 'not json');
    await store.loadKept(FIXTURE, LEFT);
    expect(keptUnreadable(entries)).toHaveLength(2);
    await store.expireKept(LEFT);
    files.files.set(keptOf(FIXTURE), 'not json');
    await store.loadKept(FIXTURE, LEFT);
    expect(keptUnreadable(entries)).toHaveLength(3);
  });

  it('a kept file the disk refuses to read is null and said, not thrown', async () => {
    const files = createMemoryQueueFiles();
    const { store, entries } = storeOver(files);
    await played(store);
    await store.leave(FIXTURE, LEFT);
    files.failNext('read');
    expect(await store.loadKept(FIXTURE, LEFT)).toBeNull();
    expect(keptUnreadable(entries)).toHaveLength(1);
    expect(await store.loadKept(FIXTURE, LEFT)).toEqual(['ev-1', 'ev-2']);
  });

  it('an id unfit for a file name keeps nothing and reads nothing', async () => {
    const { store, files } = storeOver();
    await expect(store.leave('../x', LEFT)).resolves.toBeUndefined();
    expect(await store.loadKept('../x', LEFT)).toBeNull();
    expect(files.ops).toEqual([]);
  });

  describe('expiring what is older than a day', () => {
    it('deletes the entries older than 24 h and keeps the rest, tmp files with them', async () => {
      const files = createMemoryQueueFiles();
      const { store } = storeOver(files);
      await played(store);
      await played(store, OTHER);
      await store.leave(FIXTURE, LEFT);
      await store.leave(OTHER, LEFT + 10 * HOUR);
      files.files.set(`${keptOf(FIXTURE)}.tmp`, 'half');
      await store.expireKept(LEFT + 24 * HOUR);
      expect([...files.files.keys()].sort()).toEqual(
        [keptOf(FIXTURE), `${keptOf(FIXTURE)}.tmp`, keptOf(OTHER)].sort(),
      );
      await store.expireKept(LEFT + 24 * HOUR + 1);
      expect([...files.files.keys()]).toEqual([keptOf(OTHER)]);
      await store.expireKept(LEFT + 34 * HOUR + 1);
      expect(files.files.size).toBe(0);
    });

    it('leaves a queue and its caches alone: only kept files are its business', async () => {
      const files = createMemoryQueueFiles();
      const { store } = storeOver(files);
      await played(store);
      await store.expireKept(LEFT + 1000 * HOUR);
      expect(await store.load(FIXTURE)).not.toBeNull();
      expect(await store.loadLedger(FIXTURE)).toEqual(LEDGER);
      expect(await store.loadBoot(FIXTURE)).not.toBeNull();
    });

    it('takes a garbled kept file away, which nothing else would, and one whose temp file is garbled too', async () => {
      const files = createMemoryQueueFiles();
      const { store } = storeOver(files);
      files.files.set(keptOf(FIXTURE), 'not json');
      files.files.set(`${keptOf(OTHER)}.tmp`, 'half');
      await store.expireKept(LEFT);
      expect(files.files.size).toBe(0);
    });

    it('leaves a file the disk would not read: it is tried again next time', async () => {
      const files = createMemoryQueueFiles();
      const { store } = storeOver(files);
      await played(store);
      await store.leave(FIXTURE, LEFT);
      files.failNext('read');
      await store.expireKept(LEFT + 100 * HOUR);
      expect(files.files.has(keptOf(FIXTURE))).toBe(true);
      await store.expireKept(LEFT + 100 * HOUR);
      expect(files.files.has(keptOf(FIXTURE))).toBe(false);
    });

    it('with nothing kept, the empty input, deletes nothing; a folder that cannot be listed is said, not thrown', async () => {
      const files = createMemoryQueueFiles();
      const { store } = storeOver(files);
      await expect(store.expireKept(LEFT)).resolves.toBeUndefined();
      files.failNext('names');
      await expect(store.expireKept(LEFT)).resolves.toBeUndefined();
    });

    it('rejects when the disk refuses the delete, so the caller can say so', async () => {
      const files = createMemoryQueueFiles();
      const { store } = storeOver(files);
      await played(store);
      await store.leave(FIXTURE, LEFT);
      files.failNext('remove');
      await expect(store.expireKept(LEFT + 25 * HOUR)).rejects.toThrow();
      await store.expireKept(LEFT + 25 * HOUR);
      expect(files.files.size).toBe(0);
    });
  });
});

// A queue save that fails says why in one word, for the record line `scoring.queue.saveFailed {problem}`: the store's
// own refusals carry it, and anything the file port throws is `file`. The word is never matched out of a message, and
// no message, path or queue text travels with it.
describe('why a queue save failed', () => {
  const problemOf = async (files: ReturnType<typeof createMemoryQueueFiles>, saved: MatchQueue) => {
    const failure: unknown = await storeOver(files)
      .store.save(saved)
      .then(
        () => null,
        (error: unknown) => error,
      );
    if (failure === null) throw new Error('the save was not refused');
    return queueSaveProblemOf(failure);
  };

  it.each([
    ['the label', queue({ label: `Match ${TOKEN}` })],
    ['a tap’s payload', queue({ pending: [tap({ payload: { note: [`x ${TOKEN}`] } })] })],
    ['an own event id', queue({ ownEventIds: [TOKEN] })],
  ])('a link secret in %s is `secret`', async (_name, bad) => {
    expect(await problemOf(createMemoryQueueFiles(), bad)).toBe('secret');
  });

  it('a link secret is `secret` whatever else is wrong with the queue, but a bad file name comes first', async () => {
    expect(
      await problemOf(
        createMemoryQueueFiles(),
        queue({ label: TOKEN, pending: [tap({ attempts: 1.5 })] }),
      ),
    ).toBe('secret');
    expect(
      await problemOf(createMemoryQueueFiles(), queue({ fixtureId: '../x', label: TOKEN })),
    ).toBe('name');
  });

  it.each([
    ['a fractional attempts count', queue({ pending: [tap({ attempts: 1.5 })] })],
    ['a tap with no payload', queue({ pending: [tap({ payload: undefined })] })],
  ])('%s, which would not read back, is `readback`', async (_name, bad) => {
    expect(await problemOf(createMemoryQueueFiles(), bad)).toBe('readback');
  });

  it.each(['', '..', '../x', 'a b', 'a'.repeat(101)])(
    'the fixture id %j, which is no file name, is `name`',
    async (fixtureId) => {
      expect(await problemOf(createMemoryQueueFiles(), queue({ fixtureId }))).toBe('name');
    },
  );

  it.each(['write', 'move', 'moveAfterDelete'] as const)(
    'the disk refusing %s is `file`',
    async (op) => {
      const files = createMemoryQueueFiles();
      files.failNext(op);
      expect(await problemOf(files, queue())).toBe('file');
    },
  );

  it('anything that is not one of the store’s own refusals is `file`: a plain Error, a lookalike, a non-error', () => {
    const lookalike = Object.assign(new Error('disk'), { problem: 'secret' });
    for (const thrown of [
      new Error('disk'),
      lookalike,
      'secret',
      undefined,
      null,
      { problem: 'readback' },
    ])
      expect(queueSaveProblemOf(thrown)).toBe('file');
  });

  it('the refusal’s message names no secret, and a refused save leaves no word behind for the next one', async () => {
    const files = createMemoryQueueFiles();
    const { store } = storeOver(files);
    const refused = await store.save(queue({ label: TOKEN })).catch((error: unknown) => error);
    expect(String(refused)).not.toContain(TOKEN);
    await store.save(queue());
    files.failNext('write');
    const failed = await store.save(queue({ pending: [] })).catch((error: unknown) => error);
    expect(queueSaveProblemOf(refused)).toBe('secret');
    expect(queueSaveProblemOf(failed)).toBe('file');
  });
});
