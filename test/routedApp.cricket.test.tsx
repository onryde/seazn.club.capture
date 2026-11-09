import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { cricketSeed, liveCricketSeed } from '@/services/fakeCricketPad';
import type { FakeMatchSeed } from '@/services/fakeScoringPort';
import {
  AWAY,
  FIRST_INNINGS_8,
  HOME,
  OPENING,
  TIED_KO,
  TWO_INNINGS,
  summary,
  type Spec,
} from './cricketLedger';
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

  // S2-4 Task 18 fix round (controller's ruling 2): a History row wraps with no line cap, so a ball or wicket sentence is
  // never cut. The kit's cap is two lines, and every other sport's rows keep it.
  it('History puts no line cap on a row’s sentence', async () => {
    await scanned();
    act(() => fireEvent.click(screen.getByRole('button', { name: en['scoring.history.title'] })));
    await flush(400);
    const rows = within(screen.getByTestId('history')).getAllByTestId('history-said');
    expect(rows).toHaveLength(5);
    for (const said of rows) expect(getComputedStyle(said).webkitLineClamp).toBe('');
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

// S2-4 plan Task 16: the innings break from the scan, on the ledger fixtures' sides ("Home CC", "Away CC"; "Home Player
// 11"): the ball that ends an innings, the break's card over the next innings' setup, Start innings (nothing recorded),
// More's follow-on at a two-innings break, and a super over's setup, which offers no More.
describe('the innings break, from the last ball to Start innings', () => {
  const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
  const seedOf = (specs: readonly Spec[], cfg?: unknown): FakeMatchSeed => ({
    ...cricketSeed({
      events: specs.map(({ type, payload }) => ({ type, payload })),
      ...(cfg === undefined ? {} : { cfg }),
    }),
    sides: { home: HOME, away: AWAY },
  });
  let seconds = 0;
  beforeEach(() => {
    seconds = 0;
  });
  async function tap(app: Awaited<ReturnType<typeof scanned>>, name: string) {
    seconds += 1;
    app.setNow(new Date(TEST_NOW.getTime() + seconds * 1000));
    act(() => fireEvent.click(screen.getByRole('button', { name })));
    await flush(400);
  }
  const ledger = async (app: Awaited<ReturnType<typeof scanned>>, seed: FakeMatchSeed) => {
    const events = await app.scoring.events(LINK, seed.fixtureId, 0);
    return Array.isArray(events) ? events : [];
  };
  const orderHeading = (team: string) =>
    screen.getByRole('heading', {
      name: en['scoring.cricket.setup.order'].replace('{team}', team),
    });

  it('the innings’ last ball, the card with the target, the openers, the bowler, then Start innings', async () => {
    const seed = seedOf(FIRST_INNINGS_8.slice(0, -1));
    const app = await scanned(seed);
    await tap(app, en['scoring.cricket.ball.dot']);
    const card = screen.getByTestId('break-card');
    expect(within(card).getByRole('heading', { name: 'Innings break' })).toBeTruthy();
    expect(screen.getByTestId('break-line').textContent).toBe(
      'Home CC 8/0 (2 ov) · Away CC need 9 off 12 balls',
    );
    expect(screen.queryByTestId('cricket-board')).toBeNull();
    expect(orderHeading('Away CC')).toBeTruthy();
    await tap(app, en['scoring.cricket.setup.next']);
    await tap(app, 'Home Player 11');
    const before = (await ledger(app, seed)).length;
    await tap(app, en['scoring.cricket.setup.startInnings']);
    expect((await ledger(app, seed)).length).toBe(before);
    expect(screen.getByTestId('cricket-board')).toBeTruthy();
    expect(screen.queryByTestId('cricket-setup')).toBeNull();
    expect(screen.getByTestId('board-innings').textContent).toBe('Innings 2 · Away CC');
    // T19 device run D3: the line says the innings begun, not innings 1's last ball; the first ball then says itself.
    expect(screen.getByTestId('last-tap-sentence').textContent).toBe('Innings 2 started');
    await tap(app, '1 run');
    const ball = (await ledger(app, seed)).at(-1);
    expect(ball?.payload).toMatchObject({ striker: 'A-p1', nonStriker: 'A-p2', bowler: 'H-p11' });
    expect(screen.getByTestId('last-tap-sentence').textContent).toBe('1 run');
  });

  // The controller's ruling on Task 16's concern 1: Undo of the innings' last ball after Start innings drops the stale
  // Start innings, so the ball recorded again brings the break back, its target on the card, the openers kept.
  it('Start innings, Undo of the last ball, the ball again: the break card again, the openers pre-picked', async () => {
    const seed = seedOf(FIRST_INNINGS_8.slice(0, -1));
    const app = await scanned(seed);
    await tap(app, en['scoring.cricket.ball.dot']);
    await tap(app, en['scoring.cricket.setup.next']);
    await tap(app, 'Home Player 11');
    await tap(app, en['scoring.cricket.setup.startInnings']);
    expect(screen.getByTestId('cricket-board')).toBeTruthy();
    await tap(app, en['scoring.pad.undo']);
    expect(screen.getByTestId('board-innings').textContent).toBe('Innings 1 · Home CC');
    expect((await ledger(app, seed)).at(-1)?.type).toBe('core.void');
    expect(screen.getByTestId('last-tap-sentence').textContent).toBe('Undone — Dot ball');
    await tap(app, en['scoring.cricket.ball.dot']);
    expect(screen.getByTestId('break-line').textContent).toBe(
      'Home CC 8/0 (2 ov) · Away CC need 9 off 12 balls',
    );
    expect(
      screen.getByText(
        en['scoring.cricket.setup.openers']
          .replace('{striker}', 'Away Player 1')
          .replace('{nonStriker}', 'Away Player 2'),
      ),
    ).toBeTruthy();
    const start = screen.getByRole('button', { name: en['scoring.cricket.setup.startInnings'] });
    expect(start.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('two innings a side: the lead on the card, and More’s follow-on makes the other side bat', async () => {
    const seed = seedOf([...OPENING, summary(300, 10, 300), summary(50, 10, 120)], TWO_INNINGS);
    const app = await scanned(seed);
    expect(screen.getByTestId('break-line').textContent).toBe(
      'Away CC 50/10 (20 ov) · Home CC lead by 250 runs',
    );
    expect(orderHeading('Home CC')).toBeTruthy();
    await tap(app, en['scoring.cricket.key.more']);
    await tap(app, en['scoring.cricket.more.followOn']);
    await tap(app, en['scoring.cricket.confirm.followOn.do']);
    expect((await ledger(app, seed)).at(-1)?.type).toBe('cricket.followon');
    expect(orderHeading('Away CC')).toBeTruthy();
  });

  // The controller's ruling (follow-on): Undo of the enforced follow-on after Start innings drops the stale Start innings;
  // the follow-on enforced again brings the break back with the openers and the bowler already picked.
  it('follow-on, Start innings, Undo of the follow-on: the break again, Start innings asked again', async () => {
    const seed = seedOf([...OPENING, summary(300, 10, 300), summary(50, 10, 120)], TWO_INNINGS);
    const enforce = async () => {
      await tap(app, en['scoring.cricket.key.more']);
      await tap(app, en['scoring.cricket.more.followOn']);
      await tap(app, en['scoring.cricket.confirm.followOn.do']);
    };
    const app = await scanned(seed);
    await enforce();
    await tap(app, en['scoring.cricket.setup.next']);
    await tap(app, 'Home Player 11');
    await tap(app, en['scoring.cricket.setup.startInnings']);
    expect(screen.getByTestId('cricket-board')).toBeTruthy();
    await tap(app, en['scoring.pad.undo']);
    expect((await ledger(app, seed)).at(-1)?.type).toBe('core.void');
    expect(screen.getByTestId('break-line').textContent).toBe(
      'Away CC 50/10 (20 ov) · Home CC lead by 250 runs',
    );
    expect(orderHeading('Home CC')).toBeTruthy();
    await enforce();
    expect(screen.queryByTestId('cricket-board')).toBeNull();
    expect(screen.getByTestId('break-card')).toBeTruthy();
    expect(
      screen.getByText(
        en['scoring.cricket.setup.openers']
          .replace('{striker}', 'Away Player 1')
          .replace('{nonStriker}', 'Away Player 2'),
      ),
    ).toBeTruthy();
    const start = screen.getByRole('button', { name: en['scoring.cricket.setup.startInnings'] });
    expect(start.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('a knockout tie: the super over’s setup, the side batting second first, and no More', async () => {
    const app = await scanned(seedOf(TIED_KO));
    expect(screen.getByRole('heading', { name: 'Tied — super over' })).toBeTruthy();
    expect(screen.getByTestId('break-line').textContent).toBe('Away CC 8/0 (2 ov)');
    expect(orderHeading('Away CC')).toBeTruthy();
    expect(screen.queryByRole('button', { name: en['scoring.cricket.key.more'] })).toBeNull();
  });
});
