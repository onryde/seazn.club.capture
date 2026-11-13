import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTennisMatch } from '@/hooks/useTennisMatch';
import { TENNIS_TOUR_SEED } from '@/services/fakeTennisPad';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, readRecord, timerClock } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

// The pad hook says an engine fault in the point calls to the record (wiring of usePointCallFault): the helper is made to
// report one, and the hook must log it once. Deleting the hook's call fails this.
vi.mock('@/domain/scoring/tennisPointCall', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/domain/scoring/tennisPointCall')>()),
  tennisPointCallsOf: () => ({ calls: { first: null, second: null }, fault: 'TypeError' }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-13T09:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useTennisMatch: a fault in the point calls', () => {
  it('is recorded once as scoring.pointCall, never with a message', async () => {
    const seed = TENNIS_TOUR_SEED;
    const fakes = createFakePorts({ clock: timerClock, scoringSeed: seed });
    await saveScoringLink(
      fakes.kv,
      seed.fixtureId,
      { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET },
      'stg.seazn.club',
      'tennis',
    );
    const view = renderHook(() => useTennisMatch(seed.fixtureId), { wrapper: wrapperFor(fakes) });
    await act(async () => {
      for (let i = 0; i < 400; i += 1) await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(view.result.current.kind).toBe('pad');
    const lines = readRecord(fakes.record).filter((line) => line.event === 'scoring.pointCall');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.fields).toEqual({ reason: 'engine', cause: 'TypeError' });
  });
});
