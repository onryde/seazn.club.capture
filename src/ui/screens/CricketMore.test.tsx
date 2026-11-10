import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { LIVE_EVENTS, liveCricketSeed } from '@/services/fakeCricketPad';
import type { FakeMatchSeed } from '@/services/fakeScoringPort';
import { FAKE_SCORING_SECRET } from '../../../test/fakeScoringLinkPort';
import { TEST_NOW } from '../../../test/fakePorts';
import { flush, launchApp, type LaunchedApp } from '../../../test/routedApp';
import { RAW } from '../../../test/scoringHomeFixtures';

beforeEach(() => {
  seconds = 0;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

// More (S2-4 spec §4.8, amended by preflight F20; ruling 79; plan Task 15), from the scan, on the fake server with the
// real runner, queue, sender and fold under it (the real engine judges every event). The rows each format offers are the
// domain's tests (`cricketMore.test.ts`); here, what the scorer does and what the ledger then holds. Whether the number
// pad leaves the typed fields in sight is the device check's (Task 19).

const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const LIVE = liveCricketSeed();

let seconds = 0;
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

async function ledger(app: LaunchedApp) {
  const events = await app.scoring.events(LINK, LIVE.fixtureId, 0);
  return Array.isArray(events) ? events : [];
}

const last = async (app: LaunchedApp) => {
  const event = (await ledger(app)).at(-1);
  return [event?.type, event?.payload];
};
const count = async (app: LaunchedApp) => (await ledger(app)).length;

async function press(app: LaunchedApp, name: string | RegExp) {
  aSecondOn(app);
  act(() => fireEvent.click(screen.getByRole('button', { name })));
  await flush(400);
}

const idOf = (name: string) =>
  [...LIVE.sides.home.members, ...LIVE.sides.away.members].find((one) => one.fullName === name)
    ?.personId;
const stepSheet = () => screen.queryByTestId('step-sheet');
const entrySheet = () => screen.queryByTestId('entry-sheet');
const heading = (testId: string) =>
  within(screen.getByTestId(testId)).getByRole('heading').textContent;
const fill = (text: string, vars: Readonly<Record<string, string | number>>) =>
  Object.entries(vars).reduce(
    (out, [name, value]) => out.replace(`{${name}}`, String(value)),
    text,
  );
const record = () =>
  within(screen.getByTestId('entry-sheet')).getByRole('button', {
    name: en['scoring.cricket.entry.record'],
  });

async function openMore(app: LaunchedApp) {
  await press(app, en['scoring.cricket.key.more']);
  expect(heading('step-sheet')).toBe(en['scoring.cricket.key.more']);
}

describe('More’s rows', () => {
  it('a one-innings knockout mid-over: Other runs first, the rows the engine takes now, no Declare and no draw', async () => {
    const app = await scanned();
    await openMore(app);
    const rows = within(screen.getByTestId('step-sheet'))
      .getAllByRole('button')
      .map((one) => one.textContent);
    expect(rows).toEqual([
      en['scoring.cricket.more.otherRuns'],
      en['scoring.cricket.more.swap'],
      en['scoring.cricket.more.change'],
      en['scoring.cricket.more.retire'],
      en['scoring.cricket.more.review'],
      en['scoring.cricket.more.newBall'],
      en['scoring.cricket.more.powerplay'],
      en['scoring.cricket.more.interruption'],
      en['scoring.cricket.more.revise'],
      en['scoring.cricket.more.close'],
      en['scoring.sheet.cancel'],
    ]);
  });

  it('the setup screen has no More (F20): before Start there is no More key', async () => {
    await scanned(liveCricketSeed({ events: LIVE_EVENTS.slice(0, 1) }));
    expect(screen.queryByRole('button', { name: en['scoring.cricket.key.more'] })).toBeNull();
  });
});

describe('Other runs and penalty (ruling 79)', () => {
  it('5 runs records five off the bat; 4 all run records four with no boundary', async () => {
    const app = await scanned();
    await openMore(app);
    await press(app, en['scoring.cricket.more.otherRuns']);
    expect(heading('step-sheet')).toBe(en['scoring.cricket.other.title']);
    await press(app, fill(en['scoring.cricket.ball.runs.other'], { count: 5 }));
    expect(stepSheet()).toBeNull();
    const [, five] = await last(app);
    expect(five).toMatchObject({ runs: { bat: 5 } });
    expect(five).not.toHaveProperty('boundary');
    await openMore(app);
    await press(app, en['scoring.cricket.more.otherRuns']);
    await press(app, fill(en['scoring.cricket.other.ran'], { runs: 4 }));
    const [, ran] = await last(app);
    expect(ran).toMatchObject({ runs: { bat: 4 } });
    expect(ran).not.toHaveProperty('boundary');
    expect(screen.getByTestId('board-runs').textContent).toBe('14/0');
  });

  it('+5 penalty, then 1 off the bat: a fair ball with five penalty runs, the over a ball on', async () => {
    const app = await scanned();
    await openMore(app);
    await press(app, en['scoring.cricket.more.otherRuns']);
    await press(app, fill(en['scoring.cricket.other.penalty'], { runs: 5 }));
    expect(heading('step-sheet')).toBe(fill(en['scoring.cricket.other.penalty'], { runs: 5 }));
    await press(app, `${en['scoring.cricket.extras.bat']}: 1`);
    const [type, payload] = await last(app);
    expect(type).toBe('cricket.ball');
    expect(payload).toMatchObject({
      ballInOver: 4,
      runs: { bat: 1, extras: { kind: 'penalty', runs: 5 } },
    });
    expect(screen.getByTestId('board-runs').textContent).toBe('11/0');
    expect(screen.getByTestId('board-overs').textContent).toContain('0.4');
  });
});

describe('the rows’ steps', () => {
  it('Retire, the striker, Retired hurt, the next batter suggested: cricket.retire with the incoming', async () => {
    const app = await scanned();
    await openMore(app);
    await press(app, en['scoring.cricket.more.retire']);
    expect(heading('step-sheet')).toBe(en['scoring.cricket.retire.who']);
    await press(app, /B\. Okafor/);
    await press(app, en['scoring.cricket.retire.reason.hurt']);
    expect(heading('step-sheet')).toBe(en['scoring.cricket.wicket.incoming']);
    await press(app, /C\. Mendes/);
    expect(stepSheet()).toBeNull();
    expect(await last(app)).toEqual([
      'cricket.retire',
      { person: idOf('B. Okafor'), reason: 'hurt', incoming: idOf('C. Mendes') },
    ]);
    expect(screen.getByTestId('board-crease').textContent).toContain('C. Mendes');
  });

  it('Rain or bad light, Rain, Record with the overs lost left empty: cricket.interruption {kind}', async () => {
    const app = await scanned();
    await openMore(app);
    await press(app, en['scoring.cricket.more.interruption']);
    await press(app, en['scoring.cricket.interruption.kind.rain']);
    expect(stepSheet()).toBeNull();
    expect(heading('entry-sheet')).toBe(en['scoring.cricket.interruption.lostTitle']);
    await press(app, en['scoring.cricket.entry.record']);
    expect(entrySheet()).toBeNull();
    expect(await last(app)).toEqual(['cricket.interruption', { kind: 'rain' }]);
  });

  it('Revised overs or target: the overs as they stand, Record greyed until a target is typed; the target alone sent', async () => {
    const app = await scanned();
    await openMore(app);
    await press(app, en['scoring.cricket.more.revise']);
    const sheet = within(screen.getByTestId('entry-sheet'));
    const overs = sheet.getByLabelText(en['scoring.cricket.revise.overs']) as HTMLInputElement;
    expect(overs.value).toBe('2');
    expect(record().getAttribute('aria-disabled')).toBe('true');
    const before = await count(app);
    await press(app, en['scoring.cricket.entry.record']);
    expect(await count(app)).toBe(before);
    const target = sheet.getByLabelText(en['scoring.cricket.revise.target']);
    act(() => fireEvent.change(target, { target: { value: '41' } }));
    expect(record().getAttribute('aria-disabled')).not.toBe('true');
    await press(app, en['scoring.cricket.entry.record']);
    expect(entrySheet()).toBeNull();
    expect(await last(app)).toEqual(['cricket.revise', { target: 41 }]);
  });

  it('after an interruption: Undo takes a retirement back, and the batter is in again', async () => {
    const app = await scanned();
    await openMore(app);
    await press(app, en['scoring.cricket.more.retire']);
    await press(app, /B\. Okafor/);
    await press(app, en['scoring.cricket.retire.reason.hurt']);
    await press(app, /C\. Mendes/);
    expect(screen.getByTestId('board-crease').textContent).toContain('C. Mendes');
    await press(app, en['scoring.pad.undo']);
    expect((await ledger(app)).at(-1)?.type).toBe('core.void');
    expect(screen.getByTestId('board-crease').textContent).toContain('B. Okafor');
    expect(screen.getByTestId('board-crease').textContent).not.toContain('C. Mendes');
  });

  it('after an interruption: a row recorded offline shows at once and reaches the ledger once the phone is back', async () => {
    const app = await scanned();
    const before = await count(app);
    app.scoring.goOffline(true);
    await openMore(app);
    await press(app, en['scoring.cricket.more.otherRuns']);
    await press(app, fill(en['scoring.cricket.other.penalty'], { runs: 5 }));
    await press(app, `${en['scoring.cricket.extras.bat']}: 2`);
    expect(screen.getByTestId('board-runs').textContent).toBe('12/0');
    app.scoring.goOffline(false);
    app.setNow(new Date(TEST_NOW.getTime() + (seconds + 30) * 1000));
    await flush(30_000);
    expect((await count(app)) - before).toBe(1);
    expect(await last(app)).toMatchObject([
      'cricket.ball',
      { runs: { bat: 2, extras: { kind: 'penalty', runs: 5 } } },
    ]);
  });

  it('a double tap on Record records once', async () => {
    const app = await scanned();
    await openMore(app);
    await press(app, en['scoring.cricket.more.interruption']);
    await press(app, en['scoring.cricket.interruption.kind.light']);
    const before = await count(app);
    aSecondOn(app);
    act(() => {
      const button = record();
      fireEvent.click(button);
      fireEvent.click(button);
    });
    await flush(400);
    expect((await count(app)) - before).toBe(1);
  });

  it('Cancel and Back close the typed numbers with nothing recorded', async () => {
    const app = await scanned();
    const before = await count(app);
    await openMore(app);
    await press(app, en['scoring.cricket.more.revise']);
    await press(app, en['scoring.sheet.cancel']);
    expect(entrySheet()).toBeNull();
    await openMore(app);
    await press(app, en['scoring.cricket.more.revise']);
    let handled = false;
    act(() => {
      handled = app.back.press();
    });
    expect(handled).toBe(true);
    expect(entrySheet()).toBeNull();
    expect(await count(app)).toBe(before);
  });

  it('a choice on the heels of the entry sheet appearing is ignored (the second touch of the tap that opened it)', async () => {
    const app = await scanned();
    await openMore(app);
    await press(app, en['scoring.cricket.more.interruption']);
    aSecondOn(app);
    const before = await count(app);
    act(() =>
      fireEvent.click(
        screen.getByRole('button', { name: en['scoring.cricket.interruption.kind.other'] }),
      ),
    );
    act(() => fireEvent.click(record()));
    await flush(400);
    expect(entrySheet()).not.toBeNull();
    expect(await count(app)).toBe(before);
  });
});
