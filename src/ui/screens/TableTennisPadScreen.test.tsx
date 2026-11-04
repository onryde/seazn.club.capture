import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSavedCode } from '@/domain/mode/savedCode';
import { tableTennisCfg } from '@/domain/scoring/tableTennisEngine';
import en from '@/i18n/en.json';
import type { FakeMatchSeed } from '@/services/fakeScoringPort';
import {
  AWAY_ENTRANT,
  HOME_ENTRANT,
  TABLE_TENNIS_DOUBLES_SEED,
  TABLE_TENNIS_SINGLES_SEED,
  TABLE_TENNIS_UNANCHORED_SEED,
  tableTennisSeed,
} from '@/services/fakeTableTennisPad';
import { STORE_KEYS } from '@/services/modeStore';
import { TEST_NOW } from '../../../test/fakePorts';
import { linkKey } from '../../../test/scoringHomeFixtures';
import { screenIsHeld, type HoldLog } from '../../../test/heldScreen';
import { flush, launchApp, type LaunchedApp } from '../../../test/routedApp';

const holds = vi.hoisted((): HoldLog => []);
vi.mock('@/hooks/keepAwake', async () => {
  const { recordingHold } = await import('../../../test/heldScreen');
  return { holdScreenOn: recordingHold(holds) };
});

beforeEach(() => {
  seconds = 0;
  vi.useFakeTimers();
  holds.length = 0;
});
afterEach(() => vi.useRealTimers());

// Plan S2-2 Task 8: table tennis's pad screen, the sheets over it (design §5), on the fake server with the real runner,
// queue, sender and fold under it. Each test reads what the scorer sees. What jsdom cannot see (the sheets' colours, a
// press's feedback, a screen reader reading them, the number pad over the Set score fields) is the device check's.

const LINK = { origin: 'https://stg.seazn.club', token: 'dl_madeUpTokenForTableTennis01' };

/** A phone that scanned `seed`'s match earlier: the code saved, the link kept with the sport the bootstrap named. */
function inMatch(seed: FakeMatchSeed): Record<string, string> {
  return {
    [STORE_KEYS.active]: 'scoring',
    [STORE_KEYS.code('scoring')]: encodeSavedCode({
      mode: 'scoring',
      raw: '',
      slot: null,
      savedAt: TEST_NOW,
      expiresAt: null,
      stream: null,
      scoring: { fixtureId: seed.fixtureId, label: 'Match 4' },
    }),
    [linkKey(seed.fixtureId)]: JSON.stringify({ ...LINK, sportKey: 'tabletennis' }),
  };
}

let seconds = 0;
/** The phone's clock a second on: the next tap is never in the bounce window of the last. */
const aSecondOn = (app: LaunchedApp) => {
  seconds += 1;
  app.setNow(new Date(TEST_NOW.getTime() + seconds * 1000));
};
const half = (side: 'first' | 'second') => screen.getByTestId(`half-${side}`);
const score = (side: 'first' | 'second') => within(half(side)).getByTestId('score').textContent;
const lastTap = () => screen.getByTestId('last-tap-sentence').textContent;
const fill = (text: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce(
    (out, [name, value]) => out.replace(`{${name}}`, String(value)),
    text,
  );
const buttons = (within_: HTMLElement) =>
  within(within_)
    .getAllByRole('button')
    .map((button) => button.textContent);
const tools = () =>
  within(screen.getByTestId('tool-row'))
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label'));

/** A button pressed a second after the last thing the scorer did, and the time its sheet needs before it takes a choice. */
async function press(app: LaunchedApp, name: string): Promise<void> {
  aSecondOn(app);
  act(() => fireEvent.click(screen.getByRole('button', { name })));
  await flush(400);
}

async function rally(app: LaunchedApp, side: 'first' | 'second', times = 1): Promise<void> {
  for (let at = 0; at < times; at += 1) {
    aSecondOn(app);
    act(() => fireEvent.click(half(side)));
    await flush(0);
  }
}

const events = async (app: LaunchedApp, seed: FakeMatchSeed) => {
  const ledger = await app.scoring.events(LINK, seed.fixtureId, 0);
  return Array.isArray(ledger) ? ledger : [];
};

/** The match opened as the phone finds it, a minute before the test's taps. */
async function open(seed: FakeMatchSeed, over: Parameters<typeof launchApp>[0] = {}) {
  const app = await launchApp({ scoringSeed: seed, kvSeed: inMatch(seed), ...over });
  await flush(200);
  app.setNow(new Date(TEST_NOW.getTime() - 60_000));
  return app;
}

/** The match started by this phone, the first side serving, and the clock back at the test's own. */
async function started(seed: FakeMatchSeed = TABLE_TENNIS_SINGLES_SEED) {
  const app = await open(seed);
  act(() => fireEvent.click(screen.getByRole('radio', { name: seed.sides.home.name })));
  act(() => fireEvent.click(screen.getByRole('button', { name: en['scoring.start.confirm'] })));
  app.setNow(TEST_NOW);
  await flush(200);
  return app;
}

describe('Card', () => {
  it('a singles side’s card is one step: the level, recorded for the side’s one player, and the sheet leaves with it', async () => {
    const app = await started();
    await press(app, `${en['scoring.tabletennis.tool.card']}, L. Chen`);
    // The level step names the side as the body and offers the two cards the engine lists, nothing else.
    const sheet = screen.getByTestId('step-sheet');
    expect(buttons(sheet)).toEqual([
      en['scoring.tabletennis.card.warning'],
      en['scoring.tabletennis.card.penalty'],
      en['scoring.sheet.cancel'],
    ]);
    expect(within(sheet).getByText('L. Chen')).toBeTruthy();
    await press(app, en['scoring.tabletennis.card.warning']);
    expect(screen.queryByTestId('step-sheet')).toBeNull();
    expect(lastTap()).toBe(
      fill(en['scoring.tabletennis.last.sanction'], {
        level: en['scoring.tabletennis.card.warning'],
        person: 'L. Chen',
      }),
    );
    expect((await events(app, TABLE_TENNIS_SINGLES_SEED)).at(-1)).toMatchObject({
      type: 'tabletennis.sanction',
      payload: { by: AWAY_ENTRANT, level: 'warning' },
    });
  });

  it('a pair is asked which player, after the level, and the card names that player', async () => {
    const app = await started(TABLE_TENNIS_DOUBLES_SEED);
    await press(app, `${en['scoring.tabletennis.tool.card']}, A. Sharma / R. Iyer`);
    await press(app, en['scoring.tabletennis.card.penalty']);
    const sheet = screen.getByTestId('step-sheet');
    expect(within(sheet).getByText(en['scoring.sanction.who'])).toBeTruthy();
    expect(within(sheet).getByText(en['scoring.tabletennis.card.penalty'])).toBeTruthy();
    expect(buttons(sheet)).toEqual(['A. Sharma', 'R. Iyer', en['scoring.sheet.cancel']]);
    await press(app, 'R. Iyer');
    expect(lastTap()).toBe(
      fill(en['scoring.tabletennis.last.sanction'], {
        level: en['scoring.tabletennis.card.penalty'],
        person: 'R. Iyer',
      }),
    );
    // A red card is recorded as it is: no ending prompt, however the card is read (table tennis has no sanction ending).
    expect(screen.queryByTestId('ending-prompt')).toBeNull();
    expect(screen.getByTestId('half-first')).toBeTruthy();
  });

  it('Cancel closes the sheet and records nothing', async () => {
    const app = await started();
    await press(app, `${en['scoring.tabletennis.tool.card']}, A. Sharma`);
    await press(app, en['scoring.sheet.cancel']);
    expect(screen.queryByTestId('step-sheet')).toBeNull();
    expect((await events(app, TABLE_TENNIS_SINGLES_SEED)).map((event) => event.type)).toEqual([
      'core.start',
    ]);
  });
});

describe('Who is serving? (ruling 51)', () => {
  it('is in the row of a match another scorer started without a server, and Card, Card, Who is serving?, More are four cells', async () => {
    await open(TABLE_TENNIS_UNANCHORED_SEED);
    expect(tools()).toEqual([
      `${en['scoring.tabletennis.tool.card']}, A. Sharma`,
      `${en['scoring.tabletennis.tool.card']}, L. Chen`,
      en['scoring.tabletennis.tool.serving'],
      en['scoring.tabletennis.tool.more'],
    ]);
    // The engine names no server, so no plate shows on either half.
    expect(within(half('first')).queryByTestId('serving')).toBeNull();
    expect(within(half('second')).queryByTestId('serving')).toBeNull();
  });

  it('asks with the two sides as typed; the answer is held, said on the line, and the next point carries it', async () => {
    const seed = TABLE_TENNIS_UNANCHORED_SEED;
    const app = await open(seed);
    app.setNow(TEST_NOW);
    await press(app, en['scoring.tabletennis.tool.serving']);
    const sheet = screen.getByTestId('step-sheet');
    expect(within(sheet).getByText(en['scoring.tabletennis.tool.serving'])).toBeTruthy();
    expect(buttons(sheet)).toEqual(['A. Sharma', 'L. Chen', en['scoring.sheet.cancel']]);
    await press(app, 'L. Chen');
    expect(screen.queryByTestId('step-sheet')).toBeNull();
    expect(lastTap()).toBe(fill(en['scoring.tabletennis.held'], { side: 'L. Chen' }));
    // Nothing is recorded by the answer itself.
    expect((await events(app, seed)).map((event) => event.type)).toEqual(['core.start']);

    await rally(app, 'first');
    await flush(400);
    expect((await events(app, seed)).at(-1)).toMatchObject({
      type: 'tabletennis.rally',
      payload: { wonBy: HOME_ENTRANT, serving: AWAY_ENTRANT },
    });
    // The anchor is in: the tool goes for the match, the plate names the server (L. Chen's second serve), the held line is gone.
    expect(tools()).not.toContain(en['scoring.tabletennis.tool.serving']);
    expect(within(half('second')).getByTestId('serving').textContent).toBe(
      en['scoring.tabletennis.serving.second'],
    );
    expect(lastTap()).not.toBe(fill(en['scoring.tabletennis.held'], { side: 'L. Chen' }));
  });

  it('Cancel holds nothing: the tool is still there and the next point carries no answer', async () => {
    const seed = TABLE_TENNIS_UNANCHORED_SEED;
    const app = await open(seed);
    app.setNow(TEST_NOW);
    await press(app, en['scoring.tabletennis.tool.serving']);
    await press(app, en['scoring.sheet.cancel']);
    expect(tools()).toContain(en['scoring.tabletennis.tool.serving']);
    await rally(app, 'first');
    await flush(400);
    const [, point] = await events(app, seed);
    expect((point?.payload as { serving?: string }).serving).toBeUndefined();
  });
});

describe('Set score', () => {
  const typed = (side: string, value: string) =>
    act(() =>
      fireEvent.change(screen.getByLabelText(fill(en['scoring.setScore.field'], { side })), {
        target: { value },
      }),
    );
  const confirm = () => screen.getByRole('button', { name: en['scoring.setScore.confirm'] });

  async function atSetScore(seed: FakeMatchSeed) {
    const app = await started(seed);
    await press(app, en['scoring.tabletennis.tool.more']);
    await press(app, en['scoring.tabletennis.more.setScore']);
    return app;
  }

  it('names the game it sets, and the fields start at the points now', async () => {
    await atSetScore(TABLE_TENNIS_SINGLES_SEED);
    expect(screen.getByText(fill(en['scoring.setScore.title'], { game: 1 }))).toBeTruthy();
    for (const side of ['A. Sharma', 'L. Chen'])
      expect(
        (screen.getByLabelText(fill(en['scoring.setScore.field'], { side })) as HTMLInputElement)
          .value,
      ).toBe('0');
  });

  it('holds the match’s bound: 31 for a game to 11, one more refused at the sheet, a score within it recorded', async () => {
    const app = await atSetScore(TABLE_TENNIS_SINGLES_SEED);
    typed('A. Sharma', '32');
    expect(confirm().getAttribute('aria-disabled')).toBe('true');
    typed('A. Sharma', '31');
    expect(confirm().getAttribute('aria-disabled')).not.toBe('true');
    typed('A. Sharma', '7');
    typed('L. Chen', '5');
    aSecondOn(app);
    act(() => fireEvent.click(confirm()));
    await flush(400);
    expect(screen.queryByTestId('score-sheet')).toBeNull();
    expect((await events(app, TABLE_TENNIS_SINGLES_SEED)).at(-1)).toMatchObject({
      type: 'tabletennis.game.summary',
      payload: { home: 7, away: 5, partial: true },
    });
    expect(lastTap()).toBe(fill(en['scoring.tabletennis.last.setScore'], { score: '7–5' }));
  });

  it('holds the hardbat variant’s bound: 41 for a game to 21, where 32 is allowed', async () => {
    const hardbat = tableTennisSeed('fake-tt-hardbat', [['A. Sharma'], ['L. Chen']], {
      cfg: tableTennisCfg({ setTo: 21, finalSetTo: 21 }),
    });
    await atSetScore(hardbat);
    typed('A. Sharma', '32');
    expect(confirm().getAttribute('aria-disabled')).not.toBe('true');
    typed('L. Chen', '42');
    expect(confirm().getAttribute('aria-disabled')).toBe('true');
    typed('L. Chen', '41');
    expect(confirm().getAttribute('aria-disabled')).not.toBe('true');
  });

  it('Cancel records nothing and leaves More closed', async () => {
    const app = await atSetScore(TABLE_TENNIS_SINGLES_SEED);
    await press(app, en['scoring.sheet.cancel']);
    expect(screen.queryByTestId('score-sheet')).toBeNull();
    expect(screen.queryByTestId('step-sheet')).toBeNull();
    expect((await events(app, TABLE_TENNIS_SINGLES_SEED)).map((event) => event.type)).toEqual([
      'core.start',
    ]);
  });
});

describe('the sheets cover the pad', () => {
  it('hides the pad from a screen reader while a sheet shows, and Back closes the sheet', async () => {
    const app = await started();
    expect(screen.getByTestId('pad-content').getAttribute('aria-hidden')).not.toBe('true');
    await press(app, en['scoring.tabletennis.tool.more']);
    expect(screen.getByTestId('pad-content').getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByTestId('step-sheet').getAttribute('aria-modal')).toBe('true');
    let handled = false;
    act(() => {
      handled = app.back.press();
    });
    expect(handled).toBe(true);
    expect(screen.queryByTestId('step-sheet')).toBeNull();
    expect(screen.getByTestId('pad-content').getAttribute('aria-hidden')).not.toBe('true');
  });

  it('Match details shows the match card with table tennis’s rules, from the match’s own config', async () => {
    const app = await started();
    await press(app, en['scoring.details.title']);
    const sheet = screen.getByTestId('details-sheet');
    for (const text of [
      fill(en['scoring.tabletennis.rules.bestOf'], { bestOf: 5 }),
      fill(en['scoring.tabletennis.rules.points.value'], { points: 11, winBy: 2 }),
      en['scoring.tabletennis.rules.expedite.value'],
      en['scoring.tabletennis.rules.timeouts.value'],
    ])
      expect(within(sheet).getByText(text)).toBeTruthy();
    expect(within(sheet).getByText('Spring Open 2026')).toBeTruthy();
    // Close is the way back, and the pad is whole again.
    await press(app, en['panel.close']);
    expect(screen.queryByTestId('details-sheet')).toBeNull();
    expect(screen.getByTestId('pad-content').getAttribute('aria-hidden')).not.toBe('true');
  });

  it('History lists the match’s taps in table tennis’s words, a card and a timeout among them', async () => {
    const app = await started();
    await rally(app, 'first');
    await press(app, `${en['scoring.tabletennis.tool.card']}, A. Sharma`);
    await press(app, en['scoring.tabletennis.card.warning']);
    await press(app, en['scoring.history.title']);
    const said = within(screen.getByTestId('history'))
      .getAllByTestId('history-said')
      .map((row) => row.textContent);
    expect(said).toContain(
      fill(en['scoring.tabletennis.last.sanction'], {
        level: en['scoring.tabletennis.card.warning'],
        person: 'A. Sharma',
      }),
    );
    expect(said).toContain(fill(en['scoring.tabletennis.last.rally'], { side: 'A. Sharma' }));
    // Close is the way back, and the pad is whole again.
    await press(app, en['panel.close']);
    expect(screen.queryByTestId('history')).toBeNull();
    expect(screen.getByTestId('pad-content').getAttribute('aria-hidden')).not.toBe('true');
  });
});

describe('the reconnect question', () => {
  it('stands over the pad when someone else scored while this phone was offline, and Send my taps answers it', async () => {
    const app = await started();
    app.scoring.goOffline(true);
    await rally(app, 'first', 2);
    app.scoring.addOtherScorerEvent('tabletennis.rally', { wonBy: AWAY_ENTRANT });
    app.scoring.goOffline(false);
    for (let waited = 0; screen.queryByTestId('ask-sheet') === null && waited < 40; waited += 1) {
      aSecondOn(app);
      await flush(1000);
    }
    expect(screen.getByTestId('ask-sheet')).toBeTruthy();
    expect(screen.getByTestId('pad-content').getAttribute('aria-hidden')).toBe('true');
    // Discard asks again before it deletes: Keep is the way back to the question.
    await press(app, en['scoring.ask.discard']);
    expect(screen.getByTestId('dismiss-confirm')).toBeTruthy();
    await press(app, en['scoring.ask.confirm.keep']);
    expect(screen.getByTestId('ask-sheet')).toBeTruthy();
    await press(app, en['scoring.ask.send']);
    expect(screen.queryByTestId('ask-sheet')).toBeNull();
  });

  it('Discard them, confirmed, deletes the taps: the pad shows the match as the web has it and the badge goes', async () => {
    const app = await started();
    app.scoring.goOffline(true);
    await rally(app, 'first', 2);
    app.scoring.addOtherScorerEvent('tabletennis.rally', { wonBy: AWAY_ENTRANT });
    app.scoring.goOffline(false);
    for (let waited = 0; screen.queryByTestId('ask-sheet') === null && waited < 40; waited += 1) {
      aSecondOn(app);
      await flush(1000);
    }
    await press(app, en['scoring.ask.discard']);
    await press(app, en['scoring.ask.confirm.discard']);
    expect(screen.queryByTestId('dismiss-confirm')).toBeNull();
    expect(screen.queryByTestId('ask-sheet')).toBeNull();
    await flush(30_000);
    expect([score('first'), score('second')]).toEqual(['0', '1']);
    expect(screen.queryByTestId('sync')).toBeNull();
  });
});

describe('keeping the screen on', () => {
  it('holds it while the pad stands, as every sport’s pad does', async () => {
    await started();
    expect(screenIsHeld(holds)).toBe(true);
  });
});
