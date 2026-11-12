import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { VOLLEYBALL_INDOOR_SEED } from '@/services/fakeVolleyballPad';
import { TEST_NOW } from '../../../test/fakePorts';
import { RAW } from '../../../test/scoringHomeFixtures';
import { flush, launchApp, type LaunchedApp } from '../../../test/routedApp';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// S2-6 Task 11: a volleyball link scanned from Home reaches volleyball's own pad through the route's table, on the fake
// server with the real runner, queue, sender and fold under it. Each test reads what the scorer sees. Portrait only.

const SEED = VOLLEYBALL_INDOOR_SEED;
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

describe('a volleyball match from the scan to History', () => {
  it('a scanned link opens volleyball’s Start screen; Start, a rally and History show the rally', async () => {
    const app = await scanned();
    expect(app.nav.current()).toBe('scoring');
    app.setNow(new Date(TEST_NOW.getTime() - 60_000));
    act(() => fireEvent.click(screen.getAllByRole('radio')[0]!));
    press(en['scoring.start.confirm']);
    app.setNow(TEST_NOW);
    await flush(200);
    // The pad is volleyball's: its tool row, not another sport's. Set score is last, so the others keep their place when
    // it goes after a set's first rally (F3, device exit bar).
    expect(
      within(screen.getByTestId('tool-row'))
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      en['scoring.volleyball.tool.timeout'],
      en['scoring.volleyball.sheet.sub'],
      en['scoring.volleyball.tool.more'],
      en['scoring.volleyball.tool.setScore'],
    ]);
    app.setNow(new Date(TEST_NOW.getTime() + 2_000));
    act(() => fireEvent.click(half('second')));
    await flush(200);
    expect(within(half('second')).getByTestId('score').textContent).toBe('1');
    app.setNow(new Date(TEST_NOW.getTime() + 4_000));
    press(en['scoring.history.title']);
    await flush(200);
    expect(
      screen.getByText(`${en['scoring.volleyball.setHeading'].replace('{set}', '1')}`),
    ).toBeTruthy();
    // Once in the last-tap line under the halves and once as History's row.
    expect(
      screen.getAllByText(en['scoring.volleyball.last.rally'].replace('{side}', 'Herons')),
    ).toHaveLength(2);
  });
});
