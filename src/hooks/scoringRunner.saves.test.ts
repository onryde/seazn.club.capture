import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BadmintonTap } from '@/domain/scoring/badmintonPad';
import type { MatchQueue, QueuedEvent } from '@/domain/scoring/queue';
import type { MatchEvent } from '@/domain/scoring/scoringMatchState';
import { createScoringRunner, type ScoringRunner } from '@/hooks/scoringRunner';
import { SINGLES_SEED } from '@/services/fakeScoringPort';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { createTapQueueStore } from '@/services/tapQueueStore';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, readRecord, timerClock, type FakePorts } from '../../test/fakePorts';
import { createMemoryQueueFiles } from '../../test/memoryQueueFiles';

// A queue write that fails says why in the record: `scoring.queue.saveFailed {problem}`, one word of `secret`,
// `readback`, `name` or `file` (the store's own refusals carry theirs; anything else is the file's). A device record
// once showed the line twice with no reason. `problem` and not `code`, since the scrub masks any field named `code`.
// No message, path or queue text may reach the line.

const FIXTURE = SINGLES_SEED.fixtureId;
const HOST = 'stg.seazn.club';
const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const START: BadmintonTap = { kind: 'start', server: 'first' };
const FIRST: BadmintonTap = { kind: 'rally', side: 'first' };
const ONE_TAP: QueuedEvent = {
  key: 'a2f4c3d1-7a60-4d5e-9b0c-1e2f3a4b5c6d',
  type: 'badminton.rally',
  payload: { wonBy: 'ent-home' },
  rulesVersion: 2,
  createdAt: '2026-11-03T09:00:00.000Z',
  attempts: 0,
};

async function flush(): Promise<void> {
  for (let i = 0; i < 400; i += 1) await Promise.resolve();
}

const tap = (made: BadmintonTap, key: string): MatchEvent => ({
  kind: 'tap',
  tap: made,
  key,
  at: new Date(Date.now()).toISOString(),
});

async function open(fakes: FakePorts): Promise<ScoringRunner> {
  await saveScoringLink(fakes.kv, FIXTURE, LINK, HOST, 'badminton');
  const runner = createScoringRunner(fakes.ports, { fixtureId: FIXTURE, mode: 'focused' });
  await runner.start();
  await flush();
  return runner;
}

const lines = (fakes: FakePorts) =>
  readRecord(fakes.record).filter((line) => line.event === 'scoring.queue.saveFailed');

/**
 * One tap asks for several queue saves (its own, the server's answer, ...), and each failed one says its own line, so a
 * test of one reason reads that every line says it, and that there is at least one.
 */
function expectEveryLineSays(fakes: FakePorts, problem: string): void {
  const said = lines(fakes);
  expect(said.length).toBeGreaterThan(0);
  expect(said.map((line) => [line.level, line.fields])).toEqual(
    said.map(() => ['warn', { problem }]),
  );
}

/** The folder refusing one file's write or move, the rest working: what a full disk does to the queue alone. */
function refuseQueueFile(fakes: FakePorts, op: 'write' | 'move'): void {
  const files = fakes.queueFiles;
  const real = files[op].bind(files);
  const refused = (name: string): boolean => name === `${FIXTURE}.json.tmp`;
  vi.spyOn(files, op).mockImplementation((from: string, to: string) =>
    refused(from) ? Promise.reject(new Error('disk')) : real(from, to),
  );
}

/** What the real store rejects with for a queue it will not write: the thing the runner is handed in production. */
async function refusalFor(overrides: Partial<MatchQueue>): Promise<unknown> {
  const bad: MatchQueue = {
    fixtureId: FIXTURE,
    label: 'A. Sharma v L. Chen',
    pending: [],
    ownEventIds: [],
    dead: null,
    ...overrides,
  };
  const store = createTapQueueStore({
    files: createMemoryQueueFiles(),
    logger: createFakePorts().ports.logger,
  });
  return store.save(bad).then(
    () => {
      throw new Error('the store did not refuse');
    },
    (error: unknown) => error,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-03T09:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the record says why a queue save failed', () => {
  it.each([
    ['a link secret in the queue', { label: `Match ${FAKE_SCORING_SECRET}` }, 'secret'],
    ['a queue that would not read back', { pending: [{ ...ONE_TAP, attempts: 1.5 }] }, 'readback'],
    ['a fixture id that is no file name', { fixtureId: '../x' }, 'name'],
  ] as const)('%s: the store’s own refusal gives `%s`', async (_name, overrides, problem) => {
    const fakes = createFakePorts({ clock: timerClock });
    const runner = await open(fakes);
    const refusal = await refusalFor(overrides);
    vi.spyOn(fakes.tapQueue, 'save').mockRejectedValue(refusal);

    runner.dispatch(tap(START, 'k-start'));
    await flush();

    expectEveryLineSays(fakes, problem);
    await runner.stop();
  });

  it('a plain error from the file port is `file`, and its message is nowhere in the record', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    const runner = await open(fakes);
    vi.spyOn(fakes.tapQueue, 'save').mockRejectedValue(new Error('disk'));

    runner.dispatch(tap(START, 'k-start'));
    await flush();

    expectEveryLineSays(fakes, 'file');
    expect(fakes.record.lines().join('\n')).not.toContain('disk');
    await runner.stop();
  });

  it('a save rejected with something that is not an Error is `file`', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    const runner = await open(fakes);
    vi.spyOn(fakes.tapQueue, 'save').mockRejectedValue(undefined);

    runner.dispatch(tap(START, 'k-start'));
    await flush();

    expectEveryLineSays(fakes, 'file');
    await runner.stop();
  });

  it.each(['write', 'move'] as const)(
    'a disk that refuses the real store’s %s of the queue, end to end, is `file`',
    async (op) => {
      const fakes = createFakePorts({ clock: timerClock });
      const runner = await open(fakes);
      refuseQueueFile(fakes, op);

      runner.dispatch(tap(START, 'k-start'));
      await flush();

      expectEveryLineSays(fakes, 'file');
      expect(fakes.record.lines().join('\n')).not.toContain('disk');
      await runner.stop();
    },
  );

  it('each failed save says its own reason, in order: a secret, then a disk', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    const runner = await open(fakes);
    const refusal = await refusalFor({ label: FAKE_SCORING_SECRET });
    vi.spyOn(fakes.tapQueue, 'save')
      .mockRejectedValueOnce(refusal)
      .mockRejectedValueOnce(new Error('disk'));

    runner.dispatch(tap(START, 'k-start'));
    await flush();

    expect(lines(fakes).map((line) => line.fields)).toEqual([
      { problem: 'secret' },
      { problem: 'file' },
    ]);
    await runner.stop();
  });

  it('the line carries the one field, and no secret, id or queue text', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    const runner = await open(fakes);
    const refusal = await refusalFor({ label: `Match ${FAKE_SCORING_SECRET}` });
    vi.spyOn(fakes.tapQueue, 'save').mockRejectedValue(refusal);

    runner.dispatch(tap(START, 'k-start'));
    await flush();

    expect(lines(fakes).length).toBeGreaterThan(0);
    for (const said of lines(fakes)) {
      expect(Object.keys(said.fields)).toEqual(['problem']);
      const written = JSON.stringify(said);
      for (const leak of [FAKE_SCORING_SECRET, 'k-start', FIXTURE, 'Sharma', 'dl_']) {
        expect(written).not.toContain(leak);
      }
    }
    await runner.stop();
  });

  it('writes none while the queue saves', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    const runner = await open(fakes);

    runner.dispatch(tap(START, 'k-start'));
    await flush();
    runner.dispatch(tap(FIRST, 'k-r1'));
    await flush();

    expect(lines(fakes)).toEqual([]);
    expect(fakes.queueFiles.files.has(`${FIXTURE}.json`)).toBe(true);
    await runner.stop();
  });
});
