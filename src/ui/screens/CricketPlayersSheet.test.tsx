import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CricketPlayersView, PlayersBatter } from '@/domain/scoring/cricketPlayers';
import en from '@/i18n/en.json';
import {
  AWAY_ENTRANT,
  HOME_ENTRANT,
  LIVE_EVENTS,
  liveCricketSeed,
  playerOf,
} from '@/services/fakeCricketPad';
import type { FakeMatchSeed } from '@/services/fakeScoringPort';
import { CricketPlayersSheet } from '@/ui/screens/CricketPlayersSheet';
import { FAKE_SCORING_SECRET } from '../../../test/fakeScoringLinkPort';
import { TEST_NOW } from '../../../test/fakePorts';
import { renderWithPorts } from '../../../test/renderWithPorts';
import { flush, launchApp, type LaunchedApp } from '../../../test/routedApp';
import { RAW } from '../../../test/scoringHomeFixtures';

// The Players sheet (S2-4 spec §4.8a; rulings 77 and 78; plan Task 14): the sheet on its own, then from the scan on the
// fake server with the real runner, queue, sender and fold under it. Every figure is the scripted ledger's, written out
// by hand (preflight D3). The lime rows and ▲▼, the greyed rows' colour and a press's feedback are the device check's.

const fill = (text: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce(
    (all, [name, value]) => all.replace(`{${name}}`, String(value)),
    text,
  );

const batter = (over: Partial<PlayersBatter> & { readonly id: string }): PlayersBatter => ({
  name: over.id,
  state: 'yet',
  striker: false,
  note: { key: 'scoring.cricket.players.yet' },
  up: false,
  down: false,
  ...over,
});

const VIEW: CricketPlayersView = {
  batting: [
    batter({
      id: 'a',
      name: 'A. Sharma',
      state: 'in',
      striker: true,
      note: { key: 'scoring.cricket.players.in', vars: { runs: 9, balls: 3 } },
    }),
    batter({ id: 'c', name: 'C. Mendes', down: true }),
    batter({ id: 'd', name: 'D. Walsh', up: true }),
  ],
  bowling: [
    {
      id: 'v',
      name: 'V. Kaur',
      note: {
        key: 'scoring.cricket.players.figures.other',
        count: 1,
        vars: { figures: '0-0-0-0' },
      },
      tappable: true,
      chosen: true,
    },
    {
      id: 'w',
      name: 'W. Murphy',
      note: {
        key: 'scoring.cricket.players.cannot',
        vars: { figures: '1.0-0-9-1', why: { key: 'scoring.cricket.bowling.lastOver' } },
      },
      tappable: false,
      chosen: false,
    },
  ],
  betweenOvers: true,
};

function mount(view: CricketPlayersView = VIEW, tab: 'batting' | 'bowling' = 'batting') {
  const calls = {
    onTab: vi.fn<(tab: 'batting' | 'bowling') => void>(),
    onMove: vi.fn<(from: number, to: number) => void>(),
    onBowler: vi.fn<(id: string) => void>(),
    onClose: vi.fn<() => void>(),
  };
  renderWithPorts(<CricketPlayersSheet tab={tab} players={view} {...calls} />);
  return calls;
}

const sheetOf = () => within(screen.getByTestId('players-sheet'));

describe('CricketPlayersSheet', () => {
  it('says which tab is shown, and a tap on the other asks for it', () => {
    const calls = mount();
    const tabs = sheetOf().getAllByRole('tab');
    expect(tabs.map((one) => [one.textContent, one.getAttribute('aria-selected')])).toEqual([
      [en['scoring.cricket.players.batting'], 'true'],
      [en['scoring.cricket.players.bowling'], 'false'],
    ]);
    fireEvent.click(tabs[1]!);
    expect(calls.onTab).toHaveBeenCalledWith('bowling');
  });

  it('a batter reads how they stand; the striker is marked; ▲▼ only on those yet to bat, greyed at either end', () => {
    const calls = mount();
    const sharma = within(screen.getByTestId('players-a'));
    expect(
      sharma.getByText(fill(en['scoring.cricket.players.in'], { runs: 9, balls: 3 })),
    ).toBeTruthy();
    expect(sharma.getByLabelText(en['scoring.cricket.board.onStrike'])).toBeTruthy();
    expect(sharma.queryAllByRole('button')).toEqual([]);
    const up = (name: string) =>
      screen.getByRole('button', { name: fill(en['scoring.cricket.setup.up'], { name }) });
    const down = (name: string) =>
      screen.getByRole('button', { name: fill(en['scoring.cricket.setup.down'], { name }) });
    expect(up('C. Mendes').getAttribute('aria-disabled')).toBe('true');
    expect(down('D. Walsh').getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(down('C. Mendes'));
    fireEvent.click(up('D. Walsh'));
    expect(calls.onMove.mock.calls).toEqual([
      [1, 2],
      [2, 1],
    ]);
  });

  it('between overs one who may bowl takes a tap and the pick is said selected; a greyed bowler takes no tap', () => {
    const calls = mount(VIEW, 'bowling');
    const selected = sheetOf()
      .getAllByRole('tab')
      .map((one) => one.getAttribute('aria-selected'));
    expect(selected).toEqual(['false', 'true']);
    const kaur = screen.getByRole('button', { name: /V\. Kaur/ });
    const murphy = screen.getByRole('button', { name: /W\. Murphy/ });
    expect(kaur.getAttribute('aria-selected')).toBe('true');
    expect(
      within(murphy).getByText(`1.0-0-9-1 · ${en['scoring.cricket.bowling.lastOver']}`),
    ).toBeTruthy();
    expect(murphy.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(murphy);
    fireEvent.click(kaur);
    expect(calls.onBowler.mock.calls).toEqual([['v']]);
  });

  it('mid-over the bowling tab is read-only: no row is a button', () => {
    mount({ ...VIEW, betweenOvers: false }, 'bowling');
    const buttons = sheetOf()
      .getAllByRole('button')
      .map((one) => one.textContent);
    expect(buttons).toEqual([en['panel.close']]);
    expect(within(screen.getByTestId('players-w')).getByText(/1\.0-0-9-1/)).toBeTruthy();
  });

  it('Close and the dim close it', () => {
    const calls = mount();
    fireEvent.click(screen.getByRole('button', { name: en['panel.close'] }));
    const dim = screen.getByTestId('players-sheet').previousElementSibling;
    if (dim === null) throw new Error('no dim');
    fireEvent.click(dim);
    expect(calls.onClose).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// From the scan
// ---------------------------------------------------------------------------------------------------------------

beforeEach(() => {
  seconds = 0;
});
afterEach(() => vi.useRealTimers());

const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const home = (n: number) => playerOf(HOME_ENTRANT, n);
const away = (n: number) => playerOf(AWAY_ENTRANT, n);

/**
 * The first over finished: LIVE_EVENTS (A. Sharma 1; B. Okafor 4, 0), then B. Okafor 4, bowled, and C. Mendes 0, all
 * off W. Murphy: 1.0-0-9-1. At the over's end A. Sharma is on strike, with C. Mendes.
 */
const OVER_DONE: FakeMatchSeed = liveCricketSeed({
  events: [
    ...LIVE_EVENTS,
    ball(4, home(2), home(1), { runs: { bat: 4 }, boundary: 4 }),
    ball(5, home(2), home(1), {
      runs: { bat: 0 },
      wicket: { kind: 'bowled', out: home(2), incoming: home(3), bowlerCredited: true },
    }),
    ball(6, home(3), home(1), { runs: { bat: 0 } }),
  ],
});

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

let seconds = 0;
const aSecondOn = (app: LaunchedApp) => {
  seconds += 1;
  app.setNow(new Date(TEST_NOW.getTime() + seconds * 1000));
};

async function scanned(seed: FakeMatchSeed = liveCricketSeed()) {
  vi.useFakeTimers();
  const app = await launchApp({ scoringSeed: seed });
  app.scanner.queue({ outcome: 'scanned', raw: RAW });
  act(() => screen.getByRole('button', { name: /Remote Scoring/ }).click());
  await flush(400);
  aSecondOn(app);
  return app;
}

async function ledger(app: LaunchedApp, seed: FakeMatchSeed) {
  const events = await app.scoring.events(LINK, seed.fixtureId, 0);
  return Array.isArray(events) ? events : [];
}

/** A click a second after the last thing the scorer did, then the time a sheet needs before it takes a choice. */
async function click(app: LaunchedApp, target: HTMLElement) {
  aSecondOn(app);
  act(() => fireEvent.click(target));
  await flush(400);
}

const press = (app: LaunchedApp, name: string | RegExp) =>
  click(app, screen.getByRole('button', { name }));
const openPlayers = (app: LaunchedApp) => click(app, screen.getByTestId('board-score'));
const tab = (name: string) => screen.getByRole('tab', { name });
const noteOf = (name: string) =>
  within(screen.getByRole('button', { name: new RegExp(`^${name.replace('.', '\\.')}`) }));

describe('Players from the pad (plan Task 14)', () => {
  it('a tap on the score panel opens Players on Batting: how each stands, from the ledger', async () => {
    const app = await scanned();
    await openPlayers(app);
    expect(tab(en['scoring.cricket.players.batting']).getAttribute('aria-selected')).toBe('true');
    const rows = within(screen.getByTestId('players-sheet'));
    const okafor = within(screen.getByTestId(`players-${home(2)}`));
    expect(okafor.getByText('B. Okafor')).toBeTruthy();
    expect(
      okafor.getByText(fill(en['scoring.cricket.players.in'], { runs: 4, balls: 2 })),
    ).toBeTruthy();
    expect(okafor.getByLabelText(en['scoring.cricket.board.onStrike'])).toBeTruthy();
    expect(
      within(screen.getByTestId(`players-${home(1)}`)).getByText(
        fill(en['scoring.cricket.players.in'], { runs: 1, balls: 1 }),
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId(`players-${home(3)}`)).getByText(en['scoring.cricket.players.yet']),
    ).toBeTruthy();
    expect(rows.getByRole('heading').textContent).toBe(en['scoring.cricket.players.title']);
  });

  it('a reorder changes only the next suggestion: nothing recorded, then D. Walsh is next in', async () => {
    const seed = liveCricketSeed();
    const app = await scanned(seed);
    const before = (await ledger(app, seed)).length;
    await openPlayers(app);
    await press(app, fill(en['scoring.cricket.setup.down'], { name: 'C. Mendes' }));
    const yet = screen
      .getAllByText(en['scoring.cricket.players.yet'])
      .map((one) => one.closest('[data-testid^="players-"]')?.getAttribute('data-testid'));
    expect(yet.slice(0, 2)).toEqual([`players-${home(4)}`, `players-${home(3)}`]);
    expect((await ledger(app, seed)).length).toBe(before);
    await press(app, en['panel.close']);
    await press(app, en['scoring.cricket.key.out']);
    await press(app, en['scoring.cricket.wicket.kind.bowled']);
    const next = within(screen.getByTestId('step-sheet')).getAllByRole('button')[0]!;
    expect(next.textContent).toContain('D. Walsh');
    expect(next.getAttribute('aria-selected')).toBe('true');
  });

  it('mid-over the bowling tab takes no tap', async () => {
    const seed = liveCricketSeed();
    const app = await scanned(seed);
    await openPlayers(app);
    await click(app, tab(en['scoring.cricket.players.bowling']));
    const buttons = within(screen.getByTestId('players-sheet'))
      .getAllByRole('button')
      .map((one) => one.textContent);
    expect(buttons).toEqual([en['panel.close']]);
    await click(app, within(screen.getByTestId(`players-${away(10)}`)).getByText('V. Kaur'));
    await press(app, en['panel.close']);
    await press(app, '1 run');
    expect((await ledger(app, seed)).at(-1)?.payload).toMatchObject({ bowler: away(11) });
  });

  it('a scripted over shows its bowler’s figures: W. Murphy 1.0-0-9-1, greyed with why', async () => {
    const app = await scanned(OVER_DONE);
    await press(app, /^V\. Kaur/);
    await openPlayers(app);
    await click(app, tab(en['scoring.cricket.players.bowling']));
    expect(
      noteOf('W. Murphy').getByText(`1.0-0-9-1 · ${en['scoring.cricket.bowling.lastOver']}`),
    ).toBeTruthy();
    expect(
      noteOf('U. Rossi').getByText(
        fill(en['scoring.cricket.players.figures.one'], { figures: '0-0-0-0', count: 1 }),
      ),
    ).toBeTruthy();
  });

  it('between overs a tap sets the next bowler; a greyed bowler takes no tap', async () => {
    const app = await scanned(OVER_DONE);
    await press(app, /^V\. Kaur/);
    await openPlayers(app);
    await click(app, tab(en['scoring.cricket.players.bowling']));
    const kaur = () => screen.getByRole('button', { name: /^V\. Kaur/ });
    const rossi = () => screen.getByRole('button', { name: /^U\. Rossi/ });
    expect(kaur().getAttribute('aria-selected')).toBe('true');
    await click(app, rossi());
    expect(rossi().getAttribute('aria-selected')).toBe('true');
    expect(kaur().getAttribute('aria-selected')).toBeNull();
    await click(app, screen.getByRole('button', { name: /^W\. Murphy/ }));
    expect(rossi().getAttribute('aria-selected')).toBe('true');
    await press(app, en['panel.close']);
    await press(app, '1 run');
    expect((await ledger(app, OVER_DONE)).at(-1)?.payload).toMatchObject({
      over: 1,
      bowler: away(9),
      striker: home(1),
    });
  });
});
