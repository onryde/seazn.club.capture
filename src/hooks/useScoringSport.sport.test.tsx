import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PortsProvider } from '@/hooks/usePorts';
import { LanguageProvider } from '@/hooks/useLanguage';
import { useScoringSport } from '@/hooks/useScoringSport';
import { SINGLES_SEED } from '@/services/fakeScoringPort';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, timerClock } from '../../test/fakePorts';

// The picker names the sport the runner opened the match as, whichever it is: given a second sport (the made-up
// "first to 3", `test/firstTo3Sport.ts`, as `scoringRunner.sport.test.ts` does), the pick is that sport's key and
// badminton's is not assumed. The server is offline: the runner opens as the link's sport before any read.

vi.mock('@/domain/scoring/sports', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/domain/scoring/sports')>();
  const { firstTo3 } = await import('../../test/firstTo3Sport');
  return {
    ...real,
    sportFor: (key: string) => (key === firstTo3.key ? firstTo3 : real.sportFor(key)),
  };
});

const FIXTURE = SINGLES_SEED.fixtureId;
const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-02T09:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

describe('useScoringSport with a second sport in the table', () => {
  it('names the sport the match was kept as', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    await saveScoringLink(fakes.kv, FIXTURE, LINK, 'stg.seazn.club', 'first3');
    fakes.scoring.goOffline(true);
    const view = renderHook(() => useScoringSport(FIXTURE), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <PortsProvider ports={fakes.ports}>
          <LanguageProvider>{children}</LanguageProvider>
        </PortsProvider>
      ),
    });
    await act(async () => {
      for (let i = 0; i < 400; i += 1) await Promise.resolve();
    });
    expect(view.result.current).toEqual({ kind: 'sport', sportKey: 'first3' });
  });
});
