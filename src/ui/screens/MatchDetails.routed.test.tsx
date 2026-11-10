import { foldEpochOf } from '@seazn/engine/sport';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import {
  AWAY_ENTRANT,
  HOME_ENTRANT,
  LIVE_EVENTS,
  cricketSeed,
  liveCricketSeed,
  playerOf,
} from '@/services/fakeCricketPad';
import { chessSeed } from '@/services/fakeChessPad';
import { SINGLES_SEED, type FakeMatchSeed } from '@/services/fakeScoringPort';
import { TABLE_TENNIS_SINGLES_SEED } from '@/services/fakeTableTennisPad';
import { STORE_KEYS } from '@/services/modeStore';
import { FAKE_SCORING_SECRET } from '../../../test/fakeScoringLinkPort';
import { TEST_NOW } from '../../../test/fakePorts';
import { flush, launchApp, type LaunchedApp } from '../../../test/routedApp';
import { RAW } from '../../../test/scoringHomeFixtures';

// Match details from the pad (S2-4 plan Task 18): cricket adds its scorecard under the match card; every other sport's
// sheet is the card and Close as it was. From the scan, on the fake server with the real runner, queue, sender and fold
// (the real engine judges every event). Every cricket figure is the scripted ledger's, written out by hand from the Laws.
// What jsdom cannot see (the look of the rows, how a 30-character name wraps, scrolling under a thumb) is the device
// check's; the widths are `cricketFit.test.ts`'s arithmetic.

const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const START = { type: 'core.start', payload: {} } as const;
const home = (n: number) => playerOf(HOME_ENTRANT, n);
const away = (n: number) => playerOf(AWAY_ENTRANT, n);

let seconds = 0;
beforeEach(() => {
  seconds = 0;
});
afterEach(() => vi.useRealTimers());

const aSecondOn = (app: LaunchedApp) => {
  seconds += 1;
  app.setNow(new Date(TEST_NOW.getTime() + seconds * 1000));
};

async function scanned(seed: FakeMatchSeed, words: Readonly<Record<string, string>> = en) {
  vi.useFakeTimers();
  const lang = words === en ? 'en' : 'es';
  const app = await launchApp({ scoringSeed: seed, kvSeed: { [STORE_KEYS.lang]: lang } });
  app.scanner.queue({ outcome: 'scanned', raw: RAW });
  act(() => screen.getByRole('button', { name: new RegExp(words['mode.scoring']!) }).click());
  await flush(400);
  aSecondOn(app);
  return app;
}

/** Tap Match details a second after the last thing, then let the sheet settle. */
async function openDetails(app: LaunchedApp, name: string = en['scoring.details.title']) {
  aSecondOn(app);
  act(() => fireEvent.click(screen.getByRole('button', { name })));
  await flush(400);
}

const sheet = () => within(screen.getByTestId('details-sheet'));
const texts = (id: string) =>
  sheet()
    .queryAllByTestId(id)
    .map((one) => one.textContent);

function ball(
  ballInOver: number,
  striker: string,
  nonStriker: string,
  rest: Readonly<Record<string, unknown>>,
) {
  return {
    type: 'cricket.ball',
    payload: { over: 0, ballInOver, striker, nonStriker, bowler: away(11), ...rest },
  };
}

/**
 * Five balls of the first over, all off W. Murphy: A. Sharma 1; B. Okafor 4, 0, 4 and bowled; C. Mendes in. Riverside
 * 9/1 off 0.5 overs. A. Sharma 1 (1) not out, B. Okafor 8 (4) bowled, C. Mendes 0 (0) not out; W. Murphy 0.5-0-9-1; no
 * extras; the one wicket fell at 9 in the fifth ball (0.5). Mid-over, so no standing sheet covers the pad.
 */
const MID_OVER: FakeMatchSeed = liveCricketSeed({
  events: [
    ...LIVE_EVENTS,
    ball(4, home(2), home(1), { runs: { bat: 4 }, boundary: 4 }),
    ball(5, home(2), home(1), {
      runs: { bat: 0 },
      wicket: { kind: 'bowled', out: home(2), incoming: home(3), bowlerCredited: true },
    }),
  ],
});

describe('Match details on the cricket pad', () => {
  it('shows the match card, and under it each innings: title, total, batting, who has not batted, extras, bowling, fall', async () => {
    const app = await scanned(MID_OVER);
    await openDetails(app);
    expect(sheet().getByTestId('match-card')).toBeTruthy();
    expect(texts('card-title')).toEqual(['Innings 1 · Riverside CC']);
    expect(texts('card-total')).toEqual(['9/1 · 0.5 ov']);
    expect(texts('card-batter')).toEqual([
      'A. Sharmanot out1 (1)',
      'B. Okaforbowled · b W. Murphy8 (4)',
      'C. Mendesnot out0 (0)',
    ]);
    expect(texts('card-didnotbat')).toEqual([
      'Did not bat: D. Walsh, E. Nakamura, F. Haddad, G. Lindqvist, H. Brennan, I. Petrova, ' +
        'J. Mwangi, K. Doyle',
    ]);
    expect(texts('card-extras')).toEqual(['Extras 0 (w 0, nb 0, b 0, lb 0)']);
    expect(texts('card-bowler')).toEqual(['W. Murphy0.5-0-9-1']);
    expect(texts('card-fall')).toEqual(['1-9 (B. Okafor, 0.5 ov)']);
  });

  it('the scorecard sits under the rules, in the same scroll, and Close closes the sheet', async () => {
    const app = await scanned(MID_OVER);
    await openDetails(app);
    const scroll = within(screen.getByTestId('details-scroll'));
    const card = scroll.getByTestId('match-card');
    const block = scroll.getByTestId('details-sport');
    expect(card.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    aSecondOn(app);
    act(() => fireEvent.click(screen.getByRole('button', { name: en['panel.close'] })));
    await flush(400);
    expect(screen.queryByTestId('details-sheet')).toBeNull();
  });

  // The four questions, an empty input: a match started with no ball has no innings figures to show.
  it('before a ball is bowled the sheet is the match card and nothing under it', async () => {
    const app = await scanned(
      cricketSeed({
        events: [{ type: 'cricket.toss', payload: { wonBy: HOME_ENTRANT, elected: 'bat' } }, START],
      }),
    );
    await openDetails(app);
    expect(sheet().getByTestId('match-card')).toBeTruthy();
    expect(screen.queryByTestId('details-sport')).toBeNull();
  });

  // The four questions, after an interruption: the ledger moves under the open sheet (another scorer's ball).
  it('another scorer’s ball while the sheet is open moves the scorecard on', async () => {
    const seed = liveCricketSeed();
    const app = await scanned(seed);
    await openDetails(app);
    expect(texts('card-total')).toEqual(['5/0 · 0.3 ov']);
    const last = (await app.scoring.events(LINK, seed.fixtureId, 0)) as readonly { seq: number }[];
    await app.scoring.append(LINK, seed.fixtureId, {
      expected_seq: last.at(-1)?.seq ?? 0,
      type: 'cricket.ball',
      payload: ball(4, home(2), home(1), { runs: { bat: 2 } }).payload,
      idempotency_key: 'another-scorer-1',
      engine_epoch: foldEpochOf('cricket'),
      rules_version: 0,
    });
    app.realtime.ping();
    await flush(2_000);
    expect(texts('card-total')).toEqual(['7/0 · 0.4 ov']);
    expect(screen.getAllByTestId('details-sheet')).toHaveLength(1);
  });

  // The four questions, another language.
  it('reads in Spanish', async () => {
    const app = await scanned(MID_OVER, es);
    await openDetails(app, es['scoring.details.title']);
    expect(texts('card-total')).toEqual(['9/1 · 0.5 ov']);
    expect(sheet().getByText(es['scoring.cricket.card.fallTitle'])).toBeTruthy();
    expect(texts('card-batter')[0]).toBe('A. Sharmano eliminado1 (1)');
  });
});

describe('Match details on the other sports’ pads is as it was', () => {
  const SEEDS: readonly (readonly [string, FakeMatchSeed])[] = [
    ['badminton', { ...SINGLES_SEED, events: [START] }],
    ['table tennis', { ...TABLE_TENNIS_SINGLES_SEED, events: [START] }],
    ['chess', chessSeed({ events: [START] })],
  ];

  it.each(SEEDS)('%s: the match card and Close, and no sport block', async (_, seed) => {
    const app = await scanned(seed);
    await openDetails(app);
    expect(sheet().getByTestId('match-card')).toBeTruthy();
    expect(screen.queryByTestId('details-sport')).toBeNull();
    expect(screen.queryByTestId('cricket-scorecard')).toBeNull();
    const content = screen.getByTestId('details-scroll').firstElementChild;
    expect(content?.children).toHaveLength(1);
  });
});
