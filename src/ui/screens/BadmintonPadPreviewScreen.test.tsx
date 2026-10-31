import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { BadmintonPadPreviewScreen } from '@/ui/screens/BadmintonPadPreviewScreen';
import { layout } from '@/ui/theme/tokens';
import { TEST_NOW, type FakePorts } from '../../../test/fakePorts';
import { linesAllowed } from '../../../test/linesAllowed';
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
const shows = (side: 'first' | 'second', points: number) =>
  within(half(side)).queryByText(String(points)) !== null;
const tool = (name: string) => screen.queryByRole('button', { name });
const sanctionOn = (side: string) => `${en['scoring.badminton.tool.sanction']}, ${side}`;
const lastTap = () => screen.getByTestId('last-tap').textContent;
const undo = () => screen.getByRole('button', { name: en['scoring.pad.undo'] });
const fill = (text: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce(
    (out, [name, value]) => out.replace(`{${name}}`, String(value)),
    text,
  );

describe('BadmintonPadPreviewScreen: before the first rally', () => {
  it('shows both sides at 0, the first serving from the right, and Set score', () => {
    renderPad();
    expect(shows('first', 0) && shows('second', 0)).toBe(true);
    expect(within(half('first')).getByTestId('serving')).toBeTruthy();
    expect(within(half('second')).queryByTestId('serving')).toBeNull();
    expect(screen.getByTestId('strip-context').textContent).toBe(
      fill(en['scoring.badminton.context'], { bestOf: 3, game: 1 }),
    );
    expect(screen.getByTestId('strip-court').textContent).toBe(en['scoring.badminton.court.right']);
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
    expect(screen.getByTestId('strip-court').textContent).toBe(en['scoring.badminton.court.left']);
    expect(lastTap()).toContain(fill(en['scoring.badminton.last.rally'], { side: 'A. Sharma' }));
    expect(tool(en['scoring.badminton.tool.setScore'])).toBeNull();
  });

  it('gives a tap on the bottom half the rally and the serve', () => {
    const pad = renderPad();
    rally(pad, 'second');
    expect(shows('first', 0) && shows('second', 1)).toBe(true);
    expect(within(half('second')).getByTestId('serving')).toBeTruthy();
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
  it('between games: the next game at 0, the games line, Set score back', () => {
    const pad = renderPad();
    rally(pad, 'first', 21);
    expect(shows('first', 0) && shows('second', 0)).toBe(true);
    expect(
      within(half('first')).getByText(fill(en['scoring.badminton.games'], { count: 1 })),
    ).toBeTruthy();
    expect(screen.getByTestId('strip-context').textContent).toBe(
      fill(en['scoring.badminton.context'], { bestOf: 3, game: 2 }),
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
});

describe('BadmintonPadPreviewScreen: Set score', () => {
  const field = (side: string) =>
    screen.getByLabelText(fill(en['scoring.setScore.field'], { side }));
  const type = (side: string, value: string) =>
    act(() => fireEvent.change(field(side), { target: { value } }));

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

  it('Warning: level, person, recorded on the side’s games line and in the last-tap line', () => {
    renderPad();
    press(sanctionOn('L. Chen'));
    expect(sheetTitle().getByText(en['scoring.sanction.title'])).toBeTruthy();
    expect(sheetTitle().getByText('L. Chen')).toBeTruthy();
    press(en['scoring.sanction.warning']);
    expect(sheetTitle().getByText(en['scoring.sanction.who'])).toBeTruthy();
    press('L. Chen');
    expect(screen.queryByTestId('step-sheet')).toBeNull();
    expect(
      within(half('second')).getByText(
        fill(en['scoring.badminton.gamesSanctioned'], {
          count: 0,
          sanction: en['scoring.sanction.warning'],
        }),
      ),
    ).toBeTruthy();
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

  it('Void the sanction takes it back and play goes on', () => {
    const pad = renderPad();
    press(sanctionOn('A. Sharma'));
    press(en['scoring.sanction.disqualification']);
    press('A. Sharma');
    press(en['scoring.sanction.confirm.action']);
    press(en['scoring.ending.void']);
    expect(screen.queryByTestId('ending-prompt')).toBeNull();
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
      expect(screen.getByTestId('strip-context').textContent).toBe(
        fill(words['scoring.badminton.context'], { bestOf: 3, game: 1 }),
      );
      rally(pad, 'second');
      expect(lastTap()).toContain(fill(words['scoring.badminton.last.rally'], { side: 'L. Chen' }));
      expect(screen.getByRole('button', { name: words['scoring.pad.undo'] })).toBeTruthy();
    },
  );
});
