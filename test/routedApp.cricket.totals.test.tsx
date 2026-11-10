import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { cricketSeed } from '@/services/fakeCricketPad';
import type { FakeMatchSeed } from '@/services/fakeScoringPort';
import type { BootstrapSide } from '@/domain/scoring/wire';
import { AWAY, HOME, KO_2, LEAGUE_2, OPENING, summary, type Spec } from './cricketLedger';
import { FAKE_SCORING_SECRET } from './fakeScoringLinkPort';
import { TEST_NOW } from './fakePorts';
import { RAW } from './scoringHomeFixtures';
import { flush, launchApp } from './routedApp';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

// S2-4 plan Task 17 (spec §4.10, rulings 66 and 74): a side with no players entered is scored over by over, on the fake
// server with the real runner, queue, sender and fold under it (the real engine judges every event). Every tap is the
// scorer's, through the screen, a second after the one before on the phone's clock (out of its bounce window). What the
// scorer reads comes from the ledger the seed states and the dictionary, never from the code under test. The thumb on the
// steppers and the lime of the plate are the device check's.

const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const NO_AWAY: BootstrapSide = { ...AWAY, lineup: [] };

const seedOf = (
  specs: readonly Spec[],
  cfg: unknown = KO_2,
  sides: { home: BootstrapSide; away: BootstrapSide } = { home: HOME, away: NO_AWAY },
): FakeMatchSeed => ({
  ...cricketSeed({ events: specs.map(({ type, payload }) => ({ type, payload })), cfg }),
  sides,
});

async function scanned(seed: FakeMatchSeed) {
  const app = await launchApp({ scoringSeed: seed });
  app.scanner.queue({ outcome: 'scanned', raw: RAW });
  act(() => screen.getByRole('button', { name: /Remote Scoring/ }).click());
  await flush(400);
  return app;
}
type App = Awaited<ReturnType<typeof scanned>>;

let seconds = 0;
beforeEach(() => {
  seconds = 0;
});
/** A press a second on from the one before, out of every bounce window. */
async function press(app: App, name: string, role: 'button' | 'radio' = 'button') {
  seconds += 1;
  app.setNow(new Date(TEST_NOW.getTime() + seconds * 1000));
  act(() => fireEvent.click(screen.getByRole(role, { name })));
  await flush(400);
}
const click = (name: string) => act(() => fireEvent.click(screen.getByRole('button', { name })));
const ledger = async (app: App, seed: FakeMatchSeed) => {
  const events = await app.scoring.events(LINK, seed.fixtureId, 0);
  return Array.isArray(events) ? events : [];
};
const summaries = async (app: App, seed: FakeMatchSeed) =>
  (await ledger(app, seed)).filter((event) => event.type === 'cricket.innings.summary');
const runs = () => screen.getByTestId('board-runs').textContent;
const valueOf = (field: 'runs' | 'wickets' | 'balls') =>
  screen.getByTestId(`totals-${field}-value`).textContent;
const heading = () => screen.getByRole('heading', { name: /^Over \d+ totals$/ }).textContent;
const RECORD = en['scoring.cricket.totals.record'];

/** An over's figures keyed in: the steppers' labels are the dictionary's ("Runs: 1 more"). */
function key(field: 'Runs' | 'Wickets' | 'Balls', by: 'more' | 'fewer', times: number) {
  for (let i = 0; i < times; i += 1) click(`${field}: 1 ${by}`);
}

describe('a match with a side that has no players, from the toss to the first over', () => {
  it('the toss, then Start match, then the entry for over 1: no board, no keys, the note above it', async () => {
    const fresh = seedOf([]);
    const app = await scanned(fresh);
    await press(app, 'Home CC', 'radio');
    await press(app, 'Bat', 'radio');
    expect((await ledger(app, fresh)).map((event) => event.type)).toEqual(['cricket.toss']);
    await press(app, en['scoring.start.confirm']);
    expect((await ledger(app, fresh)).map((event) => event.type)).toEqual([
      'cricket.toss',
      'core.start',
    ]);
    expect(screen.getByTestId('cricket-totals')).toBeTruthy();
    expect(screen.getByText('Players not entered — ask the organiser')).toBeTruthy();
    expect(heading()).toBe('Over 1 totals');
    expect(screen.queryByTestId('cricket-board')).toBeNull();
    expect(screen.queryByTestId('cricket-keys')).toBeNull();
  });
});

describe('over totals on the pad', () => {
  it('two overs, 8/0 then 7/1: the ledger gets the running totals, and the innings ends at twelve balls', async () => {
    const seed = seedOf(OPENING);
    const app = await scanned(seed);
    expect(heading()).toBe('Over 1 totals');
    key('Runs', 'more', 8);
    await press(app, RECORD);
    expect(heading()).toBe('Over 2 totals');
    expect(runs()).toBe('8/0');
    expect(screen.getByTestId('board-overs').textContent).toBe('(1 ov)');
    expect(screen.getByText('Players not entered — ask the organiser')).toBeTruthy();
    key('Runs', 'more', 7);
    key('Wickets', 'more', 1);
    await press(app, RECORD);
    // Twelve balls are the innings (KO_2): it is over, and the other side's innings starts in totals too, from over 1.
    expect(screen.getByTestId('board-team').textContent).toBe('Away CC');
    expect(screen.getByTestId('board-innings').textContent).toBe('Innings 2');
    expect(runs()).toBe('0/0');
    expect(heading()).toBe('Over 1 totals');
    expect((await summaries(app, seed)).map((event) => event.payload)).toEqual([
      { runs: 8, wickets: 0, legalBalls: 6, partial: true },
      { runs: 15, wickets: 1, legalBalls: 12, partial: true },
    ]);
  });

  it('a part over sends its legal balls: three balls, 4 runs', async () => {
    const seed = seedOf(OPENING);
    const app = await scanned(seed);
    key('Runs', 'more', 4);
    key('Balls', 'fewer', 3);
    await press(app, RECORD);
    expect((await summaries(app, seed)).map((event) => event.payload)).toEqual([
      { runs: 4, wickets: 0, legalBalls: 3, partial: true },
    ]);
    expect(screen.getByTestId('board-overs').textContent).toBe('(0.3 ov)');
  });

  it('the last-tap line says the over, and Undo takes it back: the entry is over 1 again', async () => {
    const seed = seedOf(OPENING);
    const app = await scanned(seed);
    key('Runs', 'more', 8);
    await press(app, RECORD);
    expect(screen.getByTestId('last-tap-sentence').textContent).toBe('Over recorded · 8/0 (1 ov)');
    await press(app, en['scoring.pad.undo']);
    expect((await ledger(app, seed)).at(-1)?.type).toBe('core.void');
    expect(heading()).toBe('Over 1 totals');
    expect(runs()).toBe('0/0');
  });

  // The four questions, a second call: the entry starts again at once under the same thumb, so a double tap on Record
  // would record an extra maiden over.
  it('a double tap on Record records one over', async () => {
    const seed = seedOf(OPENING);
    const app = await scanned(seed);
    key('Runs', 'more', 3);
    seconds += 1;
    app.setNow(new Date(TEST_NOW.getTime() + seconds * 1000));
    const record = screen.getByRole('button', { name: RECORD });
    act(() => {
      fireEvent.click(record);
      fireEvent.click(record);
    });
    await flush(400);
    expect(await summaries(app, seed)).toHaveLength(1);
  });

  // Review of Batch 5, I1 (the four questions: a second call, after the first landed). A part over leaves the over
  // number at 1, so a key on the number left 4 / 0 / 3 under the thumb with Record on: a second deliberate tap, past
  // the bounce window, recorded the same figures again (8 runs off 6 balls). The entry opens fresh instead, on what is
  // left of the over.
  it('a part over, recorded: the entry opens at nothing scored and the three balls left, and a second tap cannot repeat it', async () => {
    const seed = seedOf(OPENING);
    const app = await scanned(seed);
    key('Runs', 'more', 4);
    key('Balls', 'fewer', 3);
    await press(app, RECORD);
    expect(heading()).toBe('Over 1 totals');
    expect([valueOf('runs'), valueOf('wickets'), valueOf('balls')]).toEqual(['0', '0', '3']);
    await press(app, RECORD);
    // The second tap records the other three balls as a maiden: 4 runs off 6 balls in all, never 8.
    expect((await summaries(app, seed)).map((event) => event.payload)).toEqual([
      { runs: 4, wickets: 0, legalBalls: 3, partial: true },
      { runs: 4, wickets: 0, legalBalls: 6, partial: true },
    ]);
    expect(heading()).toBe('Over 2 totals');
    expect([valueOf('runs'), valueOf('wickets'), valueOf('balls')]).toEqual(['0', '0', '6']);
  });

  // Review of Batch 5, I1: innings 1 all out inside over 1 leaves innings 2's first over with the number over 1 had, so
  // one tap on Record put the chasing side all out for 3 and decided the match.
  it('innings 1 all out inside over 1: the chase’s over 1 opens at nothing scored and a whole over', async () => {
    const seed = seedOf(OPENING);
    const app = await scanned(seed);
    key('Runs', 'more', 3);
    key('Wickets', 'more', 10);
    key('Balls', 'fewer', 2);
    expect([valueOf('runs'), valueOf('wickets'), valueOf('balls')]).toEqual(['3', '10', '4']);
    await press(app, RECORD);
    expect(screen.getByTestId('board-team').textContent).toBe('Away CC');
    expect(screen.getByTestId('board-innings').textContent).toBe('Innings 2');
    expect(heading()).toBe('Over 1 totals');
    expect([valueOf('runs'), valueOf('wickets'), valueOf('balls')]).toEqual(['0', '0', '6']);
    expect((await summaries(app, seed)).map((event) => event.payload)).toEqual([
      { runs: 3, wickets: 10, legalBalls: 4, partial: true },
    ]);
  });

  // The four questions, after an interruption: no network. The over shows at once, the ledger gets it once on return.
  it('with no network the over is kept, and reaches the ledger once when the network returns', async () => {
    const seed = seedOf(OPENING);
    const app = await scanned(seed);
    app.scoring.goOffline(true);
    key('Runs', 'more', 5);
    await press(app, RECORD);
    expect(runs()).toBe('5/0');
    expect(await summaries(app, seed)).toHaveLength(0);
    app.scoring.goOffline(false);
    seconds += 120;
    app.setNow(new Date(TEST_NOW.getTime() + seconds * 1000));
    app.realtime.ping();
    await flush(10_000);
    seconds += 120;
    app.setNow(new Date(TEST_NOW.getTime() + seconds * 1000));
    await flush(10_000);
    expect((await summaries(app, seed)).map((event) => event.payload)).toEqual([
      { runs: 5, wickets: 0, legalBalls: 6, partial: true },
    ]);
    expect(runs()).toBe('5/0');
  });

  // The four questions, an empty input: the entry offers only what the engine takes.
  it('the wickets stepper stops at ten, and the figures never make a summary the engine refuses', async () => {
    const seed = seedOf(OPENING);
    await scanned(seed);
    key('Wickets', 'more', 12);
    expect(screen.getByTestId('totals-wickets-value').textContent).toBe('10');
    expect(
      screen.getByRole('button', { name: 'Wickets: 1 more' }).getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('the entry survives a re-render in the same over: a sync, a tick', async () => {
    const seed = seedOf(OPENING);
    const app = await scanned(seed);
    key('Runs', 'more', 2);
    app.realtime.ping();
    await flush(400);
    expect(screen.getByTestId('totals-runs-value').textContent).toBe('2');
  });
});

describe('a tie in over totals', () => {
  const TIE = [...OPENING, summary(8, 0, 12), summary(8, 1, 12)];

  it('with a super over in the rules, the organiser decides: that line, and nothing to enter', async () => {
    const seed = seedOf(TIE, KO_2);
    const app = await scanned(seed);
    expect(screen.getByText('Tied — the organiser decides the super over')).toBeTruthy();
    expect(screen.queryByTestId('totals-runs')).toBeNull();
    expect(screen.queryByRole('button', { name: RECORD })).toBeNull();
    expect((await ledger(app, seed)).length).toBe(TIE.length);
  });

  it('without one, it is the result Tied, shown as any result', async () => {
    const seed = seedOf(TIE, LEAGUE_2);
    await scanned(seed);
    // The result heads the recorded card now, and the strip does not repeat it (T19 fix 5).
    expect(
      within(screen.getByTestId('pad-card')).getByText(en['scoring.cricket.result.tie']),
    ).toBeTruthy();
    expect(screen.queryByTestId('pad-strip')).toBeNull();
    expect(screen.queryByTestId('cricket-totals')).toBeNull();
  });
});

describe('players entered mid-innings keep the totals until the next innings', () => {
  it('both sheets in, the innings under way in totals: the entry goes on, noting that the innings stays', async () => {
    const both = { home: HOME, away: AWAY };
    const seed = seedOf([...OPENING, summary(8, 0, 6)], KO_2, both);
    await scanned(seed);
    expect(screen.getByText('This innings stays in over totals')).toBeTruthy();
    expect(heading()).toBe('Over 2 totals');
    expect(screen.queryByTestId('cricket-keys')).toBeNull();
  });
});
