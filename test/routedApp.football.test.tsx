import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSavedCode } from '@/domain/mode/savedCode';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { footballSeed } from '@/services/fakeFootballPad';
import type { FakeMatchSeed, FakeSeedEvent } from '@/services/fakeScoringPort';
import { STORE_KEYS } from '@/services/modeStore';
import { TEST_NOW } from './fakePorts';
import { KO_11, type Spec } from './footballLedger';
import { KICK_OFF, LEVEL_AFTER_ET, kicks } from './footballPadFixtures';
import { LINK, RAW, linkKey } from './scoringHomeFixtures';
import { flush, launchApp, type LaunchedApp } from './routedApp';

beforeEach(() => {
  seconds = 0;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

// Plan S2-5 P Task 12: a football match from the scan to the shootout, through the route's table, on the fake server with
// the real runner, queue, sender and fold under it (the real engine judges every event). Each test reads what the scorer
// sees; copy and expected states come from the dictionaries and the design (§6), names from the fake's team sheets
// (`fakeFootballPad.ts`: Riverside FC's R. Adeyemi #1 … R. Price #16, Northgate United's N. …). What jsdom cannot see (the
// lime plates and LED digits, the card icons' colours, how the columns stand at 320 dp, a press's feedback, TalkBack) is
// the device check's. The four questions: a second call (double taps, a sheet against the console) is useFootballMatch's;
// an empty input (no team sheet) is the hook's and the screen's; an interruption is here (offline) and in the hook (the
// background, a dead link); another language is here; orientation does not apply (Remote Scoring is portrait only).

type Words = Readonly<Record<string, string>>;

// A no-break space in a dictionary (French puts one before a colon) is kept by textContent: both sides of a compare of
// text go through `plain`.
const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ');
const fill = (text: string, vars: Record<string, string>) =>
  plain(Object.entries(vars).reduce((out, [name, value]) => out.replace(`{${name}}`, value), text));

const asSeed = (specs: readonly Spec[]): FakeSeedEvent[] =>
  specs.map(({ type, payload }) => ({ type, payload }));

/** A knockout tie, so a level match goes to extra time and then to kicks (design §6.5). */
const KNOCKOUT = footballSeed({ cfg: KO_11 });

/** A phone that scanned this match earlier: the code saved, the link kept with the sport the bootstrap named. */
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
      scoring: { fixtureId: seed.fixtureId, label: 'Riverside FC v Northgate United' },
    }),
    [linkKey(seed.fixtureId)]: JSON.stringify({ ...LINK, sportKey: 'football' }),
  };
}

let seconds = 0;
/** The phone's clock `by` seconds on from TEST_NOW's: the next tap is never in the bounce window of the last. */
function later(app: LaunchedApp, by = 1): void {
  seconds += by;
  app.setNow(new Date(TEST_NOW.getTime() + seconds * 1000));
}

/** A button pressed a second after the last thing the scorer did, and the time its sheet needs before it takes a choice. */
async function press(app: LaunchedApp, name: string, inside?: HTMLElement): Promise<void> {
  later(app);
  const scope = inside === undefined ? screen : within(inside);
  act(() => fireEvent.click(scope.getByRole('button', { name: plain(name) })));
  await flush(400);
}

/** The Goal square (Scored in the shootout) of a column: its name carries the team and the score, so it is found by its place. */
async function pressSquare(app: LaunchedApp, side: 'first' | 'second'): Promise<void> {
  later(app);
  act(() => fireEvent.click(within(column(side)).getByTestId('goal-square')));
  await flush(400);
}

/**
 * End of period, pressed once it has re-armed: it is off for 2 s after its label changes (the controller's ruling, final
 * review, 2026-11-08), and the scorer here presses it on the heels of the last period's Start.
 */
async function endPeriod(app: LaunchedApp, name: string): Promise<void> {
  await flush(2_000);
  await press(app, name);
}

const column = (side: 'first' | 'second') => screen.getByTestId(`column-${side}`);
const clockBar = () => screen.getByTestId('clock-bar');
const lastTap = () => plain(screen.getByTestId('last-tap-sentence').textContent ?? '');
const value = (side: 'first' | 'second') =>
  within(column(side)).getByTestId('column-value').textContent;
const enabled = (side: 'first' | 'second') =>
  within(column(side))
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-disabled') !== 'true');
const resultCard = (words: Words = en) =>
  screen.queryByText(plain(words['scoring.card.resultRecorded.title'] ?? ''));
const homeCard = () => within(screen.getByTestId('scoring-continue'));

async function ledger(app: LaunchedApp, seed: FakeMatchSeed) {
  const rows = await app.scoring.events(LINK, seed.fixtureId, 0);
  if (!Array.isArray(rows))
    throw new Error(`the fake answered the ledger with ${JSON.stringify(rows)}`);
  return rows;
}

/** The match scanned from Home, as the scorer scans it, and the match check it opens on. */
async function scanned(seed: FakeMatchSeed): Promise<LaunchedApp> {
  const app = await launchApp({ scoringSeed: seed });
  app.scanner.queue({ outcome: 'scanned', raw: RAW });
  act(() => screen.getByRole('button', { name: /Remote Scoring/ }).click());
  await flush(400);
  return app;
}

/** A match this phone met before, reopened from its saved code. */
async function opened(seed: FakeMatchSeed, languages?: readonly string[]): Promise<LaunchedApp> {
  const app = await launchApp({
    scoringSeed: seed,
    kvSeed: inMatch(seed),
    ...(languages === undefined ? {} : { deviceLanguages: languages }),
  });
  await flush(200);
  return app;
}

/** A shootout kick through its column and the Who kicked? sheet, the taker not known. */
async function kick(
  app: LaunchedApp,
  words: Words,
  side: 'first' | 'second',
  scored: boolean,
): Promise<void> {
  if (scored) await pressSquare(app, side);
  else await press(app, words['scoring.football.column.missed'] ?? 'missed', column(side));
  await press(app, words['scoring.football.sheet.dontKnow'] ?? 'dontKnow');
}

async function home(app: LaunchedApp): Promise<void> {
  act(() => {
    app.back.press();
  });
  await flush(400);
  expect(app.nav.current()).toBe('home');
}

/**
 * A knockout tie played through in the phone's language, from Start match: a goal, a card and a sub, the halves, extra
 * time and the kicks; Undo reopens the decision; Home's card reads the result. Every word from `words`, names as typed.
 */
async function playKnockout(app: LaunchedApp, words: Words): Promise<void> {
  const w = (key: string): string => {
    const text = words[key];
    if (text === undefined) throw new Error(`no words for ${key}`);
    return text;
  };
  await press(app, w('scoring.start.confirm'));
  const kickOff = seconds + 1;
  await press(app, w('scoring.football.clock.start'), clockBar());
  expect(lastTap()).toBe(fill(w('scoring.football.last.clockStart'), { at: ' · 0:00' }));

  // Goal → the scorer → the assist: one goal, the scorer and the assist in it, at the minute of the press.
  await pressSquare(app, 'first');
  const goalAt = seconds - kickOff;
  await press(app, '#9 R. Ito');
  await press(app, '#10 R. Jansen');
  expect(lastTap()).toBe(
    fill(w('scoring.football.last.goal'), {
      team: 'Riverside FC',
      who: ' · #9 R. Ito',
      at: " 1'",
    }),
  );
  expect([value('first'), value('second')]).toEqual(['1', '0']);

  // Yellow → the player → the reason (the button names the colour: no colour step).
  await press(
    app,
    fill(w('scoring.football.column.yellowSaid'), { team: 'Northgate United' }),
    column('second'),
  );
  await press(app, '#5 N. Evans');
  await press(app, w('scoring.football.sheet.noReason'));
  expect(lastTap()).toBe(
    fill(w('scoring.football.last.card'), {
      card: w('scoring.football.card.yellow'),
      team: 'Northgate United',
      who: ' · #5 N. Evans',
      at: " 1'",
    }),
  );

  // Sub → who comes off → who comes on (the bench).
  await press(
    app,
    fill(w('scoring.football.column.subSaid'), { team: 'Riverside FC' }),
    column('first'),
  );
  await press(app, '#11 R. Kowalski');
  await press(app, '#14 R. Novak');
  expect(lastTap()).toBe(
    fill(w('scoring.football.last.sub'), {
      team: 'Riverside FC',
      off: '#11',
      on: '#14',
      at: " 1'",
    }),
  );

  // Half-time: the bar says it, with Start for the second half, which reads from 45:00.
  await endPeriod(app, w('scoring.football.end.HT'));
  expect(within(clockBar()).getByText(plain(w('scoring.football.break.halfTime')))).toBeTruthy();
  expect(within(clockBar()).getByText('45:00')).toBeTruthy();
  await press(app, w('scoring.football.clock.start'), clockBar());
  expect(within(clockBar()).getByText(plain(w('scoring.football.period.H2')))).toBeTruthy();

  // Level at full time: a knockout goes to extra time, from 90:00.
  await pressSquare(app, 'second');
  await press(app, w('scoring.football.sheet.dontKnow'));
  expect([value('first'), value('second')]).toEqual(['1', '1']);
  await endPeriod(app, w('scoring.football.end.FT'));
  expect(within(clockBar()).getByText('90:00')).toBeTruthy();
  await press(app, w('scoring.football.clock.start'), clockBar());
  expect(within(clockBar()).getByText(plain(w('scoring.football.period.ET_H1')))).toBeTruthy();
  expect(screen.queryByTestId('pad-strip')).toBeNull();
  await endPeriod(app, w('scoring.football.end.ET_HT'));
  await press(app, w('scoring.football.clock.start'), clockBar());
  expect(within(clockBar()).getByText(plain(w('scoring.football.period.ET_H2')))).toBeTruthy();

  // Still level after extra time: the kicks. Each column has Scored and Missed: live in both before the first kick (the
  // engine leaves who kicks first to the teams), then only for the team to kick.
  await endPeriod(app, w('scoring.football.end.ET_FT'));
  expect(within(clockBar()).getByText(plain(w('scoring.football.period.shootout')))).toBeTruthy();
  expect(
    within(clockBar()).queryByRole('button', { name: w('scoring.football.clock.start') }),
  ).toBeNull();
  expect(enabled('first')).toEqual([true, true]);
  expect(enabled('second')).toEqual([true, true]);
  await kick(app, words, 'first', true);
  expect(enabled('first')).toEqual([false, false]);
  expect(enabled('second')).toEqual([true, true]);
  await kick(app, words, 'second', false);
  await kick(app, words, 'first', true);
  await kick(app, words, 'second', false);
  await kick(app, words, 'first', true);
  expect(resultCard(words)).toBeNull();
  // Home 3, away 0 with two kicks left: the third miss decides it.
  await kick(app, words, 'second', false);
  expect(lastTap()).toBe(
    fill(w('scoring.football.last.kickMissed'), { team: 'Northgate United', who: '' }),
  );
  expect(resultCard(words)).toBeTruthy();
  expect([value('first'), value('second')]).toEqual(['1 (3)', '1 (0)']);

  // Undo takes the deciding kick back: the match is open again, away to kick.
  await press(app, w('scoring.pad.undo'));
  expect(resultCard(words)).toBeNull();
  expect(enabled('second')).toEqual([true, true]);
  expect(within(column('second')).getAllByTestId('kick-missed')).toHaveLength(2);
  await kick(app, words, 'second', false);
  expect(resultCard(words)).toBeTruthy();

  const rows = await ledger(app, KNOCKOUT);
  const standing = rows.filter(
    (event) => event.type !== 'core.void' && !rows.some((other) => other.voids === event.id),
  );
  expect(standing.map((event) => event.type)).toEqual([
    'core.start',
    'football.clock',
    'football.goal',
    'football.card',
    'football.sub',
    'football.period',
    'football.clock',
    'football.goal',
    'football.period',
    'football.clock',
    'football.period',
    'football.clock',
    'football.period',
    ...Array.from({ length: 6 }, () => 'football.shootout.kick'),
  ]);
  const goal = standing.find((event) => event.type === 'football.goal');
  expect(goal?.payload).toMatchObject({
    scorer: 'ent-home-p9',
    assist: 'ent-home-p10',
    at: { period: 'H1', elapsed: goalAt },
  });

  await home(app);
  expect(
    homeCard().getByText(fill(w('home.scoring.finishedScore'), { score: '1–1 (3–0)' })),
  ).toBeTruthy();
}

describe('a football match from the scan to the shootout', () => {
  it('scan, Start match, then the pad: the clock at 0:00 in the 1st half with Start, both teams with Goal, Yellow, Red and Sub', async () => {
    const app = await scanned(KNOCKOUT);
    expect(app.nav.current()).toBe('scoring');
    expect(screen.getByTestId('start-screen')).toBeTruthy();
    await press(app, en['scoring.start.confirm']);
    expect(lastTap()).toBe(en['scoring.football.last.start']);
    expect(within(clockBar()).getByText('0:00')).toBeTruthy();
    expect(within(clockBar()).getByText(en['scoring.football.period.H1'])).toBeTruthy();
    expect(
      within(clockBar()).getByRole('button', { name: en['scoring.football.clock.start'] }),
    ).toBeTruthy();
    expect(within(column('first')).getByText('Riverside FC')).toBeTruthy();
    expect(within(column('second')).getByText('Northgate United')).toBeTruthy();
    expect((await ledger(app, KNOCKOUT)).map((event) => event.type)).toEqual(['core.start']);
  });

  it('plays a knockout tie through: a goal, a card and a sub, the halves, extra time and the kicks; Undo reopens the decision', async () => {
    await playKnockout(await scanned(KNOCKOUT), en);
  });

  it('5–5 after extra time, decided on the fourth round: Home’s card reads 5–5 (4–1)', async () => {
    const seed = footballSeed({
      cfg: KO_11,
      events: asSeed([...LEVEL_AFTER_ET, ...kicks('H+ A+ H+ A- H+ A-')]),
    });
    const app = await opened(seed);
    expect([value('first'), value('second')]).toEqual(['5 (3)', '5 (1)']);
    expect(within(column('first')).getAllByTestId('kick-scored')).toHaveLength(3);
    expect(within(column('second')).getAllByTestId('kick-missed')).toHaveLength(2);
    await kick(app, en, 'first', true);
    expect(resultCard()).toBeTruthy();
    expect([value('first'), value('second')]).toEqual(['5 (4)', '5 (1)']);
    await home(app);
    expect(
      homeCard().getByText(fill(en['home.scoring.finishedScore'], { score: '5–5 (4–1)' })),
    ).toBeTruthy();
  });
});

describe('offline (design §7.3)', () => {
  it('three taps queued with the clock running all go once back online, in order, each at the minute it was pressed', async () => {
    const seed = footballSeed({ events: asSeed(KICK_OFF) });
    const app = await opened(seed);
    app.scoring.goOffline(true);
    const pressedAt: number[] = [];

    await pressSquare(app, 'first');
    pressedAt.push(seconds);
    await press(app, en['scoring.football.sheet.dontKnow']);
    later(app, 70);
    await flush(0);
    await press(
      app,
      fill(en['scoring.football.column.yellowSaid'], { team: 'Northgate United' }),
      column('second'),
    );
    pressedAt.push(seconds);
    await press(app, '#5 N. Evans');
    await press(app, en['scoring.football.sheet.noReason']);
    later(app, 70);
    await flush(0);
    await pressSquare(app, 'second');
    pressedAt.push(seconds);
    await press(app, '#9 N. Ito');
    await press(app, en['scoring.football.sheet.noAssist']);

    expect([value('first'), value('second')]).toEqual(['1', '1']);
    // Nothing has reached the server: the badge counts the three, and the server can't be read while offline.
    expect(screen.getByTestId('sync').textContent).toBe('3');

    app.scoring.goOffline(false);
    for (let i = 0; i < 30; i += 1) {
      later(app);
      await flush(1000);
    }
    expect(screen.queryByTestId('sync')).toBeNull();
    const rows = await ledger(app, seed);
    expect(rows.map((event) => event.type)).toEqual([
      'core.start',
      'football.clock',
      'football.goal',
      'football.card',
      'football.goal',
    ]);
    // The seed's clock started at 0:00 when the match opened (TEST_NOW): a tap's stamp is the seconds since, at its press.
    expect(rows.slice(2).map((event) => (event.payload as { at: unknown }).at)).toEqual(
      pressedAt.map((elapsed) => ({ period: 'H1', elapsed })),
    );
    expect(pressedAt.map((at) => Math.floor(at / 60) + 1)).toEqual([1, 2, 3]);
  });
});

describe('the pad in the phone’s language', () => {
  it.each([
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)(
    '%s: the knockout tie played through, from Start match to the kicks and Home’s card, said in it',
    async (language, words: Words) => {
      await playKnockout(await opened(KNOCKOUT, [language]), words);
    },
  );
});
