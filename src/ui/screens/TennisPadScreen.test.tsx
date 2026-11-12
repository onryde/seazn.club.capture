import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSavedCode } from '@/domain/mode/savedCode';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import type { FakeMatchSeed } from '@/services/fakeScoringPort';
import {
  doublesSeed,
  gameEvents,
  pointEvent,
  singlesSeed,
  START,
  TENNIS_TOUR_SEED,
} from '@/services/fakeTennisPad';
import { STORE_KEYS } from '@/services/modeStore';
import { colour } from '@/ui/theme/tokens';
import { TEST_NOW } from '../../../test/fakePorts';
import { screenIsHeld, type HoldLog } from '../../../test/heldScreen';
import { fillOf, paintOf } from '../../../test/pressState';
import { linkKey } from '../../../test/scoringHomeFixtures';
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

// S2-7 Task 11: tennis's pad screen (spec layout A, rulings 228, 231, 232, 236) on the fake server with the real runner,
// queue, sender and fold under it. Each test reads what the scorer sees, in English, Spanish, French and Dutch. Portrait
// only, so the orientation question does not apply. What jsdom cannot see (a cell's real width and wrap at 320 dp:
// `tennisFit.test.ts` measures those; the card's colour on a phone; a press's feedback) is the device check's.

const DICTIONARIES = { en, es, fr, nl } as const;
type Lang = keyof typeof DICTIONARIES;
const LINK = { origin: 'https://stg.seazn.club', token: 'dl_madeUpTokenForTennis0001' };

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
      scoring: { fixtureId: seed.fixtureId, label: 'Match 2' },
    }),
    [linkKey(seed.fixtureId)]: JSON.stringify({ ...LINK, sportKey: 'tennis' }),
  };
}

let seconds = 0;
const aSecondOn = (app: LaunchedApp) => {
  seconds += 1;
  app.setNow(new Date(TEST_NOW.getTime() + seconds * 1000));
};
const half = (side: 'first' | 'second') => screen.getByTestId(`half-${side}`);
const score = (side: 'first' | 'second') => within(half(side)).getByTestId('score').textContent;
const row = () => [...screen.getByTestId('tool-row').children];
const cells = () => row().map((child) => child.querySelector('[role="button"]'));
const tools = () => cells().map((button) => button?.getAttribute('aria-label') ?? null);
const drawn = () => cells().map((button) => button?.textContent ?? null);
const enabled = () => cells().map((button) => button?.getAttribute('aria-disabled') !== 'true');
const cardFills = (side: 'first' | 'second') =>
  within(half(side))
    .queryAllByTestId('mark-card')
    .map((card) => paintOf(card).fill);
const fill = (text: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce(
    (out, [name, value]) => out.replace(`{${name}}`, String(value)),
    text,
  );
const buttons = (of: HTMLElement) =>
  within(of)
    .getAllByRole('button')
    .map((button) => button.textContent);

/** French spaces its colons with a no-break space: read the text as it is. */
const PLAIN = { normalizer: (text: string) => text };
const press = (name: string) => act(() => fireEvent.click(screen.getByRole('button', { name })));
async function tap(app: LaunchedApp, name: string): Promise<void> {
  aSecondOn(app);
  press(name);
  await flush(400);
}
async function point(app: LaunchedApp, side: 'first' | 'second', times = 1): Promise<void> {
  for (let at = 0; at < times; at += 1) {
    aSecondOn(app);
    act(() => fireEvent.click(half(side)));
    await flush(0);
  }
}

/** The match opened and started by this phone a minute before the test's taps: tennis has no serve to pick first. */
async function started(
  seed: FakeMatchSeed = TENNIS_TOUR_SEED,
  lang: Lang = 'en',
): Promise<LaunchedApp> {
  const app = await launchApp({
    scoringSeed: seed,
    kvSeed: inMatch(seed),
    deviceLanguages: [lang],
  });
  await flush(200);
  app.setNow(new Date(TEST_NOW.getTime() - 60_000));
  act(() =>
    fireEvent.click(
      screen.getByRole('button', { name: DICTIONARIES[lang]['scoring.start.confirm'] }),
    ),
  );
  app.setNow(TEST_NOW);
  await flush(200);
  return app;
}

/** A match another scorer started, and `events` after it. */
const under = (fixtureId: string, ...events: FakeMatchSeed['events']) =>
  singlesSeed({ fixtureId, events: [START, ...events] });
const opened = async (seed: FakeMatchSeed, lang: Lang = 'en'): Promise<LaunchedApp> => {
  const app = await launchApp({
    scoringSeed: seed,
    kvSeed: inMatch(seed),
    deviceLanguages: [lang],
  });
  await flush(200);
  return app;
};

/** 6-6 in games: the set's tie-break stands. */
const TIEBREAK_EVENTS = Array.from({ length: 12 }, (_, at) =>
  gameEvents(at % 2 === 0 ? 'first' : 'second'),
).flat();

describe('the Start screen', () => {
  it('has no serve to pick: no choice rows, and one Start match that starts it', async () => {
    const app = await launchApp({
      scoringSeed: TENNIS_TOUR_SEED,
      kvSeed: inMatch(TENNIS_TOUR_SEED),
    });
    await flush(200);
    expect(screen.getByTestId('start-screen')).toBeTruthy();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    app.setNow(new Date(TEST_NOW.getTime() - 60_000));
    press(en['scoring.start.confirm']);
    // A second press while it goes through starts nothing twice.
    press(en['scoring.start.confirm']);
    app.setNow(TEST_NOW);
    await flush(200);
    expect(screen.queryByTestId('start-screen')).toBeNull();
    const events = await app.scoring.events(LINK, TENNIS_TOUR_SEED.fixtureId, 0);
    expect(
      Array.isArray(events) ? events.filter((e) => e.type === 'core.start') : null,
    ).toHaveLength(1);
  });
});

describe.each(['en', 'es', 'fr', 'nl'] as const)('layout A, singles, in %s', (lang) => {
  const words = DICTIONARIES[lang];

  it('the tool row is Violation, Break, Award game, Set score; the drawn words are short, the spoken ones full', async () => {
    await started(TENNIS_TOUR_SEED, lang);
    expect(tools()).toEqual([
      words['scoring.tennis.tool.violation'],
      words['scoring.tennis.tool.break'],
      words['scoring.tennis.tool.award'],
      words['scoring.tennis.tool.setScore'],
    ]);
    expect(drawn()).toEqual([
      words['scoring.tennis.tool.violationShort'],
      words['scoring.tennis.tool.break'],
      words['scoring.tennis.tool.awardShort'],
      words['scoring.tennis.tool.setScore'],
    ]);
    expect(enabled()).toEqual([true, true, true, true]);
  });

  it('after the first point the four cells stay, in place and of one kind; only Set score is disabled', async () => {
    const app = await started(TENNIS_TOUR_SEED, lang);
    const before = tools();
    const kinds = new Set(row().map((child) => child.className));
    await point(app, 'first');
    expect(score('first')).not.toBe('0');
    expect(row()).toHaveLength(4);
    expect(tools()).toEqual(before);
    expect(new Set(row().map((child) => child.className))).toEqual(kinds);
    expect(enabled()).toEqual([true, true, true, false]);
  });

  it('in a tie-break the four cells stay too; Award game is disabled and Set score as it was', async () => {
    await opened(under(`tb-${lang}`, ...TIEBREAK_EVENTS), lang);
    expect(tools()).toEqual([
      words['scoring.tennis.tool.violation'],
      words['scoring.tennis.tool.break'],
      words['scoring.tennis.tool.award'],
      words['scoring.tennis.tool.setScore'],
    ]);
    expect(row()).toHaveLength(4);
    expect(enabled()).toEqual([true, true, false, false]);
    expect(screen.getByText(words['scoring.tennis.breaker.tiebreak'])).toBeTruthy();
  });

  it('a warning is one yellow card in the side’s corner, and its word is in the half’s name', async () => {
    const app = await started(TENNIS_TOUR_SEED, lang);
    await tap(app, words['scoring.tennis.tool.violation']);
    await tap(app, 'Ana Ruiz');
    await tap(app, words['scoring.tennis.level.warning']);
    await tap(app, words['scoring.tennis.violation.confirm.action']);
    expect(screen.queryByTestId('step-sheet')).toBeNull();
    expect(cardFills('first')).toEqual([fillOf(colour.cardCaution)]);
    expect(cardFills('second')).toEqual([]);
    expect(half('first').getAttribute('aria-label')).toContain(
      words['scoring.tennis.level.warning'],
    );
  });

  it('a retirement the organiser recorded is the Retired card, over a pad that takes no tap', async () => {
    await opened(
      under(`ret-${lang}`, pointEvent('first'), {
        type: 'core.forfeit',
        payload: { by: 'ent-away', reason: 'retired' },
      }),
      lang,
    );
    expect(
      screen.getAllByText(new RegExp(words['scoring.tennis.ending.retired'])).length,
    ).toBeGreaterThan(0);
    expect(within(screen.getByTestId('tool-row')).queryAllByRole('button')).toHaveLength(0);
  });

  it('Set score opens its sheet: the set in the title, Games for each side, and on a tie-break the tie-break’s points', async () => {
    const app = await started(TENNIS_TOUR_SEED, lang);
    await tap(app, words['scoring.tennis.tool.setScore']);
    const sheet = within(screen.getByTestId('score-sheet'));
    expect(
      sheet.getByText(fill(words['scoring.tennis.setScore.title'], { set: 1 }), PLAIN),
    ).toBeTruthy();
    for (const side of ['Ana Ruiz', 'Bea Lund'])
      expect(
        sheet.getByText(fill(words['scoring.tennis.setScore.games'], { side }), PLAIN),
      ).toBeTruthy();
    const [first, second] = screen.getAllByRole('textbox');
    act(() => fireEvent.change(first!, { target: { value: '7' } }));
    act(() => fireEvent.change(second!, { target: { value: '6' } }));
    aSecondOn(app);
    press(words['scoring.setScore.confirm']);
    await flush(400);
    // 7-6 is a tie-break set: the same sheet goes on to the tie-break's points.
    const next = within(screen.getByTestId('score-sheet'));
    for (const side of ['Ana Ruiz', 'Bea Lund'])
      expect(
        next.getByText(fill(words['scoring.tennis.setScore.tiebreak'], { side }), PLAIN),
      ).toBeTruthy();
    const [top, bottom] = screen.getAllByRole('textbox') as HTMLInputElement[];
    // The fields start empty-handed at 0, not at the games just typed.
    expect([top!.value, bottom!.value]).toEqual(['0', '0']);
  });
});

describe('the sheets’ own buttons', () => {
  it('Award game asks the side, then confirms, and the last-tap line says the game was awarded', async () => {
    const app = await started();
    await tap(app, en['scoring.tennis.tool.award']);
    expect(screen.getByText(en['scoring.tennis.award.ask'])).toBeTruthy();
    await tap(app, 'Bea Lund');
    await tap(app, en['scoring.tennis.award.confirm.action']);
    expect(screen.queryByTestId('step-sheet')).toBeNull();
    expect(screen.getByTestId('last-tap-sentence').textContent).toBe(
      en['scoring.tennis.last.award'].replace('{side}', 'Bea Lund'),
    );
  });

  it('Cancel closes a step sheet, from any step', async () => {
    const app = await started();
    await tap(app, en['scoring.tennis.tool.violation']);
    await tap(app, 'Ana Ruiz');
    await tap(app, en['scoring.sheet.cancel']);
    expect(screen.queryByTestId('step-sheet')).toBeNull();
  });

  it('Set score: Cancel closes it, and Confirm is off one above the Tour’s ten games', async () => {
    const app = await started();
    await tap(app, en['scoring.tennis.tool.setScore']);
    const [first] = screen.getAllByRole('textbox');
    const confirm = () =>
      (screen.getByRole('button', { name: en['scoring.setScore.confirm'] }) as HTMLButtonElement)
        .disabled;
    act(() => fireEvent.change(first!, { target: { value: '10' } }));
    expect(confirm()).toBe(false);
    act(() => fireEvent.change(first!, { target: { value: '11' } }));
    expect(confirm()).toBe(true);
    await tap(app, en['scoring.sheet.cancel']);
    expect(screen.queryByTestId('score-sheet')).toBeNull();
  });

  it('after a set is won the sheet names the set it sets: Set 2', async () => {
    const app = await opened(under('set-two', ...gameEvents('first', 6)));
    await tap(app, en['scoring.tennis.tool.setScore']);
    expect(
      within(screen.getByTestId('score-sheet')).getByText(
        en['scoring.tennis.setScore.title'].replace('{set}', '2'),
      ),
    ).toBeTruthy();
  });
});

describe('doubles', () => {
  it('shows both players of each pair, and the violation asks which player', async () => {
    const app = await started(doublesSeed({ fixtureId: 'screen-doubles' }));
    for (const side of ['first', 'second'] as const) expect(half(side).textContent).toContain('/');
    expect(screen.getByTestId('pad-content').textContent).toContain('Ana Ruiz');
    expect(screen.getByTestId('pad-content').textContent).toContain('Eva Vega');
    expect(screen.getByTestId('pad-content').textContent).toContain('Bea Lund');
    expect(screen.getByTestId('pad-content').textContent).toContain('Ida Berg');
    await tap(app, en['scoring.tennis.tool.violation']);
    await tap(app, 'Ana Ruiz / Eva Vega');
    await tap(app, en['scoring.tennis.level.warning']);
    expect(buttons(screen.getByTestId('step-sheet'))).toEqual(
      expect.arrayContaining(['Ana Ruiz', 'Eva Vega']),
    );
  });
});

describe('the sheets of the top bar', () => {
  it('Match details shows the tennis rules, and Close closes it', async () => {
    const app = await started();
    await tap(app, en['scoring.details.title']);
    const sheet = within(screen.getByTestId('details-scroll'));
    expect(
      sheet.getByText(en['scoring.tennis.rules.bestOf'].replace('{bestOf}', '3')),
    ).toBeTruthy();
    aSecondOn(app);
    press(en['panel.close']);
    await flush(400);
    expect(screen.queryByTestId('details-scroll')).toBeNull();
  });

  it('History lists the point under the set it was played in, and Close closes it', async () => {
    const app = await started();
    await point(app, 'second');
    await tap(app, en['scoring.history.title']);
    expect(screen.getByText(en['scoring.tennis.setHeading'].replace('{set}', '1'))).toBeTruthy();
    aSecondOn(app);
    press(en['panel.close']);
    await flush(400);
    expect(screen.queryByText(en['scoring.tennis.setHeading'].replace('{set}', '1'))).toBeNull();
  });
});

describe('what the screen holds and shows', () => {
  it('holds the screen awake on the pad', async () => {
    await started();
    expect(screenIsHeld(holds)).toBe(true);
  });

  it('a second press of a tool opens one sheet, not two', async () => {
    const app = await started();
    aSecondOn(app);
    const button = screen.getByRole('button', { name: en['scoring.tennis.tool.break'] });
    act(() => fireEvent.click(button));
    act(() => fireEvent.click(button));
    await flush(400);
    expect(screen.getAllByTestId('step-sheet')).toHaveLength(1);
  });
});
