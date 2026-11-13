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
// A fixed row wraps each tool in a slot; the chips share the row with no slots, so a cell is then the button itself.
const cells = () =>
  row().map((child) =>
    child.matches('[role="button"]') ? child : child.querySelector('[role="button"]'),
  );
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
  // Who serves first (ruling 233): the top side, then Start match.
  act(() => fireEvent.click(screen.getAllByRole('radio')[0]!));
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

describe('the Start screen (ruling 233)', () => {
  const launched = (seed: FakeMatchSeed, lang: Lang = 'en') =>
    launchApp({ scoringSeed: seed, kvSeed: inMatch(seed), deviceLanguages: [lang] });
  const radios = () => screen.getAllByRole('radio');

  it('asks who serves first with the two names, and Start match waits for the pick', async () => {
    await launched(TENNIS_TOUR_SEED);
    await flush(200);
    expect(screen.getByTestId('start-screen')).toBeTruthy();
    expect(screen.getByText(en['scoring.tennis.start.ask'])).toBeTruthy();
    expect(radios().map((side) => side.textContent)).toEqual(['Ana Ruiz', 'Bea Lund']);
    const start = screen.getByRole('button', { name: en['scoring.start.confirm'] });
    expect(start.getAttribute('aria-disabled')).toBe('true');
  });

  it.each(['en', 'es', 'fr', 'nl'] as const)('asks in %s as the dictionary says', async (lang) => {
    await launched(TENNIS_TOUR_SEED, lang);
    await flush(200);
    expect(screen.getByText(DICTIONARIES[lang]['scoring.tennis.start.ask'], PLAIN)).toBeTruthy();
  });

  it('Start match records the toss and then the start, once however often it is pressed, and the tossed side serves', async () => {
    const app = await launched(TENNIS_TOUR_SEED);
    await flush(200);
    act(() => fireEvent.click(screen.getByRole('radio', { name: 'Bea Lund' })));
    app.setNow(new Date(TEST_NOW.getTime() - 60_000));
    press(en['scoring.start.confirm']);
    // A second press while it goes through starts nothing twice.
    press(en['scoring.start.confirm']);
    app.setNow(TEST_NOW);
    await flush(200);
    expect(screen.queryByTestId('start-screen')).toBeNull();
    const events = await app.scoring.events(LINK, TENNIS_TOUR_SEED.fixtureId, 0);
    expect(Array.isArray(events) ? events.map((e) => e.type) : null).toEqual([
      'tennis.toss',
      'core.start',
    ]);
    expect(within(half('second')).queryByText(en['scoring.tennis.serving'])).toBeTruthy();
    expect(within(half('first')).queryByText(en['scoring.tennis.serving'])).toBeNull();
  });

  it('is not shown for a match another scorer started with no toss: the pad is up and home serves', async () => {
    await opened(under('fx-tn-nobody'));
    expect(screen.queryByTestId('start-screen')).toBeNull();
    expect(within(half('first')).queryByText(en['scoring.tennis.serving'])).toBeTruthy();
  });
});

describe('a doubles server’s name (ruling 235)', () => {
  const DOUBLES_SEED = doublesSeed({ fixtureId: 'fx-tn-d' });
  const SERVER_ONE = 'Ana Ruiz';
  const OTHER_SIDE = 'Bea Lund';

  it.each(['en', 'es', 'fr', 'nl'] as const)(
    'is on the serving half in %s, in the language’s words, and on the other half none',
    async (lang) => {
      await opened({ ...DOUBLES_SEED, events: [START] }, lang);
      const line = fill(DICTIONARIES[lang]['scoring.tennis.serverPerson'], {
        person: SERVER_ONE,
      });
      expect(within(half('first')).getByText(line, PLAIN)).toBeTruthy();
      const other = fill(DICTIONARIES[lang]['scoring.tennis.serverPerson'], { person: OTHER_SIDE });
      expect(within(half('second')).queryByText(other, PLAIN)).toBeNull();
    },
  );

  it('is not drawn in a tie-break: the plate names the side alone', async () => {
    await opened({ ...DOUBLES_SEED, events: [START, ...TIEBREAK_EVENTS] });
    const line = fill(en['scoring.tennis.serverPerson'], { person: SERVER_ONE });
    expect(within(half('first')).queryByText(line)).toBeNull();
    expect(screen.getAllByText(en['scoring.tennis.serving']).length).toBeGreaterThan(0);
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

  it('after the match’s first point Set score is gone (ruling 241) and the other three stay in place and of one kind', async () => {
    const app = await started(TENNIS_TOUR_SEED, lang);
    const before = tools();
    const kinds = new Set(row().map((child) => child.className));
    await point(app, 'first');
    expect(score('first')).not.toBe('0');
    expect(row()).toHaveLength(3);
    expect(tools()).toEqual(before.slice(0, 3));
    expect(tools()).not.toContain(words['scoring.tennis.tool.setScore']);
    expect(new Set(row().map((child) => child.className)).size).toBeLessThanOrEqual(kinds.size);
    expect(enabled()).toEqual([true, true, true]);
  });

  it('in a tie-break the three cells stay; Award game is disabled', async () => {
    await opened(under(`tb-${lang}`, ...TIEBREAK_EVENTS), lang);
    expect(tools()).toEqual([
      words['scoring.tennis.tool.violation'],
      words['scoring.tennis.tool.break'],
      words['scoring.tennis.tool.award'],
    ]);
    expect(row()).toHaveLength(3);
    expect(enabled()).toEqual([true, true, false]);
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

  it('after a set entered by Set score the sheet names the set it sets: Set 2', async () => {
    const summary = { type: 'tennis.set_summary', payload: { home: 6, away: 3 } };
    const app = await opened(under('set-two', summary));
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

// Ruling 234 (Task 17): the Point details switch in Match details, off by default; on, a point's chips stand in the tools'
// place, Ace (the top side serves: it was picked at Start) or Double fault, Winner and Error, the error said in full.
describe.each(['en', 'es', 'fr', 'nl'] as const)('the point details, in %s', (lang) => {
  const words = DICTIONARIES[lang];
  const detailsSwitch = () =>
    screen.getByRole('switch', { name: words['scoring.tennis.details.switch'] });

  async function switchOn(app: LaunchedApp) {
    await tap(app, words['scoring.details.title']);
    expect(detailsSwitch().getAttribute('aria-checked')).toBe('false');
    aSecondOn(app);
    act(() => fireEvent.click(detailsSwitch()));
    await flush(400);
    expect(detailsSwitch().getAttribute('aria-checked')).toBe('true');
    await tap(app, words['panel.close']);
  }

  it('the switch is in Match details, off; on, the server’s point shows Ace, Winner and Error, and Ace brings the tools back', async () => {
    const app = await started(TENNIS_TOUR_SEED, lang);
    await switchOn(app);
    await point(app, 'first');
    expect(tools()).toEqual([
      words['scoring.tennis.chip.ace'],
      words['scoring.tennis.chip.winner'],
      words['scoring.tennis.chip.errorSaid'],
    ]);
    expect(drawn()).toEqual([
      words['scoring.tennis.chip.ace'],
      words['scoring.tennis.chip.winner'],
      words['scoring.tennis.chip.error'],
    ]);
    await tap(app, words['scoring.tennis.chip.ace']);
    // Set score is gone once the match has a point (ruling 241).
    expect(tools()).toEqual([
      words['scoring.tennis.tool.violation'],
      words['scoring.tennis.tool.break'],
      words['scoring.tennis.tool.award'],
    ]);
  });

  it('the receiver’s point shows Double fault, Winner and Error', async () => {
    const app = await started(TENNIS_TOUR_SEED, lang);
    await switchOn(app);
    await point(app, 'second');
    expect(drawn()).toEqual([
      words['scoring.tennis.chip.doubleFault'],
      words['scoring.tennis.chip.winner'],
      words['scoring.tennis.chip.error'],
    ]);
  });

  it('with the switch off, a point leaves the tools as they are', async () => {
    const app = await started(TENNIS_TOUR_SEED, lang);
    await point(app, 'first');
    expect(drawn()).toEqual([
      words['scoring.tennis.tool.violationShort'],
      words['scoring.tennis.tool.break'],
      words['scoring.tennis.tool.awardShort'],
    ]);
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

  it('History lists the point under its game’s heading, and Close closes it', async () => {
    const app = await started();
    await point(app, 'second');
    await tap(app, en['scoring.history.title']);
    // The game's heading (ruling 238): the set, the game and the side serving it.
    const heading = /^Set 1 · Game 1 · .+ serving$/;
    expect(en['scoring.tennis.history.game']).toBe('Set {set} · Game {game} · {server} serving');
    expect(screen.getByText(heading)).toBeTruthy();
    aSecondOn(app);
    press(en['panel.close']);
    await flush(400);
    expect(screen.queryByText(heading)).toBeNull();
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

// T12-F3 (task 19): at 320 x 640 in Dutch the result card left the two final boards no room. A decided match scrolls the
// card and both halves together, each half at its own height; a live match takes taps and never scrolls. jsdom cannot see
// the clipping itself: that the boards are whole and apart is the device check's.
describe('the final board scrolls with the result card (T12-F3)', () => {
  const DECIDED = [...gameEvents('first', 12)];

  it('a decided match has the card and both halves, with their final boards, inside the scroll', async () => {
    await opened(under('fake-tn-decided', ...DECIDED));
    const scroll = screen.getByTestId('pad-body-scroll');
    expect(within(scroll).getByTestId('half-first')).toBeTruthy();
    expect(within(scroll).getByTestId('half-second')).toBeTruthy();
    expect(within(scroll).getAllByTestId('final-board')).toHaveLength(2);
    expect(within(scroll).getByTestId('pad-card')).toBeTruthy();
  });

  it.each(['es', 'fr', 'nl'] as const)('a decided match scrolls in %s too', async (lang) => {
    await opened(under(`fake-tn-decided-${lang}`, ...DECIDED), lang);
    expect(screen.getByTestId('pad-body-scroll')).toBeTruthy();
  });

  it('a match the organiser ended by a retirement scrolls its final boards too (ruling 239: ended has the board)', async () => {
    await opened(
      under('fake-tn-retired-scroll', ...gameEvents('first', 2), {
        type: 'core.forfeit',
        payload: { by: 'ent-away', reason: 'retired' },
      }),
    );
    const scroll = screen.getByTestId('pad-body-scroll');
    expect(within(scroll).getAllByTestId('final-board')).toHaveLength(2);
  });

  it('a live match takes taps and has no scroll', async () => {
    await started();
    expect(screen.queryByTestId('pad-body-scroll')).toBeNull();
    expect(screen.getByTestId('tool-row')).toBeTruthy();
  });

  it('a match that is not decided yet, one set won, has no scroll', async () => {
    await opened(under('fake-tn-oneset', ...gameEvents('first', 6)));
    expect(screen.queryByTestId('pad-body-scroll')).toBeNull();
  });
});
