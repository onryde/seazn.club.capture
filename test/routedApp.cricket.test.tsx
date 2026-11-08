import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { cricketSeed, liveCricketSeed } from '@/services/fakeCricketPad';
import type { FakeMatchSeed } from '@/services/fakeScoringPort';
import { FAKE_SCORING_SECRET } from './fakeScoringLinkPort';
import { TEST_NOW } from './fakePorts';
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

// S2-4 plan Task 10 (owner ruling 83): a match nobody has tossed for opens on its setup, in the board's place. Every tap
// is the scorer's, through the screen, a second after the one before on the phone's clock (out of its bounce window).
describe('a cricket match from the toss to the first ball', () => {
  const FRESH = cricketSeed();
  let seconds = 0;
  beforeEach(() => {
    seconds = 0;
  });
  async function tapThen(
    app: Awaited<ReturnType<typeof scanned>>,
    role: 'radio' | 'button',
    name: string,
  ) {
    seconds += 1;
    app.setNow(new Date(TEST_NOW.getTime() + seconds * 1000));
    act(() => fireEvent.click(screen.getByRole(role, { name })));
    await flush(400);
  }
  const typesOf = async (app: Awaited<ReturnType<typeof scanned>>) => {
    // The fake server reads no link off a read; the one the scan saved is the same.
    const link = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
    const events = await app.scoring.events(link, FRESH.fixtureId, 0);
    return Array.isArray(events) ? events.map((event) => event.type) : [];
  };

  it('the toss on the whole screen, the order, the bowler, Start: the board in its place', async () => {
    const app = await scanned(FRESH);
    expect(screen.getByTestId('cricket-toss')).toBeTruthy();
    expect(screen.queryByTestId('cricket-board')).toBeNull();
    await tapThen(app, 'radio', 'Bat');
    expect(await typesOf(app)).toEqual([]);
    await tapThen(app, 'radio', 'Riverside CC');
    await tapThen(app, 'radio', 'Bat');
    expect(await typesOf(app)).toEqual(['cricket.toss']);
    expect(screen.queryByTestId('cricket-toss')).toBeNull();
    await tapThen(app, 'button', en['scoring.cricket.setup.up'].replace('{name}', 'C. Mendes'));
    await tapThen(app, 'button', en['scoring.cricket.setup.next']);
    expect(
      screen.getByText(
        en['scoring.cricket.setup.openers']
          .replace('{striker}', 'A. Sharma')
          .replace('{nonStriker}', 'C. Mendes'),
      ),
    ).toBeTruthy();
    await tapThen(app, 'button', 'W. Murphy');
    await tapThen(app, 'button', en['scoring.start.confirm']);
    expect(await typesOf(app)).toEqual(['cricket.toss', 'core.start']);
    expect(screen.getByTestId('cricket-board')).toBeTruthy();
    expect(screen.queryByTestId('cricket-setup')).toBeNull();
  });

  it('Undo of the toss asks the toss again', async () => {
    const app = await scanned(FRESH);
    await tapThen(app, 'radio', 'Hillcrest CC');
    await tapThen(app, 'radio', 'Bowl');
    expect(screen.getByTestId('batting-order')).toBeTruthy();
    await tapThen(app, 'button', en['scoring.pad.undo']);
    expect(screen.getByTestId('cricket-toss')).toBeTruthy();
    expect(
      screen.getByRole('heading', {
        name: en['scoring.cricket.toss.chose'].replace('{team}', en['scoring.cricket.toss.team']),
      }),
    ).toBeTruthy();
  });
});
