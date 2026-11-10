import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { cricketSeed } from '@/services/fakeCricketPad';
import type { FakeMatchSeed } from '@/services/fakeScoringPort';
import { AWAY, DOT, FOUR, HOME, ONE, TIED_KO, player, superOverOf, times } from './cricketLedger';
import { FAKE_SCORING_SECRET } from './fakeScoringLinkPort';
import { TEST_NOW } from './fakePorts';
import { RAW } from './scoringHomeFixtures';
import { flush, launchApp } from './routedApp';

// More in a super over (Batch 4 fix round, concern 2; carried to Task 18): the engine refuses all of More in a super over
// but the balls, so More offers nothing to choose and a press on it records nothing. The standing over-end sheet cannot
// stand in a super over at all (the super over's bowler is picked on the break card, and its one over ends its innings), so
// that sheet's More has no case to be tested through the route: `cricketMore.test.ts` pins that no point of a super over
// stands the sheet. What the scorer can reach, the keys' More, is tested here from the scan, on the fake server with the
// real runner, queue, sender and fold under it.

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };

/** A knockout tied after two overs each, and the side that batted second three balls into its super over. */
const SUPER: FakeMatchSeed = {
  ...cricketSeed({
    events: [...TIED_KO, ...superOverOf('A', player('H', 11), times(3, DOT))].map(
      ({ type, payload }) => ({ type, payload }),
    ),
  }),
  sides: { home: HOME, away: AWAY },
};

/** The same, decided: the away side made 2 off its super over, the home side four off its first ball and won. */
const SUPER_WON: FakeMatchSeed = {
  ...cricketSeed({
    events: [
      ...TIED_KO,
      ...superOverOf('A', player('H', 9), [ONE, ONE, ...times(4, DOT)]),
      ...superOverOf('H', player('A', 9), [FOUR]),
    ].map(({ type, payload }) => ({ type, payload })),
  }),
  sides: { home: HOME, away: AWAY },
};

let seconds = 0;
async function scanned(seed: FakeMatchSeed = SUPER) {
  seconds = 0;
  const app = await launchApp({ scoringSeed: seed });
  app.scanner.queue({ outcome: 'scanned', raw: RAW });
  act(() => screen.getByRole('button', { name: /Remote Scoring/ }).click());
  await flush(400);
  return app;
}

const count = async (app: Awaited<ReturnType<typeof scanned>>) => {
  const events = await app.scoring.events(LINK, SUPER.fixtureId, 0);
  return Array.isArray(events) ? events.length : -1;
};

describe('More in a super over', () => {
  it('the keys’ More is greyed: a press opens no sheet and records nothing', async () => {
    const app = await scanned();
    expect(screen.getByTestId('board-innings').textContent).toMatch(/super/i);
    expect(screen.queryByTestId('step-sheet')).toBeNull();
    const before = await count(app);
    expect(before).toBeGreaterThan(0);
    const more = screen.getByRole('button', { name: en['scoring.cricket.key.more'] });
    expect(more.getAttribute('aria-disabled')).toBe('true');
    seconds += 1;
    app.setNow(new Date(TEST_NOW.getTime() + seconds * 1000));
    act(() => fireEvent.click(more));
    await flush(400);
    expect(screen.queryByTestId('step-sheet')).toBeNull();
    expect(await count(app)).toBe(before);
  });

  it('a super over’s ball still records: the keys other than More work', async () => {
    const app = await scanned();
    const before = await count(app);
    seconds += 1;
    app.setNow(new Date(TEST_NOW.getTime() + seconds * 1000));
    act(() =>
      fireEvent.click(screen.getByRole('button', { name: en['scoring.cricket.ball.dot'] })),
    );
    await flush(400);
    expect(await count(app)).toBe(before + 1);
  });
});

describe('the result of a super over (T19 fix 5)', () => {
  it('the card is headed by who won, with both halves of the super over under it; the strip repeats nothing', async () => {
    await scanned(SUPER_WON);
    const card = screen.getByTestId('pad-card');
    expect(within(card).getByText('Home CC won on the super over')).toBeTruthy();
    expect(card.textContent).toContain('Result recorded.');
    const first = screen.getByTestId('board-result-first');
    const second = screen.getByTestId('board-result-second');
    expect(first.textContent).toBe('Away CC2/0 (1 ov)');
    expect(second.textContent).toBe('Home CC4/0 (0.1 ov)');
    expect(screen.queryByTestId('board-runs')).toBeNull();
    expect(within(screen.getByTestId('pad-strip')).queryByText(/won on the super over/)).toBeNull();
  });
});
