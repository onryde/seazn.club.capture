import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { cricketSeed } from '@/services/fakeCricketPad';
import type { FakeMatchSeed } from '@/services/fakeScoringPort';
import { AWAY, HOME, OPENING } from './cricketLedger';
import { FAKE_SCORING_SECRET } from './fakeScoringLinkPort';
import { TEST_NOW } from './fakePorts';
import { RAW } from './scoringHomeFixtures';
import { flush, launchApp } from './routedApp';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// T19 fix 7 (device, build 982): Match started with no team sheet, the sheets saved after. The ledger is toss and start,
// both sides' players are entered, no ball has gone: the pad asks for the openers and the first bowler (spec §4.5) and does
// not stand the keys, every tap of which the engine refuses. The seed is what the phone reads after the sheets are saved.

const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const SEED: FakeMatchSeed = {
  ...cricketSeed({ events: OPENING.map(({ type, payload }) => ({ type, payload })) }),
  sides: { home: HOME, away: AWAY },
};

let seconds = 0;
async function scanned() {
  seconds = 0;
  const app = await launchApp({ scoringSeed: SEED });
  app.scanner.queue({ outcome: 'scanned', raw: RAW });
  act(() => screen.getByRole('button', { name: /Remote Scoring/ }).click());
  await flush(400);
  return app;
}
type App = Awaited<ReturnType<typeof scanned>>;

async function tap(app: App, name: string) {
  seconds += 1;
  app.setNow(new Date(TEST_NOW.getTime() + seconds * 1000));
  act(() => fireEvent.click(screen.getByRole('button', { name })));
  await flush(400);
}
const ledger = async (app: App) => {
  const events = await app.scoring.events(LINK, SEED.fixtureId, 0);
  return Array.isArray(events) ? events : [];
};

describe('players entered after Match started', () => {
  it('asks for the openers, then the bowler, then the keys work; nothing is recorded by the picks', async () => {
    const app = await scanned();
    const before = (await ledger(app)).length;
    expect(screen.getByTestId('cricket-setup')).toBeTruthy();
    expect(screen.queryByTestId('cricket-keys')).toBeNull();
    expect(screen.queryByTestId('break-card')).toBeNull();
    await tap(app, en['scoring.cricket.setup.next']);
    expect(screen.getByTestId('first-bowler')).toBeTruthy();
    await tap(app, 'Away Player 11');
    expect(screen.getByTestId('cricket-board')).toBeTruthy();
    expect(screen.getByTestId('cricket-keys')).toBeTruthy();
    expect((await ledger(app)).length).toBe(before);
    await tap(app, '1 run');
    const ball = (await ledger(app)).at(-1);
    expect(ball?.type).toBe('cricket.ball');
    expect(ball?.payload).toMatchObject({ striker: 'H-p1', nonStriker: 'H-p2', bowler: 'A-p11' });
  });
});
