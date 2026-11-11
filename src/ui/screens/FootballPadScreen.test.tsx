import { act, fireEvent, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSavedCode } from '@/domain/mode/savedCode';
import en from '@/i18n/en.json';
import { footballSeed } from '@/services/fakeFootballPad';
import type { FakeMatchSeed, FakeSeedEvent } from '@/services/fakeScoringPort';
import { STORE_KEYS } from '@/services/modeStore';
import { colour, layout, radius, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { TEST_NOW } from '../../../test/fakePorts';
import {
  KO_11,
  at,
  clock,
  goal,
  period,
  sinBin,
  start,
  type Spec,
} from '../../../test/footballLedger';
import {
  KICK_OFF,
  KICKS_4_1,
  KICKS_4_3,
  YELLOWED_HOME_4,
  ALL_HOME_SENT_OFF,
} from '../../../test/footballPadFixtures';
import { HOLD_MS } from '@/hooks/useHold';
import { pressIn, pressOut } from '../../../test/press';
import { screenIsHeld, type HoldLog } from '../../../test/heldScreen';
import { declaredStyle } from '../../../test/declaredStyle';
import { edgeOf, fillOf } from '../../../test/pressState';
import { layOut } from '../../../test/layOut';
import { linesAllowed } from '../../../test/linesAllowed';
import { LINK, linkKey } from '../../../test/scoringHomeFixtures';
import { backgroundAndBack, flush, launchApp, type LaunchedApp } from '../../../test/routedApp';

const holds = vi.hoisted((): HoldLog => []);
vi.mock('@/hooks/keepAwake', async () => {
  const { recordingHold } = await import('../../../test/heldScreen');
  return { holdScreenOn: recordingHold(holds) };
});

// Every render of a team's column that got past its memo: the clock ticks once a second, and the columns must not.
const renders = vi.hoisted(() => ({ columns: 0 }));
vi.mock('@/ui/components/TeamColumn', async () => {
  const actual = await vi.importActual<typeof import('@/ui/components/TeamColumn')>(
    '@/ui/components/TeamColumn',
  );
  const { createElement, memo } = await import('react');
  const Counted = memo(function Counted(props: ComponentProps<typeof actual.TeamColumn>) {
    renders.columns += 1;
    return createElement(actual.TeamColumn, props);
  });
  return { ...actual, TeamColumn: Counted };
});

beforeEach(() => {
  vi.useFakeTimers();
  holds.length = 0;
  renders.columns = 0;
});
afterEach(() => vi.useRealTimers());

// Plan S2-5 P Task 12: the football pad screen (design §6), on the fake server with the real runner, queue, sender and
// fold under it. Each test reads what the scorer sees; copy is the dictionary's, names are the fake's. What jsdom cannot
// see (the lime plate and the LED digits, the card icons' colours, a press's feedback, TalkBack) is the device check's.

const asSeed = (specs: readonly Spec[]): FakeSeedEvent[] =>
  specs.map(({ type, payload }) => ({ type, payload }));

const START: FakeSeedEvent = { type: 'core.start', payload: {} };
/** Started by another scorer, the clock not yet. */
const STARTED = footballSeed({ events: [START] });
/** Kicked off: the clock running from 0:00. */
const LIVE = footballSeed({ events: asSeed(KICK_OFF) });

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
/** The phone's clock `by` seconds on: the next tap is never in the bounce window of the last. */
function later(app: LaunchedApp, by = 1): void {
  seconds += by;
  app.setNow(new Date(TEST_NOW.getTime() + seconds * 1000));
}

async function open(seed: FakeMatchSeed) {
  seconds = 0;
  const app = await launchApp({ scoringSeed: seed, kvSeed: inMatch(seed) });
  await flush(200);
  return app;
}

async function press(app: LaunchedApp, name: string, within_: HTMLElement = document.body) {
  later(app);
  act(() => fireEvent.click(within(within_).getByRole('button', { name })));
  await flush(400);
}

const column = (side: 'first' | 'second') => screen.getByTestId(`column-${side}`);
/** End of period's screen-reader name: held, not tapped (owner ruling 160). */
const heldName = (word: string) => fill(en['scoring.football.hold.name'], { label: word });
const periodButton = (word: string) =>
  within(screen.getByTestId('tool-row')).getByRole('button', { name: heldName(word) });
const periodEvents = async (app: LaunchedApp, seed: FakeMatchSeed) => {
  const events = await app.scoring.events(LINK, seed.fixtureId, 0);
  return (Array.isArray(events) ? events : []).filter((event) => event.type === 'football.period');
};
const clockBar = () => screen.getByTestId('clock-bar');
const lastTap = () => screen.getByTestId('last-tap-sentence').textContent;
const value = (side: 'first' | 'second') =>
  within(column(side)).getByTestId('column-value').textContent;
/** A button's screen-reader name, from the dictionary: the team in it (controller ruling 140). */
const teamSaid = (word: 'yellowSaid' | 'redSaid' | 'subSaid', team: string) =>
  fill(en[`scoring.football.column.${word}`], { team });
const goalSaid = (team: string, score: string) =>
  fill(en['scoring.football.column.goalSaid'], { team, value: score });
const buttonNames = (side: 'first' | 'second') =>
  within(column(side))
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label'));
/** `ms` of the phone's time, a second at a time, as the clock leaf sees it. */
async function pass(app: LaunchedApp, ms: number): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
    later(app);
    await flush(1000);
  }
}
const fill = (text: string, vars: Record<string, string>) =>
  Object.entries(vars).reduce((out, [name, val]) => out.replace(`{${name}}`, val), text);

describe('the clock bar', () => {
  it('before kick-off the clock reads 0:00 under 1st half, with Start', async () => {
    await open(STARTED);
    expect(within(clockBar()).getByText('0:00')).toBeTruthy();
    expect(within(clockBar()).getByText(en['scoring.football.period.H1'])).toBeTruthy();
    expect(
      within(clockBar()).getByRole('button', { name: en['scoring.football.clock.start'] }),
    ).toBeTruthy();
  });

  it('runs with the shared clock: 0:05 five seconds after kick-off, and Pause in place of Start', async () => {
    const app = await open(LIVE);
    for (let i = 0; i < 5; i += 1) {
      later(app);
      await flush(1000);
    }
    expect(within(clockBar()).getByText('0:05')).toBeTruthy();
    expect(
      within(clockBar()).getByRole('button', { name: en['scoring.football.clock.pause'] }),
    ).toBeTruthy();
  });

  it('the clock face is no button: nothing on the time presses', async () => {
    const app = await open(LIVE);
    await pass(app, 3000);
    const time = within(clockBar()).getByText('0:03');
    later(app);
    act(() => fireEvent.click(time));
    act(() => fireEvent.click(time.parentElement!));
    await flush(400);
    expect(screen.queryByTestId('clock-correct-sheet')).toBeNull();
    expect(screen.queryByTestId('step-sheet')).toBeNull();
    expect(within(clockBar()).getAllByRole('button')).toHaveLength(1);
  });

  it('the one plate reads Start, then Pause while running, then Resume with PAUSED shown, and Start again after a break', async () => {
    const app = await open(STARTED);
    const plate = (word: string) =>
      within(clockBar()).getByRole('button', {
        name: (en as Record<string, string>)[`scoring.football.clock.${word}`],
      });
    expect(plate('start')).toBeTruthy();
    expect(within(clockBar()).queryByTestId('clock-paused')).toBeNull();
    await press(app, en['scoring.football.clock.start'], clockBar());
    expect(plate('pause')).toBeTruthy();
    expect(within(clockBar()).queryByTestId('clock-paused')).toBeNull();
    await press(app, en['scoring.football.clock.pause'], clockBar());
    expect(plate('resume')).toBeTruthy();
    expect(
      within(within(clockBar()).getByTestId('clock-paused')).getByText(
        en['scoring.football.clock.paused'],
      ),
    ).toBeTruthy();
    expect(getComputedStyle(within(clockBar()).getByText(/^\d+:\d\d$/)).color).toBe(
      edgeOf(colour.ink2),
    );
    await press(app, en['scoring.football.clock.resume'], clockBar());
    expect(plate('pause')).toBeTruthy();
    expect(within(clockBar()).queryByTestId('clock-paused')).toBeNull();
  });

  it('after Half-time the plate reads Start again, not Resume, and nothing says PAUSED', async () => {
    await open(footballSeed({ events: asSeed([...KICK_OFF, period('HT', at('H1', 2700))]) }));
    expect(
      within(clockBar()).getByRole('button', { name: en['scoring.football.clock.start'] }),
    ).toBeTruthy();
    expect(within(clockBar()).queryByTestId('clock-paused')).toBeNull();
    expect(within(clockBar()).getByText(en['scoring.football.break.halfTime'])).toBeTruthy();
  });

  it('ticks alone: in 5 s of a running clock the two team columns render at most twice in all', async () => {
    const app = await open(LIVE);
    renders.columns = 0;
    for (let i = 0; i < 5; i += 1) {
      later(app);
      await flush(1000);
    }
    expect(within(clockBar()).getByText('0:05')).toBeTruthy();
    expect(renders.columns).toBeLessThanOrEqual(2);
  });
});

describe('the team columns', () => {
  it('head each column with the team’s name and put its score in the Goal square, over Goal; Yellow, Red and Sub follow', async () => {
    await open(LIVE);
    expect(within(column('first')).getByText('Riverside FC')).toBeTruthy();
    expect(within(column('second')).getByText('Northgate United')).toBeTruthy();
    expect([value('first'), value('second')]).toEqual(['0', '0']);
    // The names carry the team (ruling 140); the words drawn are unchanged.
    expect(buttonNames('first')).toEqual([
      goalSaid('Riverside FC', '0'),
      teamSaid('yellowSaid', 'Riverside FC'),
      teamSaid('redSaid', 'Riverside FC'),
      teamSaid('subSaid', 'Riverside FC'),
    ]);
    expect(buttonNames('second')).toEqual([
      goalSaid('Northgate United', '0'),
      teamSaid('yellowSaid', 'Northgate United'),
      teamSaid('redSaid', 'Northgate United'),
      teamSaid('subSaid', 'Northgate United'),
    ]);
    expect(
      within(column('first'))
        .getAllByRole('button')
        .slice(1)
        .map((button) => button.textContent),
    ).toEqual([
      en['scoring.football.column.yellow'],
      en['scoring.football.column.red'],
      en['scoring.football.column.sub'],
    ]);
    const square = within(column('first')).getByTestId('goal-square');
    expect(within(square).getByTestId('column-value').textContent).toBe('0');
    expect(within(square).getByText(en['scoring.football.column.goal'])).toBeTruthy();
    expect(screen.queryByText('Card')).toBeNull();
  });

  it('draws no one-line scoreboard: each score is drawn once, inside its Goal square', async () => {
    const app = await open(LIVE);
    await press(app, goalSaid('Riverside FC', '0'), column('first'));
    await press(app, '#9 R. Ito');
    await press(app, en['scoring.football.sheet.noAssist']);
    expect(screen.getAllByTestId('column-value')).toHaveLength(2);
    for (const side of ['first', 'second'] as const)
      expect(
        within(within(column(side)).getByTestId('goal-square')).getByTestId('column-value'),
      ).toBeTruthy();
    expect(screen.getByTestId('tally').textContent).toBe('');
    expect(screen.getAllByText('1')).toHaveLength(1);
  });

  it('a goal with its scorer shows on the last-tap line and in the square; Undo takes it back; both numerals are night ink', async () => {
    const app = await open(LIVE);
    await press(app, goalSaid('Riverside FC', '0'), column('first'));
    await press(app, '#9 R. Ito');
    await press(app, en['scoring.football.sheet.noAssist']);
    const said = fill(en['scoring.football.last.goal'], {
      team: 'Riverside FC',
      who: ' · #9 R. Ito',
      at: " 1'",
    });
    expect(lastTap()).toBe(said);
    expect(value('first')).toBe('1');
    expect(
      within(column('first')).getByRole('button', { name: goalSaid('Riverside FC', '1') }),
    ).toBeTruthy();
    // No lead mark (the controller's ruling 135): the bigger number says who leads.
    for (const side of ['first', 'second'] as const)
      expect(getComputedStyle(within(column(side)).getByTestId('column-value')).color).toBe(
        edgeOf(colour.ground),
      );
    await press(app, en['scoring.pad.undo']);
    expect(lastTap()).toBe(fill(en['scoring.football.last.undone'], { what: said }));
    expect(value('first')).toBe('0');
  });
});

// Owner ruling 144: every button in a column is a square. jsdom has no layout, so what is read here is what the screen
// hands the column: the squares, their words, the note on its line, and the shootout's shape.
describe('the squares (ruling 144)', () => {
  const noteRoom = (side: 'first' | 'second') =>
    within(column(side)).getByTestId('column-note-room');

  it('the Goal square is alone in its room and Yellow, Red and Sub are one row of three squares, a mark over each word', async () => {
    await open(LIVE);
    const row = within(column('first')).getByTestId('column-cards');
    expect(within(row).getAllByRole('button')).toHaveLength(3);
    for (const square of within(row).getAllByRole('button'))
      expect(declaredStyle(square, 'aspect-ratio')).toBe('1 / 1');
    expect(within(row).getAllByTestId('card-swatch')).toHaveLength(2);
    expect(within(row).getAllByTestId('sub-glyph')).toHaveLength(1);
    expect(
      within(within(column('first')).getByTestId('goal-room')).getAllByRole('button'),
    ).toHaveLength(1);
  });

  it('a team with no team sheet has Sub disabled, greyed, its note on the line under the squares and in its name', async () => {
    await open(footballSeed({ sheet: 'none', events: asSeed(KICK_OFF) }));
    const note = en['scoring.football.column.noSheet'];
    const sub = within(column('first')).getByRole('button', {
      name: `${teamSaid('subSaid', 'Riverside FC')}, ${note}`,
    });
    expect(sub.getAttribute('aria-disabled')).toBe('true');
    expect(within(sub).queryByText(note)).toBeNull();
    expect(within(sub).getByText(en['scoring.football.column.sub'])).toBeTruthy();
    expect(within(noteRoom('first')).getByText(note)).toBeTruthy();
    expect(within(noteRoom('second')).getByText(note)).toBeTruthy();
  });

  it('a team with a team sheet has an empty note line, so the squares sit as high as the other team’s', async () => {
    await open(LIVE);
    expect(noteRoom('first').textContent).toBe('');
    expect(declaredStyle(noteRoom('first'), 'height')).toBe(
      declaredStyle(noteRoom('second'), 'height'),
    );
  });

  it('two taps on Sub open one player list, not two', async () => {
    const app = await open(LIVE);
    const sub = () =>
      within(column('first')).getByRole('button', { name: teamSaid('subSaid', 'Riverside FC') });
    later(app);
    act(() => {
      fireEvent.click(sub());
      fireEvent.click(sub());
    });
    await flush(400);
    expect(screen.getAllByTestId('step-sheet')).toHaveLength(1);
  });

  it('in the shootout Missed is one full-width row under the Scored square, and no squares row, note line or glyph', async () => {
    await open(footballSeed({ cfg: KO_11, events: asSeed(KICKS_4_3) }));
    for (const side of ['first', 'second'] as const) {
      const col = within(column(side));
      expect(col.queryByTestId('column-cards')).toBeNull();
      expect(col.queryByTestId('column-note-room')).toBeNull();
      expect(col.queryByTestId('sub-glyph')).toBeNull();
      const missed = col.getByRole('button', { name: en['scoring.football.column.missed'] });
      expect(declaredStyle(missed, 'min-height')).toBe(`${layout.touch}px`);
      expect(declaredStyle(missed, 'aspect-ratio')).toBe('');
      expect(col.getByTestId('goal-room')).toBeTruthy();
    }
  });
});

// Owner ruling 152: FULL TIME and MORE are in bright ink (`ink`) as in the mockup, not the shared tool row's `ink2`.
describe('the tools in bright ink (ruling 152)', () => {
  it('draws the standard tools’ words in full cream on the football pad', async () => {
    await open(LIVE);
    const tools = within(screen.getByTestId('tool-row'));
    for (const word of [en['scoring.football.tool.more'], en['scoring.football.end.HT']]) {
      const button = tools.getByRole('button', {
        name: word === en['scoring.football.end.HT'] ? heldName(word) : word,
      });
      expect(getComputedStyle(within(button).getByText(word)).color).toBe(edgeOf(colour.ink));
    }
  });
});

// Owner ruling 146: no empty band between the header and the clock.
describe('the clock under the header (ruling 146)', () => {
  it('has no strip above the clock; the clock is the first thing under the header', async () => {
    await open(LIVE);
    expect(screen.queryByTestId('pad-strip')).toBeNull();
    expect(screen.queryByTestId('strip-note')).toBeNull();
    // The header's tally is an empty, zero-width text for football and sits in the header row, not above the clock.
    expect(screen.getByTestId('tally').textContent).toBe('');
    const pad = screen.getByTestId('pad-content');
    const [header, body] = [...pad.children];
    expect(within(header as HTMLElement).getByRole('button', { name: 'Home' })).toBeTruthy();
    expect(within(header as HTMLElement).queryByTestId('football-board')).toBeNull();
    expect((body as HTMLElement).contains(screen.getByTestId('football-board'))).toBe(true);
    expect(screen.getByTestId('football-board').firstElementChild).toBe(clockBar());
  });

  // The mockup: the digits and the period line sit in one rounded panel on `surface`, tight padding, the plate under it.
  it('draws the time and the period line in one rounded surface panel, the plate outside it', async () => {
    await open(STARTED);
    const panel = within(clockBar()).getByTestId('clock-face');
    expect(getComputedStyle(panel).backgroundColor).toBe(fillOf(colour.surface));
    expect(getComputedStyle(panel).borderTopLeftRadius).toBe(`${radius.card}px`);
    expect(declaredStyle(panel, 'padding-top')).toBe(`${space.sm}px`);
    expect(within(panel).getByText('0:00')).toBeTruthy();
    expect(within(panel).getByText(en['scoring.football.period.H1'])).toBeTruthy();
    expect(within(panel).queryByRole('button')).toBeNull();
    expect(panel.parentElement).toBe(clockBar());
  });
});

describe('Yellow and Red (ruling 136)', () => {
  /** The home side's number 4 already on a yellow, after kick-off. */
  const BOOKED = footballSeed({ events: asSeed(YELLOWED_HOME_4) });

  it('Yellow opens the player list at once, with no colour step, titled for the colour and the team', async () => {
    const app = await open(LIVE);
    await press(app, teamSaid('yellowSaid', 'Riverside FC'), column('first'));
    const sheet = screen.getByTestId('step-sheet');
    expect(
      within(sheet).getByText(fill(en['scoring.football.sheet.yellow'], { team: 'Riverside FC' })),
    ).toBeTruthy();
    expect(within(sheet).getByText('#9 R. Ito')).toBeTruthy();
    expect(within(sheet).queryByText(en['scoring.football.card.second_yellow'])).toBeNull();
    expect(within(sheet).queryByText(en['scoring.football.sheet.secondYellow'])).toBeNull();
  });

  it('a player on a yellow stays in the list with “2nd yellow · sent off”, and choosing him records a second yellow', async () => {
    const app = await open(BOOKED);
    await press(app, teamSaid('yellowSaid', 'Riverside FC'), column('first'));
    const sheet = screen.getByTestId('step-sheet');
    expect(within(sheet).getAllByText(en['scoring.football.sheet.secondYellow'])).toHaveLength(1);
    later(app);
    act(() => fireEvent.click(within(sheet).getByRole('button', { name: /^#4 / })));
    await flush(400);
    await press(app, en['scoring.football.sheet.noReason']);
    expect(lastTap()).toContain(en['scoring.football.card.second_yellow']);
  });

  it('Red names the colour in the title, with no 2nd yellow note', async () => {
    const app = await open(BOOKED);
    await press(app, teamSaid('redSaid', 'Northgate United'), column('second'));
    const sheet = screen.getByTestId('step-sheet');
    expect(
      within(sheet).getByText(fill(en['scoring.football.sheet.red'], { team: 'Northgate United' })),
    ).toBeTruthy();
    expect(within(sheet).queryByText(en['scoring.football.sheet.secondYellow'])).toBeNull();
  });

  // Ruling 139: nobody left to book is said in one line, not an unexplained empty sheet.
  it('with everyone sent off, Yellow opens a sheet that says no one can be booked', async () => {
    const app = await open(footballSeed({ events: asSeed(ALL_HOME_SENT_OFF) }));
    await press(app, teamSaid('yellowSaid', 'Riverside FC'), column('first'));
    const sheet = screen.getByTestId('step-sheet');
    expect(within(sheet).getByText(en['scoring.football.sheet.noOneToBook'])).toBeTruthy();
    expect(within(sheet).queryAllByRole('button')).toHaveLength(1);
    await press(app, en['scoring.sheet.cancel']);
    expect(screen.queryByTestId('step-sheet')).toBeNull();
  });

  it('a double tap on Yellow opens one sheet, and Cancel closes it with nothing recorded', async () => {
    const app = await open(LIVE);
    later(app);
    const yellow = within(column('first')).getByRole('button', {
      name: teamSaid('yellowSaid', 'Riverside FC'),
    });
    act(() => fireEvent.click(yellow));
    act(() => fireEvent.click(yellow));
    await flush(400);
    expect(screen.getAllByTestId('step-sheet')).toHaveLength(1);
    await press(app, en['scoring.sheet.cancel']);
    expect(screen.queryByTestId('step-sheet')).toBeNull();
  });
});

// The controller's fix-round 2 ruling (R1), redone for the clock hero (ruling 130): the board's own height picks its tier.
// The full tier needs the hero's 180 dp (a 116 panel, 8, the 48 plate, 8) over a column of 292 (2 × 8 and the 4 colour bar, an 84 head, a 100
// Goal room, 3 × 8, the 48 row of squares and the 16 note line): 472. Below it the clock and both columns go compact, at once
// (footballFit.test.ts holds the heights).
describe('a short phone (ruling R1)', () => {
  const H1 = en['scoring.football.period.H1'];
  const name = () => within(column('second')).getByText('Northgate United');
  const timeSize = () => getComputedStyle(within(clockBar()).getByText('0:00')).fontSize;
  const FULL = `${typeScale.clockHero.fontSize}px`;
  const COMPACT = `${typeScale.tallyCompact.fontSize}px`;

  it('at 472 dp of board the pad is full; at 471 the clock and the columns go compact', async () => {
    await open(STARTED);
    // Before the phone lays the board out, it is full.
    expect(linesAllowed(name())).toBe(2);
    expect(timeSize()).toBe(FULL);
    expect(within(clockBar()).getByText(H1)).toBeTruthy();
    const board = screen.getByTestId('football-board');
    layOut(board, { width: 328, height: 472 });
    expect(timeSize()).toBe(FULL);
    expect(linesAllowed(name())).toBe(2);
    layOut(board, { width: 328, height: 471 });
    expect(timeSize()).toBe(COMPACT);
    expect(linesAllowed(name())).toBe(1);
    expect(linesAllowed(within(column('first')).getByText('Riverside FC'))).toBe(1);
    expect(declaredStyle(screen.getAllByTestId('goal-room')[0]!, 'min-height')).toBe(
      `${layout.touch}px`,
    );
  });

  // Ruling 150: the height the Goal square cannot use goes to the digits, laid out, never on a tick.
  it('a tall board grows the digits to 106 dp, a short full one keeps 80, and a compact one its step down', async () => {
    await open(STARTED);
    const board = screen.getByTestId('football-board');
    layOut(board, { width: 380, height: 664 });
    expect(timeSize()).toBe('106px');
    layOut(board, { width: 328, height: 472 });
    expect(timeSize()).toBe(FULL);
    layOut(board, { width: 380, height: 300 });
    expect(timeSize()).toBe(COMPACT);
  });

  it('a phone that grows again goes back to full', async () => {
    await open(STARTED);
    const board = screen.getByTestId('football-board');
    layOut(board, { width: 328, height: 330 });
    expect(linesAllowed(name())).toBe(1);
    expect(timeSize()).toBe(COMPACT);
    layOut(board, { width: 328, height: 500 });
    expect(linesAllowed(name())).toBe(2);
    expect(timeSize()).toBe(FULL);
    expect(within(clockBar()).getByText(H1)).toBeTruthy();
  });
});

describe('the shootout and the end (design §6.5, §6.7)', () => {
  it('each column has Scored and Missed, live only for the team to kick, and the kicks so far', async () => {
    await open(footballSeed({ cfg: KO_11, events: asSeed(KICKS_4_3) }));
    const scored = (team: string, score: string) =>
      fill(en['scoring.football.column.scoredSaid'], { team, value: score });
    const missed = en['scoring.football.column.missed'];
    expect(buttonNames('first')).toEqual([scored('Riverside FC', '5 (4)'), missed]);
    expect(buttonNames('second')).toEqual([scored('Northgate United', '5 (3)'), missed]);
    // The shootout's column is the square (Scored, with the same numeral) and Missed: no Yellow, Red or Sub.
    expect(within(column('first')).queryByTestId('column-cards')).toBeNull();
    expect(within(column('first')).getByTestId('goal-square')).toBeTruthy();
    expect(
      within(within(column('first')).getByTestId('goal-square')).getByText(
        en['scoring.football.column.scored'],
      ),
    ).toBeTruthy();
    const disabled = (side: 'first' | 'second') =>
      within(column(side))
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-disabled') === 'true');
    expect(disabled('first')).toEqual([true, true]);
    expect(disabled('second')).toEqual([false, false]);
    expect(within(column('first')).getAllByTestId('kick-scored')).toHaveLength(4);
    expect(within(column('second')).getAllByTestId('kick-scored')).toHaveLength(3);
    expect([value('first'), value('second')]).toEqual(['5 (4)', '5 (3)']);
  });

  // Controller ruling 156 (F-R4): the columns stay Scored and Missed; a booking during the kicks is made from More.
  it('in the shootout More offers a Yellow and a Red card for each team, and its Yellow books a player', async () => {
    const app = await open(footballSeed({ cfg: KO_11, events: asSeed(KICKS_4_3) }));
    await press(app, en['scoring.football.tool.more']);
    const sheet = screen.getByTestId('step-sheet');
    const yellow = (team: string) => fill(en['scoring.football.sheet.yellow'], { team });
    const red = (team: string) => fill(en['scoring.football.sheet.red'], { team });
    for (const row of [
      yellow('Riverside FC'),
      red('Riverside FC'),
      yellow('Northgate United'),
      red('Northgate United'),
    ])
      expect(within(sheet).getByRole('button', { name: row })).toBeTruthy();
    await press(app, yellow('Riverside FC'), sheet);
    const players = screen.getByTestId('step-sheet');
    expect(within(players).getByText(yellow('Riverside FC'))).toBeTruthy();
    later(app);
    act(() => fireEvent.click(within(players).getByRole('button', { name: '#9 R. Ito' })));
    await flush(400);
    await press(app, en['scoring.football.sheet.noReason']);
    expect(lastTap()).toContain(en['scoring.football.card.yellow']);
    expect(buttonNames('first')).toHaveLength(2);
  });

  it('a decided match shows the result card over the columns, and the shootout’s score', async () => {
    await open(footballSeed({ cfg: KO_11, events: asSeed(KICKS_4_1) }));
    expect(screen.getByTestId('pad-card').textContent).toContain(
      en['scoring.card.resultRecorded.title'],
    );
    expect([value('first'), value('second')]).toEqual(['5 (4)', '5 (1)']);
  });
});

/** Adjust clock as the scorer reaches it: More, then its row (the clock face opens nothing: ruling 134). */
async function openAdjust(app: LaunchedApp): Promise<void> {
  await press(app, en['scoring.football.tool.more']);
  expect(en['scoring.football.more.correct']).toBe('Adjust clock');
  await press(app, en['scoring.football.more.correct']);
}

describe('the clock’s Adjust clock, the sheets and a sin-bin', () => {
  it('Adjust clock opens from More alone, and its time runs on with the clock while it is open', async () => {
    const app = await open(LIVE);
    await pass(app, 3000);
    await openAdjust(app);
    const sheet = screen.getByTestId('clock-correct-sheet');
    expect(within(sheet).getByText(en['scoring.football.correct.title'])).toBeTruthy();
    expect(
      within(sheet).getByRole('button', { name: en['scoring.football.correct.set'] }),
    ).toBeTruthy();
    expect(within(sheet).getByText('0:05')).toBeTruthy();
    await pass(app, 3000);
    expect(within(sheet).getByText('0:08')).toBeTruthy();
    await press(app, en['scoring.football.correct.fwd60'], sheet);
    expect(within(sheet).getByText('1:09')).toBeTruthy();
  });

  // Fix round 1, M1: the floor flag is judged where the time is drawn, each second, so a running clock frees the back
  // steppers as soon as its time passes the floor.
  it('Correct at the floor frees its back steppers as the running clock carries the time past it', async () => {
    const scored = footballSeed({
      events: asSeed([start(), clock(true, at('H1', 0)), goal({ by: 'H', at: at('H1', 3) })]),
    });
    const app = await open(scored);
    await pass(app, 4000);
    await openAdjust(app);
    const sheet = screen.getByTestId('clock-correct-sheet');
    const back = () =>
      within(sheet).getByRole('button', { name: en['scoring.football.correct.back10'] });
    await press(app, en['scoring.football.correct.back60'], sheet);
    expect(within(sheet).getByText('0:03')).toBeTruthy();
    expect(back().getAttribute('aria-disabled')).toBe('true');
    expect(within(sheet).queryByText(en['scoring.football.correct.floor'])).not.toBeNull();
    await pass(app, 3000);
    expect(within(sheet).getByText('0:06')).toBeTruthy();
    expect(back().getAttribute('aria-disabled')).not.toBe('true');
    expect(within(sheet).queryByText(en['scoring.football.correct.floor'])).toBeNull();
  });

  it('History from the top bar lists the goal; Match details opens from More', async () => {
    const app = await open(LIVE);
    await press(app, goalSaid('Riverside FC', '0'), column('first'));
    await press(app, en['scoring.football.sheet.dontKnow']);
    await press(app, en['scoring.history.title']);
    const history = screen.getByTestId('history');
    expect(history.textContent).toContain(
      fill(en['scoring.football.last.goal'], { team: 'Riverside FC', who: '', at: " 1'" }),
    );
    await press(app, en['panel.close'], history);
    await press(app, en['scoring.football.tool.more']);
    await press(app, en['scoring.football.more.details']);
    expect(screen.getByTestId('details-sheet')).toBeTruthy();
  });

  it('a player in the sin-bin is marked by shirt number, and Sin-bin over once the clock passes the bin’s end', async () => {
    // Ten minutes in the bin from 0:00 (KO_11's sinBinMinutes), the clock moved on to 9:55 and running.
    const binned = footballSeed({
      cfg: KO_11,
      events: asSeed([
        start(),
        clock(true, at('H1', 0)),
        sinBin({ by: 'H', person: 'ent-home-p4', at: at('H1', 0) }),
        clock(false, at('H1', 0)),
        clock(true, at('H1', 595)),
      ]),
    });
    const app = await open(binned);
    expect(within(column('first')).getByTestId('sin-bin').textContent).toBe('#4');
    await pass(app, 6000);
    expect(within(column('first')).getByTestId('sin-bin').textContent).toBe(
      `#4 · ${en['scoring.football.mark.sinBinOver']}`,
    );
    // One line, cut with an ellipsis where it does not fit (fix-round ruling b), so the buttons under it never move.
    expect(linesAllowed(within(column('first')).getByTestId('sin-bin'))).toBe(1);
  });

  // The final review's fix-now (2026-11-08): a bin with no player named says just that it is over, with no empty name
  // in front of a " · ".
  it('a sin-bin with no player named reads just Sin-bin over once the clock passes its end', async () => {
    const binned = footballSeed({
      cfg: KO_11,
      events: asSeed([
        start(),
        clock(true, at('H1', 0)),
        sinBin({ by: 'H', at: at('H1', 0) }),
        clock(false, at('H1', 0)),
        clock(true, at('H1', 595)),
      ]),
    });
    const app = await open(binned);
    await pass(app, 6000);
    expect(within(column('first')).getByTestId('sin-bin').textContent).toBe(
      en['scoring.football.mark.sinBinOver'],
    );
  });
});

describe('the screen kept on', () => {
  it('holds the screen on while the pad stands', async () => {
    await open(LIVE);
    expect(screenIsHeld(holds)).toBe(true);
  });

  it('a decided match the organiser locks lets the screen go', async () => {
    const app = await open(footballSeed({ cfg: KO_11, events: asSeed(KICKS_4_1) }));
    expect(screenIsHeld(holds)).toBe(true);
    app.scoring.finalize();
    await pass(app, 16_000);
    await backgroundAndBack(app);
    await flush(2_000);
    expect(screen.getByTestId('pad-card').textContent).toContain(en['scoring.card.viewOnly.title']);
    expect(screenIsHeld(holds)).toBe(false);
  });
});

// Owner ruling 160 (2026-11-11): "half time and full time, we need to hold for 3 seconds to confirm otherwise it just
// ending straightaway". The fill's motion and the press feel are the device's; here, what is sent and when.
describe('End of period is a 3 s hold (ruling 160)', () => {
  const NO_STAMP = footballSeed({ events: asSeed(KICK_OFF) });

  it('a tap sends nothing, and a release a millisecond early sends nothing', async () => {
    const app = await open(NO_STAMP);
    const button = periodButton(en['scoring.football.end.HT']);
    act(() => fireEvent.click(button));
    await flush(400);
    pressIn(button);
    await flush(HOLD_MS - 1);
    pressOut(button);
    await flush(HOLD_MS);
    expect(await periodEvents(app, NO_STAMP)).toEqual([]);
  });

  it('a hold of HOLD_MS sends exactly one end of period, and a press mid-hold does not send a second', async () => {
    const app = await open(NO_STAMP);
    const button = periodButton(en['scoring.football.end.HT']);
    pressIn(button);
    await flush(1000);
    pressIn(button);
    await flush(HOLD_MS);
    expect(await periodEvents(app, NO_STAMP)).toHaveLength(1);
  });

  it('after it, the tool is off while it re-arms, so a hold begun at once sends nothing more', async () => {
    const app = await open(NO_STAMP);
    pressIn(periodButton(en['scoring.football.end.HT']));
    await flush(HOLD_MS);
    expect(await periodEvents(app, NO_STAMP)).toHaveLength(1);
    const next = within(screen.getByTestId('tool-row')).getByRole('button', {
      name: /Hold for/,
    });
    pressIn(next);
    await flush(HOLD_MS + 500);
    expect(await periodEvents(app, NO_STAMP)).toHaveLength(1);
  });

  it('says so on the plate: the label and a hold line, named "Hold for …", More staying a tap', async () => {
    await open(NO_STAMP);
    const button = periodButton(en['scoring.football.end.HT']);
    expect(within(button).getByText(en['scoring.football.end.HT'])).toBeTruthy();
    expect(within(button).getByText(en['scoring.football.hold.hint'])).toBeTruthy();
    const more = within(screen.getByTestId('tool-row')).getByRole('button', {
      name: en['scoring.football.tool.more'],
    });
    expect(within(more).queryByText(en['scoring.football.hold.hint'])).toBeNull();
  });

  it.each([
    ['H1', 'HT', []],
    ['H2', 'FT', [period('HT', at('H1', 2700)), clock(true, at('H2', 0))]],
  ] as const)('in %s the held plate reads %s', async (_phase, marker, before) => {
    await open(footballSeed({ events: asSeed([...KICK_OFF, ...before]) }));
    expect(periodButton(en[`scoring.football.end.${marker}`])).toBeTruthy();
  });
});
