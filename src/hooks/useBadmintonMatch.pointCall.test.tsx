import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useBadmintonMatch } from '@/hooks/useBadmintonMatch';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { SINGLES_SEED } from '@/services/fakeScoringPort';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, readRecord } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

// The pad hook says an engine fault in the point calls to the record (wiring of usePointCallFault): the fold is made to
// report one, and the hook must log it once. Deleting the hook's call fails this.
vi.mock('@/domain/scoring/setBasedPointCall', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/domain/scoring/setBasedPointCall')>()),
  pointCallsFrom: () => ({ calls: { first: null, second: null }, fault: 'TypeError' }),
}));

describe('useBadmintonMatch: a fault in the point calls', () => {
  it('is recorded once as scoring.pointCall, never with a message', async () => {
    const seed = SINGLES_SEED;
    const fakes = createFakePorts({ scoringSeed: seed });
    await saveScoringLink(
      fakes.kv,
      seed.fixtureId,
      { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET },
      'stg.seazn.club',
      'badminton',
    );
    const view = renderHook(() => useBadmintonMatch(seed.fixtureId), {
      wrapper: wrapperFor(fakes),
    });
    await act(async () => {
      for (let i = 0; i < 400; i += 1) await Promise.resolve();
    });
    expect(view.result.current.kind).toBe('pad');
    const lines = readRecord(fakes.record).filter((line) => line.event === 'scoring.pointCall');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.fields).toEqual({ reason: 'engine', cause: 'TypeError' });
  });
});
