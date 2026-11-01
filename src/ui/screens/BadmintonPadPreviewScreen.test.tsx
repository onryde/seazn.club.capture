import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { BadmintonPadPreviewScreen } from '@/ui/screens/BadmintonPadPreviewScreen';
import { colour, layout, space } from '@/ui/theme/tokens';
import { TEST_NOW, type FakePorts } from '../../../test/fakePorts';
import { linesAllowed } from '../../../test/linesAllowed';
import { edgeOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';
import { restoreWindowSize, setWindowSize } from '../../../test/windowSize';

afterEach(restoreWindowSize);

type Pad = ReturnType<typeof renderWithPorts>;

/** The preview as Home opens it: on its own route, with the phone's clock a second on for every tap. */
function renderPad(options?: Parameters<typeof renderWithPorts>[1]): Pad {
  const view = renderWithPorts(<BadmintonPadPreviewScreen />, options);
  act(() => view.navigation.go('scoringPreview'));
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
const half = (side: 'first' | 'second') => screen.getByTestId(`half-${side}`);
/** The half's big number: the game under way's points (a box may hold the same digits). */
const shows = (side: 'first' | 'second', points: number) =>
  within(half(side)).getByTestId('score').textContent === String(points);
const tool = (name: string) => screen.queryByRole('button', { name });
const sanctionOn = (side: string) => `${en['scoring.badminton.tool.sanction']}, ${side}`;
const lastTap = () => screen.getByTestId('last-tap').textContent;
const undo = () => screen.getByRole('button', { name: en['scoring.pad.undo'] });
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

describe('BadmintonPadPreviewScreen: before the first rally', () => {
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
    expect(undo().getAttribute('aria-disabled')).toBe('true');
  });

  it('marks itself a preview and says the taps are synced', () => {
    renderPad();
    expect(screen.getByText(en['scoring.preview.tag'])).toBeTruthy();
    expect(screen.getByTestId('sync').textContent).toBe(en['scoring.sync.synced']);
  });
});

describe('BadmintonPadPreviewScreen: rallies and Undo', () => {
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

describe('BadmintonPadPreviewScreen: games and the match', () => {
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
    press(en['scoring.preview.dev.doubles']);
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

describe('BadmintonPadPreviewScreen: Set score', () => {
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
    renderPad();
    press(en['scoring.badminton.tool.setScore']);
    type('A. Sharma', '5');
    type('L. Chen', '3');
    press(en['scoring.setScore.confirm']);
    expect(screen.queryByTestId('score-sheet')).toBeNull();
    expect(shows('first', 5) && shows('second', 3)).toBe(true);
    expect(lastTap()).toContain(fill(en['scoring.badminton.last.setScore'], { score: '5–3' }));
    press(en['scoring.pad.undo']);
    expect(shows('first', 0)).toBe(true);
    expect(lastTap()).toContain(en['scoring.badminton.undone.setScore']);
  });

  it('refuses a score no game in progress has, in caution, and changes nothing', () => {
    renderPad();
    press(en['scoring.badminton.tool.setScore']);
    type('A. Sharma', '21');
    type('L. Chen', '5');
    press(en['scoring.setScore.confirm']);
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
    expect(lastTap()).toBe(en['scoring.pad.undo']);
    expect(undo().getAttribute('aria-disabled')).toBe('true');
    expect(tool(en['scoring.badminton.tool.setScore'])).not.toBeNull();
  });

  it('clears an old refusal on the next good tap', () => {
    const pad = renderPad();
    press(en['scoring.badminton.tool.setScore']);
    type('A. Sharma', '30');
    press(en['scoring.setScore.confirm']);
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

describe('BadmintonPadPreviewScreen: a sanction, end to end', () => {
  const sheetTitle = () => within(screen.getByTestId('step-sheet'));

  it('Warning: level, person, recorded in the side’s bottom row and in the last-tap line', () => {
    renderPad();
    press(sanctionOn('L. Chen'));
    expect(sheetTitle().getByText(en['scoring.sanction.title'])).toBeTruthy();
    expect(sheetTitle().getByText('L. Chen')).toBeTruthy();
    press(en['scoring.sanction.warning']);
    expect(sheetTitle().getByText(en['scoring.sanction.who'])).toBeTruthy();
    press('L. Chen');
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
    press(en['scoring.sanction.disqualification']);
    press('L. Chen');
    expect(
      sheetTitle().getByText(fill(en['scoring.sanction.confirm.title'], { person: 'L. Chen' })),
    ).toBeTruthy();
    expect(sheetTitle().getByText(en['scoring.sanction.confirm.body'])).toBeTruthy();
    press(en['scoring.sanction.confirm.action']);
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
    press(en['scoring.sanction.disqualification']);
    press('L. Chen');
    press(en['scoring.sanction.confirm.action']);
    press(en['scoring.ending.record']);
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
    press(en['scoring.sanction.disqualification']);
    press('L. Chen');
    press(en['scoring.sanction.confirm.action']);
    expect(boxes('second')).toEqual(['0']);
    press(en['scoring.ending.record']);
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
    press(en['scoring.sanction.disqualification']);
    press('A. Sharma');
    press(en['scoring.sanction.confirm.action']);
    press(en['scoring.ending.void']);
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
    press(en['scoring.sanction.penalty']);
    expect(back(pad)).toBe(true);
    expect(screen.queryByTestId('step-sheet')).toBeNull();
    expect(pad.navigation.current()).toBe('scoringPreview');
    expect(lastTap()).toBe(en['scoring.pad.undo']);
  });

  it('asks which player in doubles', () => {
    renderPad();
    press(en['scoring.preview.dev.doubles']);
    press(sanctionOn('L. Chen / M. Wong'));
    press(en['scoring.sanction.penalty']);
    expect(screen.getByRole('button', { name: 'L. Chen' })).toBeTruthy();
    press('M. Wong');
    expect(lastTap()).toContain(
      fill(en['scoring.badminton.last.sanction'], {
        level: en['scoring.sanction.penalty'],
        person: 'M. Wong',
      }),
    );
  });
});

describe('BadmintonPadPreviewScreen: the preview row', () => {
  it.each([
    ['notStarted', en['scoring.preview.dev.notStarted']],
    ['linkInvalid', en['scoring.preview.dev.linkInvalid']],
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
    press(en['scoring.preview.dev.updateNeeded']);
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
    press(en['scoring.preview.dev.updateNeeded']);
    const order = [
      half('second'),
      screen.getByTestId('update-banner'),
      screen.getByRole('button', { name: en['scoring.preview.dev.pad'] }),
    ];
    const follows = (a: HTMLElement, b: HTMLElement) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect([follows(order[0], order[1]), follows(order[1], order[2])]).toEqual([true, true]);
  });

  it('back on the pad from the update banner: the last-tap line and the tools return', () => {
    const pad = renderPad();
    rally(pad, 'first');
    press(en['scoring.preview.dev.updateNeeded']);
    press(en['scoring.preview.dev.pad']);
    expect(screen.queryByTestId('update-banner')).toBeNull();
    expect(lastTap()).toContain(fill(en['scoring.badminton.last.rally'], { side: 'A. Sharma' }));
    expect(tool(sanctionOn('L. Chen'))).not.toBeNull();
  });

  it.each([en['scoring.card.updateNeeded.update'], en['scoring.card.updateNeeded.browser']])(
    'update needed: %s opens nothing in the preview, and says so on the banner',
    (name) => {
      const pad = renderPad();
      press(en['scoring.preview.dev.updateNeeded']);
      press(name);
      const banner = screen.getByTestId('update-banner');
      expect(within(banner).getByText(en['scoring.preview.noop'])).toBeTruthy();
      expect(pad.navigation.current()).toBe('scoringPreview');
      press(en['scoring.preview.dev.pad']);
      press(en['scoring.preview.dev.updateNeeded']);
      expect(screen.queryByText(en['scoring.preview.noop'])).toBeNull();
    },
  );

  it.each([
    ['resultRecorded', en['scoring.preview.dev.result']],
    ['viewOnly', en['scoring.preview.dev.viewOnly']],
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
    press(en['scoring.preview.dev.result']);
    expect(undo().getAttribute('aria-disabled')).not.toBe('true');
    press(en['scoring.preview.dev.viewOnly']);
    expect(undo().getAttribute('aria-disabled')).toBe('true');
  });

  it('goes back to the same match from a card', () => {
    const pad = renderPad();
    rally(pad, 'first');
    press(en['scoring.preview.dev.linkInvalid']);
    press(en['scoring.preview.dev.pad']);
    expect(shows('first', 1)).toBe(true);
    expect(screen.queryByTestId('pad-card')).toBeNull();
  });

  it('steps the sync status through its four words', () => {
    renderPad();
    const sync = () => screen.getByTestId('sync').textContent;
    press(en['scoring.preview.dev.sync']);
    expect(sync()).toBe(fill(en['scoring.sync.sending.one'], { count: 1 }));
    press(en['scoring.preview.dev.sync']);
    expect(sync()).toBe(fill(en['scoring.sync.offline.other'], { count: 3 }));
    press(en['scoring.preview.dev.sync']);
    expect(sync()).toBe(fill(en['scoring.sync.refused.one'], { count: 1 }));
    press(en['scoring.preview.dev.sync']);
    expect(sync()).toBe(en['scoring.sync.synced']);
  });

  it('doubles joins a match others began: their taps stay when this phone undoes its own', () => {
    const pad = renderPad();
    press(en['scoring.preview.dev.doubles']);
    expect(within(half('first')).getByText('A. Sharma / R. Iyer')).toBeTruthy();
    expect(shows('first', 3) && shows('second', 1)).toBe(true);
    expect(undo().getAttribute('aria-disabled')).toBe('true');
    rally(pad, 'second');
    press(en['scoring.pad.undo']);
    expect(shows('first', 3) && shows('second', 1)).toBe(true);
    expect(undo().getAttribute('aria-disabled')).toBe('true');
  });

  it('starts singles afresh when it is picked again', () => {
    const pad = renderPad();
    rally(pad, 'first');
    press(en['scoring.preview.dev.doubles']);
    press(en['scoring.preview.dev.singles']);
    expect(within(half('first')).getByText('A. Sharma')).toBeTruthy();
    expect(shows('first', 0)).toBe(true);
  });
});

describe('BadmintonPadPreviewScreen: leaving, and the phone', () => {
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
    press(en['scoring.preview.dev.sync']);
    press(en['scoring.preview.dev.sync']);
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
describe('BadmintonPadPreviewScreen: the flash of a half whose tap counted', () => {
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
    press(en['scoring.setScore.confirm']);
    press(sanctionOn('L. Chen'));
    press(en['scoring.sanction.warning']);
    press('L. Chen');
    expect(lastTap()).toContain(
      fill(en['scoring.badminton.last.sanction'], {
        level: en['scoring.sanction.warning'],
        person: 'L. Chen',
      }),
    );
    expect(cues()).toEqual(['0', '1']);
  });

  it.each([
    en['scoring.preview.dev.result'],
    en['scoring.preview.dev.viewOnly'],
    en['scoring.preview.dev.sync'],
    en['scoring.preview.dev.doubles'],
  ])(
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
    press(en['scoring.preview.dev.notStarted']);
    press(en['scoring.preview.dev.pad']);
    expect(cues()).toEqual(['0', '0']);
    rally(pad, 'first');
    expect(cue('first')).not.toBe('0');
  });
});

/** Owner ruling 14: "a one-line hint at the bottom of each half". */
describe('BadmintonPadPreviewScreen: the halves’ hints', () => {
  const hint = (side: string) => fill(en['scoring.badminton.hintLine'], { side });

  it('names each half’s side in its hint while the half takes a tap, and drops it under a card', () => {
    const pad = renderPad();
    expect(within(half('first')).getByText(hint('A. Sharma'))).toBeTruthy();
    expect(within(half('second')).getByText(hint('L. Chen'))).toBeTruthy();
    rally(pad, 'first');
    press(en['scoring.preview.dev.result']);
    expect(screen.queryByText(hint('A. Sharma'))).toBeNull();
    expect(screen.queryByText(hint('L. Chen'))).toBeNull();
  });
});

/**
 * Owner ruling 15 (2026-10-31): "a 'Rules' button in the top bar beside the sync status, opening a sheet over the pad";
 * ruling 20 made it an icon named "Match rules", with History beside it.
 */
describe('BadmintonPadPreviewScreen: Rules', () => {
  const rulesButton = () => screen.queryByRole('button', { name: en['scoring.rules.title'] });
  /** The preview's match (best of 3, 21 won by 2, capped at 30, the interval at 11), in the dictionary's words. */
  const LINES = [
    fill(en['scoring.badminton.rules.bestOf.other'], { count: 3 }),
    fill(en['scoring.badminton.rules.points'], { points: 21, winBy: 2 }),
    fill(en['scoring.badminton.rules.cap'], { cap: 30 }),
    fill(en['scoring.badminton.intervalAt'], { point: 11 }),
    fill(en['scoring.badminton.rules.endsChange'], { point: 11, game: 3 }),
  ];
  const lines = () => screen.getAllByTestId('rules-line').map((line) => line.textContent);

  // Owner ruling 20: "Order: Back, Preview tag, then the right end holds [Rules][History] then the sync status."
  it('stands in the top bar after Back and the Preview tag, then History, then the sync status', () => {
    renderPad();
    const order = [
      screen.getByRole('button', { name: en['stream.home'] }),
      screen.getByText(en['scoring.preview.tag']),
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
    expect([glyph(en['scoring.rules.title']), glyph(en['scoring.history.title'])]).toEqual([
      'info',
      'history',
    ]);
    expect([tone(en['scoring.rules.title']), tone(en['scoring.history.title'])]).toEqual([
      'ink2',
      'ink2',
    ]);
    expect(rulesButton()?.textContent).toBe('');
  });

  // padFit.test.ts fits the row at 320 and 360 dp: gaps of `space.xs`, the end group pushed right by its auto margin, the
  // sync status in its fixed box, and the tag the one thing that gives way.
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
    const tag = screen.getByText(en['scoring.preview.tag']);
    expect([getComputedStyle(tag).flexShrink, getComputedStyle(tag).whiteSpace]).toEqual([
      '1',
      'nowrap',
    ]);
  });

  it('opens the match rules over the pad, which it hides from a screen reader, and changes no score', () => {
    const pad = renderPad();
    rally(pad, 'first', 2);
    press(en['scoring.rules.title']);
    const sheet = within(screen.getByTestId('rules-sheet'));
    expect(sheet.getByText(en['scoring.rules.title'])).toBeTruthy();
    expect(lines()).toEqual(LINES);
    expect(screen.getByTestId('pad-content').getAttribute('aria-hidden')).toBe('true');
    expect(shows('first', 2) && shows('second', 0)).toBe(true);
    press(en['panel.close']);
    expect(screen.queryByTestId('rules-sheet')).toBeNull();
    expect(screen.getByTestId('pad-content').getAttribute('aria-hidden')).not.toBe('true');
    expect(shows('first', 2)).toBe(true);
  });

  it('opens once for a double tap: one Back closes it, the next returns Home', () => {
    const pad = renderPad();
    const button = rulesButton();
    if (button === null) throw new Error('no Rules');
    act(() => fireEvent.click(button));
    act(() => fireEvent.click(button));
    expect(screen.getAllByTestId('rules-sheet')).toHaveLength(1);
    expect(back(pad)).toBe(true);
    expect(screen.queryByTestId('rules-sheet')).toBeNull();
    expect(pad.navigation.current()).toBe('scoringPreview');
    expect(back(pad)).toBe(true);
    expect(pad.navigation.current()).toBe('home');
  });

  it.each([
    en['scoring.preview.dev.notStarted'],
    en['scoring.preview.dev.result'],
    en['scoring.preview.dev.viewOnly'],
    en['scoring.preview.dev.updateNeeded'],
  ])('shows under the %s card, where the match’s config is known', (chip) => {
    renderPad();
    press(chip);
    expect(rulesButton()).not.toBeNull();
    press(en['scoring.rules.title']);
    expect(lines()).toEqual(LINES);
  });

  it('is absent for a bad link, which names no match, and back on the pad', () => {
    renderPad();
    press(en['scoring.preview.dev.linkInvalid']);
    expect(rulesButton()).toBeNull();
    press(en['scoring.preview.dev.pad']);
    expect(rulesButton()).not.toBeNull();
  });

  it.each([
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)(
    '%s: the button, the title and the lines in the operator’s language',
    (lang, words) => {
      renderPad({ deviceLanguages: [lang] });
      press(words['scoring.rules.title']);
      expect(
        within(screen.getByTestId('rules-sheet')).getByText(words['scoring.rules.title']),
      ).toBeTruthy();
      const plain = (text: string) => text.split(String.fromCodePoint(0x00a0)).join(' ');
      expect(lines().map((line) => plain(line ?? ''))).toEqual(
        [
          fill(words['scoring.badminton.rules.bestOf.other'], { count: 3 }),
          fill(words['scoring.badminton.rules.points'], { points: 21, winBy: 2 }),
          fill(words['scoring.badminton.rules.cap'], { cap: 30 }),
          fill(words['scoring.badminton.intervalAt'], { point: 11 }),
          fill(words['scoring.badminton.rules.endsChange'], { point: 11, game: 3 }),
        ].map(plain),
      );
      expect(screen.getByRole('button', { name: words['panel.close'] })).toBeTruthy();
    },
  );
});

describe('BadmintonPadPreviewScreen: in four languages', () => {
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
describe('BadmintonPadPreviewScreen: History', () => {
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

  it('covers the pad, which it hides from a screen reader, with Back and the title, and says when nothing is recorded', () => {
    renderPad();
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
    expect(groups[1] && within(groups[1]).getAllByTestId('history-row')).toHaveLength(21);
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
    press(en['scoring.preview.dev.doubles']);
    rally(pad, 'second');
    openHistory();
    const other = en['scoring.history.otherScorer'];
    expect(said()).toEqual([
      `${rallyTo('L. Chen / M. Wong')}, 3–2, ${thisPhone}`,
      `${rallyTo('A. Sharma / R. Iyer')}, 3–1, ${other}`,
      `${rallyTo('A. Sharma / R. Iyer')}, 2–1, ${other}`,
      `${rallyTo('L. Chen / M. Wong')}, 1–1, ${other}`,
      `${rallyTo('A. Sharma / R. Iyer')}, 1–0, ${other}`,
    ]);
  });

  it('lists a sanction and Set score with no score of their own, and the disqualification and its ending', () => {
    renderPad();
    press(en['scoring.badminton.tool.setScore']);
    const field = (side: string) =>
      screen.getByLabelText(fill(en['scoring.setScore.field'], { side }));
    act(() => fireEvent.change(field('A. Sharma'), { target: { value: '9' } }));
    act(() => fireEvent.change(field('L. Chen'), { target: { value: '4' } }));
    press(en['scoring.setScore.confirm']);
    press(sanctionOn('A. Sharma'));
    press(en['scoring.sanction.disqualification']);
    press('A. Sharma');
    press(en['scoring.sanction.confirm.action']);
    press(en['scoring.ending.record']);
    openHistory();
    expect(said()).toEqual([
      `${fill(en['scoring.badminton.last.ending'], { person: 'A. Sharma' })}, ${thisPhone}`,
      `${fill(en['scoring.badminton.last.sanction'], {
        level: en['scoring.sanction.disqualification'],
        person: 'A. Sharma',
      })}, ${thisPhone}`,
      `${fill(en['scoring.badminton.last.setScore'], { score: '9–4' })}, ${thisPhone}`,
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
    expect(pad.navigation.current()).toBe('scoringPreview');
    expect(back(pad)).toBe(true);
    expect(pad.navigation.current()).toBe('home');
  });

  it('is absent for a bad link, which names no match, and shows under every other card', () => {
    renderPad();
    for (const chip of [
      en['scoring.preview.dev.notStarted'],
      en['scoring.preview.dev.result'],
      en['scoring.preview.dev.viewOnly'],
      en['scoring.preview.dev.updateNeeded'],
    ]) {
      press(chip);
      expect(historyButton()).not.toBeNull();
    }
    press(en['scoring.preview.dev.linkInvalid']);
    expect(historyButton()).toBeNull();
    press(en['scoring.preview.dev.pad']);
    expect(historyButton()).not.toBeNull();
  });

  it.each([
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)(
    '%s: the button, the title, the empty line and the recorder in the operator’s language',
    (lang, words) => {
      const pad = renderPad({ deviceLanguages: [lang] });
      press(words['scoring.history.title']);
      expect(cover().getByText(words['scoring.history.empty'])).toBeTruthy();
      press(words['panel.close']);
      rally(pad, 'first');
      press(words['scoring.history.title']);
      expect(headings()).toEqual([fill(words['scoring.badminton.gameHeading'], { game: 1 })]);
      expect(cover().getByTestId('history-by').textContent).toBe(
        words['scoring.history.thisPhone'],
      );
    },
  );
});
