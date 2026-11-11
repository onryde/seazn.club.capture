import { act, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { cricketSeed, liveCricketSeed } from '@/services/fakeCricketPad';
import type { FakeMatchSeed } from '@/services/fakeScoringPort';
import {
  AWAY,
  AWAY_BOWLERS,
  DOT,
  HOME,
  HOME_BOWLERS,
  ONE,
  OPENING,
  WIDE,
  inningsOf,
  times,
} from './cricketLedger';
import { layOut } from './layOut';
import { RAW } from './scoringHomeFixtures';
import { flush, launchApp } from './routedApp';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// A decided cricket match scrolls (device bug, NE2211: the second side's Extras clipped under the last-tap line). The card,
// the board and its summary stand in a scroll under the fixed header and last-tap line; a live match's keys never do. jsdom
// lays nothing out, so that the content is taller than the room, the swipe and the pixels are the device check's: what is
// asserted here is the structure, which is what lets a taller-than-room content be reached, at 320 and 360 dp.

const LONG = 'Christopher Alexander Fitzwilliam-Montague';
const longNamed = (side: typeof HOME, club: string) => ({
  ...side,
  name: `${club} Cricket Club of the Longest Name`,
  members: side.members?.map((m) => ({ ...m, fullName: `${LONG} ${m.personId}` })),
});

/** Home 9 (a wide and eight singles) beats Away 2 (a wide and a single) by 7: both sides have extras. */
const DECIDED: FakeMatchSeed = {
  ...cricketSeed({
    events: [
      ...OPENING,
      ...inningsOf('H', AWAY_BOWLERS, [WIDE, ...times(8, ONE), ...times(4, DOT)]),
      ...inningsOf('A', HOME_BOWLERS, [WIDE, ONE, ...times(11, DOT)]),
    ].map(({ type, payload }) => ({ type, payload })),
  }),
  sides: { home: longNamed(HOME, 'Home'), away: longNamed(AWAY, 'Away') },
};

async function scanned(seed: FakeMatchSeed) {
  const app = await launchApp({ scoringSeed: seed });
  app.scanner.queue({ outcome: 'scanned', raw: RAW });
  act(() => screen.getByRole('button', { name: /Remote Scoring/ }).click());
  await flush(400);
  return app;
}

describe.each([
  { width: 288, label: '320 dp' },
  { width: 328, label: '360 dp' },
])('a decided match at $label', ({ width }) => {
  it('the card, the board and every extras line are in one scroll; the header and the last-tap line are not', async () => {
    await scanned(DECIDED);
    layOut(screen.getByTestId('cricket-board'), { width, height: 100 });
    const scroll = screen.getByTestId('pad-body-scroll');
    const won = en['scoring.cricket.result.runs.other']
      .replace('{name}', 'Home Cricket Club of the Longest Name')
      .replace('{count}', '7');
    expect(within(scroll).getByTestId('pad-card').textContent).toContain(won);
    expect(within(scroll).getByTestId('cricket-board')).toBeTruthy();
    const extras = within(scroll).getAllByTestId('summary-extras');
    expect(extras).toHaveLength(2);
    expect(extras[1]!.textContent).toBe(
      en['scoring.cricket.card.extras']
        .replace('{total}', '1')
        .replace('{wides}', '1')
        .replace('{noBalls}', '0')
        .replace('{byes}', '0')
        .replace('{legByes}', '0'),
    );
    expect(scroll.contains(screen.getByTestId('pad-header-end'))).toBe(false);
    expect(scroll.contains(screen.getByTestId('last-tap'))).toBe(false);
  });
});

describe('a live match', () => {
  it('has no scroll: its keys and board are never inside one', async () => {
    await scanned(liveCricketSeed());
    expect(screen.queryByTestId('pad-body-scroll')).toBeNull();
    expect(screen.getByTestId('cricket-board')).toBeTruthy();
    expect(screen.getByRole('button', { name: en['scoring.cricket.key.more'] })).toBeTruthy();
  });
});
