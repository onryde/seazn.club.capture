import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import {
  AWAY_ENTRANT,
  HOME_ENTRANT,
  LIVE_EVENTS,
  liveCricketSeed,
  playerOf,
} from '@/services/fakeCricketPad';
import type { FakeMatchSeed } from '@/services/fakeScoringPort';
import { colour, layout } from '@/ui/theme/tokens';
import { FAKE_SCORING_SECRET } from '../../../test/fakeScoringLinkPort';
import { edgeOf } from '../../../test/pressState';
import { TEST_NOW } from '../../../test/fakePorts';
import { flush, launchApp, type LaunchedApp } from '../../../test/routedApp';
import { RAW } from '../../../test/scoringHomeFixtures';

beforeEach(() => {
  seconds = 0;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

// The cricket pad's keys and the extras sheets (S2-4 spec §4.2, §5; rulings 73, 79, 80, 81; plan Task 11), from the scan,
// on the fake server with the real runner, queue, sender and fold under it (the real engine judges every ball). What the
// scorer reads and what the ledger holds, from the seed and the dictionary. The colours (the lime 4 and 6, the caution
// extras and Out), a press's feedback and the keys standing still on a phone are the device check's (Task 19).

const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const LIVE = liveCricketSeed();

let seconds = 0;
/** The phone's clock a second on: the next tap is never in the bounce window of the last. */
const aSecondOn = (app: LaunchedApp) => {
  seconds += 1;
  app.setNow(new Date(TEST_NOW.getTime() + seconds * 1000));
};

async function scanned(seed: FakeMatchSeed = LIVE) {
  const app = await launchApp({ scoringSeed: seed });
  app.scanner.queue({ outcome: 'scanned', raw: RAW });
  act(() => screen.getByRole('button', { name: /Remote Scoring/ }).click());
  await flush(400);
  aSecondOn(app);
  return app;
}

async function ledger(app: LaunchedApp, seed: FakeMatchSeed = LIVE) {
  const events = await app.scoring.events(LINK, seed.fixtureId, 0);
  return Array.isArray(events) ? events : [];
}

const lastPayload = async (app: LaunchedApp) => (await ledger(app)).at(-1)?.payload;
const count = async (app: LaunchedApp) => (await ledger(app)).length;

/** A press a second after the last thing the scorer did, then the time a sheet needs before it takes a choice. */
async function press(app: LaunchedApp, name: string | RegExp) {
  aSecondOn(app);
  act(() => fireEvent.click(screen.getByRole('button', { name })));
  await flush(400);
}

const key = (name: string | RegExp) => screen.getByRole('button', { name });
const sheet = () => screen.queryByTestId('step-sheet');
const runs = () => screen.getByTestId('board-runs').textContent;

describe('the run keys', () => {
  it('a 4 records a boundary 4: four off the bat, the board 9/0', async () => {
    const app = await scanned();
    await press(app, en['scoring.cricket.ball.four']);
    expect(await lastPayload(app)).toMatchObject({ runs: { bat: 4 }, boundary: 4 });
    expect(runs()).toBe('9/0');
  });

  it('a 2 records two off the bat and no boundary', async () => {
    const app = await scanned();
    await press(app, '2 runs');
    const payload = await lastPayload(app);
    expect(payload).toMatchObject({ runs: { bat: 2 } });
    expect(payload).not.toHaveProperty('boundary');
  });

  it('a double tap on a run key records one ball, and the line says Counted once', async () => {
    const app = await scanned();
    const before = await count(app);
    act(() => {
      fireEvent.click(key('1 run'));
      fireEvent.click(key('1 run'));
    });
    await flush(400);
    expect((await count(app)) - before).toBe(1);
    expect(screen.getByTestId('last-tap-note').textContent).toBe(en['scoring.pad.countedOnce']);
    expect(runs()).toBe('6/0');
  });

  // The 4 and the 6 are the engine's boundaries (`cricketPadRules.boundaryValues`), lime-edged; jsdom reads the edge, how it
  // looks on the phone is the device check's.
  it('the 4 and the 6 keys are edged in lime, and 0 to 3 are not', async () => {
    await scanned();
    const names = [
      en['scoring.cricket.ball.dot'],
      '1 run',
      '2 runs',
      '3 runs',
      en['scoring.cricket.ball.four'],
      en['scoring.cricket.ball.six'],
    ];
    const edges = names.map((name) => getComputedStyle(key(name)).borderTopColor);
    const plain = edgeOf(colour.ink3);
    const lime = edgeOf(colour.lime);
    expect(edges).toEqual([plain, plain, plain, plain, lime, lime]);
  });

  it('each key row’s height is its token before and after a ball', async () => {
    const app = await scanned();
    const heights = () =>
      ['keys-runs-first', 'keys-runs-second', 'keys-extras', 'keys-actions'].map(
        (id) => getComputedStyle(screen.getByTestId(id)).height,
      );
    const tokens = [
      layout.cricketRunKey,
      layout.cricketRunKey,
      layout.cricketExtraKey,
      layout.cricketActionKey,
    ].map((height) => `${height}px`);
    expect(heights()).toEqual(tokens);
    await press(app, en['scoring.cricket.ball.six']);
    expect(runs()).toBe('11/0');
    expect(heights()).toEqual(tokens);
  });
});

describe('the extras sheets', () => {
  it('Wide then 2 records runs 3: one wide extra, nothing off the bat', async () => {
    const app = await scanned();
    await press(app, en['scoring.cricket.key.wide']);
    await press(app, `${en['scoring.cricket.extras.ran']}: 2`);
    expect(await lastPayload(app)).toMatchObject({
      runs: { bat: 0, extras: { kind: 'wide', runs: 3 } },
    });
    expect(runs()).toBe('8/0');
    expect(sheet()).toBeNull();
  });

  it('No-ball then 4 off the bat records bat 4, a no-ball and boundary 4', async () => {
    const app = await scanned();
    await press(app, en['scoring.cricket.key.noBall']);
    await press(app, `${en['scoring.cricket.extras.bat']}: 4`);
    expect(await lastPayload(app)).toMatchObject({
      runs: { bat: 4, extras: { kind: 'noball', runs: 1 } },
      boundary: 4,
    });
    expect(runs()).toBe('10/0');
  });

  it('the no-ball sheet offers bat 0, 1, 2, 3, 4, 6 and runs run 1–4, then + Out', async () => {
    const app = await scanned();
    await press(app, en['scoring.cricket.key.noBall']);
    const names = within(sheet()!)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent);
    expect(names).toEqual([
      'Off the bat: 0',
      'Off the bat: 1',
      'Off the bat: 2',
      'Off the bat: 3',
      'Off the bat: 4',
      'Off the bat: 6',
      'Runs run: 1',
      'Runs run: 2',
      'Runs run: 3',
      'Runs run: 4',
      '+ Out',
      en['scoring.sheet.cancel'],
    ]);
  });

  it('a bye of 2 is two byes; a leg-bye of 1 one leg-bye', async () => {
    const app = await scanned();
    await press(app, en['scoring.cricket.key.bye']);
    await press(app, `${en['scoring.cricket.extras.runs']}: 2`);
    expect(await lastPayload(app)).toMatchObject({
      runs: { bat: 0, extras: { kind: 'bye', runs: 2 } },
    });
    await press(app, en['scoring.cricket.key.legBye']);
    await press(app, `${en['scoring.cricket.extras.runs']}: 1`);
    expect(await lastPayload(app)).toMatchObject({
      runs: { bat: 0, extras: { kind: 'legbye', runs: 1 } },
    });
    expect(runs()).toBe('8/0');
  });

  it('the extras sheet has no timer: 30 s on it is still open and nothing is queued', async () => {
    const app = await scanned();
    const before = await count(app);
    await press(app, en['scoring.cricket.key.wide']);
    for (let i = 0; i < 30; i += 1) {
      aSecondOn(app);
      await flush(1000);
    }
    expect(sheet()).not.toBeNull();
    expect(await count(app)).toBe(before);
  });

  it('Cancel records nothing and closes the sheet; so does the phone’s Back', async () => {
    const app = await scanned();
    const before = await count(app);
    await press(app, en['scoring.cricket.key.wide']);
    await press(app, en['scoring.sheet.cancel']);
    expect(sheet()).toBeNull();
    await press(app, en['scoring.cricket.key.noBall']);
    act(() => void app.back.press());
    await flush(400);
    expect(sheet()).toBeNull();
    expect(await count(app)).toBe(before);
  });

  it('while a sheet is open every key is disabled: a run key under it records nothing', async () => {
    const app = await scanned();
    const before = await count(app);
    await press(app, en['scoring.cricket.key.wide']);
    const four = screen.getByRole('button', {
      name: en['scoring.cricket.ball.four'],
      hidden: true,
    });
    expect(four.getAttribute('aria-disabled')).toBe('true');
    aSecondOn(app);
    act(() => fireEvent.click(four));
    await flush(400);
    expect(await count(app)).toBe(before);
  });

  it('a double tap on Wide opens one sheet: the second touch, on the sheet’s 0, records nothing', async () => {
    const app = await scanned();
    const before = await count(app);
    aSecondOn(app);
    act(() => fireEvent.click(key(en['scoring.cricket.key.wide'])));
    act(() => fireEvent.click(key(`${en['scoring.cricket.extras.ran']}: 0`)));
    await flush(400);
    expect(sheet()).not.toBeNull();
    expect(await count(app)).toBe(before);
  });

  it('a double tap on + Out opens one wicket flow: the second touch, on its first kind, records nothing', async () => {
    const app = await scanned();
    const before = await count(app);
    await press(app, en['scoring.cricket.key.wide']);
    aSecondOn(app);
    act(() => fireEvent.click(key(en['scoring.cricket.extras.out'])));
    const how = within(sheet()!).getByRole('heading', { name: en['scoring.cricket.wicket.how'] });
    expect(how).toBeTruthy();
    const [first] = within(sheet()!).getAllByRole('button');
    act(() => fireEvent.click(first!));
    await flush(400);
    expect(
      within(sheet()!).getByRole('heading', { name: en['scoring.cricket.wicket.how'] }),
    ).toBeTruthy();
    expect(await count(app)).toBe(before);
  });
});

describe('Undo and the status line', () => {
  it('Undo takes back this phone’s last ball only (ruling 81): none of the console’s', async () => {
    const app = await scanned();
    const undo = () => key(en['scoring.pad.undo']);
    // The live seed's balls are another scorer's: nothing of this phone's to take back.
    expect(undo().getAttribute('aria-disabled')).toBe('true');
    await press(app, '2 runs');
    expect(undo().getAttribute('aria-disabled')).not.toBe('true');
    const ball = (await ledger(app)).at(-1);
    await press(app, en['scoring.pad.undo']);
    const voiding = (await ledger(app)).at(-1);
    expect([
      voiding?.type,
      (voiding?.payload as { event_id?: string } | undefined)?.event_id,
    ]).toEqual(['core.void', ball?.id]);
    expect(runs()).toBe('5/0');
    expect(undo().getAttribute('aria-disabled')).toBe('true');
    // One Undo on the pad: the last-tap line has none of its own under the keys.
    expect(screen.getAllByRole('button', { name: en['scoring.pad.undo'] })).toHaveLength(1);
  });

  it('a no-ball says Free hit on the board’s over strip, and the next fair ball takes it away', async () => {
    const app = await scanned();
    expect(screen.queryByTestId('board-status')).toBeNull();
    await press(app, en['scoring.cricket.key.noBall']);
    await press(app, `${en['scoring.cricket.extras.bat']}: 0`);
    expect(screen.getByTestId('board-status').textContent).toBe(
      en['scoring.cricket.board.freeHit'],
    );
    await press(app, en['scoring.cricket.ball.dot']);
    expect(screen.queryByTestId('board-status')).toBeNull();
  });

  it('the line says the last ball', async () => {
    const app = await scanned();
    await press(app, en['scoring.cricket.ball.four']);
    expect(screen.getByTestId('last-tap-sentence').textContent).toContain(
      en['scoring.cricket.ball.four'],
    );
  });
});

describe('the wicket steps (plan Task 12)', () => {
  const choices = () => within(screen.getByTestId('step-sheet')).getAllByRole('button');
  const heading = () => within(screen.getByTestId('step-sheet')).getByRole('heading').textContent;

  it('Out, Bowled, then the next batter, suggested and said so: one wicket, the board a wicket down', async () => {
    const app = await scanned();
    await press(app, en['scoring.cricket.key.out']);
    expect(heading()).toBe(en['scoring.cricket.wicket.how']);
    await press(app, en['scoring.cricket.wicket.kind.bowled']);
    expect(heading()).toBe(en['scoring.cricket.wicket.incoming']);
    const next = choices()[0]!;
    expect(next.getAttribute('aria-selected')).toBe('true');
    expect(within(next).getByText(en['scoring.cricket.wicket.nextInOrder'])).toBeTruthy();
    aSecondOn(app);
    act(() => fireEvent.click(next));
    await flush(400);
    expect(sheet()).toBeNull();
    expect(await lastPayload(app)).toMatchObject({
      runs: { bat: 0 },
      wicket: { kind: 'bowled', bowlerCredited: true },
    });
    expect(runs()).toBe('5/1');
  });

  it('a run out asks who, the fielder, a second one (never the fielder), the runs, then who walks in', async () => {
    const app = await scanned();
    await press(app, en['scoring.cricket.key.out']);
    await press(app, en['scoring.cricket.wicket.kind.runout']);
    expect(heading()).toBe(en['scoring.cricket.wicket.who']);
    const [striker] = choices();
    aSecondOn(app);
    act(() => fireEvent.click(striker!));
    await flush(400);
    expect(heading()).toBe(en['scoring.cricket.wicket.fielder']);
    const fielder = choices()[3]!;
    const name = fielder.textContent;
    aSecondOn(app);
    act(() => fireEvent.click(fielder));
    await flush(400);
    expect(heading()).toBe(en['scoring.cricket.wicket.assist']);
    const same = choices().find((one) => one.textContent?.startsWith(name ?? '?') === true);
    expect(same?.getAttribute('aria-disabled')).toBe('true');
    expect(within(same!).getByText(en['scoring.cricket.wicket.isFielder'])).toBeTruthy();
    await press(app, en['scoring.cricket.wicket.noAssist']);
    await press(app, `${en['scoring.cricket.extras.ran']}: 1`);
    expect(heading()).toBe(en['scoring.cricket.wicket.incoming']);
    aSecondOn(app);
    act(() => fireEvent.click(choices()[0]!));
    await flush(400);
    expect(await lastPayload(app)).toMatchObject({
      runs: { bat: 1 },
      wicket: { kind: 'runout', bowlerCredited: false },
    });
    expect(await lastPayload(app)).not.toHaveProperty('wicket.fielderAssist');
    expect(runs()).toBe('6/1');
  });
});

/** The first over finished from the console: three dots after `LIVE_EVENTS`' three balls, none of this phone's. */
const consoleDot = (ballInOver: number) => ({
  type: 'cricket.ball',
  payload: {
    over: 0,
    ballInOver,
    striker: playerOf(HOME_ENTRANT, 2),
    nonStriker: playerOf(HOME_ENTRANT, 1),
    bowler: playerOf(AWAY_ENTRANT, 11),
    runs: { bat: 0 },
  },
});
const OVER_BY_CONSOLE = [...LIVE_EVENTS, consoleDot(4), consoleDot(5), consoleDot(6)];

describe('the next bowler, a mid-over change, a strike swap (plan Task 13)', () => {
  const idOf = (name: string) =>
    [...LIVE.sides.home.members, ...LIVE.sides.away.members].find((one) => one.fullName === name)
      ?.personId;
  const heading = () => within(screen.getByTestId('step-sheet')).getByRole('heading').textContent;
  const row = (name: string) =>
    within(screen.getByTestId('step-sheet')).getByRole('button', { name: new RegExp(name) });
  const overOut = async (app: LaunchedApp) => {
    for (let i = 0; i < 3; i += 1) await press(app, en['scoring.cricket.ball.dot']);
  };
  const over2 = en['scoring.cricket.bowling.title'].replace('{number}', '2').toUpperCase();

  it('an over’s end stands the next-bowler sheet: the last over’s bowler greyed with why, no Cancel', async () => {
    const app = await scanned();
    await overOut(app);
    expect(heading()?.toUpperCase()).toBe(over2);
    const murphy = row('W. Murphy');
    expect(murphy.getAttribute('aria-disabled')).toBe('true');
    expect(within(murphy).getByText(en['scoring.cricket.bowling.lastOver'])).toBeTruthy();
    expect(
      within(screen.getByTestId('step-sheet')).queryByRole('button', {
        name: en['scoring.sheet.cancel'],
      }),
    ).toBeNull();
    // The keys are under the sheet: hidden from a screen reader, and disabled.
    const one = screen.getByLabelText('1 run');
    expect(one.getAttribute('aria-disabled')).toBe('true');
  });

  it('a bowler picked is held, recording nothing, and the over’s first ball names them', async () => {
    const app = await scanned();
    await overOut(app);
    const before = await count(app);
    await press(app, /V\. Kaur/);
    expect(sheet()).toBeNull();
    expect(await count(app)).toBe(before);
    expect(screen.getByTestId('board-crease').textContent).toContain('V. Kaur');
    await press(app, '1 run');
    expect(await lastPayload(app)).toMatchObject({
      over: 1,
      ballInOver: 1,
      bowler: idOf('V. Kaur'),
    });
  });

  it('Undo on the sheet takes the over’s last ball back, and the sheet goes', async () => {
    const app = await scanned();
    await overOut(app);
    await press(app, en['scoring.pad.undo']);
    expect(sheet()).toBeNull();
    expect((await ledger(app)).at(-1)?.type).toBe('core.void');
    expect(screen.getByTestId('board-overs').textContent).toContain('0.5');
  });

  // Batch 4 review C1 (the controller's ruling): the standing sheet's dim covers the board, the top bar and the keys, so a
  // touch on it, a double tap's second touch or a reach for Home, must not take the over's last ball back.
  it('a tap on the standing sheet’s dim records nothing, and the sheet stays', async () => {
    const app = await scanned();
    await overOut(app);
    const before = await count(app);
    aSecondOn(app);
    act(() => fireEvent.click(screen.getByTestId('step-dim')));
    await flush(400);
    expect(await count(app)).toBe(before);
    expect((await ledger(app)).at(-1)?.type).toBe('cricket.ball');
    expect(heading()?.toUpperCase()).toBe(over2);
  });

  it('a double tap on the over’s last run key, its second touch on the dim, records one ball and no void', async () => {
    const app = await scanned();
    await press(app, en['scoring.cricket.ball.dot']);
    await press(app, en['scoring.cricket.ball.dot']);
    const before = await count(app);
    aSecondOn(app);
    act(() => fireEvent.click(key(en['scoring.cricket.ball.dot'])));
    await flush(50);
    expect(heading()?.toUpperCase()).toBe(over2);
    act(() => fireEvent.click(screen.getByTestId('step-dim')));
    await flush(400);
    expect((await ledger(app)).slice(before).map((one) => one.type)).toEqual(['cricket.ball']);
    expect(heading()?.toUpperCase()).toBe(over2);
  });

  // The sheet-appearing window (`useJustShown`, as every other sheet's close): Undo is a button under the thumb that just
  // lifted off the run key, so it takes nothing for 250 ms of the sheet showing, and works after.
  it('Undo on the standing sheet in the moment the sheet appears records nothing; a second on, it takes the ball back', async () => {
    const app = await scanned();
    await press(app, en['scoring.cricket.ball.dot']);
    await press(app, en['scoring.cricket.ball.dot']);
    const before = await count(app);
    aSecondOn(app);
    act(() => fireEvent.click(key(en['scoring.cricket.ball.dot'])));
    await flush(50);
    act(() => fireEvent.click(key(en['scoring.pad.undo'])));
    await flush(400);
    expect((await ledger(app)).slice(before).map((one) => one.type)).toEqual(['cricket.ball']);
    await press(app, en['scoring.pad.undo']);
    expect((await ledger(app)).slice(before).map((one) => one.type)).toEqual([
      'cricket.ball',
      'core.void',
    ]);
    expect(sheet()).toBeNull();
  });

  // Back is the only way off the screen at an over's end with the dim and the top bar covered; it leaves to Home, writes
  // nothing, and the sheet stands again on return, since it is drawn from the display (the controller's ruling).
  it('Back on the standing sheet leaves to Home and records nothing; on return the sheet stands again', async () => {
    const app = await scanned();
    await overOut(app);
    const before = await count(app);
    let handled = false;
    act(() => {
      handled = app.back.press();
    });
    await flush(400);
    expect(handled).toBe(true);
    expect(app.nav.current()).toBe('home');
    expect(await count(app)).toBe(before);
    aSecondOn(app);
    act(() => app.ports.navigation.go('scoring'));
    await flush(400);
    expect(app.nav.current()).toBe('scoring');
    expect(heading()?.toUpperCase()).toBe(over2);
    expect(await count(app)).toBe(before);
  });

  // Batch 4 review I3: an over's end is the usual moment to declare, stop for rain, close for time or retire a batter, and
  // the sheet disables every key under it; More and Players are on the sheet, with no bowler picked.
  it('More on the standing sheet opens More without a bowler picked; Cancel brings the sheet back', async () => {
    const app = await scanned();
    await overOut(app);
    const before = await count(app);
    await press(app, en['scoring.cricket.key.more']);
    expect(heading()).toBe(en['scoring.cricket.key.more']);
    const rows = within(screen.getByTestId('step-sheet'))
      .getAllByRole('button')
      .map((one) => one.textContent);
    expect(rows).toContain(en['scoring.cricket.more.retire']);
    expect(rows).not.toContain(en['scoring.cricket.more.otherRuns']);
    await press(app, en['scoring.sheet.cancel']);
    expect(heading()?.toUpperCase()).toBe(over2);
    expect(await count(app)).toBe(before);
  });

  it('Declare at an over’s end is reachable with no bowler picked: More, Declare, its confirm', async () => {
    const twoInnings = liveCricketSeed({
      cfg: {
        inningsPerSide: 2,
        ballsPerInnings: null,
        followOn: { enabled: true, lead: 200 },
        minOversForResult: 0,
      },
      events: OVER_BY_CONSOLE,
    });
    const app = await scanned(twoInnings);
    expect(heading()?.toUpperCase()).toBe(over2);
    await press(app, en['scoring.cricket.key.more']);
    await press(app, en['scoring.cricket.more.declare']);
    expect(heading()).toBe(en['scoring.cricket.confirm.declare.title']);
    await press(app, en['scoring.cricket.confirm.declare.do']);
    expect((await ledger(app, twoInnings)).at(-1)?.type).toBe('cricket.innings.declare');
  });

  it('Players on the standing sheet opens Players; closing it brings the sheet back, nothing recorded', async () => {
    const app = await scanned();
    await overOut(app);
    const before = await count(app);
    await press(app, en['scoring.cricket.players.title']);
    expect(screen.getByTestId('players-sheet')).toBeTruthy();
    expect(sheet()).toBeNull();
    await press(app, en['panel.close']);
    expect(screen.queryByTestId('players-sheet')).toBeNull();
    expect(heading()?.toUpperCase()).toBe(over2);
    expect(await count(app)).toBe(before);
  });

  // The thumb that lifted off the over's last run key lands where the sheet's buttons now are: More and Players take
  // nothing for the 250 ms of the sheet appearing (`useJustShown`), as every other sheet's buttons.
  it('More and Players in the moment the standing sheet appears open nothing; a second on they do', async () => {
    const app = await scanned();
    await press(app, en['scoring.cricket.ball.dot']);
    await press(app, en['scoring.cricket.ball.dot']);
    aSecondOn(app);
    act(() => fireEvent.click(key(en['scoring.cricket.ball.dot'])));
    await flush(50);
    act(() => fireEvent.click(key(en['scoring.cricket.key.more'])));
    act(() => fireEvent.click(key(en['scoring.cricket.players.title'])));
    await flush(400);
    expect(heading()?.toUpperCase()).toBe(over2);
    expect(screen.queryByTestId('players-sheet')).toBeNull();
    await press(app, en['scoring.cricket.key.more']);
    expect(heading()).toBe(en['scoring.cricket.key.more']);
  });

  it('More, Change bowler (injury), a bowler, why: cricket.bowler.change; both are greyed for the next over', async () => {
    const app = await scanned();
    await press(app, en['scoring.cricket.key.more']);
    expect(heading()).toBe(en['scoring.cricket.key.more']);
    await press(app, en['scoring.cricket.more.change']);
    expect(heading()).toBe(en['scoring.cricket.change.title']);
    expect(
      within(screen.getByTestId('step-sheet')).queryByRole('button', { name: /W\. Murphy/ }),
    ).toBeNull();
    await press(app, /V\. Kaur/);
    expect(heading()).toBe(en['scoring.cricket.change.why']);
    await press(app, en['scoring.cricket.change.reason.incapacitated']);
    expect(sheet()).toBeNull();
    const change = (await ledger(app)).at(-1);
    expect([change?.type, change?.payload]).toEqual([
      'cricket.bowler.change',
      { bowler: idOf('V. Kaur'), reason: 'incapacitated' },
    ]);
    await overOut(app);
    for (const name of ['W. Murphy', 'V. Kaur']) {
      expect(within(row(name)).getByText(en['scoring.cricket.bowling.lastOver'])).toBeTruthy();
    }
  });

  it('an over the console finished has no way back on the sheet: nothing of this phone’s to undo', async () => {
    await scanned(liveCricketSeed({ events: OVER_BY_CONSOLE }));
    expect(heading()?.toUpperCase()).toBe(over2);
    const words = within(screen.getByTestId('step-sheet'))
      .getAllByRole('button')
      .map((one) => one.textContent);
    expect(words).not.toContain(en['scoring.pad.undo']);
    expect(words).not.toContain(en['scoring.sheet.cancel']);
  });

  it('in a super over More is greyed: no change, no swap (ruling 84)', async () => {
    const home = (n: number) => playerOf(HOME_ENTRANT, n);
    const away = (n: number) => playerOf(AWAY_ENTRANT, n);
    const dots = (
      type: string,
      bat: (n: number) => string,
      bowlers: readonly string[],
      overs: number,
    ) =>
      Array.from({ length: overs * 6 }, (_, i) => {
        const over = Math.floor(i / 6);
        const [striker, nonStriker] = over % 2 === 0 ? [bat(1), bat(2)] : [bat(2), bat(1)];
        return {
          type,
          payload: {
            over,
            ballInOver: (i % 6) + 1,
            striker,
            nonStriker,
            bowler: bowlers[over],
            runs: { bat: 0 },
          },
        };
      });
    const events = [
      ...LIVE_EVENTS.slice(0, 2),
      ...dots('cricket.ball', home, [away(11), away(10)], 2),
      ...dots('cricket.ball', away, [home(11), home(10)], 2),
      ...dots('cricket.superover.ball', away, [home(11)], 1).slice(0, 1),
    ];
    await scanned(liveCricketSeed({ events }));
    expect(screen.getByTestId('board-innings').textContent).toMatch(/super/i);
    expect(key(en['scoring.cricket.key.more']).getAttribute('aria-disabled')).toBe('true');
  });

  it('Swap strike records nothing; the next ball names the pair reversed', async () => {
    const app = await scanned();
    const before = await count(app);
    await press(app, en['scoring.cricket.key.more']);
    await press(app, en['scoring.cricket.more.swap']);
    expect(sheet()).toBeNull();
    expect(await count(app)).toBe(before);
    await press(app, en['scoring.cricket.ball.dot']);
    expect(await lastPayload(app)).toMatchObject({
      striker: idOf('A. Sharma'),
      nonStriker: idOf('B. Okafor'),
    });
  });
});
