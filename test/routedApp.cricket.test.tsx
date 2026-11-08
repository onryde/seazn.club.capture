import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { liveCricketSeed } from '@/services/fakeCricketPad';
import type { FakeMatchSeed } from '@/services/fakeScoringPort';
import { RAW } from './scoringHomeFixtures';
import { flush, launchApp } from './routedApp';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// S2-4 plan Task 8: a cricket link from the scan to the board, through the route's table, on the fake server with the real
// runner, queue, sender and fold under it (the real engine folds every event). What the scorer reads, from the seed's
// ledger and the dictionary, never from the code under test. The lime, the caution chips and a cut name are the device
// check's (Batch 2's); Remote Scoring is portrait only, so no orientation applies.

async function scanned(seed: FakeMatchSeed = liveCricketSeed()) {
  const app = await launchApp({ scoringSeed: seed });
  app.scanner.queue({ outcome: 'scanned', raw: RAW });
  act(() => screen.getByRole('button', { name: /Remote Scoring/ }).click());
  await flush(400);
  return app;
}

describe('a cricket match from the scan to the board', () => {
  it('a cricket link opens on the cricket screen: the board in the halves’ place', async () => {
    const app = await scanned();
    expect(app.nav.current()).toBe('scoring');
    expect(screen.getByTestId('cricket-board')).toBeTruthy();
    expect(screen.queryByTestId('half-first')).toBeNull();
    expect(screen.getByTestId('board-runs').textContent).toBe('5/0');
    expect(screen.getByTestId('board-overs').textContent).toBe('(0.3 ov)');
    expect(screen.getByTestId('board-innings').textContent).toBe('Innings 1 · Riverside CC');
    const striker = screen.getByTestId('board-batter-first');
    expect(within(striker).getByText('B. Okafor')).toBeTruthy();
    expect(within(striker).getByLabelText(en['scoring.cricket.board.onStrike'])).toBeTruthy();
    expect(screen.getAllByTestId('over-chip').map((chip) => chip.textContent)).toEqual([
      '1',
      '4',
      '·',
    ]);
  });

  it('History reads the console’s balls in words, the latest first', async () => {
    await scanned();
    act(() => fireEvent.click(screen.getByRole('button', { name: en['scoring.history.title'] })));
    await flush(400);
    expect(screen.getByRole('heading', { name: 'Innings 1 · Riverside CC' })).toBeTruthy();
    const history = screen.getByTestId('history');
    expect(
      within(history)
        .getAllByTestId('history-said')
        .map((said) => said.textContent),
    ).toEqual([
      'Dot ball',
      'Four',
      '1 run',
      'Match started',
      'Riverside CC won the toss and chose to bat',
    ]);
    expect(
      within(history)
        .getAllByTestId('history-score')
        .map((score) => score.textContent),
    ).toEqual(['5/0', '5/0', '1/0']);
  });

  it('Match details lists the format’s rows', async () => {
    await scanned();
    act(() => fireEvent.click(screen.getByRole('button', { name: en['scoring.details.title'] })));
    await flush(400);
    expect(screen.getByText('2 an innings')).toBeTruthy();
    expect(screen.getByText('6 balls')).toBeTruthy();
    expect(screen.getByText('11 a side')).toBeTruthy();
    expect(screen.getByText('Up to 1 over')).toBeTruthy();
  });
});
