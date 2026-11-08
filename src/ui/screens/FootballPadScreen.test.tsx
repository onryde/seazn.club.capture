import { act, fireEvent, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSavedCode } from '@/domain/mode/savedCode';
import en from '@/i18n/en.json';
import { footballSeed } from '@/services/fakeFootballPad';
import type { FakeMatchSeed, FakeSeedEvent } from '@/services/fakeScoringPort';
import { STORE_KEYS } from '@/services/modeStore';
import { colour } from '@/ui/theme/tokens';
import { TEST_NOW } from '../../../test/fakePorts';
import { KO_11, at, clock, goal, sinBin, start, type Spec } from '../../../test/footballLedger';
import { KICK_OFF, KICKS_4_1, KICKS_4_3 } from '../../../test/footballPadFixtures';
import { screenIsHeld, type HoldLog } from '../../../test/heldScreen';
import { edgeOf } from '../../../test/pressState';
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
const clockBar = () => screen.getByTestId('clock-bar');
const lastTap = () => screen.getByTestId('last-tap-sentence').textContent;
const value = (side: 'first' | 'second') =>
  within(column(side)).getByTestId('column-value').textContent;
const scoreColours = () =>
  (['first', 'second'] as const).map(
    (side) => getComputedStyle(within(column(side)).getByTestId('column-value')).color,
  );
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
  it('show each team’s name, its score and Goal, Card and Sub', async () => {
    await open(LIVE);
    expect(within(column('first')).getByText('Riverside FC')).toBeTruthy();
    expect(within(column('second')).getByText('Northgate United')).toBeTruthy();
    expect([value('first'), value('second')]).toEqual(['0', '0']);
    const words = [
      en['scoring.football.column.goal'],
      en['scoring.football.column.card'],
      en['scoring.football.column.sub'],
    ];
    expect(buttonNames('first')).toEqual(words);
    expect(buttonNames('second')).toEqual(words);
  });

  it('a goal with its scorer shows on the last-tap line and the score; Undo takes it back', async () => {
    const app = await open(LIVE);
    await press(app, en['scoring.football.column.goal'], column('first'));
    await press(app, '#9 R. Ito');
    await press(app, en['scoring.football.sheet.noAssist']);
    const said = fill(en['scoring.football.last.goal'], {
      team: 'Riverside FC',
      who: ' · #9 R. Ito',
      at: " 1'",
    });
    expect(lastTap()).toBe(said);
    expect(value('first')).toBe('1');
    // The leading side's score in the LED lime, the other's in cream (design §6.2).
    expect(scoreColours()).toEqual([edgeOf(colour.lime), edgeOf(colour.ink)]);
    await press(app, en['scoring.pad.undo']);
    expect(lastTap()).toBe(fill(en['scoring.football.last.undone'], { what: said }));
    expect(value('first')).toBe('0');
    expect(scoreColours()).toEqual([edgeOf(colour.ink), edgeOf(colour.ink)]);
  });
});

describe('the shootout and the end (design §6.5, §6.7)', () => {
  it('each column has Scored and Missed, live only for the team to kick, and the kicks so far', async () => {
    await open(footballSeed({ cfg: KO_11, events: asSeed(KICKS_4_3) }));
    const kicks = [en['scoring.football.column.scored'], en['scoring.football.column.missed']];
    expect(buttonNames('first')).toEqual(kicks);
    expect(buttonNames('second')).toEqual(kicks);
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

  it('a decided match shows the result card over the columns, and the shootout’s score', async () => {
    await open(footballSeed({ cfg: KO_11, events: asSeed(KICKS_4_1) }));
    expect(screen.getByTestId('pad-card').textContent).toContain(
      en['scoring.card.resultRecorded.title'],
    );
    expect([value('first'), value('second')]).toEqual(['5 (4)', '5 (1)']);
  });
});

describe('the clock’s Correct, the sheets and a sin-bin', () => {
  it('a tap on the time opens Correct, whose time runs on with the clock while it is open', async () => {
    const app = await open(LIVE);
    await pass(app, 3000);
    later(app);
    act(() =>
      fireEvent.click(
        within(clockBar()).getByRole('button', {
          name: fill(en['scoring.football.clock.said'], { time: '0:03' }),
        }),
      ),
    );
    await flush(400);
    const sheet = screen.getByTestId('clock-correct-sheet');
    expect(within(sheet).getByText(en['scoring.football.correct.title'])).toBeTruthy();
    expect(within(sheet).getByText('0:04')).toBeTruthy();
    await pass(app, 3000);
    expect(within(sheet).getByText('0:07')).toBeTruthy();
    await press(app, en['scoring.football.correct.fwd60'], sheet);
    expect(within(sheet).getByText('1:08')).toBeTruthy();
  });

  // Fix round 1, M1: the floor flag is judged where the time is drawn, each second, so a running clock frees the back
  // steppers as soon as its time passes the floor.
  it('Correct at the floor frees its back steppers as the running clock carries the time past it', async () => {
    const scored = footballSeed({
      events: asSeed([start(), clock(true, at('H1', 0)), goal({ by: 'H', at: at('H1', 3) })]),
    });
    const app = await open(scored);
    await pass(app, 4000);
    later(app);
    act(() =>
      fireEvent.click(
        within(clockBar()).getByRole('button', {
          name: fill(en['scoring.football.clock.said'], { time: '0:04' }),
        }),
      ),
    );
    await flush(400);
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
    await press(app, en['scoring.football.column.goal'], column('first'));
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
