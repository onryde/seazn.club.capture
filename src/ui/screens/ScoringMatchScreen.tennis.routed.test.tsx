import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { TENNIS_TOUR_SEED } from '@/services/fakeTennisPad';
import { TEST_NOW } from '../../../test/fakePorts';
import { RAW } from '../../../test/scoringHomeFixtures';
import { flush, launchApp, type LaunchedApp } from '../../../test/routedApp';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// S2-7 Task 11: a tennis link scanned from Home reaches tennis's own pad through the route's table, on the fake server with
// the real runner, queue, sender and fold under it. Each test reads what the scorer sees. Portrait only.

const SEED = TENNIS_TOUR_SEED;
const press = (name: string) => act(() => fireEvent.click(screen.getByRole('button', { name })));
const half = (side: 'first' | 'second') => screen.getByTestId(`half-${side}`);

/** The match scanned from Home, as the scorer scans it, and the Start screen it opens on. */
async function scanned(): Promise<LaunchedApp> {
  const app = await launchApp({ scoringSeed: SEED });
  app.scanner.queue({ outcome: 'scanned', raw: RAW });
  act(() => screen.getByRole('button', { name: /^(Remote Scoring|Puntuación|Scoren)/ }).click());
  await flush(400);
  return app;
}

describe('a tennis match from the scan to History', () => {
  it('a scanned link opens tennis’s Start screen; Start, a point and History show the point', async () => {
    const app = await scanned();
    expect(app.nav.current()).toBe('scoring');
    // Who serves first: the top side, then Start match.
    act(() => fireEvent.click(screen.getAllByRole('radio')[0]!));
    app.setNow(new Date(TEST_NOW.getTime() - 60_000));
    press(en['scoring.start.confirm']);
    app.setNow(TEST_NOW);
    await flush(200);
    // The pad is tennis's: its four cells, not another sport's tool row.
    expect(
      within(screen.getByTestId('tool-row'))
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      en['scoring.tennis.tool.violation'],
      en['scoring.tennis.tool.break'],
      en['scoring.tennis.tool.award'],
      en['scoring.tennis.tool.setScore'],
    ]);
    app.setNow(new Date(TEST_NOW.getTime() + 2_000));
    act(() => fireEvent.click(half('second')));
    await flush(200);
    app.setNow(new Date(TEST_NOW.getTime() + 4_000));
    press(en['scoring.history.title']);
    await flush(200);
    expect(screen.getByText(/^Set 1 · Game 1 · .+ serving$/)).toBeTruthy();
    // Once in the last-tap line under the halves and once as History's row.
    expect(
      screen.getAllByText(en['scoring.tennis.last.point'].replace('{side}', 'Bea Lund')),
    ).toHaveLength(2);
  });
});
