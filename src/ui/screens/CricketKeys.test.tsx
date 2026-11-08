import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { liveCricketSeed } from '@/services/fakeCricketPad';
import type { FakeMatchSeed } from '@/services/fakeScoringPort';
import { layout } from '@/ui/theme/tokens';
import { FAKE_SCORING_SECRET } from '../../../test/fakeScoringLinkPort';
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

  it('a no-ball says Free hit on the status line, and the next fair ball takes it away', async () => {
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
