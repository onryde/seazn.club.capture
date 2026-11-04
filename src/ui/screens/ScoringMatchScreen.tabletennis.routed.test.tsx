import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { TABLE_TENNIS_SINGLES_SEED } from '@/services/fakeTableTennisPad';
import { STORE_KEYS } from '@/services/modeStore';
import { colour } from '@/ui/theme/tokens';
import { TEST_NOW } from '../../../test/fakePorts';
import { fillOf, paintOf } from '../../../test/pressState';
import { RAW, linkKey } from '../../../test/scoringHomeFixtures';
import { screenIsHeld, type HoldLog } from '../../../test/heldScreen';
import { backgroundAndBack, flush, launchApp, type LaunchedApp } from '../../../test/routedApp';

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

// Plan S2-2 Task 8 (the controller's ruling 4): a table tennis link scanned from Home reaches table tennis's own pad
// through the route's table, on the fake server with the real runner, queue, sender and fold under it. Each test reads
// what the scorer sees. What jsdom cannot see (the plate's colour, the row's fit on a phone, a press's feedback) is the
// device check's.

const SEED = TABLE_TENNIS_SINGLES_SEED;
const DICTIONARIES = { en, es, fr, nl } as const;
type Words = typeof en;

const SAVED: SavedCode = {
  mode: 'scoring',
  raw: '',
  slot: null,
  savedAt: TEST_NOW,
  expiresAt: null,
  stream: null,
  scoring: { fixtureId: SEED.fixtureId, label: 'Match 4' },
};
/** A phone that scanned this match earlier: the code saved, the link kept with the sport the bootstrap named. */
const IN_MATCH = {
  [STORE_KEYS.active]: 'scoring',
  [STORE_KEYS.code('scoring')]: encodeSavedCode(SAVED),
  [linkKey(SEED.fixtureId)]: JSON.stringify({
    origin: 'https://stg.seazn.club',
    token: 'dl_madeUpTokenForTableTennis01',
    sportKey: 'tabletennis',
  }),
};

let seconds = 0;
/** The phone's clock a second on: the next tap is never in the bounce window of the last. */
const aSecondOn = (app: LaunchedApp) => {
  seconds += 1;
  app.setNow(new Date(TEST_NOW.getTime() + seconds * 1000));
};
const press = (name: string) => act(() => fireEvent.click(screen.getByRole('button', { name })));
const half = (side: 'first' | 'second') => screen.getByTestId(`half-${side}`);
const plate = (side: 'first' | 'second') =>
  within(half(side)).queryByTestId('serving')?.textContent ?? null;
const score = (side: 'first' | 'second') => within(half(side)).getByTestId('score').textContent;
const lastTap = () => screen.getByTestId('last-tap-sentence').textContent;
const stripNote = () => screen.getByTestId('strip-note').textContent;
/** How many stopwatches a half draws (owner ruling 56: Expedite is a clock on both halves, not a word in the strip). */
const clocks = (side: 'first' | 'second') =>
  within(half(side))
    .queryAllByTestId('glyph')
    .filter((glyph) => glyph.dataset.name === 'stopwatch').length;
const bothClocks = () => [clocks('first'), clocks('second')];
/** The fills of a half's cards, left to right. */
const cardFills = (side: 'first' | 'second') =>
  within(half(side))
    .queryAllByTestId('mark-card')
    .map((card) => paintOf(card).fill);
/** The names of the buttons in the tools row, left to right. */
const tools = () =>
  within(screen.getByTestId('tool-row'))
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label'));
/** What the cells draw, left to right: the label and the side beneath it. */
const drawn = () =>
  within(screen.getByTestId('tool-row'))
    .getAllByRole('button')
    .map((button) => button.textContent);
const sheet = () => screen.queryByTestId('step-sheet');
const fill = (text: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce(
    (out, [name, value]) => out.replace(`{${name}}`, String(value)),
    text,
  );

async function rally(app: LaunchedApp, side: 'first' | 'second', times = 1): Promise<void> {
  for (let at = 0; at < times; at += 1) {
    aSecondOn(app);
    act(() => fireEvent.click(half(side)));
    await flush(0);
  }
}

/** A tool pressed a second after the last tap, and the time its sheet needs before it takes a choice. */
async function tool(app: LaunchedApp, name: string): Promise<void> {
  aSecondOn(app);
  press(name);
  await flush(400);
}

/** A choice on the sheet open, a second on. */
async function choose(app: LaunchedApp, name: string): Promise<void> {
  aSecondOn(app);
  press(name);
  await flush(400);
}

/** The match scanned from Home, as the scorer scans it, and the Start screen it opens on. */
async function scanned(over: Parameters<typeof launchApp>[0] = {}): Promise<LaunchedApp> {
  const app = await launchApp({ scoringSeed: SEED, ...over });
  app.scanner.queue({ outcome: 'scanned', raw: RAW });
  act(() => screen.getByRole('button', { name: /Remote Scoring|Puntuación|Score|Scoren/ }).click());
  await flush(400);
  return app;
}

/** The match opened and started as the scorer starts it, L. Chen serving first, a minute before the test's taps. */
async function started(
  over: Parameters<typeof launchApp>[0] = {},
  words: Words = en,
): Promise<LaunchedApp> {
  const app = await launchApp({ scoringSeed: SEED, kvSeed: IN_MATCH, ...over });
  await flush(200);
  app.setNow(new Date(TEST_NOW.getTime() - 60_000));
  act(() => fireEvent.click(screen.getByRole('radio', { name: 'L. Chen' })));
  press(words['scoring.start.confirm']);
  app.setNow(TEST_NOW);
  await flush(200);
  return app;
}

describe('a table tennis match from the scan to the pad', () => {
  it('a scanned link opens the Start screen; a pick and Start open the pad with Serving · 1st on the picked side', async () => {
    const app = await scanned();
    expect(app.nav.current()).toBe('scoring');
    // Nothing is recorded before Start: the screen asks who serves first, and there is neither a half to tap nor a tool.
    expect(screen.getByTestId('start-screen')).toBeTruthy();
    expect(screen.getByText(en['scoring.tabletennis.start.ask'])).toBeTruthy();
    expect(screen.queryByTestId('half-first')).toBeNull();
    expect(screen.queryByTestId('tool-row')).toBeNull();
    // Start waits for a pick.
    expect(
      screen
        .getByRole('button', { name: en['scoring.start.confirm'] })
        .getAttribute('aria-disabled'),
    ).toBe('true');

    app.setNow(new Date(TEST_NOW.getTime() - 60_000));
    act(() => fireEvent.click(screen.getByRole('radio', { name: 'L. Chen' })));
    press(en['scoring.start.confirm']);
    app.setNow(TEST_NOW);
    await flush(200);

    expect(screen.queryByTestId('start-screen')).toBeNull();
    expect(lastTap()).toBe(fill(en['scoring.tabletennis.last.start'], { side: 'L. Chen' }));
    expect(plate('second')).toBe(en['scoring.tabletennis.serving.first']);
    expect(plate('first')).toBeNull();
    expect(screen.getByTestId('strip-game').textContent).toBe(
      fill(en['scoring.tabletennis.gameOf'], { game: 1, bestOf: 5 }),
    );
    expect([score('first'), score('second')]).toEqual(['0', '0']);
  });

  it('draws Set score, Expedite and More before the first point: no Card cell, no 13 returns, no Who is serving?', async () => {
    await started();
    expect(tools()).toEqual([
      en['scoring.tabletennis.tool.setScore'],
      en['scoring.tabletennis.tool.expediteSaid'],
      en['scoring.tabletennis.tool.more'],
    ]);
    expect(drawn()).toEqual([
      en['scoring.tabletennis.tool.setScore'],
      en['scoring.tabletennis.tool.expedite'],
      en['scoring.tabletennis.tool.more'],
    ]);
  });

  it('the first point takes Set score away, and the scan-to-Expedite path ends in the 13 returns cell', async () => {
    const app = await scanned();
    app.setNow(new Date(TEST_NOW.getTime() - 60_000));
    act(() => fireEvent.click(screen.getByRole('radio', { name: 'L. Chen' })));
    press(en['scoring.start.confirm']);
    app.setNow(TEST_NOW);
    await flush(200);
    expect(tools()).toContain(en['scoring.tabletennis.tool.setScore']);
    await rally(app, 'first');
    expect(tools()).toEqual([
      en['scoring.tabletennis.tool.expediteSaid'],
      en['scoring.tabletennis.tool.more'],
    ]);
    await tool(app, en['scoring.tabletennis.tool.expediteSaid']);
    expect(
      within(screen.getByTestId('step-sheet')).getByText(en['scoring.tabletennis.expedite.title']),
    ).toBeTruthy();
    await choose(app, en['scoring.tabletennis.expedite.start']);
    expect(sheet()).toBeNull();
    expect(stripNote()).toBe('');
    expect(bothClocks()).toEqual([1, 1]);
    expect(tools()).toEqual([
      `${fill(en['scoring.tabletennis.tool.returns'], { returns: 13 })}, L. Chen`,
      en['scoring.tabletennis.tool.more'],
    ]);
  });

  it('the plate follows the engine: the server keeps it for two points, then it goes to the other side', async () => {
    const app = await started();
    await rally(app, 'first');
    expect([score('first'), score('second')]).toEqual(['1', '0']);
    expect(plate('second')).toBe(en['scoring.tabletennis.serving.second']);
    await rally(app, 'first');
    expect(plate('first')).toBe(en['scoring.tabletennis.serving.first']);
    expect(plate('second')).toBeNull();
  });
});

describe('More', () => {
  it('Timeout records for the side chosen, closes the sheet, and the line says so', async () => {
    const app = await started();
    await tool(app, en['scoring.tabletennis.tool.more']);
    expect(
      within(screen.getByTestId('step-sheet')).getByText(en['scoring.tabletennis.tool.more']),
    ).toBeTruthy();
    const timeout = fill(en['scoring.tabletennis.more.timeout'], { side: 'A. Sharma' });
    const choices = within(screen.getByTestId('step-sheet'))
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(choices).toEqual([
      fill(en['scoring.tabletennis.more.card'], { side: 'A. Sharma' }),
      fill(en['scoring.tabletennis.more.card'], { side: 'L. Chen' }),
      timeout,
      fill(en['scoring.tabletennis.more.timeout'], { side: 'L. Chen' }),
      en['scoring.sheet.cancel'],
    ]);
    await choose(app, timeout);
    expect(sheet()).toBeNull();
    expect(lastTap()).toBe(fill(en['scoring.tabletennis.last.timeout'], { side: 'A. Sharma' }));
    const ledger = await app.scoring.events(
      { origin: 'https://stg.seazn.club', token: 'x' },
      SEED.fixtureId,
      0,
    );
    expect(Array.isArray(ledger) ? ledger.map((event) => event.type) : ledger).toEqual([
      'core.start',
      'tabletennis.timeout',
    ]);
  });

  it('a Card chosen in More opens the card steps in its place, and records for the side', async () => {
    const app = await started();
    await tool(app, en['scoring.tabletennis.tool.more']);
    await choose(app, fill(en['scoring.tabletennis.more.card'], { side: 'L. Chen' }));
    expect(
      within(screen.getByTestId('step-sheet')).getByText(en['scoring.tabletennis.sheet.card']),
    ).toBeTruthy();
    await choose(app, en['scoring.tabletennis.card.penalty']);
    expect(sheet()).toBeNull();
    expect(lastTap()).toBe(
      fill(en['scoring.tabletennis.last.sanction'], {
        level: en['scoring.tabletennis.card.penalty'],
        person: 'L. Chen',
      }),
    );
    // Owner ruling 56: the penalty is the yellow and the red card in L. Chen's corner, and A. Sharma's has none.
    expect(cardFills('second')).toEqual([fillOf(colour.cardCaution), fillOf(colour.cardDismissal)]);
    expect(cardFills('first')).toEqual([]);
  });
});

describe('Expedite', () => {
  it('both halves carry the clock, the strip says nothing of it, and 13 returns takes the cell’s place', async () => {
    const app = await started();
    await rally(app, 'first');
    expect(bothClocks()).toEqual([0, 0]);
    await tool(app, en['scoring.tabletennis.tool.expediteSaid']);
    // The cell asks first (ruling 55): nothing is recorded until Start.
    expect(bothClocks()).toEqual([0, 0]);
    await choose(app, en['scoring.tabletennis.expedite.start']);
    expect(sheet()).toBeNull();
    expect(bothClocks()).toEqual([1, 1]);
    expect(stripNote()).toBe('');
    expect(lastTap()).toBe(en['scoring.tabletennis.last.expedite']);
    const returns = fill(en['scoring.tabletennis.tool.returns'], { returns: 13 });
    expect(tools().filter((name) => name?.startsWith(returns))).toHaveLength(1);
    expect(tools()).not.toContain(en['scoring.tabletennis.tool.expediteSaid']);
    // Expedite is in force for the rest of the match, so Undo is its only way back (and More never listed it).
    await tool(app, en['scoring.tabletennis.tool.more']);
    expect(
      within(screen.getByTestId('step-sheet')).queryByText(
        en['scoring.tabletennis.tool.expediteSaid'],
      ),
    ).toBeNull();
  });

  it('Undo of the start brings the Expedite cell back', async () => {
    const app = await started();
    await rally(app, 'first');
    await tool(app, en['scoring.tabletennis.tool.expediteSaid']);
    await choose(app, en['scoring.tabletennis.expedite.start']);
    expect(tools()).not.toContain(en['scoring.tabletennis.tool.expediteSaid']);
    aSecondOn(app);
    press(en['scoring.pad.undo']);
    await flush(400);
    expect(tools()).toEqual([
      en['scoring.tabletennis.tool.expediteSaid'],
      en['scoring.tabletennis.tool.more'],
    ]);
    expect(stripNote()).toBe('');
    expect(bothClocks()).toEqual([0, 0]);
  });

  // ITTF 2.15.4: Expedite begun between rallies resumes with service by the player who received in the rally before. L. Chen
  // served the first point (the Start pick), so A. Sharma serves the next, and L. Chen is the receiver 13 returns credits.
  it('13 returns gives the point to the side receiving, said so, and Undo takes it back', async () => {
    const app = await started();
    await rally(app, 'first');
    await tool(app, en['scoring.tabletennis.tool.expediteSaid']);
    await choose(app, en['scoring.tabletennis.expedite.start']);
    expect(plate('first')).toBe(en['scoring.tabletennis.serving.first']);
    expect(plate('second')).toBeNull();
    const returns = `${fill(en['scoring.tabletennis.tool.returns'], { returns: 13 })}, L. Chen`;
    expect(tools()).toEqual([returns, en['scoring.tabletennis.tool.more']]);
    aSecondOn(app);
    press(returns);
    await flush(400);
    expect([score('first'), score('second')]).toEqual(['1', '1']);
    expect(lastTap()).toBe(
      fill(en['scoring.tabletennis.last.returns'], {
        point: fill(en['scoring.tabletennis.last.rally'], { side: 'L. Chen' }),
        returns: 13,
      }),
    );
    // The serve changed with the point: Expedite serves each in turn, so L. Chen serves now and the cell moves to A. Sharma.
    expect(plate('second')).toBe(en['scoring.tabletennis.serving.first']);
    expect(tools()).toContain(
      `${fill(en['scoring.tabletennis.tool.returns'], { returns: 13 })}, A. Sharma`,
    );
    aSecondOn(app);
    press(en['scoring.pad.undo']);
    await flush(400);
    expect([score('first'), score('second')]).toEqual(['1', '0']);
    expect(plate('first')).toBe(en['scoring.tabletennis.serving.first']);
  });
});

describe('a match decided', () => {
  it('shows the recorded result over the final score, takes no tap, and the organiser’s finalise makes it view only', async () => {
    const app = await started();
    await rally(app, 'first', 33);
    await flush(2_000);
    expect(screen.getByTestId('pad-card').textContent).toContain(
      en['scoring.card.resultRecorded.title'],
    );
    expect(
      within(half('first'))
        .getAllByTestId('period')
        .map((box) => box.textContent),
    ).toEqual(['11', '11', '11']);
    expect(half('first').getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByTestId('tool-row')?.children.length ?? 0).toBe(0);
    // A recorded result is still the scorer's to undo a mistake in: the screen stays on.
    expect(screenIsHeld(holds)).toBe(true);

    app.scoring.finalize();
    await backgroundAndBack(app);
    await flush(2_000);
    expect(screen.getByTestId('pad-card').textContent).toContain(en['scoring.card.viewOnly.title']);
    expect(half('first').getAttribute('aria-disabled')).toBe('true');
    // The organiser's lock ends the scorer's part: the phone may sleep.
    expect(screenIsHeld(holds)).toBe(false);
  });
});

describe('in four languages', () => {
  it.each([
    ['en', en],
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)(
    '%s: the pad, its plate, its strip, its tools and the Start Expedite? question are said in the phone’s language',
    async (lang, words) => {
      const app = await started({ deviceLanguages: [lang] }, words);
      expect(plate('second')).toBe(words['scoring.tabletennis.serving.first']);
      expect(screen.getByTestId('strip-game').textContent).toBe(
        fill(words['scoring.tabletennis.gameOf'], { game: 1, bestOf: 5 }),
      );
      // Before the first point: Set score, Expedite and More, three cells. A screen reader hears Expedite's full term; the
      // cell draws the web's term where it fits three cells (en, fr) and a cut of it where it does not (es "Aceler.", nl
      // "Versnel."). The short words are the row of four's (TableTennisPadScreen.test.tsx).
      expect(tools()).toEqual([
        words['scoring.tabletennis.tool.setScore'],
        words['scoring.tabletennis.tool.expediteSaid'],
        words['scoring.tabletennis.tool.more'],
      ]);
      expect(drawn()).toEqual([
        words['scoring.tabletennis.tool.setScore'],
        words['scoring.tabletennis.tool.expedite'],
        words['scoring.tabletennis.tool.more'],
      ]);
      // A Card is More's, in full words, and the sheet it opens is titled with the full word.
      await tool(app, words['scoring.tabletennis.tool.more']);
      await choose(app, fill(words['scoring.tabletennis.more.card'], { side: 'A. Sharma' }));
      expect(
        within(screen.getByTestId('step-sheet')).getByText(words['scoring.tabletennis.sheet.card']),
      ).toBeTruthy();
      await choose(app, words['scoring.sheet.cancel']);
      expect(sheet()).toBeNull();
      await rally(app, 'first');
      // The question: its title, its sentence and its Start are the phone's language (textContent keeps French's no-break space).
      await tool(app, words['scoring.tabletennis.tool.expediteSaid']);
      const asked = screen.getByTestId('step-sheet').textContent ?? '';
      expect(asked).toContain(words['scoring.tabletennis.expedite.title']);
      expect(asked).toContain(words['scoring.tabletennis.expedite.body']);
      await choose(app, words['scoring.tabletennis.expedite.start']);
      // Owner ruling 56: no word in the strip; the clock is on both halves, and each says Expedite in the language's term.
      expect(stripNote()).toBe('');
      expect(bothClocks()).toEqual([1, 1]);
      for (const side of ['first', 'second'] as const) {
        expect(half(side).getAttribute('aria-label')).toContain(
          words['scoring.tabletennis.tool.expediteSaid'],
        );
      }
      expect(tools()).toEqual([
        `${fill(words['scoring.tabletennis.tool.returns'], { returns: 13 })}, L. Chen`,
        words['scoring.tabletennis.tool.more'],
      ]);
    },
  );
});

describe('the four questions', () => {
  it('a second Start press records the start once', async () => {
    const app = await launchApp({ scoringSeed: SEED, kvSeed: IN_MATCH });
    await flush(200);
    app.setNow(new Date(TEST_NOW.getTime() - 60_000));
    act(() => fireEvent.click(screen.getByRole('radio', { name: 'A. Sharma' })));
    const append = vi.spyOn(app.scoring, 'append');
    const start = screen.getByRole('button', { name: en['scoring.start.confirm'] });
    act(() => {
      fireEvent.click(start);
      fireEvent.click(start);
    });
    app.setNow(TEST_NOW);
    await flush(2_000);
    expect(append).toHaveBeenCalledTimes(1);
  });

  it('a timeout chosen twice in the bounce window records once', async () => {
    const app = await started();
    await tool(app, en['scoring.tabletennis.tool.more']);
    const timeout = screen.getByRole('button', {
      name: fill(en['scoring.tabletennis.more.timeout'], { side: 'A. Sharma' }),
    });
    const append = vi.spyOn(app.scoring, 'append');
    aSecondOn(app);
    act(() => {
      fireEvent.click(timeout);
      fireEvent.click(timeout);
    });
    await flush(2_000);
    expect(append).toHaveBeenCalledTimes(1);
  });

  it('a Start chosen twice in the bounce window records Expedite once', async () => {
    const app = await started();
    await rally(app, 'first');
    await tool(app, en['scoring.tabletennis.tool.expediteSaid']);
    const start = screen.getByRole('button', { name: en['scoring.tabletennis.expedite.start'] });
    const append = vi.spyOn(app.scoring, 'append');
    aSecondOn(app);
    act(() => {
      fireEvent.click(start);
      fireEvent.click(start);
    });
    await flush(2_000);
    expect(append).toHaveBeenCalledTimes(1);
  });

  it('the app sent away and back with the Expedite question open leaves it open, and Cancel records nothing', async () => {
    const app = await started();
    await rally(app, 'first');
    await tool(app, en['scoring.tabletennis.tool.expediteSaid']);
    await backgroundAndBack(app);
    await flush(500);
    expect(screen.getByTestId('step-sheet')).toBeTruthy();
    const append = vi.spyOn(app.scoring, 'append');
    await choose(app, en['scoring.sheet.cancel']);
    expect(sheet()).toBeNull();
    expect(append).not.toHaveBeenCalled();
    expect(stripNote()).toBe('');
    expect(bothClocks()).toEqual([0, 0]);
  });

  it('the app sent away and back with More open leaves the pad as it was', async () => {
    const app = await started();
    await rally(app, 'first');
    await tool(app, en['scoring.tabletennis.tool.more']);
    await backgroundAndBack(app);
    await flush(500);
    expect(score('first')).toBe('1');
    expect(screen.queryByTestId('pad-content')).toBeTruthy();
    // Nothing closes a sheet on a return to the foreground: More is still open over the pad, with its choices, and the
    // scorer's way out (Cancel) still closes it.
    expect(
      within(screen.getByTestId('step-sheet')).getByText(en['scoring.tabletennis.tool.more']),
    ).toBeTruthy();
    expect(screen.getByTestId('pad-content').getAttribute('aria-hidden')).toBe('true');
    expect(
      screen.getByRole('button', {
        name: fill(en['scoring.tabletennis.more.timeout'], { side: 'A. Sharma' }),
      }),
    ).toBeTruthy();
    await choose(app, en['scoring.sheet.cancel']);
    expect(sheet()).toBeNull();
    expect(screen.getByTestId('pad-content').getAttribute('aria-hidden')).not.toBe('true');
  });
});
