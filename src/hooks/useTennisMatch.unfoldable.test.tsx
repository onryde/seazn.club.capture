import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTennisMatch } from '@/hooks/useTennisMatch';
import { TENNIS_TOUR_SEED } from '@/services/fakeTennisPad';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, readRecord, timerClock } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

// S2-7 B3 fix round (review I2): a match the fold cannot work out is said in words on the screen and, with its cause, in the
// session record through the levelled logger. The fold is stood in for here (its causes are `tennisFold.malformed.test.ts`'s),
// so this pins the seam: the detail the fold names reaches the record once, and a match that folds writes no such line.

const fold = vi.hoisted(() => ({ broken: true }));

vi.mock('@/domain/scoring/tennisFold', async (importActual) => {
  const actual = await importActual<typeof import('@/domain/scoring/tennisFold')>();
  return {
    ...actual,
    foldTennis: (...args: Parameters<typeof actual.foldTennis>) =>
      fold.broken
        ? ({ kind: 'unfoldable', reason: 'ledger', detail: 'engine:WRONG_PHASE' } as const)
        : actual.foldTennis(...args),
  };
});

const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };

async function open() {
  const seed = TENNIS_TOUR_SEED;
  const fakes = createFakePorts({ clock: timerClock, scoringSeed: seed });
  await saveScoringLink(fakes.kv, seed.fixtureId, LINK, 'stg.seazn.club', 'tennis');
  const view = renderHook(() => useTennisMatch(seed.fixtureId), { wrapper: wrapperFor(fakes) });
  await act(async () => {
    for (let i = 0; i < 400; i += 1) await Promise.resolve();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
  return { fakes, view };
}

const said = (fakes: Awaited<ReturnType<typeof open>>['fakes']) =>
  readRecord(fakes.record).filter((line) => line.event === 'scoring.unfoldable');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-12T09:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a match that cannot be folded', () => {
  it('is the unfoldable card, and the record says why once: the reason and the detail, nothing of the ledger', async () => {
    fold.broken = true;
    const { fakes, view } = await open();
    expect(view.result.current).toMatchObject({ kind: 'unfoldable', reason: 'ledger' });
    expect(said(fakes)).toHaveLength(1);
    expect(said(fakes)[0]?.level).toBe('warn');
    expect(said(fakes)[0]?.fields).toEqual({ reason: 'ledger', cause: 'engine:WRONG_PHASE' });
  });

  it('a match that folds writes no such line', async () => {
    fold.broken = false;
    const { fakes, view } = await open();
    expect(view.result.current.kind).toBe('pad');
    expect(said(fakes)).toHaveLength(0);
  });
});
