import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLanguage } from '@/hooks/useLanguage';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { colour, layout, space } from '@/ui/theme/tokens';
import { TEST_NOW, type FakePorts } from '../../../test/fakePorts';
import { screenIsHeld, type HoldLog } from '../../../test/heldScreen';
import { layOut } from '../../../test/layOut';
import { linesAllowed } from '../../../test/linesAllowed';
import { edgeOf } from '../../../test/pressState';
import { CHIP, PadWithPreviewChips } from '../../../test/padPreviewHarness';
import { renderWithPorts } from '../../../test/renderWithPorts';
import { restoreWindowSize, setWindowSize } from '../../../test/windowSize';

/** Which screens hold the phone's screen on, recorded where the pad asks (`test/heldScreen.ts`). */
const holds = vi.hoisted((): HoldLog => []);
vi.mock('@/hooks/keepAwake', async () => {
  const { recordingHold } = await import('../../../test/heldScreen');
  return { holdScreenOn: recordingHold(holds) };
});

beforeEach(() => {
  holds.length = 0;
});
afterEach(restoreWindowSize);

type Pad = ReturnType<typeof renderWithPorts>;

const DICTIONARIES: Readonly<Record<string, typeof en>> = { en, es, fr, nl };

/** The preview as Home opens it, on its own route: the Start screen, as the samples begin (owner, 2026-11-01). */
function renderStart(options?: Parameters<typeof renderWithPorts>[1]): Pad {
  const view = renderWithPorts(<PadWithPreviewChips />, options);
  act(() => view.navigation.go('scoring'));
  latest = view;
  return view;
}

/** The preview `renderStart` last opened: `choose` moves its clock. */
let latest: Pad | null = null;

/**
 * The preview with its match started as the scorer starts it, A. Sharma picked to serve first, a minute before the
 * test's own taps (never in the start's bounce window), and the phone's clock a second on for every tap.
 */
function renderPad(options?: Parameters<typeof renderWithPorts>[1]): Pad {
  const view = renderStart(options);
  const words = DICTIONARIES[options?.deviceLanguages?.[0] ?? 'en'] ?? en;
  view.setNow(new Date(TEST_NOW.getTime() - 60_000));
  act(() => fireEvent.click(screen.getByRole('radio', { name: 'A. Sharma' })));
  act(() => fireEvent.click(screen.getByRole('button', { name: words['scoring.start.confirm'] })));
  view.setNow(TEST_NOW);
  return view;
}

let seconds = 0;
/** The phone's clock a second on: the next tap is never in the bounce window of the last. */
function aSecondOn(pad: FakePorts) {
  seconds += 1;
  pad.setNow(new Date(TEST_NOW.getTime() + seconds * 1000));
}

/** A scorer's taps on one half, a second apart. */
function rally(pad: FakePorts, side: 'first' | 'second', times = 1) {
  for (let at = 0; at < times; at += 1) {
    aSecondOn(pad);
    act(() => fireEvent.click(screen.getByTestId(`half-${side}`)));
  }
}

/** The scorer's Undo, a second after whatever came before it. */
function undoTap(pad: FakePorts) {
  aSecondOn(pad);
  press(en['scoring.pad.undo']);
}

/** Android Back, as the phone delivers it: React flushes what it changed before the test reads the screen. */
function back(pad: FakePorts): boolean {
  let handled = false;
  act(() => {
    handled = pad.back.press();
  });
  return handled;
}

const press = (name: string) => act(() => fireEvent.click(screen.getByRole('button', { name })));
/**
 * A tap a second on: a sheet step's button (a sanction's level, person or confirm, Set score's Confirm, the ending
 * prompt's, Match details' Close), never in the window of its step appearing, and a tool never in the window of the
 * sheet button before it (the coordinator's ruling and review I1, 2026-11-01).
 */
const choose = (name: string) => {
  if (latest !== null) aSecondOn(latest);
  press(name);
};
const half = (side: 'first' | 'second') => screen.getByTestId(`half-${side}`);
/** The half's big number: the game under way's points (a box may hold the same digits). */
const shows = (side: 'first' | 'second', points: number) =>
  within(half(side)).getByTestId('score').textContent === String(points);
const tool = (name: string) => screen.queryByRole('button', { name });
const sanctionOn = (side: string) => `${en['scoring.badminton.tool.sanction']}, ${side}`;
const lastTap = () => screen.getByTestId('last-tap').textContent;
const undo = () => screen.getByRole('button', { name: en['scoring.pad.undo'] });
/** The last-tap line as `renderPad` leaves it: the start, A. Sharma serving, then Undo (owner, 2026-11-01). */
const startedLine = () =>
  fill(en['scoring.badminton.last.start'], { side: 'A. Sharma' }) + en['scoring.pad.undo'];
/**
 * The preview's rules (best of 3, 21 won by 2, capped at 30, the interval at 11), each row of the match card's table as
 * a screen reader hears it ("Format: Best of 3 games"), in the dictionary's words (owner, 2026-11-01, option A).
 */
const rowsSaid = (words: Readonly<Record<string, string>>) =>
  (
    [
      ['format', 'scoring.badminton.rules.bestOf.other', { count: 3 }],
      ['points', 'scoring.badminton.rules.points.value', { points: 21, winBy: 2 }],
      ['cap', 'scoring.badminton.rules.cap.value', { cap: 30 }],
      ['interval', 'scoring.badminton.rules.interval.value', { point: 11 }],
      ['endsChange', 'scoring.badminton.rules.endsChange.value', { point: 11, game: 3 }],
    ] as const
  ).map(([name, key, vars]) =>
    fill(words['scoring.rules.row'] ?? '', {
      label: words[`scoring.badminton.rules.${name}.label`] ?? '',
      value: fill(words[key] ?? '', vars),
    }),
  );
/** The match card's rows, as heard, in an element. */
const rowsIn = (element: HTMLElement) =>
  within(element)
    .getAllByTestId('match-card-row')
    .map((row) => row.getAttribute('aria-label'));

const fill = (text: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce(
    (out, [name, value]) => out.replace(`{${name}}`, String(value)),
    text,
  );
/** A half's finished games' boxes, as their digits (owner ruling 16). */
const boxes = (side: 'first' | 'second') =>
  within(half(side))
    .queryAllByTestId('period')
    .map((box) => box.textContent);
/** The serving plate's words in a half, or null when it is not serving (owner ruling 17). */
const plate = (side: 'first' | 'second') =>
  within(half(side)).queryByTestId('serving')?.textContent ?? null;

describe('BadmintonPadScreen: before the first rally', () => {
  it('shows both sides at 0, the first serving from the right, and Set score', () => {
    renderPad();
    expect(shows('first', 0) && shows('second', 0)).toBe(true);
    expect([plate('first'), plate('second')]).toEqual([
      en['scoring.badminton.serving.right'],
      null,
    ]);
    expect([boxes('first'), boxes('second')]).toEqual([[], []]);
    expect(screen.getByTestId('strip-game').textContent).toBe(
      fill(en['scoring.badminton.gameOf'], { game: 1, bestOf: 3 }),
    );
    // Owner ruling 17: the court is on the plate, and left the strip.
    expect(screen.queryByTestId('strip-court')).toBeNull();
    expect(screen.getByTestId('strip-interval').textContent).toBe(
      fill(en['scoring.badminton.intervalAt'], { point: 11 }),
    );
    expect(tool(en['scoring.badminton.tool.setScore'])).not.toBeNull();
    expect(tool(sanctionOn('A. Sharma'))).not.toBeNull();
    expect(tool(sanctionOn('L. Chen'))).not.toBeNull();
    // The start is the last tap, and Undo can take it back while nothing follows it (owner, 2026-11-01).
    expect(lastTap()).toBe(startedLine());
    expect(undo().getAttribute('aria-disabled')).not.toBe('true');
  });

  // Owner, 2026-11-01: "can we have 0:0 with lime light in place of preview". The preview row marks the preview.
  it('starts the games tally at 0:0 in lime where the Preview tag was, and says the taps are synced', () => {
    renderPad();
    const tally = screen.getByTestId('tally');
    expect(tally.textContent).toBe('0:0');
    expect(tally.getAttribute('aria-label')).toBe(
      fill(en['scoring.badminton.gamesTally'], {
        first: 'A. Sharma',
        firstGames: 0,
        second: 'L. Chen',
        secondGames: 0,
      }),
    );
    expect(getComputedStyle(tally).color).toBe(edgeOf(colour.lime));
    expect(screen.queryByText('Preview')).toBeNull();
    expect(screen.getByLabelText(CHIP.row)).toBeTruthy();
    expect(screen.getByTestId('sync').textContent).toBe(en['scoring.sync.synced']);
  });
});

describe('BadmintonPadScreen: rallies and Undo', () => {
  it('gives a tap on the top half the rally: the top score rises, the serve and the court follow', () => {
    const pad = renderPad();
    rally(pad, 'first');
    expect(shows('first', 1) && shows('second', 0)).toBe(true);
    expect(plate('first')).toBe(en['scoring.badminton.serving.left']);
    expect(lastTap()).toContain(fill(en['scoring.badminton.last.rally'], { side: 'A. Sharma' }));
    expect(tool(en['scoring.badminton.tool.setScore'])).toBeNull();
  });

  it('gives a tap on the bottom half the rally and the serve', () => {
    const pad = renderPad();
    rally(pad, 'second');
    expect(shows('first', 0) && shows('second', 1)).toBe(true);
    expect([plate('first'), plate('second')]).toEqual([null, en['scoring.badminton.serving.left']]);
    expect(half('second').getAttribute('aria-label')).toBe(
      ['L. Chen', '1', en['scoring.badminton.servingSaid.left']].join(', '),
    );
  });

  it('Undo takes the last tap back and says so; a second Undo has nothing left', () => {
    const pad = renderPad();
    rally(pad, 'first');
    press(en['scoring.pad.undo']);
    expect(shows('first', 0) && shows('second', 0)).toBe(true);
    expect(lastTap()).toContain(fill(en['scoring.badminton.undone.rally'], { side: 'A. Sharma' }));
    expect(tool(en['scoring.badminton.tool.setScore'])).not.toBeNull();
    expect(undo().getAttribute('aria-disabled')).toBe('true');
  });

  it('steps back through several taps, one at a time', () => {
    const pad = renderPad();
    rally(pad, 'first', 2);
    rally(pad, 'second');
    undoTap(pad);
    expect(shows('first', 2) && shows('second', 0)).toBe(true);
    undoTap(pad);
    expect(shows('first', 1) && shows('second', 0)).toBe(true);
  });

  it('counts a double tap on a half once, says so, and keeps the rally that counted on the line', () => {
    const pad = renderPad();
    rally(pad, 'first');
    act(() => fireEvent.click(half('first')));
    expect(shows('first', 1)).toBe(true);
    expect(screen.getByTestId('last-tap-note').textContent).toBe(en['scoring.pad.countedOnce']);
    expect(screen.getByTestId('last-tap-sentence').textContent).toBe(
      fill(en['scoring.badminton.last.rally'], { side: 'A. Sharma' }),
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('counts a bounced Undo once: one tap taken back, not two, and says so', () => {
    const pad = renderPad();
    rally(pad, 'first', 2);
    undoTap(pad);
    press(en['scoring.pad.undo']);
    expect(shows('first', 1)).toBe(true);
    expect(screen.getByTestId('last-tap-note').textContent).toBe(en['scoring.pad.countedOnce']);
    expect(screen.getByTestId('last-tap-sentence').textContent).toBe(
      fill(en['scoring.badminton.undone.rally'], { side: 'A. Sharma' }),
    );
  });

  it('takes a second Undo back a moment later, after the window', () => {
    const pad = renderPad();
    rally(pad, 'first', 2);
    undoTap(pad);
    pad.setNow(new Date(pad.ports.clock().getTime() + 250));
    press(en['scoring.pad.undo']);
    expect(shows('first', 0)).toBe(true);
    expect(screen.queryByTestId('last-tap-note')).toBeNull();
  });

  it('counts a tap after the phone’s clock stepped back: a rally, never swallowed', () => {
    const pad = renderPad();
    rally(pad, 'first');
    pad.setNow(new Date(pad.ports.clock().getTime() - 60_000));
    act(() => fireEvent.click(half('first')));
    expect(shows('first', 2)).toBe(true);
    expect(screen.queryByTestId('last-tap-note')).toBeNull();
  });

  it('clears the note on the next tap that counts', () => {
    const pad = renderPad();
    rally(pad, 'first');
    act(() => fireEvent.click(half('first')));
    rally(pad, 'second');
    expect(screen.queryByTestId('last-tap-note')).toBeNull();
  });

  it('records a tap on the other half at once, and the same half a moment later', () => {
    const pad = renderPad();
    rally(pad, 'first');
    act(() => fireEvent.click(half('second')));
    expect(shows('first', 1) && shows('second', 1)).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
    pad.setNow(new Date(pad.ports.clock().getTime() + 250));
    act(() => fireEvent.click(half('second')));
    expect(shows('second', 2)).toBe(true);
  });
});

describe('BadmintonPadScreen: games and the match', () => {
  it('between games: the next game at 0, game 1’s box in each half, Set score back', () => {
    const pad = renderPad();
    rally(pad, 'first', 21);
    expect(shows('first', 0) && shows('second', 0)).toBe(true);
    expect([boxes('first'), boxes('second')]).toEqual([['21'], ['0']]);
    expect(half('first').getAttribute('aria-label')).toBe(
      [
        'A. Sharma',
        '0',
        fill(en['scoring.badminton.gamesSaid.one'], { scores: '21' }),
        en['scoring.badminton.servingSaid.right'],
      ].join(', '),
    );
    expect(screen.getByTestId('strip-game').textContent).toBe(
      fill(en['scoring.badminton.gameOf'], { game: 2, bestOf: 3 }),
    );
    expect(lastTap()).toContain(
      fill(en['scoring.badminton.last.game'], { game: 1, side: 'A. Sharma' }),
    );
    expect(tool(en['scoring.badminton.tool.setScore'])).not.toBeNull();
  });

  it('says the interval when the server reaches 11 first', () => {
    const pad = renderPad();
    rally(pad, 'first', 11);
    expect(screen.getByTestId('strip-interval').textContent).toBe(
      en['scoring.badminton.intervalNow'],
    );
  });

  it('decided: the result card over the final score, no tools, the halves take no tap, Undo still offered', () => {
    const pad = renderPad();
    rally(pad, 'first', 42);
    expect(screen.getByTestId('pad-card').textContent).toContain(
      en['scoring.card.resultRecorded.title'],
    );
    expect(shows('first', 21)).toBe(true);
    expect(half('first').getAttribute('aria-disabled')).toBe('true');
    expect(within(screen.getByTestId('tool-row')).queryAllByRole('button')).toEqual([]);
    expect(lastTap()).toContain(fill(en['scoring.badminton.last.match'], { side: 'A. Sharma' }));
    press(en['scoring.pad.undo']);
    expect(screen.queryByTestId('pad-card')).toBeNull();
    expect(shows('first', 20)).toBe(true);
  });

  // The four questions: after an interruption. Undo across a game boundary reopens the game: its box goes.
  it('Undo of a game’s winning rally reopens the game and takes its box away', () => {
    const pad = renderPad();
    rally(pad, 'first', 21);
    rally(pad, 'second', 21);
    expect([boxes('first'), boxes('second')]).toEqual([
      ['21', '0'],
      ['0', '21'],
    ]);
    undoTap(pad);
    expect([boxes('first'), boxes('second')]).toEqual([['21'], ['0']]);
    expect(shows('second', 20)).toBe(true);
    expect(screen.getByTestId('strip-game').textContent).toBe(
      fill(en['scoring.badminton.gameOf'], { game: 2, bestOf: 3 }),
    );
  });

  // Owner ruling 16: "After the match is decided, every game's box shows, and the big number is the last game."
  it('decided 2-1: every game’s box, the last too, with the big numbers on the last game', () => {
    const pad = renderPad();
    rally(pad, 'first', 21);
    rally(pad, 'second', 21);
    rally(pad, 'first', 21);
    expect(screen.getByTestId('pad-card').textContent).toContain(
      en['scoring.card.resultRecorded.title'],
    );
    expect([boxes('first'), boxes('second')]).toEqual([
      ['21', '0', '21'],
      ['0', '21', '0'],
    ]);
    expect(shows('first', 21) && shows('second', 0)).toBe(true);
    expect([plate('first'), plate('second')]).toEqual([null, null]);
    expect(screen.getByTestId('strip-game').textContent).toBe(
      fill(en['scoring.badminton.gameOf'], { game: 3, bestOf: 3 }),
    );
    expect(half('first').getAttribute('aria-label')).toBe(
      [
        'A. Sharma',
        '21',
        fill(en['scoring.badminton.gamesSaid.other'], { scores: '21, 0, 21' }),
      ].join(', '),
    );
  });

  // The four questions: another mode of play. Doubles, joined at 3-1 by a scorer before this phone.
  it('doubles: the joined game’s box once this phone wins it, beside the partners’ names', () => {
    const pad = renderPad();
    press(CHIP.doubles);
    rally(pad, 'first', 18);
    expect([boxes('first'), boxes('second')]).toEqual([['21'], ['1']]);
    expect(plate('first')).toBe(en['scoring.badminton.serving.right']);
    expect(within(half('first')).getByText('A. Sharma / R. Iyer')).toBeTruthy();
    expect(half('second').getAttribute('aria-label')).toBe(
      ['L. Chen / M. Wong', '0', fill(en['scoring.badminton.gamesSaid.one'], { scores: '1' })].join(
        ', ',
      ),
    );
  });
});

describe('BadmintonPadScreen: Set score', () => {
  const field = (side: string) =>
    screen.getByLabelText(fill(en['scoring.setScore.field'], { side }));
  const type = (side: string, value: string) =>
    act(() => fireEvent.change(field(side), { target: { value } }));

  // The controller's call (2026-10-31): the title names the game it sets, the one the strip names.
  it('names the game it sets: game 1 before the first rally, game 2 between games', () => {
    const pad = renderPad();
    press(en['scoring.badminton.tool.setScore']);
    const title = () => within(screen.getByTestId('score-sheet'));
    expect(title().getByText(fill(en['scoring.setScore.title'], { game: 1 }))).toBeTruthy();
    press(en['scoring.sheet.cancel']);
    rally(pad, 'second', 21);
    press(en['scoring.badminton.tool.setScore']);
    expect(title().getByText(fill(en['scoring.setScore.title'], { game: 2 }))).toBeTruthy();
  });

  it('sets the score before the first rally, and Undo takes it back', () => {
    const pad = renderPad();
    press(en['scoring.badminton.tool.setScore']);
    type('A. Sharma', '5');
    type('L. Chen', '3');
    choose(en['scoring.setScore.confirm']);
    expect(screen.queryByTestId('score-sheet')).toBeNull();
    expect(shows('first', 5) && shows('second', 3)).toBe(true);
    expect(lastTap()).toContain(fill(en['scoring.badminton.last.setScore'], { score: '5–3' }));
    undoTap(pad);
    expect(shows('first', 0)).toBe(true);
    expect(lastTap()).toContain(en['scoring.badminton.undone.setScore']);
  });

  it('refuses a score no game in progress has, in caution, and changes nothing', () => {
    renderPad();
    press(en['scoring.badminton.tool.setScore']);
    type('A. Sharma', '21');
    type('L. Chen', '5');
    choose(en['scoring.setScore.confirm']);
    expect(screen.getByRole('alert').textContent).toBe(en['scoring.refusal.invalidScore']);
    expect(shows('first', 0)).toBe(true);
  });

  it('closes on Cancel with nothing set: the score, the line and Set score as they were', () => {
    renderPad();
    press(en['scoring.badminton.tool.setScore']);
    type('A. Sharma', '5');
    type('L. Chen', '3');
    press(en['scoring.sheet.cancel']);
    expect(screen.queryByTestId('score-sheet')).toBeNull();
    expect(shows('first', 0) && shows('second', 0)).toBe(true);
    expect(lastTap()).toBe(startedLine());
    expect(tool(en['scoring.badminton.tool.setScore'])).not.toBeNull();
  });

  it('clears an old refusal on the next good tap', () => {
    const pad = renderPad();
    press(en['scoring.badminton.tool.setScore']);
    type('A. Sharma', '30');
    choose(en['scoring.setScore.confirm']);
    expect(screen.getByRole('alert').textContent).toBe(en['scoring.refusal.invalidScore']);
    rally(pad, 'second');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(shows('second', 1)).toBe(true);
  });

  it('hides the pad from a screen reader while the sheet is up', () => {
    renderPad();
    press(en['scoring.badminton.tool.setScore']);
    expect(screen.getByTestId('pad-content').getAttribute('aria-hidden')).toBe('true');
    press(en['scoring.sheet.cancel']);
    expect(screen.getByTestId('pad-content').getAttribute('aria-hidden')).not.toBe('true');
  });
});

describe('BadmintonPadScreen: a sanction, end to end', () => {
  const sheetTitle = () => within(screen.getByTestId('step-sheet'));

  it('Warning: level, person, recorded in the side’s bottom row and in the last-tap line', () => {
    renderPad();
    press(sanctionOn('L. Chen'));
    expect(sheetTitle().getByText(en['scoring.sanction.title'])).toBeTruthy();
    expect(sheetTitle().getByText('L. Chen')).toBeTruthy();
    choose(en['scoring.sanction.warning']);
    expect(sheetTitle().getByText(en['scoring.sanction.who'])).toBeTruthy();
    choose('L. Chen');
    expect(screen.queryByTestId('step-sheet')).toBeNull();
    // Game 1: the sanction alone, with no box and no dot before it (owner ruling 16).
    expect(within(half('second')).getByText(en['scoring.sanction.warning'])).toBeTruthy();
    expect(boxes('second')).toEqual([]);
    expect(within(half('second')).queryByText('·')).toBeNull();
    expect(lastTap()).toContain(
      fill(en['scoring.badminton.last.sanction'], {
        level: en['scoring.sanction.warning'],
        person: 'L. Chen',
      }),
    );
  });

  it('Disqualification asks to confirm, then the ending prompt over a pad that takes no tap; Back still leaves', () => {
    const pad = renderPad();
    press(sanctionOn('L. Chen'));
    choose(en['scoring.sanction.disqualification']);
    choose('L. Chen');
    expect(
      sheetTitle().getByText(fill(en['scoring.sanction.confirm.title'], { person: 'L. Chen' })),
    ).toBeTruthy();
    expect(sheetTitle().getByText(en['scoring.sanction.confirm.body'])).toBeTruthy();
    choose(en['scoring.sanction.confirm.action']);
    expect(screen.getByTestId('ending-prompt').textContent).toContain(
      fill(en['scoring.ending.title'], { person: 'L. Chen' }),
    );
    expect(half('first').getAttribute('aria-disabled')).toBe('true');
    expect(back(pad)).toBe(true);
    expect(pad.navigation.current()).toBe('home');
  });

  it('Record the ending ends the match: the result card', () => {
    renderPad();
    press(sanctionOn('L. Chen'));
    choose(en['scoring.sanction.disqualification']);
    choose('L. Chen');
    choose(en['scoring.sanction.confirm.action']);
    choose(en['scoring.ending.record']);
    expect(screen.queryByTestId('ending-prompt')).toBeNull();
    expect(screen.getByTestId('pad-card').textContent).toContain(
      en['scoring.card.resultRecorded.title'],
    );
    expect(lastTap()).toContain(fill(en['scoring.badminton.last.ending'], { person: 'L. Chen' }));
  });

  // Owner ruling 18 (2026-10-31, "box with DQ").
  it('Record the ending boxes the game in play at its points, DQ on the side disqualified; Undo takes it away', () => {
    const pad = renderPad();
    rally(pad, 'first', 21);
    rally(pad, 'first', 9);
    rally(pad, 'second', 4);
    press(sanctionOn('L. Chen'));
    choose(en['scoring.sanction.disqualification']);
    choose('L. Chen');
    choose(en['scoring.sanction.confirm.action']);
    expect(boxes('second')).toEqual(['0']);
    choose(en['scoring.ending.record']);
    const dq = en['scoring.badminton.mark.disqualified'];
    expect([boxes('first'), boxes('second')]).toEqual([
      ['21', '9'],
      ['0', `4${dq}`],
    ]);
    expect(within(half('first')).queryByTestId('period-mark')).toBeNull();
    expect(within(half('second')).getByTestId('period-mark').textContent).toBe(dq);
    expect(shows('first', 9) && shows('second', 4)).toBe(true);
    expect(half('second').getAttribute('aria-label')).toBe(
      [
        'L. Chen',
        '4',
        fill(en['scoring.badminton.gamesSaid.one'], { scores: '0' }),
        fill(en['scoring.badminton.gameSaid.disqualified'], { game: 2, points: 4 }),
        en['scoring.sanction.disqualification'],
      ].join(', '),
    );
    expect(half('first').getAttribute('aria-label')).toBe(
      [
        'A. Sharma',
        '9',
        fill(en['scoring.badminton.gamesSaid.one'], { scores: '21' }),
        fill(en['scoring.badminton.gameSaid.stopped'], { game: 2, points: 9 }),
      ].join(', '),
    );
    undoTap(pad);
    expect(screen.getByTestId('ending-prompt')).toBeTruthy();
    expect([boxes('first'), boxes('second')]).toEqual([['21'], ['0']]);
  });

  it('Void the sanction takes it back and play goes on', () => {
    const pad = renderPad();
    press(sanctionOn('A. Sharma'));
    choose(en['scoring.sanction.disqualification']);
    choose('A. Sharma');
    choose(en['scoring.sanction.confirm.action']);
    choose(en['scoring.ending.void']);
    expect(screen.queryByTestId('ending-prompt')).toBeNull();
    // Owner ruling 18: a voided disqualification leaves no box.
    expect([boxes('first'), boxes('second')]).toEqual([[], []]);
    expect(lastTap()).toContain(
      fill(en['scoring.badminton.undone.sanction'], {
        level: en['scoring.sanction.disqualification'],
        person: 'A. Sharma',
      }),
    );
    rally(pad, 'first');
    expect(shows('first', 1)).toBe(true);
  });

  it('Cancel, the dim and Back close a step with nothing recorded', () => {
    const pad = renderPad();
    press(sanctionOn('A. Sharma'));
    press(en['scoring.sheet.cancel']);
    expect(screen.queryByTestId('step-sheet')).toBeNull();
    press(sanctionOn('A. Sharma'));
    choose(en['scoring.sanction.penalty']);
    expect(back(pad)).toBe(true);
    expect(screen.queryByTestId('step-sheet')).toBeNull();
    expect(pad.navigation.current()).toBe('scoring');
    expect(lastTap()).toBe(startedLine());
  });

  it('asks which player in doubles', () => {
    renderPad();
    press(CHIP.doubles);
    press(sanctionOn('L. Chen / M. Wong'));
    choose(en['scoring.sanction.penalty']);
    expect(screen.getByRole('button', { name: 'L. Chen' })).toBeTruthy();
    choose('M. Wong');
    expect(lastTap()).toContain(
      fill(en['scoring.badminton.last.sanction'], {
        level: en['scoring.sanction.penalty'],
        person: 'M. Wong',
      }),
    );
  });
});

describe('BadmintonPadScreen: the preview row', () => {
  it.each([
    ['notStarted', CHIP.notStarted],
    ['linkInvalid', CHIP.linkInvalid],
  ] as const)('shows the %s card instead of the score, with nothing to tap', (kind, chip) => {
    renderPad();
    press(chip);
    expect(screen.getByTestId('pad-card').textContent).toContain(en[`scoring.card.${kind}.title`]);
    expect(screen.queryByTestId('half-first')).toBeNull();
    expect(within(screen.getByTestId('tool-row')).queryAllByRole('button')).toEqual([]);
    expect(undo().getAttribute('aria-disabled')).toBe('true');
  });

  it('update needed (owner ruling 8): the score stays on screen, taking no tap, the banner in the controls’ place', () => {
    const pad = renderPad();
    rally(pad, 'first');
    press(CHIP.updateNeeded);
    const banner = screen.getByTestId('update-banner');
    expect(within(banner).getByText(en['scoring.card.updateNeeded.body'])).toBeTruthy();
    expect(
      within(banner).getByText(fill(en['scoring.card.updateNeeded.unsent.other'], { count: 2 })),
    ).toBeTruthy();
    expect(shows('first', 1) && shows('second', 0)).toBe(true);
    expect(half('first').getAttribute('aria-disabled')).toBe('true');
    expect(half('second').getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByTestId('pad-card')).toBeNull();
    expect(screen.queryByTestId('last-tap')).toBeNull();
    expect(screen.queryByTestId('tool-row')).toBeNull();
    expect(screen.queryByRole('button', { name: en['scoring.pad.undo'] })).toBeNull();
    aSecondOn(pad);
    act(() => fireEvent.click(half('second')));
    expect(shows('second', 0)).toBe(true);
  });

  it('update needed: the halves stand above the banner, the banner above the preview row', () => {
    renderPad();
    press(CHIP.updateNeeded);
    const order = [
      half('second'),
      screen.getByTestId('update-banner'),
      screen.getByRole('button', { name: CHIP.pad }),
    ];
    const follows = (a: HTMLElement, b: HTMLElement) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect([follows(order[0], order[1]), follows(order[1], order[2])]).toEqual([true, true]);
  });

  it('back on the pad from the update banner: the last-tap line and the tools return', () => {
    const pad = renderPad();
    rally(pad, 'first');
    press(CHIP.updateNeeded);
    press(CHIP.pad);
    expect(screen.queryByTestId('update-banner')).toBeNull();
    expect(lastTap()).toContain(fill(en['scoring.badminton.last.rally'], { side: 'A. Sharma' }));
    expect(tool(sanctionOn('L. Chen'))).not.toBeNull();
  });

  it.each([en['scoring.card.updateNeeded.update'], en['scoring.card.updateNeeded.browser']])(
    'update needed: %s opens nothing in the preview, and says so on the banner',
    (name) => {
      const pad = renderPad();
      press(CHIP.updateNeeded);
      press(name);
      const banner = screen.getByTestId('update-banner');
      expect(within(banner).getByText(en['scoring.card.cantOpen'])).toBeTruthy();
      expect(pad.navigation.current()).toBe('scoring');
      press(CHIP.pad);
      press(CHIP.updateNeeded);
      expect(screen.queryByText(en['scoring.card.cantOpen'])).toBeNull();
    },
  );

  it.each([
    ['resultRecorded', CHIP.result],
    ['viewOnly', CHIP.viewOnly],
  ] as const)('shows the %s card over the score, which takes no tap', (kind, chip) => {
    const pad = renderPad();
    rally(pad, 'first');
    press(chip);
    expect(screen.getByTestId('pad-card').textContent).toContain(en[`scoring.card.${kind}.title`]);
    expect(shows('first', 1)).toBe(true);
    expect(half('first').getAttribute('aria-disabled')).toBe('true');
  });

  it('keeps Undo on a recorded result, and not on view only', () => {
    const pad = renderPad();
    rally(pad, 'first');
    press(CHIP.result);
    expect(undo().getAttribute('aria-disabled')).not.toBe('true');
    press(CHIP.viewOnly);
    expect(undo().getAttribute('aria-disabled')).toBe('true');
  });

  it('goes back to the same match from a card', () => {
    const pad = renderPad();
    rally(pad, 'first');
    press(CHIP.linkInvalid);
    press(CHIP.pad);
    expect(shows('first', 1)).toBe(true);
    expect(screen.queryByTestId('pad-card')).toBeNull();
  });

  it('steps the sync status through its four words', () => {
    renderPad();
    const sync = () => screen.getByTestId('sync').textContent;
    press(CHIP.sync);
    expect(sync()).toBe(fill(en['scoring.sync.sending.one'], { count: 1 }));
    press(CHIP.sync);
    expect(sync()).toBe(fill(en['scoring.sync.offline.other'], { count: 3 }));
    press(CHIP.sync);
    expect(sync()).toBe(fill(en['scoring.sync.refused.one'], { count: 1 }));
    press(CHIP.sync);
    expect(sync()).toBe(en['scoring.sync.synced']);
  });

  it('doubles joins a match others began: their taps stay when this phone undoes its own', () => {
    const pad = renderPad();
    press(CHIP.doubles);
    expect(within(half('first')).getByText('A. Sharma / R. Iyer')).toBeTruthy();
    expect(shows('first', 3) && shows('second', 1)).toBe(true);
    expect(undo().getAttribute('aria-disabled')).toBe('true');
    rally(pad, 'second');
    press(en['scoring.pad.undo']);
    expect(shows('first', 3) && shows('second', 1)).toBe(true);
    expect(undo().getAttribute('aria-disabled')).toBe('true');
  });

  it('starts singles afresh when it is picked again: not started, on the Start screen (owner, 2026-11-01)', () => {
    const pad = renderPad();
    rally(pad, 'first');
    press(CHIP.doubles);
    press(CHIP.singles);
    expect(screen.getByTestId('start-screen')).toBeTruthy();
    expect(screen.getAllByRole('radio').map((side) => side.textContent)).toEqual([
      'A. Sharma',
      'L. Chen',
    ]);
  });
});

describe('BadmintonPadScreen: leaving, and the phone', () => {
  it('Back returns Home', () => {
    const pad = renderPad();
    expect(back(pad)).toBe(true);
    expect(pad.navigation.current()).toBe('home');
  });

  it('the Home button returns Home', () => {
    const pad = renderPad();
    press(en['stream.home']);
    expect(pad.navigation.current()).toBe('home');
  });

  it('never dims or touches the brightness', () => {
    const pad = renderPad();
    rally(pad, 'first', 3);
    expect(pad.screen.calls).toEqual([]);
  });

  it('keeps every tool and the sync words on a 320 dp phone: shared cells, clamped, never pushed off', () => {
    setWindowSize(320, 640);
    renderPad();
    press(CHIP.sync);
    press(CHIP.sync);
    const row = screen.getByTestId('tool-row');
    expect(within(row).getAllByRole('button')).toHaveLength(3);
    for (const button of within(row).getAllByRole('button')) {
      expect(getComputedStyle(button).flexGrow).toBe('1');
      expect(getComputedStyle(button).minWidth).toBe('0px');
    }
    expect(linesAllowed(within(row).getByText(en['scoring.badminton.tool.setScore']))).toBe(
      layout.padToolLines,
    );
    const words = within(screen.getByTestId('sync')).getByText(
      fill(en['scoring.sync.offline.other'], { count: 3 }),
    );
    expect(linesAllowed(words)).toBe(layout.padSyncLines);
  });
});

/**
 * Owner ruling 14 (2026-10-31): "the tapped half flashes lime briefly so you see at a glance your tap counted". The
 * flash itself is a worklet (TapFlash.test.tsx); here each half's stand-in shows the cue it was handed, which moves
 * only for a counted tap on that half (`flashMove` flashes on a move to a new number, stops on a move to 0).
 */
describe('BadmintonPadScreen: the flash of a half whose tap counted', () => {
  const cue = (side: 'first' | 'second') =>
    within(half(side)).getByTestId('tap-flash').dataset.cue ?? '';
  const cues = () => [cue('first'), cue('second')];

  it('flashes nothing as the pad opens', () => {
    renderPad();
    expect(cues()).toEqual(['0', '0']);
  });

  it('moves the tapped half’s cue on each counted tap, the same half twice included', () => {
    const pad = renderPad();
    rally(pad, 'first');
    expect(cues()).toEqual(['1', '0']);
    rally(pad, 'first');
    expect(cues()).toEqual(['2', '0']);
    rally(pad, 'second');
    expect(cues()).toEqual(['0', '3']);
  });

  it('leaves the cue where it was for a bounced repeat, Undo, Set score and a sanction', () => {
    const pad = renderPad();
    rally(pad, 'second');
    act(() => fireEvent.click(half('second')));
    expect(screen.getByTestId('last-tap-note').textContent).toBe(en['scoring.pad.countedOnce']);
    undoTap(pad);
    press(en['scoring.badminton.tool.setScore']);
    act(() =>
      fireEvent.change(
        screen.getByLabelText(fill(en['scoring.setScore.field'], { side: 'A. Sharma' })),
        { target: { value: '4' } },
      ),
    );
    choose(en['scoring.setScore.confirm']);
    choose(sanctionOn('L. Chen'));
    choose(en['scoring.sanction.warning']);
    choose('L. Chen');
    expect(lastTap()).toContain(
      fill(en['scoring.badminton.last.sanction'], {
        level: en['scoring.sanction.warning'],
        person: 'L. Chen',
      }),
    );
    expect(cues()).toEqual(['0', '1']);
  });

  it.each([CHIP.result, CHIP.viewOnly, CHIP.sync, CHIP.doubles])(
    'clears the flash when the preview row picks %s mid-flash: the new state never flashes',
    (chip) => {
      const pad = renderPad();
      rally(pad, 'first');
      press(chip);
      expect(cues()).toEqual(['0', '0']);
    },
  );

  it('flashes again after a card, on the next counted tap', () => {
    const pad = renderPad();
    rally(pad, 'first');
    press(CHIP.notStarted);
    press(CHIP.pad);
    expect(cues()).toEqual(['0', '0']);
    rally(pad, 'first');
    expect(cue('first')).not.toBe('0');
  });
});

/** Owner ruling 14: "a one-line hint at the bottom of each half". */
describe('BadmintonPadScreen: the halves’ hints', () => {
  const hint = (side: string) => fill(en['scoring.badminton.hintLine'], { side });

  it('names each half’s side in its hint while the half takes a tap, and drops it under a card', () => {
    const pad = renderPad();
    expect(within(half('first')).getByText(hint('A. Sharma'))).toBeTruthy();
    expect(within(half('second')).getByText(hint('L. Chen'))).toBeTruthy();
    rally(pad, 'first');
    press(CHIP.result);
    expect(screen.queryByText(hint('A. Sharma'))).toBeNull();
    expect(screen.queryByText(hint('L. Chen'))).toBeNull();
  });
});

/**
 * Owner ruling 15 (2026-10-31): "a 'Rules' button in the top bar beside the sync status, opening a sheet over the pad";
 * ruling 20 made it an icon, with History beside it; owner, 2026-11-01: it became Match details, where the match sits
 * and then its rules, and the icon is named so.
 */
describe('BadmintonPadScreen: Match details', () => {
  const rulesButton = () => screen.queryByRole('button', { name: en['scoring.details.title'] });
  const sheet = () => within(screen.getByTestId('details-sheet'));
  const lines = () => rowsIn(screen.getByTestId('details-sheet'));
  const LINES = rowsSaid(en);

  // Owner ruling 20: "Order: Back, Preview tag, then the right end holds [Rules][History] then the sync status"; the
  // games tally took the tag's place (owner, 2026-11-01).
  it('stands in the top bar after Back and the games tally, then History, then the sync status', () => {
    renderPad();
    const order = [
      screen.getByRole('button', { name: en['stream.home'] }),
      screen.getByTestId('tally'),
      rulesButton(),
      screen.getByRole('button', { name: en['scoring.history.title'] }),
      screen.getByTestId('sync'),
    ];
    const follows = (a: Node | null, b: Node | null) =>
      a !== null &&
      b !== null &&
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(order.slice(1).map((node, at) => follows(order[at] ?? null, node))).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  // Ruling 20: round 48 dp icon buttons like Home's gear (IconButton), the glyph in ink2: an i for Rules, a clock for History.
  it('is an icon button with the info glyph in ink2, History beside it with the history glyph', () => {
    renderPad();
    const glyph = (name: string) =>
      screen.getByRole('button', { name }).querySelector('[data-name]')?.getAttribute('data-name');
    const tone = (name: string) =>
      screen.getByRole('button', { name }).querySelector('[data-name]')?.getAttribute('data-tone');
    expect([glyph(en['scoring.details.title']), glyph(en['scoring.history.title'])]).toEqual([
      'info',
      'history',
    ]);
    expect([tone(en['scoring.details.title']), tone(en['scoring.history.title'])]).toEqual([
      'ink2',
      'ink2',
    ]);
    expect(rulesButton()?.textContent).toBe('');
  });

  // padFit.test.ts fits the row at 320 and 360 dp: gaps of `space.xs`, the end group pushed right by its auto margin, the
  // sync status in its fixed box, and the tally whole.
  it('shares the top bar `space.xs` apart, the icons and the sync box at the right end', () => {
    renderPad();
    const end = screen.getByTestId('pad-header-end');
    const bar = end.parentElement;
    if (bar === null) throw new Error('no top bar');
    expect([getComputedStyle(bar).flexDirection, getComputedStyle(bar).gap]).toEqual([
      'row',
      `${space.xs}px`,
    ]);
    const style = getComputedStyle(end);
    expect([style.flexDirection, style.gap, style.marginLeft]).toEqual([
      'row',
      `${space.xs}px`,
      'auto',
    ]);
    expect(getComputedStyle(screen.getByTestId('sync-box')).width).toBe(`${layout.padSyncBox}px`);
    expect(getComputedStyle(screen.getByTestId('tally')).flexShrink).toBe('0');
  });

  it('opens Match details over the pad, which it hides from a screen reader, and changes no score', () => {
    const pad = renderPad();
    rally(pad, 'first', 2);
    press(en['scoring.details.title']);
    expect(sheet().getByTestId('match-card')).toBeTruthy();
    expect(lines()).toEqual(LINES);
    expect(screen.getByTestId('pad-content').getAttribute('aria-hidden')).toBe('true');
    expect(shows('first', 2) && shows('second', 0)).toBe(true);
    choose(en['panel.close']);
    expect(screen.queryByTestId('details-sheet')).toBeNull();
    expect(screen.getByTestId('pad-content').getAttribute('aria-hidden')).not.toBe('true');
    expect(shows('first', 2)).toBe(true);
  });

  it('opens once for a double tap: one Back closes it, the next returns Home', () => {
    const pad = renderPad();
    const button = rulesButton();
    if (button === null) throw new Error('no Match details');
    act(() => fireEvent.click(button));
    act(() => fireEvent.click(button));
    expect(screen.getAllByTestId('details-sheet')).toHaveLength(1);
    expect(back(pad)).toBe(true);
    expect(screen.queryByTestId('details-sheet')).toBeNull();
    expect(pad.navigation.current()).toBe('scoring');
    expect(back(pad)).toBe(true);
    expect(pad.navigation.current()).toBe('home');
  });

  it.each([CHIP.notStarted, CHIP.result, CHIP.viewOnly, CHIP.updateNeeded])(
    'shows under the %s card, where the match’s config is known',
    (chip) => {
      renderPad();
      press(chip);
      expect(rulesButton()).not.toBeNull();
      press(en['scoring.details.title']);
      expect(lines()).toEqual(LINES);
    },
  );

  it('is absent for a bad link, which names no match, and back on the pad', () => {
    renderPad();
    press(CHIP.linkInvalid);
    expect(rulesButton()).toBeNull();
    press(CHIP.pad);
    expect(rulesButton()).not.toBeNull();
  });

  it.each([
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)(
    '%s: the button, the subheading and the rows in the operator’s language',
    (lang, words) => {
      renderPad({ deviceLanguages: [lang] });
      press(words['scoring.details.title']);
      expect(sheet().getByRole('heading').textContent).toBe(words['scoring.rules.heading']);
      expect(sheet().getByTestId('match-card-competition').textContent).toBe('Spring Open 2026');
      expect(lines()).toEqual(rowsSaid(words));
      expect(screen.getByRole('button', { name: words['panel.close'] })).toBeTruthy();
    },
  );

  // Owner, 2026-11-01, option A: "The Match details sheet is MatchCard and Close." The card scrolls; Close stays.
  it('is the match card in a scroll, then Close: where the match sits, the sides, then the rules', () => {
    renderPad();
    press(en['scoring.details.title']);
    const scroll = screen.getByTestId('details-scroll');
    const card = within(scroll).getByTestId('match-card');
    expect([...screen.getByTestId('details-sheet').children]).toEqual([
      scroll,
      sheet().getByRole('button', { name: en['panel.close'] }),
    ]);
    expect(within(card).getByTestId('match-card-header').getAttribute('aria-label')).toBe(
      'Spring Open 2026, U15 Boys Singles, Round 1, Match 4',
    );
    expect(within(card).getByTestId('match-card-versus').getAttribute('aria-label')).toBe(
      'A. Sharma versus L. Chen',
    );
    expect(rowsIn(card)[0]).toBe('Format: Best of 3 games');
  });

  it('names the doubles match’s sides as typed, partners joined by " / "', () => {
    renderPad();
    press(CHIP.doubles);
    press(en['scoring.details.title']);
    expect(sheet().getByTestId('match-card-competition').textContent).toBe(
      'Riverside Badminton Club Championships 2026',
    );
    expect(sheet().getByTestId('match-card-where').textContent).toBe(
      'Open Mixed Doubles · Quarter-final',
    );
    expect(sheet().getByTestId('match-card-match').textContent).toBe('BAD0001');
    expect(
      sheet()
        .getAllByTestId('match-card-name')
        .map((name) => name.textContent),
    ).toEqual(['A. Sharma / R. Iyer', 'L. Chen / M. Wong']);
  });
});

describe('BadmintonPadScreen: in four languages', () => {
  it.each([
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)(
    '%s: the tools, the strip and the last tap in the operator’s language',
    (lang, words) => {
      const pad = renderPad({ deviceLanguages: [lang] });
      expect(tool(words['scoring.badminton.tool.setScore'])).not.toBeNull();
      expect(tool(`${words['scoring.badminton.tool.sanction']}, L. Chen`)).not.toBeNull();
      expect(screen.getByTestId('strip-game').textContent).toBe(
        fill(words['scoring.badminton.gameOf'], { game: 1, bestOf: 3 }),
      );
      expect(plate('first')).toBe(words['scoring.badminton.serving.right']);
      rally(pad, 'second');
      expect(lastTap()).toContain(fill(words['scoring.badminton.last.rally'], { side: 'L. Chen' }));
      expect(screen.getByRole('button', { name: words['scoring.pad.undo'] })).toBeTruthy();
      expect(plate('second')).toBe(words['scoring.badminton.serving.left']);
      rally(pad, 'second', 20);
      expect([boxes('first'), boxes('second')]).toEqual([['0'], ['21']]);
      expect(screen.getByTestId('strip-game').textContent).toBe(
        fill(words['scoring.badminton.gameOf'], { game: 2, bestOf: 3 }),
      );
      expect(half('second').getAttribute('aria-label')).toBe(
        [
          'L. Chen',
          '0',
          fill(words['scoring.badminton.gamesSaid.one'], { scores: '21' }),
          words['scoring.badminton.servingSaid.right'],
        ].join(', '),
      );
    },
  );
});

/**
 * Owner ruling 21 (2026-10-31), History, view only: a cover the full height of the pad inside the scoring route, Back
 * and the title "History" across the top; newest first, grouped by game; one row per entry with what it did (the
 * last-tap line's words), the score after it where it applies, and who recorded it; an undone entry struck through,
 * with "Undone"; "Nothing recorded yet" for an empty match. Each row reads as one line.
 */
describe('BadmintonPadScreen: History', () => {
  const historyButton = () => screen.queryByRole('button', { name: en['scoring.history.title'] });
  const openHistory = () => press(en['scoring.history.title']);
  const cover = () => within(screen.getByTestId('history'));
  const headings = () =>
    cover()
      .queryAllByRole('heading')
      .map((heading) => heading.textContent);
  /** Each row as a screen reader reads it: its one label. */
  const said = () =>
    cover()
      .queryAllByTestId('history-row')
      .map((row) => row.getAttribute('aria-label'));
  const game = (n: number) => fill(en['scoring.badminton.gameHeading'], { game: n });
  const rallyTo = (side: string) => fill(en['scoring.badminton.last.rally'], { side });
  const thisPhone = en['scoring.history.thisPhone'];
  /** The start's row, as `renderPad` starts the match (owner, 2026-11-01): A. Sharma serving, this phone's. */
  const startRow = `${fill(en['scoring.badminton.last.start'], { side: 'A. Sharma' })}, ${thisPhone}`;

  it('covers the pad, which it hides from a screen reader, with Back and the title, and says when nothing is recorded', () => {
    // Nothing is recorded before the start: the Start screen (owner, 2026-11-01).
    renderStart();
    openHistory();
    expect(cover().getByText(en['scoring.history.title'])).toBeTruthy();
    expect(cover().getByText(en['scoring.history.empty'])).toBeTruthy();
    expect(cover().queryAllByTestId('history-row')).toEqual([]);
    expect(screen.getByTestId('pad-content').getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByTestId('history').getAttribute('aria-modal')).toBe('true');
    press(en['panel.close']);
    expect(screen.queryByTestId('history')).toBeNull();
    expect(screen.getByTestId('pad-content').getAttribute('aria-hidden')).not.toBe('true');
  });

  it('lists this phone’s rallies newest first, each read as one line with the score after it', () => {
    const pad = renderPad();
    rally(pad, 'first', 2);
    rally(pad, 'second');
    openHistory();
    expect(headings()).toEqual([game(1)]);
    expect(said()).toEqual([
      `${rallyTo('L. Chen')}, 2–1, ${thisPhone}`,
      `${rallyTo('A. Sharma')}, 2–0, ${thisPhone}`,
      `${rallyTo('A. Sharma')}, 1–0, ${thisPhone}`,
      startRow,
    ]);
    expect(
      cover()
        .getAllByTestId('history-score')
        .map((score) => score.textContent),
    ).toEqual(['2–1', '2–0', '1–0']);
  });

  it('groups by game, the latest first, the game-winning rally in the game it won', () => {
    const pad = renderPad();
    rally(pad, 'first', 21);
    rally(pad, 'second');
    openHistory();
    expect(headings()).toEqual([game(2), game(1)]);
    const groups = cover().getAllByTestId('history-group');
    const first = (group: HTMLElement | undefined) =>
      group === undefined
        ? null
        : within(group).getAllByTestId('history-row')[0]?.getAttribute('aria-label');
    expect([first(groups[0]), first(groups[1])]).toEqual([
      `${rallyTo('L. Chen')}, 0–1, ${thisPhone}`,
      `${fill(en['scoring.badminton.last.game'], { game: 1, side: 'A. Sharma' })}, 21–0, ${thisPhone}`,
    ]);
    // The start and the game's 21 rallies.
    expect(groups[1] && within(groups[1]).getAllByTestId('history-row')).toHaveLength(22);
  });

  it('keeps an undone rally in its place, struck through and inert, with “Undone”', () => {
    const pad = renderPad();
    rally(pad, 'first', 2);
    undoTap(pad);
    openHistory();
    const undone = en['scoring.history.undone'];
    expect(said()).toEqual([
      `${rallyTo('A. Sharma')}, 2–0, ${thisPhone}, ${undone}`,
      `${rallyTo('A. Sharma')}, 1–0, ${thisPhone}`,
      startRow,
    ]);
    const [struck, standing] = cover().getAllByTestId('history-said');
    if (struck === undefined || standing === undefined) throw new Error('no rows');
    expect(getComputedStyle(struck).textDecorationLine).toBe('line-through');
    expect(getComputedStyle(standing).textDecorationLine).not.toBe('line-through');
    expect(getComputedStyle(struck).color).toBe(edgeOf(colour.ink3));
    expect(
      cover()
        .getAllByTestId('history-undone')
        .map((word) => word.textContent),
    ).toEqual([undone]);
  });

  it('says “Another scorer” for the doubles sample’s taps from the scorer before this phone', () => {
    const pad = renderPad();
    press(CHIP.doubles);
    rally(pad, 'second');
    openHistory();
    const other = en['scoring.history.otherScorer'];
    expect(said()).toEqual([
      `${rallyTo('L. Chen / M. Wong')}, 3–2, ${thisPhone}`,
      `${rallyTo('A. Sharma / R. Iyer')}, 3–1, ${other}`,
      `${rallyTo('A. Sharma / R. Iyer')}, 2–1, ${other}`,
      `${rallyTo('L. Chen / M. Wong')}, 1–1, ${other}`,
      `${rallyTo('A. Sharma / R. Iyer')}, 1–0, ${other}`,
      `${fill(en['scoring.badminton.last.start'], { side: 'A. Sharma / R. Iyer' })}, ${other}`,
    ]);
  });

  it('lists a sanction and Set score with no score of their own, and the disqualification and its ending', () => {
    renderPad();
    press(en['scoring.badminton.tool.setScore']);
    const field = (side: string) =>
      screen.getByLabelText(fill(en['scoring.setScore.field'], { side }));
    act(() => fireEvent.change(field('A. Sharma'), { target: { value: '9' } }));
    act(() => fireEvent.change(field('L. Chen'), { target: { value: '4' } }));
    choose(en['scoring.setScore.confirm']);
    choose(sanctionOn('A. Sharma'));
    choose(en['scoring.sanction.disqualification']);
    choose('A. Sharma');
    choose(en['scoring.sanction.confirm.action']);
    choose(en['scoring.ending.record']);
    openHistory();
    expect(said()).toEqual([
      `${fill(en['scoring.badminton.last.ending'], { person: 'A. Sharma' })}, ${thisPhone}`,
      `${fill(en['scoring.badminton.last.sanction'], {
        level: en['scoring.sanction.disqualification'],
        person: 'A. Sharma',
      })}, ${thisPhone}`,
      `${fill(en['scoring.badminton.last.setScore'], { score: '9–4' })}, ${thisPhone}`,
      startRow,
    ]);
  });

  it('changes nothing: Back is its one button, and the score is as it was after it closes', () => {
    const pad = renderPad();
    rally(pad, 'first', 3);
    openHistory();
    expect(
      cover()
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual([en['panel.close']]);
    press(en['panel.close']);
    expect(shows('first', 3) && shows('second', 0)).toBe(true);
    expect(undo()).toBeTruthy();
  });

  it('opens once for a double tap: Android Back closes it, the next returns Home', () => {
    const pad = renderPad();
    const button = historyButton();
    if (button === null) throw new Error('no History');
    act(() => fireEvent.click(button));
    act(() => fireEvent.click(button));
    expect(screen.getAllByTestId('history')).toHaveLength(1);
    expect(back(pad)).toBe(true);
    expect(screen.queryByTestId('history')).toBeNull();
    expect(pad.navigation.current()).toBe('scoring');
    expect(back(pad)).toBe(true);
    expect(pad.navigation.current()).toBe('home');
  });

  it('is absent for a bad link, which names no match, and shows under every other card', () => {
    renderPad();
    for (const chip of [CHIP.notStarted, CHIP.result, CHIP.viewOnly, CHIP.updateNeeded]) {
      press(chip);
      expect(historyButton()).not.toBeNull();
    }
    press(CHIP.linkInvalid);
    expect(historyButton()).toBeNull();
    press(CHIP.pad);
    expect(historyButton()).not.toBeNull();
  });

  it.each([
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)(
    '%s: the button, the title, the empty line and the recorder in the operator’s language',
    (lang, words) => {
      const pad = renderStart({ deviceLanguages: [lang] });
      press(words['scoring.history.title']);
      expect(cover().getByText(words['scoring.history.empty'])).toBeTruthy();
      press(words['panel.close']);
      act(() => fireEvent.click(screen.getByRole('radio', { name: 'A. Sharma' })));
      press(words['scoring.start.confirm']);
      rally(pad, 'first');
      press(words['scoring.history.title']);
      expect(headings()).toEqual([fill(words['scoring.badminton.gameHeading'], { game: 1 })]);
      expect(cover().getAllByTestId('history-by')[0]?.textContent).toBe(
        words['scoring.history.thisPhone'],
      );
    },
  );
});

/**
 * Owner, 2026-11-01 (build 708): "move interval at 11 to far right, and can we have 0:0 with lime light in place of
 * preview". The tally counts games won, top side first, as the halves are; a game a disqualification ended counts for
 * nobody. The real pad keeps it, so it shows whenever the match is known, as the icons do.
 */
describe('BadmintonPadScreen: the games tally and the strip', () => {
  const tally = () => screen.queryByTestId('tally');
  const said = (first: string, firstGames: number, second: string, secondGames: number) =>
    fill(en['scoring.badminton.gamesTally'], { first, firstGames, second, secondGames });

  it('counts a game won, top side first, and Undo takes it back', () => {
    const pad = renderPad();
    rally(pad, 'second', 21);
    expect(tally()?.textContent).toBe('0:1');
    expect(tally()?.getAttribute('aria-label')).toBe(said('A. Sharma', 0, 'L. Chen', 1));
    rally(pad, 'first', 21);
    expect(tally()?.textContent).toBe('1:1');
    undoTap(pad);
    expect(tally()?.textContent).toBe('0:1');
  });

  it('counts a game a disqualification ended for nobody, and shows the final tally under the result', () => {
    const pad = renderPad();
    rally(pad, 'first', 21);
    rally(pad, 'second', 3);
    press(sanctionOn('L. Chen'));
    choose(en['scoring.sanction.disqualification']);
    choose('L. Chen');
    choose(en['scoring.sanction.confirm.action']);
    choose(en['scoring.ending.record']);
    expect(tally()?.textContent).toBe('1:0');
    expect(screen.getByTestId('tally').getAttribute('aria-label')).toBe(
      said('A. Sharma', 1, 'L. Chen', 0),
    );
  });

  it('names doubles sides as the match label joins them', () => {
    renderPad();
    press(CHIP.doubles);
    expect(tally()?.getAttribute('aria-label')).toBe(
      said('A. Sharma / R. Iyer', 0, 'L. Chen / M. Wong', 0),
    );
  });

  it('is absent for a bad link, which names no match, and shows under every other card', () => {
    renderPad();
    for (const chip of [CHIP.notStarted, CHIP.result, CHIP.viewOnly, CHIP.updateNeeded]) {
      press(chip);
      expect(tally()?.textContent).toBe('0:0');
    }
    press(CHIP.linkInvalid);
    expect(tally()).toBeNull();
  });

  it.each([
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)('%s: said in the operator’s language', (lang, words) => {
    renderPad({ deviceLanguages: [lang] });
    expect(tally()?.getAttribute('aria-label')).toBe(
      fill(words['scoring.badminton.gamesTally'], {
        first: 'A. Sharma',
        firstGames: 0,
        second: 'L. Chen',
        secondGames: 0,
      }),
    );
  });

  it('puts the game at the left of the strip and the interval at the far right, on one line', () => {
    renderPad();
    const words = (slot: string) => screen.getByTestId(`strip-${slot}`).firstElementChild;
    const game = words('game');
    const interval = words('interval');
    if (!(game instanceof HTMLElement) || !(interval instanceof HTMLElement)) {
      throw new Error('no strip words');
    }
    expect(interval.textContent).toBe(fill(en['scoring.badminton.intervalAt'], { point: 11 }));
    expect(getComputedStyle(interval).textAlign).toBe('right');
    expect(getComputedStyle(game).textAlign).not.toBe('right');
    expect([linesAllowed(game), linesAllowed(interval)]).toEqual([1, 1]);
  });
});

/**
 * Owner, 2026-11-01: "can we add in not started including rules?" Then option A: "The Division-not-open card is its
 * title and MatchCard, then its sentence", the card the sheet and the Start screen draw. It scrolls when it is taller
 * than the room, and the top bar's icons stay.
 */
describe('BadmintonPadScreen: the Not started card', () => {
  const card = () => screen.getByTestId('pad-card');
  const notStarted = () => {
    renderPad();
    press(CHIP.notStarted);
  };

  it('shows its title, the match card, then its sentence', () => {
    notStarted();
    const parts = [...card().children];
    expect(parts).toHaveLength(3);
    expect(parts[0]?.textContent).toBe(en['scoring.card.notStarted.title']);
    expect(parts[1]?.getAttribute('data-testid')).toBe('match-card');
    expect(parts[2]?.textContent).toBe(en['scoring.card.notStarted.body']);
    expect(within(card()).getByTestId('match-card-header').getAttribute('aria-label')).toBe(
      'Spring Open 2026, U15 Boys Singles, Round 1, Match 4',
    );
    expect(rowsIn(card())).toEqual(rowsSaid(en));
  });

  it('stands in a scroll where the halves were, and the top bar keeps its icons', () => {
    notStarted();
    const scroll = screen.getByTestId('pad-card-scroll');
    expect(scroll.contains(card())).toBe(true);
    expect(getComputedStyle(scroll).overflowY).not.toBe('visible');
    expect(screen.queryByTestId('half-first')).toBeNull();
    for (const name of [en['scoring.details.title'], en['scoring.history.title']]) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.getByTestId('tally')).toBeTruthy();
  });

  it('carries no Match details on the other cards (a dead link names no match; the rest keep the halves)', () => {
    renderPad();
    for (const chip of [CHIP.linkInvalid, CHIP.result, CHIP.viewOnly]) {
      press(chip);
      expect(screen.queryByTestId('match-card')).toBeNull();
    }
  });

  it('names the doubles match, the sides as typed', () => {
    renderPad();
    press(CHIP.doubles);
    press(CHIP.notStarted);
    expect(within(card()).getByTestId('match-card-versus').getAttribute('aria-label')).toBe(
      'A. Sharma / R. Iyer versus L. Chen / M. Wong',
    );
  });

  it.each([
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)(
    '%s: the title, the subheading, the rows and the sentence in the operator’s language',
    (lang, words) => {
      renderPad({ deviceLanguages: [lang] });
      press(CHIP.notStarted);
      const parts = [...card().children].map((part) => part.textContent);
      expect(parts[0]).toBe(words['scoring.card.notStarted.title']);
      expect(within(card()).getByRole('heading').textContent).toBe(words['scoring.rules.heading']);
      expect(rowsIn(card())).toEqual(rowsSaid(words));
      expect(parts[2]).toBe(words['scoring.card.notStarted.body']);
      // The organiser's words are never translated.
      expect(within(card()).getByTestId('match-card-where').textContent).toBe(
        'U15 Boys Singles · Round 1',
      );
    },
  );
});

/**
 * Owner, 2026-11-01: "should we show before the match started as well right, in UI, it show the player, match info and
 * ask to start", then option A (toss + Start). The Start screen stands where the halves are, the top bar kept; Start
 * match is a tap, and Undo right after it returns here with the pick cleared.
 */
describe('BadmintonPadScreen: the Start screen', () => {
  const startButton = (words = en) =>
    screen.getByRole('button', { name: words['scoring.start.confirm'] });
  const radios = () => screen.getAllByRole('radio');
  const pick = (name: string) => act(() => fireEvent.click(screen.getByRole('radio', { name })));
  const follows = (a: Node, b: Node) =>
    (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  it('shows the match card, who serves first, then Start match, in a scroll where the halves are', () => {
    renderStart();
    const start = screen.getByTestId('start-screen');
    const parts = [
      within(start).getByTestId('match-card'),
      within(start).getByRole('radiogroup'),
      startButton(),
    ];
    expect(parts.slice(1).map((part, at) => follows(parts[at] as Node, part))).toEqual([
      true,
      true,
    ]);
    expect(rowsIn(start)).toEqual(rowsSaid(en));
    expect(start.contains(startButton())).toBe(true);
    expect(getComputedStyle(start).overflowY).not.toBe('visible');
    expect(screen.queryByTestId('half-first')).toBeNull();
    expect(screen.queryByTestId('last-tap')).toBeNull();
    expect(tool(en['scoring.badminton.tool.setScore'])).toBeNull();
    expect(radios().map((radio) => radio.textContent)).toEqual(['A. Sharma', 'L. Chen']);
  });

  it('keeps the top bar: Back, the tally at 0:0, Match details, History and the sync status', () => {
    renderStart();
    expect(screen.getByRole('button', { name: en['stream.home'] })).toBeTruthy();
    expect(screen.getByTestId('tally').textContent).toBe('0:0');
    expect(screen.getByRole('button', { name: en['scoring.details.title'] })).toBeTruthy();
    expect(screen.getByRole('button', { name: en['scoring.history.title'] })).toBeTruthy();
    expect(screen.getByTestId('sync').textContent).toBe(en['scoring.sync.synced']);
  });

  it('holds Start match disabled, and says so, until a side is picked; one pick at a time', () => {
    renderStart();
    expect(startButton().getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('radiogroup').getAttribute('aria-label')).toBe(
      en['scoring.badminton.start.ask'],
    );
    pick('L. Chen');
    expect(radios().map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'true']);
    expect(startButton().getAttribute('aria-disabled')).not.toBe('true');
    pick('A. Sharma');
    expect(radios().map((radio) => radio.getAttribute('aria-checked'))).toEqual(['true', 'false']);
  });

  it('does nothing for Start match before a pick (empty input)', () => {
    renderStart();
    act(() => fireEvent.click(startButton()));
    expect(screen.getByTestId('start-screen')).toBeTruthy();
  });

  it('starts on a tap: the pad at 0–0, SERVING · RIGHT on the side picked, the line saying so with Undo', () => {
    renderStart();
    pick('L. Chen');
    act(() => fireEvent.click(startButton()));
    expect(screen.queryByTestId('start-screen')).toBeNull();
    expect(shows('first', 0) && shows('second', 0)).toBe(true);
    expect([plate('first'), plate('second')]).toEqual([
      null,
      en['scoring.badminton.serving.right'],
    ]);
    expect(lastTap()).toContain(fill(en['scoring.badminton.last.start'], { side: 'L. Chen' }));
    expect(undo().getAttribute('aria-disabled')).not.toBe('true');
    // Set score stays on the pad before the first rally.
    expect(tool(en['scoring.badminton.tool.setScore'])).not.toBeNull();
  });

  it('returns to the Start screen, the pick cleared, on an Undo right after Start', () => {
    const pad = renderStart();
    pick('L. Chen');
    act(() => fireEvent.click(startButton()));
    undoTap(pad);
    expect(screen.getByTestId('start-screen')).toBeTruthy();
    expect(radios().map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'false']);
    expect(startButton().getAttribute('aria-disabled')).toBe('true');
  });

  it('cannot undo the start once a rally follows: Undo steps back through the rallies only', () => {
    const pad = renderStart();
    pick('L. Chen');
    act(() => fireEvent.click(startButton()));
    rally(pad, 'first');
    undoTap(pad);
    expect(shows('first', 0)).toBe(true);
    expect(lastTap()).toContain(fill(en['scoring.badminton.undone.rally'], { side: 'A. Sharma' }));
    expect(undo().getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByTestId('start-screen')).toBeNull();
  });

  it('lists "Match started" in History', () => {
    renderStart();
    pick('L. Chen');
    act(() => fireEvent.click(startButton()));
    press(en['scoring.history.title']);
    expect(
      within(screen.getByTestId('history')).getByText(
        fill(en['scoring.badminton.last.start'], { side: 'L. Chen' }),
      ),
    ).toBeTruthy();
  });

  // Hardening (2026-11-01): a fast double tap on Start match lands its second tap on the pad that took the Start
  // screen's place. Within the bounce window (`bounce.ts`) it is the same tap: counted once, and said so.
  it('counts a half tapped within the bounce window of Start as the same tap: no rally, "Counted once"', () => {
    renderStart();
    pick('L. Chen');
    act(() => fireEvent.click(startButton()));
    act(() => fireEvent.click(half('first')));
    expect(shows('first', 0) && shows('second', 0)).toBe(true);
    expect(lastTap()).toBe(
      fill(en['scoring.badminton.last.start'], { side: 'L. Chen' }) +
        en['scoring.pad.countedOnce'] +
        en['scoring.pad.undo'],
    );
  });

  it('counts Undo within the bounce window of Start as the same tap: the match stays started', () => {
    renderStart();
    pick('L. Chen');
    act(() => fireEvent.click(startButton()));
    press(en['scoring.pad.undo']);
    expect(screen.queryByTestId('start-screen')).toBeNull();
    expect(lastTap()).toContain(en['scoring.pad.countedOnce']);
  });

  it('takes a rally once the bounce window after Start has passed', () => {
    const pad = renderStart();
    pick('L. Chen');
    act(() => fireEvent.click(startButton()));
    pad.setNow(new Date(TEST_NOW.getTime() + 250));
    act(() => fireEvent.click(half('first')));
    expect(shows('first', 1)).toBe(true);
  });

  it('goes Home on Back, as the pad does', () => {
    const pad = renderStart();
    expect(back(pad)).toBe(true);
    expect(pad.navigation.current()).toBe('home');
  });

  it('comes back afresh from the preview row’s Start, the doubles names as typed', () => {
    renderPad();
    press(CHIP.doubles);
    expect(screen.queryByTestId('start-screen')).toBeNull();
    press(CHIP.start);
    expect(radios().map((radio) => radio.textContent)).toEqual([
      'A. Sharma / R. Iyer',
      'L. Chen / M. Wong',
    ]);
  });

  it('keeps the Not started card for a division not open, under its own chip', () => {
    renderStart();
    press(CHIP.notStarted);
    expect(screen.getByTestId('pad-card')).toBeTruthy();
    expect(screen.queryByTestId('start-screen')).toBeNull();
    expect(CHIP.notStarted).not.toBe(CHIP.start);
  });

  it.each([
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)(
    '%s: the question, the group’s name and Start match in the operator’s language',
    (lang, words) => {
      renderStart({ deviceLanguages: [lang] });
      expect(
        within(screen.getByTestId('start-screen'))
          .getAllByRole('heading')
          .map((h) => h.textContent),
      ).toContain(words['scoring.badminton.start.ask']);
      expect(screen.getByRole('radiogroup').getAttribute('aria-label')).toBe(
        words['scoring.badminton.start.ask'],
      );
      pick('L. Chen');
      act(() => fireEvent.click(startButton(words)));
      const plain = (text: string) => text.split(String.fromCodePoint(0x00a0)).join(' ');
      expect(plain(lastTap() ?? '')).toContain(
        plain(fill(words['scoring.badminton.last.start'], { side: 'L. Chen' })),
      );
    },
  );
});

// Hardening (2026-11-01): the four questions (AGENTS §10) across rounds 2–7, as the scorer meets them on screen.
describe('BadmintonPadScreen: the four questions (hardening, 2026-11-01)', () => {
  const disqualifyChen = () => {
    press(sanctionOn('L. Chen'));
    choose(en['scoring.sanction.disqualification']);
    choose('L. Chen');
    choose(en['scoring.sanction.confirm.action']);
  };

  // A second call: Start match's second tap on a tool in the controls that take the Start screen's room.
  it('opens no tool for a tap within the bounce window of Start, and says so; a moment later it opens', () => {
    const pad = renderStart();
    act(() => fireEvent.click(screen.getByRole('radio', { name: 'L. Chen' })));
    act(() => fireEvent.click(screen.getByRole('button', { name: en['scoring.start.confirm'] })));
    press(en['scoring.badminton.tool.setScore']);
    expect(screen.queryByTestId('score-sheet')).toBeNull();
    expect(lastTap()).toContain(en['scoring.pad.countedOnce']);
    aSecondOn(pad);
    press(en['scoring.badminton.tool.setScore']);
    expect(screen.getByTestId('score-sheet')).toBeTruthy();
  });

  // After an interruption: the preview row's Start mid-match is a new match, nothing of the old one kept.
  it('starts afresh from the preview row’s Start mid-match: 0:0, nothing in History, no pick', () => {
    const pad = renderPad();
    rally(pad, 'first', 21);
    expect(screen.getByTestId('tally').textContent).toBe('1:0');
    press(CHIP.start);
    expect(screen.getByTestId('start-screen')).toBeTruthy();
    expect(screen.getByTestId('tally').textContent).toBe('0:0');
    for (const name of ['A. Sharma', 'L. Chen']) {
      expect(screen.getByRole('radio', { name }).getAttribute('aria-checked')).toBe('false');
    }
    press(en['scoring.history.title']);
    expect(screen.getByText(en['scoring.history.empty'])).toBeTruthy();
  });

  it('comes back to the Start screen, the pick cleared, from the Division not open card', () => {
    renderStart();
    act(() => fireEvent.click(screen.getByRole('radio', { name: 'L. Chen' })));
    press(CHIP.notStarted);
    expect(screen.queryByTestId('start-screen')).toBeNull();
    press(CHIP.pad);
    expect(screen.getByTestId('start-screen')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'L. Chen' }).getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(
      screen
        .getByRole('button', { name: en['scoring.start.confirm'] })
        .getAttribute('aria-disabled'),
    ).toBe('true');
  });

  // An Undo of the start keeps it in History, struck through, as every entry Undo takes back (owner ruling 21).
  it('keeps the undone start in History on the Start screen, struck through, with “Undone”', () => {
    const pad = renderPad();
    undoTap(pad);
    expect(screen.getByTestId('start-screen')).toBeTruthy();
    press(en['scoring.history.title']);
    const rows = screen.getAllByTestId('history-row');
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
      [
        fill(en['scoring.badminton.last.start'], { side: 'A. Sharma' }),
        en['scoring.history.thisPhone'],
        en['scoring.history.undone'],
      ].join(', '),
    ]);
  });

  // After an interruption: a card arrives while the ending waits; under a card the pad takes no tap.
  it('hides the ending prompt under the View only card, and brings it back on the pad', () => {
    renderPad();
    disqualifyChen();
    expect(screen.getByTestId('ending-prompt')).toBeTruthy();
    // The prompt's dim covers the preview row, and hides it from a screen reader: the chip stands for a card the
    // server sends while the ending waits.
    act(() => fireEvent.click(screen.getByRole('button', { name: CHIP.viewOnly, hidden: true })));
    expect(screen.queryByTestId('ending-prompt')).toBeNull();
    expect(screen.getByTestId('pad-card').textContent).toContain(en['scoring.card.viewOnly.title']);
    expect(screen.getByTestId('pad-content').getAttribute('aria-hidden')).not.toBe('true');
    press(CHIP.pad);
    expect(screen.getByTestId('ending-prompt')).toBeTruthy();
  });

  // A second call across the game boundary: the first Undo reopens game 1, the next steps back inside it.
  it('steps back inside game 1 on a second Undo after the game boundary, its box gone', () => {
    const pad = renderPad();
    rally(pad, 'first', 21);
    expect([boxes('first'), boxes('second')]).toEqual([['21'], ['0']]);
    undoTap(pad);
    undoTap(pad);
    expect([boxes('first'), boxes('second')]).toEqual([[], []]);
    expect(shows('first', 19)).toBe(true);
    expect(screen.getByTestId('tally').textContent).toBe('0:0');
    expect(plate('first')).toBe(en['scoring.badminton.serving.left']);
  });

  // After an interruption: Undo takes the interval back to its warning, and the court back to the right.
  it('takes the interval and the court back on Undo: “Interval at 11”, serving from the right', () => {
    const pad = renderPad();
    rally(pad, 'first', 10);
    expect(plate('first')).toBe(en['scoring.badminton.serving.right']);
    rally(pad, 'first');
    expect(screen.getByTestId('strip-interval').textContent).toBe(
      en['scoring.badminton.intervalNow'],
    );
    expect(plate('first')).toBe(en['scoring.badminton.serving.left']);
    undoTap(pad);
    expect(screen.getByTestId('strip-interval').textContent).toBe(
      fill(en['scoring.badminton.intervalAt'], { point: 11 }),
    );
    expect(plate('first')).toBe(en['scoring.badminton.serving.right']);
  });
});

// The coordinator's ruling (2026-11-01): the second tap of a double tap on a sheet's button lands on the next step's,
// on the same bottom edge. Within the bounce window of a step appearing, its buttons do nothing.
describe('BadmintonPadScreen: a sheet step that has just appeared', () => {
  it('does nothing for Record the ending tapped in the window after Disqualify; a moment later it ends the match', () => {
    const pad = renderPad();
    press(sanctionOn('L. Chen'));
    choose(en['scoring.sanction.disqualification']);
    choose('L. Chen');
    choose(en['scoring.sanction.confirm.action']);
    press(en['scoring.ending.record']);
    expect(screen.getByTestId('ending-prompt')).toBeTruthy();
    expect(screen.queryByTestId('pad-card')).toBeNull();
    aSecondOn(pad);
    press(en['scoring.ending.record']);
    expect(screen.queryByTestId('ending-prompt')).toBeNull();
    expect(screen.getByTestId('pad-card').textContent).toContain(
      en['scoring.card.resultRecorded.title'],
    );
  });

  it('records no penalty for a person tapped in the window after the level: the step still asks', () => {
    renderPad();
    press(sanctionOn('L. Chen'));
    choose(en['scoring.sanction.penalty']);
    press('L. Chen');
    expect(screen.getByTestId('step-sheet')).toBeTruthy();
    expect(within(half('second')).queryByText(en['scoring.sanction.penalty'])).toBeNull();
    choose('L. Chen');
    expect(screen.queryByTestId('step-sheet')).toBeNull();
    expect(within(half('second')).getByText(en['scoring.sanction.penalty'])).toBeTruthy();
  });
});

// Review I1 and M2 (2026-11-01): where a double tap's second touch lands once the first has done its work.
describe('BadmintonPadScreen: the second touch of a double tap', () => {
  const dim = () => {
    const found = screen.getByTestId('details-sheet').previousElementSibling;
    if (!(found instanceof HTMLElement)) throw new Error('no dim');
    return found;
  };

  it('keeps Match details up for a touch on the dim within the window of opening it; a moment later the dim closes it', () => {
    const pad = renderPad();
    press(en['scoring.details.title']);
    act(() => fireEvent.click(dim()));
    expect(screen.getByTestId('details-sheet')).toBeTruthy();
    aSecondOn(pad);
    act(() => fireEvent.click(dim()));
    expect(screen.queryByTestId('details-sheet')).toBeNull();
  });

  it('counts Undo within the window of Record the ending once: the result stands, "Counted once"', () => {
    const pad = renderPad();
    press(sanctionOn('L. Chen'));
    choose(en['scoring.sanction.disqualification']);
    choose('L. Chen');
    choose(en['scoring.sanction.confirm.action']);
    choose(en['scoring.ending.record']);
    press(en['scoring.pad.undo']);
    expect(screen.getByTestId('pad-card').textContent).toContain(
      en['scoring.card.resultRecorded.title'],
    );
    expect(lastTap()).toContain(en['scoring.pad.countedOnce']);
    undoTap(pad);
    expect(screen.getByTestId('ending-prompt')).toBeTruthy();
  });
});

/** A language picked while the preview shows, as Home's picker picks one: the provider's own `setLang`. */
function LanguageSwitch() {
  const { setLang } = useLanguage();
  return (
    <button type="button" onClick={() => setLang('fr')}>
      pick-fr
    </button>
  );
}

/**
 * The match card's four questions (hardening of option A; the owner approved the card on build 716, 2026-11-01): a
 * second call, an empty input, an interruption (a card switch or a language picked while it shows), and the other
 * sample and languages, in each of its three places. Portrait only (layout A), so no orientation applies.
 */
describe('BadmintonPadScreen: the match card’s four questions (hardening)', () => {
  const sheetCard = () => within(screen.getByTestId('details-sheet')).getByTestId('match-card');
  /** A chip under a sheet's dim stands for what the server sends while the sheet is up. */
  const chipUnder = (name: string) =>
    act(() => fireEvent.click(screen.getByRole('button', { name, hidden: true })));
  const renderSwitchable = () => {
    const view = renderWithPorts(
      <>
        <PadWithPreviewChips />
        <LanguageSwitch />
      </>,
    );
    act(() => view.navigation.go('scoring'));
    return view;
  };
  const pickFrench = () => act(() => fireEvent.click(screen.getByText('pick-fr')));
  const leastWidths = (within_: HTMLElement) =>
    [...within_.querySelectorAll('[data-testid="match-card-label-cell"]')].map(
      (cell) => getComputedStyle(cell).minWidth,
    );

  // The preview's cards and samples arrive by a chip, which closes the sheet first (`usePick`); the sheet's details are
  // read afresh from the pad at every render, so it opens again on what the pad now holds.
  it('closes Match details for a sample switch, and opens again on the doubles match', () => {
    renderPad();
    press(en['scoring.details.title']);
    chipUnder(CHIP.doubles);
    expect(screen.queryByTestId('details-sheet')).toBeNull();
    press(en['scoring.details.title']);
    expect(within(sheetCard()).getByTestId('match-card-competition').textContent).toBe(
      'Riverside Badminton Club Championships 2026',
    );
    expect(within(sheetCard()).getByTestId('match-card-versus').getAttribute('aria-label')).toBe(
      'A. Sharma / R. Iyer versus L. Chen / M. Wong',
    );
    expect(rowsIn(sheetCard())).toEqual(rowsSaid(en));
  });

  it('closes Match details for the Not started card, which carries the match card; it opens again over it', () => {
    renderPad();
    press(en['scoring.details.title']);
    chipUnder(CHIP.notStarted);
    expect(screen.queryByTestId('details-sheet')).toBeNull();
    expect(screen.getAllByTestId('match-card')).toHaveLength(1);
    press(en['scoring.details.title']);
    expect(within(sheetCard()).getByTestId('match-card-where').textContent).toBe(
      'U15 Boys Singles · Round 1',
    );
    // The card's own match card stands behind the sheet, the same match.
    expect(screen.getAllByTestId('match-card')).toHaveLength(2);
    expect(within(screen.getByTestId('pad-card')).getByTestId('match-card')).toBeTruthy();
  });

  it('shows the doubles sample on the Start screen: the card’s sides and the toss’s, as typed', () => {
    renderStart();
    press(CHIP.doubles);
    press(CHIP.start);
    const start = screen.getByTestId('start-screen');
    expect(
      within(start)
        .getAllByTestId('match-card-name')
        .map((name) => name.textContent),
    ).toEqual(['A. Sharma / R. Iyer', 'L. Chen / M. Wong']);
    expect(within(start).getByTestId('match-card-match').textContent).toBe('BAD0001');
    expect(rowsIn(start)).toEqual(rowsSaid(en));
  });

  it.each([
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)(
    '%s: the Start screen’s card says the rules in the operator’s language',
    (lang, words) => {
      renderStart({ deviceLanguages: [lang] });
      const start = screen.getByTestId('start-screen');
      expect(
        within(start).getByRole('heading', { name: words['scoring.rules.heading'] }),
      ).toBeTruthy();
      expect(rowsIn(start)).toEqual(rowsSaid(words));
      expect(within(start).getByTestId('match-card-versus').getAttribute('aria-label')).toBe(
        fill(words['scoring.details.versus'], { first: 'A. Sharma', second: 'L. Chen' }),
      );
    },
  );

  it('says the Start screen’s rules again in a language picked while it shows, and measures them afresh', () => {
    renderSwitchable();
    const start = () => screen.getByTestId('start-screen');
    const cells = () => within(start()).getAllByTestId('match-card-label-cell');
    layOut(cells()[4] as HTMLElement, { width: 89.4, height: 22 });
    expect(leastWidths(start())).toEqual(['90px', '90px', '90px', '90px', '90px']);
    pickFrench();
    expect(rowsIn(start())).toEqual(rowsSaid(fr));
    expect(leastWidths(start())).toEqual(['0px', '0px', '0px', '0px', '0px']);
    layOut(cells()[4] as HTMLElement, { width: 112, height: 44 });
    expect(leastWidths(start())).toEqual(['112px', '112px', '112px', '112px', '112px']);
  });

  it('says Match details’ rules again in a language picked while the sheet is open', () => {
    const view = renderSwitchable();
    view.setNow(new Date(TEST_NOW.getTime() - 60_000));
    act(() => fireEvent.click(screen.getByRole('radio', { name: 'A. Sharma' })));
    press(en['scoring.start.confirm']);
    view.setNow(TEST_NOW);
    press(en['scoring.details.title']);
    act(() => fireEvent.click(screen.getByText('pick-fr')));
    expect(rowsIn(sheetCard())).toEqual(rowsSaid(fr));
    expect(within(sheetCard()).getByRole('heading').textContent).toBe(fr['scoring.rules.heading']);
  });
});

describe('BadmintonPadScreen: keeping the screen on', () => {
  // Owner ruling 9, applied by the controller on 2026-11-02: held on the pad and under a card the scorer is still
  // waiting on, let go under the two that end their part. Whether the phone's screen really stays lit is the device's.
  it('holds it from the Start screen and on the pad', () => {
    renderStart();
    expect(screenIsHeld(holds)).toBe(true);
    press(CHIP.pad);
    expect(screenIsHeld(holds)).toBe(true);
  });

  it.each([
    ['the match not open yet', CHIP.notStarted],
    ['a recorded result', CHIP.result],
    ['an app to update', CHIP.updateNeeded],
  ] as const)('holds it under %s', (_what, chip) => {
    renderPad();
    press(chip);
    expect(screenIsHeld(holds)).toBe(true);
  });

  it.each([
    ['the organiser’s lock', CHIP.viewOnly],
    ['a link that is not valid', CHIP.linkInvalid],
  ] as const)('lets it go under %s, and holds it again on the pad', (_what, chip) => {
    renderPad();
    expect(screenIsHeld(holds)).toBe(true);
    press(chip);
    expect(screenIsHeld(holds)).toBe(false);
    press(CHIP.pad);
    expect(screenIsHeld(holds)).toBe(true);
  });
});
