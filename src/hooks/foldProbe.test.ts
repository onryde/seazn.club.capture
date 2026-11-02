import { describe, expect, it } from 'vitest';
import * as realProbe from '@/domain/scoring/engineProbe';
import {
  FOLD_PROBE_RUNS,
  foldProbeLine,
  runFoldProbe,
  type FoldProbeModule,
} from '@/hooks/foldProbe';
import { createLogger } from '@/services/logger';
import { createRingRecord, parseRecordLine } from '@/services/sessionRecord';

/** The real logger over a ring, as the fake ports wire it: the line read back is the line the record keeps. */
function recorded() {
  const record = createRingRecord();
  const logger = createLogger({ record, now: () => 0 });
  return { logger, lines: () => record.lines().map(parseRecordLine) };
}

/** The probe module with its clock's readings fixed: every fold takes `ms`, one after another. */
function timedAt(...ms: number[]): FoldProbeModule {
  return {
    ...realProbe,
    timeFold: (events, times) => ({ events: events.length, ms: ms.slice(0, times) }),
  };
}

describe('runFoldProbe', () => {
  it('folds the 76-event match 50 times, on the real engine', async () => {
    const { logger } = recorded();
    const state = await runFoldProbe(logger);
    expect(FOLD_PROBE_RUNS).toBe(50);
    expect(state).toMatchObject({ kind: 'read', reading: { events: 76, runs: 50 } });
  });

  // Plan S2-1 Task 1 Step 6: `scoring.foldProbe {events, ms}`. The record takes numbers only (no arrays), so `ms` is
  // the reading's four numbers, each to a hundredth of a millisecond.
  it('records the reading as one line, in numbers', async () => {
    const { logger, lines } = recorded();
    const load = () => Promise.resolve(timedAt(0.304, 0.1, 0.2049, 9.876, 0.25));
    await runFoldProbe(logger, load, 5);
    expect(lines()).toEqual([
      {
        atMs: 0,
        level: 'info',
        event: 'scoring.foldProbe',
        fields: { events: 76, runs: 5, minMs: 0.1, medianMs: 0.25, maxMs: 9.88, firstMs: 0.3 },
      },
    ]);
  });

  // A phone whose engine cannot load or fold (zod reaching `new Function` under Hermes is R4's worry) reads the
  // failure on the chip and in the record, and the app stays up: the error's name in the record, its words on screen.
  it('reads a load that fails as a failure, never a crash', async () => {
    const { logger, lines } = recorded();
    const state = await runFoldProbe(logger, () => Promise.reject(new EvalError('no eval here')));
    expect(state).toEqual({ kind: 'failed', error: 'EvalError: no eval here' });
    expect(lines()).toMatchObject([
      { level: 'warn', event: 'scoring.foldProbe.failed', fields: { error: 'EvalError' } },
    ]);
  });

  it('reads a fold the engine refuses as a failure', async () => {
    const { logger, lines } = recorded();
    const refusing: FoldProbeModule = {
      ...realProbe,
      timeFold: () => {
        throw new TypeError('refused');
      },
    };
    expect(await runFoldProbe(logger, () => Promise.resolve(refusing))).toEqual({
      kind: 'failed',
      error: 'TypeError: refused',
    });
    expect(lines()).toMatchObject([{ fields: { error: 'TypeError' } }]);
  });

  it('reads a throw that is not an Error by what it is', async () => {
    const { logger } = recorded();
    expect(await runFoldProbe(logger, () => Promise.reject('gone'))).toEqual({
      kind: 'failed',
      error: 'gone',
    });
  });

  it('reads no folds as a failure, with nothing to time', async () => {
    const { logger, lines } = recorded();
    expect(await runFoldProbe(logger, () => Promise.resolve(timedAt()), 0)).toEqual({
      kind: 'failed',
      error: 'no folds',
    });
    expect(lines()).toMatchObject([{ fields: { error: 'none' } }]);
  });
});

/** The chip's readout: a developer's numbers, not copy, so not in the dictionaries (as `DevProbe`'s state word). */
describe('foldProbeLine', () => {
  const reading = { events: 76, runs: 50, min: 0.1549, median: 0.2, max: 12.345, first: 8.1 };

  it.each([
    ['nothing before the first tap', { kind: 'idle' } as const, null],
    ['an ellipsis while it runs', { kind: 'running' } as const, '…'],
    [
      'the events, then the fastest, median and slowest fold in ms',
      { kind: 'read', reading } as const,
      '76 · 0.15 / 0.20 / 12.35 ms',
    ],
    [
      'a failure in its own words',
      { kind: 'failed', error: 'EvalError: no eval here' } as const,
      'failed: EvalError: no eval here',
    ],
  ])('shows %s', (_name, state, line) => {
    expect(foldProbeLine(state)).toBe(line);
  });
});
