import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PadHalf } from '@/domain/scoring/padView';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import type { MessageKey } from '@/i18n/messages';
import { ScoreHalf } from '@/ui/components/ScoreHalf';
import { colour, layout } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { declaredStyle } from '../../../test/declaredStyle';
import { layOut } from '../../../test/layOut';
import { linesAllowed } from '../../../test/linesAllowed';
import { edgeOf, fillOf, paintOf, unpaintedFill } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

const NO_MARKS: PadHalf<MessageKey>['marks'] = { clock: false, cards: [], said: [] };

/** Game 3 under way (owner ruling 16's sample): game 1 won 21-15, game 2 lost 18-21; serving from the right; no card. */
const top: PadHalf<MessageKey> = {
  side: 'first',
  label: 'A. Sharma',
  value: '11',
  periods: {
    scores: [
      { value: '21', won: true },
      { value: '18', won: false },
    ],
    said: [{ key: 'scoring.badminton.gamesSaid.other', count: 2, vars: { scores: '21, 18' } }],
  },
  sub: null,
  marks: NO_MARKS,
  serving: {
    shown: { key: 'scoring.badminton.serving.right' },
    said: { key: 'scoring.badminton.servingSaid.right' },
  },
  plate: null,
  action: null,
  bar: 'lit',
  hint: { key: 'scoring.badminton.hint' },
  tappable: true,
};

/** The same half holding a penalty, the web's fault: a red card in the corner (owner ruling 56). */
const carded: PadHalf<MessageKey> = {
  ...top,
  marks: { clock: false, cards: ['dismissal'], said: [{ key: 'scoring.sanction.penalty' }] },
};

/** Table tennis's doubles server: the one line the bottom row still holds after the boxes. */
const SERVER: PadHalf<MessageKey>['sub'] = {
  key: 'scoring.tabletennis.serverPerson',
  vars: { person: 'M. Wong' },
};

/** Game 1: no finished game, no card, receiving. */
const gameOne: PadHalf<MessageKey> = { ...top, periods: null, serving: null };

type Dictionary = Readonly<Record<string, string>>;
const gamesSaid = (words: Dictionary, scores: string) =>
  (words['scoring.badminton.gamesSaid.other'] ?? '').replace('{scores}', scores);
/** The visible hint: the one word "Tap" (owner ruling 56), whatever the sport and the side. */
const TAP = en['scoring.pad.tap'];
/** The half's name, as a screen reader hears it: side, value, finished games, serving with the court. */
const NAME = [
  'A. Sharma',
  '11',
  gamesSaid(en, '21, 18'),
  en['scoring.badminton.servingSaid.right'],
].join(', ');
/** The same half's name when it holds a penalty: the card's name comes before the plate's (owner ruling 56). */
const CARDED_NAME = [
  'A. Sharma',
  '11',
  gamesSaid(en, '21, 18'),
  en['scoring.sanction.penalty'],
  en['scoring.badminton.servingSaid.right'],
].join(', ');
const boxes = () => screen.queryAllByTestId('period');
const SEPARATOR = '·';

describe('ScoreHalf', () => {
  it('shows the names, the big value, the finished games’ scores and the plate with its court', () => {
    renderWithPorts(<ScoreHalf half={top} flash={0} onTap={vi.fn()} />);
    expect(screen.getByText('A. Sharma')).toBeTruthy();
    expect(screen.getByText('11')).toBeTruthy();
    expect(boxes().map((box) => box.textContent)).toEqual(['21', '18']);
    expect(screen.getByTestId('serving').textContent).toBe(en['scoring.badminton.serving.right']);
  });

  // Owner rulings 16 and 17: "Games: 21, 18" and "Serving, right service court".
  it('is one button a screen reader names by side, value, finished games and serving with the court', () => {
    renderWithPorts(<ScoreHalf half={top} flash={0} onTap={vi.fn()} />);
    expect(screen.getByRole('button', { name: NAME })).toBeTruthy();
  });

  // Owner ruling 56: the card is drawn, so its words move to the name; the card's name sits after the games, before Serving.
  it('names its card in the half’s name, after the finished games and before the plate', () => {
    renderWithPorts(<ScoreHalf half={carded} flash={0} onTap={vi.fn()} />);
    expect(screen.getByRole('button', { name: CARDED_NAME })).toBeTruthy();
  });

  it('gives its side the tap', () => {
    const onTap = vi.fn();
    renderWithPorts(<ScoreHalf half={{ ...top, side: 'second' }} flash={0} onTap={onTap} />);
    act(() => fireEvent.click(screen.getByTestId('half-second')));
    expect(onTap).toHaveBeenCalledExactlyOnceWith('second');
  });

  it('takes no tap when it is not tappable', () => {
    const onTap = vi.fn();
    renderWithPorts(<ScoreHalf half={{ ...top, tappable: false }} flash={0} onTap={onTap} />);
    act(() => fireEvent.click(screen.getByTestId('half-first')));
    expect(onTap).not.toHaveBeenCalled();
    expect(screen.getByTestId('half-first').getAttribute('aria-disabled')).toBe('true');
  });

  it('draws no plate for the receiving side, and says no Serving', () => {
    renderWithPorts(<ScoreHalf half={{ ...carded, serving: null }} flash={0} onTap={vi.fn()} />);
    expect(screen.queryByTestId('serving')).toBeNull();
    const name = ['A. Sharma', '11', gamesSaid(en, '21, 18'), en['scoring.sanction.penalty']];
    expect(screen.getByRole('button', { name: name.join(', ') })).toBeTruthy();
  });

  // Owner ruling 16: "Game 1 has no boxes yet: the row shows only the hint." (the word "Tap" since ruling 56).
  it('shows only the hint in game 1: no box, no dot, and no games in its name', () => {
    renderWithPorts(<ScoreHalf half={gameOne} flash={0} onTap={vi.fn()} />);
    expect(boxes()).toEqual([]);
    expect(screen.queryByText(SEPARATOR)).toBeNull();
    const hint = screen.getByText(TAP);
    // Only: an empty box group or server line would still take the row's gap from the hint (mutation check, 2026-11-01).
    expect([...(hint.parentElement?.children ?? [])]).toEqual([hint]);
    expect(screen.getByRole('button', { name: 'A. Sharma, 11' })).toBeTruthy();
  });

  it('draws a server line with no box before it, and no dot', () => {
    renderWithPorts(<ScoreHalf half={{ ...gameOne, sub: SERVER }} flash={0} onTap={vi.fn()} />);
    const line = screen.getByText(
      en['scoring.tabletennis.serverPerson'].replace('{person}', 'M. Wong'),
    );
    expect(screen.queryByText(SEPARATOR)).toBeNull();
    expect([...(line.parentElement?.children ?? [])]).toEqual([line, screen.getByText(TAP)]);
  });

  it('draws no dot after the boxes when there is no server line', () => {
    renderWithPorts(<ScoreHalf half={top} flash={0} onTap={vi.fn()} />);
    expect(boxes()).toHaveLength(2);
    expect(screen.queryByText(SEPARATOR)).toBeNull();
  });

  // Owner ruling 16: "[21] [18] … [21] · M. Wong serves", in one row with the hint, which gives way first. Owner ruling
  // 56: a sanction is no longer words in this row; the doubles server's line is the one that stays.
  it('puts the scores first, then a dot and the server line, then the hint, in one row', () => {
    renderWithPorts(<ScoreHalf half={{ ...top, sub: SERVER }} flash={0} onTap={vi.fn()} />);
    const group = screen.getByTestId('periods');
    const dot = screen.getByText(SEPARATOR);
    const line = screen.getByText(
      en['scoring.tabletennis.serverPerson'].replace('{person}', 'M. Wong'),
    );
    const hint = screen.getByText(TAP);
    const row = group.parentElement;
    if (row === null) throw new Error('no bottom row');
    expect([...row.children]).toEqual([group, dot, line, hint]);
    expect(getComputedStyle(row).flexDirection).toBe('row');
    expect([group.getAttribute('aria-hidden'), dot.getAttribute('aria-hidden')]).toEqual([
      'true',
      'true',
    ]);
  });

  // Owner ruling 56: the bottom row is the boxes, then "Tap": no card words in it, in any sport.
  it('puts no card words in the bottom row: the boxes, then Tap', () => {
    renderWithPorts(<ScoreHalf half={carded} flash={0} onTap={vi.fn()} />);
    const row = screen.getByTestId('periods').parentElement;
    if (row === null) throw new Error('no bottom row');
    expect([...row.children].map((child) => child.textContent)).toEqual(['2118', TAP]);
    expect(row.textContent).not.toContain(en['scoring.sanction.penalty']);
  });

  it('marks a game the side won with lime digits and a lime hairline; a game it lost is plain', () => {
    renderWithPorts(<ScoreHalf half={top} flash={0} onTap={vi.fn()} />);
    const [won, lost] = boxes();
    if (won === undefined || lost === undefined) throw new Error('two boxes');
    const digits = (box: HTMLElement) => getComputedStyle(within(box).getByText(/\d+/)).color;
    expect(paintOf(won).edges).toEqual(Array(4).fill(edgeOf(colour.lime)));
    expect(digits(won)).toBe(edgeOf(colour.lime));
    expect(paintOf(lost).edges).toEqual(Array(4).fill(edgeOf(colour.ink3)));
    expect(digits(lost)).toBe(edgeOf(colour.ink2));
    // A hairline, not a plate: the lime plate is the serving marker's alone.
    expect([paintOf(won).fill, paintOf(lost).fill]).toEqual([unpaintedFill(), unpaintedFill()]);
  });

  it('sets a box’s digits tabular in the box role, centred in a box two digits wide', () => {
    renderWithPorts(<ScoreHalf half={top} flash={0} onTap={vi.fn()} />);
    const [box] = boxes();
    if (box === undefined) throw new Error('a box');
    const digits = within(box).getByText('21');
    expect(getComputedStyle(digits).fontVariant).toContain('tabular-nums');
    expect(getComputedStyle(digits).fontSize).toBe(`${typeScale.periodScore.fontSize}px`);
    expect(getComputedStyle(box).minWidth).toBe(`${layout.padPeriodBox}px`);
    const style = getComputedStyle(box);
    expect([style.flexDirection, style.justifyContent, style.alignItems]).toEqual([
      'row',
      'center',
      'center',
    ]);
    expect(within(box).queryByTestId('period-mark')).toBeNull();
  });

  // Owner ruling 18 (2026-10-31, "box with DQ"): game 1 won 21-15; this side disqualified in game 2 at 9.
  const disqualified: PadHalf<MessageKey> = {
    ...top,
    value: '9',
    periods: {
      scores: [
        { value: '21', won: true },
        { value: '9', won: false, mark: { key: 'scoring.badminton.mark.disqualified' } },
      ],
      said: [
        { key: 'scoring.badminton.gamesSaid.other', count: 1, vars: { scores: '21' } },
        { key: 'scoring.badminton.gameSaid.disqualified', vars: { game: 2, points: 9 } },
      ],
    },
    marks: {
      clock: false,
      cards: ['dismissal'],
      said: [{ key: 'scoring.sanction.disqualification' }],
    },
    serving: null,
    tappable: false,
  };

  it('marks a disqualified game’s box DQ, small, after its score, and draws the box plain', () => {
    renderWithPorts(<ScoreHalf half={disqualified} flash={0} onTap={vi.fn()} />);
    const [won, stopped] = boxes();
    if (won === undefined || stopped === undefined) throw new Error('two boxes');
    expect(within(won).queryByTestId('period-mark')).toBeNull();
    const mark = within(stopped).getByTestId('period-mark');
    expect(mark.textContent).toBe(en['scoring.badminton.mark.disqualified']);
    expect([...stopped.children].map((child) => child.textContent)).toEqual([
      '9',
      en['scoring.badminton.mark.disqualified'],
    ]);
    expect(getComputedStyle(mark).fontSize).toBe(`${typeScale.metricUnit.fontSize}px`);
    // The sanction tools' caution (never red: red means ON AIR, AGENTS §5).
    expect(getComputedStyle(mark).color).toBe(edgeOf(colour.caution));
    expect(paintOf(stopped).edges).toEqual(Array(4).fill(edgeOf(colour.ink3)));
    expect(getComputedStyle(within(stopped).getByText('9')).color).toBe(edgeOf(colour.ink2));
  });

  it.each([
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)('marks it and says it in %s', (lang, words: Dictionary) => {
    renderWithPorts(<ScoreHalf half={disqualified} flash={0} onTap={vi.fn()} />, {
      deviceLanguages: [lang],
    });
    expect(screen.getByTestId('period-mark').textContent).toBe(
      words['scoring.badminton.mark.disqualified'],
    );
    const name = [
      'A. Sharma',
      '9',
      (words['scoring.badminton.gamesSaid.one'] ?? '').replace('{scores}', '21'),
      (words['scoring.badminton.gameSaid.disqualified'] ?? '')
        .replace('{game}', '2')
        .replace('{points}', '9'),
      words['scoring.sanction.disqualification'],
    ].join(', ');
    expect(screen.getByTestId('half-first').getAttribute('aria-label')).toBe(name);
  });

  it('says a disqualified game apart in its name: “Game 2: 9, disqualified”', () => {
    renderWithPorts(<ScoreHalf half={disqualified} flash={0} onTap={vi.fn()} />);
    const name = [
      'A. Sharma',
      '9',
      en['scoring.badminton.gamesSaid.one'].replace('{scores}', '21'),
      en['scoring.badminton.gameSaid.disqualified'].replace('{game}', '2').replace('{points}', '9'),
      en['scoring.sanction.disqualification'],
    ].join(', ');
    expect(screen.getByTestId('half-first').getAttribute('aria-label')).toBe(name);
  });

  // Owner ruling 16: "the hint gives way (ellipsis, then hidden) before the boxes. Boxes are never cut."
  it('never shrinks a box or the server line: the hint alone gives way, one line', () => {
    renderWithPorts(<ScoreHalf half={{ ...top, sub: SERVER }} flash={0} onTap={vi.fn()} />);
    const shrink = (element: HTMLElement) => declaredStyle(element, 'flex-shrink');
    // A View's own 0 (react-native-web's view class, as Yoga's default); a Text is told.
    expect(shrink(screen.getByTestId('periods'))).toBe('0');
    for (const box of boxes()) expect(shrink(box)).toBe('0');
    const line = en['scoring.tabletennis.serverPerson'].replace('{person}', 'M. Wong');
    expect(shrink(screen.getByText(line))).toBe('0');
    const hint = screen.getByText(TAP);
    expect([shrink(hint), declaredStyle(hint, 'min-width')]).toEqual(['1', '0px']);
    expect(linesAllowed(hint)).toBe(1);
  });

  // Owner, 2026-11-02: the bar is the sport's call (`half.bar`), not the side's: the kit draws a lit bar lime and a dim
  // one lilac, whichever side the half is. Both ways, and on both sides, so no side is hard-coded.
  it.each([
    ['first', 'lit', colour.lime],
    ['first', 'dim', colour.ink3],
    ['second', 'lit', colour.lime],
    ['second', 'dim', colour.ink3],
  ] as const)(
    'draws the %s half’s %s bar at its left edge in the token’s colour',
    (side, bar, paint) => {
      renderWithPorts(<ScoreHalf half={{ ...top, side, bar }} flash={0} onTap={vi.fn()} />);
      const edge = getComputedStyle(screen.getByTestId(`half-${side}`)).borderLeftColor;
      expect(edge).toBe(edgeOf(paint));
    },
  );

  it('moves the lime when the half’s bar changes, with nothing else about the half changed', () => {
    const view = renderWithPorts(
      <ScoreHalf half={{ ...top, bar: 'dim' }} flash={0} onTap={vi.fn()} />,
    );
    const edge = () => getComputedStyle(screen.getByTestId('half-first')).borderLeftColor;
    expect(edge()).toBe(edgeOf(colour.ink3));
    view.rerender(<ScoreHalf half={{ ...top, bar: 'lit' }} flash={0} onTap={vi.fn()} />);
    expect(edge()).toBe(edgeOf(colour.lime));
  });

  it('keeps the bar out of the half’s name: the serving plate says who serves', () => {
    renderWithPorts(<ScoreHalf half={{ ...top, bar: 'lit' }} flash={0} onTap={vi.fn()} />);
    const name = screen.getByTestId('half-first').getAttribute('aria-label') ?? '';
    expect(name).toBe(NAME);
    expect(name.toLowerCase()).not.toContain('lime');
  });

  it('sets the value in the score role: tabular, so 9 to 10 does not jump', () => {
    renderWithPorts(<ScoreHalf half={top} flash={0} onTap={vi.fn()} />);
    expect(getComputedStyle(screen.getByText('11')).fontVariant).toContain('tabular-nums');
  });

  // A half 194 tall holds the names' two lines, the score at 96 and the bottom row in its padding (padFit.test.ts);
  // one dp shorter, the score steps down a size rather than run into the other half.
  // 226 holds it at 128 (owner ruling 14: "score centred and larger"); the owner's phone's halves are 209 with the
  // preview row and 233 without (the controller's brief, 2026-10-31).
  it.each([
    [null, typeScale.score.fontSize],
    [233, typeScale.scoreLarge.fontSize],
    [226, typeScale.scoreLarge.fontSize],
    [225, typeScale.score.fontSize],
    [209, typeScale.score.fontSize],
    [194, typeScale.score.fontSize],
    [193, typeScale.scoreCompact.fontSize],
  ] as const)('sets the score for a half %s tall at %i', (height, size) => {
    renderWithPorts(<ScoreHalf half={top} flash={0} onTap={vi.fn()} />);
    if (height !== null) layOut(screen.getByTestId('half-first'), { width: 288, height });
    expect(getComputedStyle(screen.getByText('11')).fontSize).toBe(`${size}px`);
  });

  // Owner ruling 14: the score centred in the space between the name row and the bottom row.
  it('centres the score, across and down, in the space between the names and the bottom row', () => {
    renderWithPorts(<ScoreHalf half={top} flash={0} onTap={vi.fn()} />);
    const middle = screen.getByText('11').parentElement;
    if (middle === null) throw new Error('no score box');
    const style = getComputedStyle(middle);
    expect([style.flexGrow, style.alignItems, style.justifyContent]).toEqual([
      '1',
      'center',
      'center',
    ]);
    const names = screen.getByText('A. Sharma');
    const bottom = screen.getByTestId('periods');
    const follows = (a: Node, b: Node) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect([follows(names, middle), follows(middle, bottom)]).toEqual([true, true]);
  });

  // Owner ruling 14: "a one-line hint at the bottom of each half", on the bottom row so it costs no height. Owner ruling
  // 56 (2026-11-04: "bottom right, just tap Tap?"): the one word "Tap", no side name, in every sport.
  it('shows the one word Tap at the bottom row’s right, in the unit role, hidden from a screen reader', () => {
    renderWithPorts(<ScoreHalf half={top} flash={0} onTap={vi.fn()} />);
    const hint = screen.getByText(TAP);
    expect(hint.textContent).toBe('Tap');
    expect(getComputedStyle(hint).textAlign).toBe('right');
    expect(getComputedStyle(hint).fontSize).toBe(`${typeScale.metricUnit.fontSize}px`);
    expect(hint.getAttribute('aria-hidden')).toBe('true');
    // The button's name is as it was: the hint is not read with it (`accessibilityHint` is dropped by react-native-web in
    // jsdom, so what a screen reader hears of it is the device check's).
    expect(screen.getByRole('button', { name: NAME })).toBeTruthy();
  });

  it('names no side in the hint, whoever the half is, doubles included', () => {
    const doubles = { ...top, label: 'A. Sharma / R. Iyer' };
    renderWithPorts(<ScoreHalf half={doubles} flash={0} onTap={vi.fn()} />);
    expect(screen.getByText(TAP).textContent).toBe('Tap');
    expect(screen.queryByText(/Tap:/)).toBeNull();
    expect(screen.getAllByText(/A\. Sharma/)).toHaveLength(1);
  });

  it('shows no hint on a half that takes no tap, and keeps its boxes and card', () => {
    renderWithPorts(<ScoreHalf half={{ ...carded, tappable: false }} flash={0} onTap={vi.fn()} />);
    expect(screen.queryByText(TAP)).toBeNull();
    expect(boxes()).toHaveLength(2);
    expect(screen.getByTestId('mark-card')).toBeTruthy();
  });

  it('hands its flash the cue it is given (`flashCue`), and the flash takes no touch from the half', () => {
    const onTap = vi.fn();
    renderWithPorts(<ScoreHalf half={top} flash={3} onTap={onTap} />);
    const flash = within(screen.getByTestId('half-first')).getByTestId('tap-flash');
    expect(flash.dataset.cue).toBe('3');
    act(() => fireEvent.click(screen.getByTestId('half-first')));
    expect(onTap).toHaveBeenCalledExactlyOnceWith('first');
  });

  // The four questions: another language. getByText normalises the node's no-break space to a plain one, not the
  // matcher's (docs/i18n-glossary.md); the name is read from its attribute, as written.
  it.each([
    ['es', es, 'Toca'],
    ['fr', fr, 'Touchez'],
    ['nl', nl, 'Tik'],
  ] as const)('says it in %s', (lang, words: Dictionary, tap) => {
    renderWithPorts(<ScoreHalf half={carded} flash={0} onTap={vi.fn()} />, {
      deviceLanguages: [lang],
    });
    expect(screen.getByTestId('serving').textContent).toBe(
      words['scoring.badminton.serving.right'],
    );
    // The word is written out, not read from the dictionary under test: the imperative of each language's pad words.
    expect(words['scoring.pad.tap']).toBe(tap);
    expect(screen.getByText(tap)).toBeTruthy();
    expect(screen.queryByText(en['scoring.pad.tap'])).toBeNull();
    const name = [
      'A. Sharma',
      '11',
      gamesSaid(words, '21, 18'),
      words['scoring.sanction.penalty'],
      words['scoring.badminton.servingSaid.right'],
    ].join(', ');
    expect(screen.getByTestId('half-first').getAttribute('aria-label')).toBe(name);
  });
});

// Owner ruling 56 (2026-11-04, device check): "may in the top right corner", "just clock symbol on expetise and card symbol
// on right cornor, both expetie clock on both card?". A side's card is a small upright card in its colour at the half's
// top-right corner; while Expedite is in force a stopwatch sits before it. Colour, the hairline and the icon's size in sun
// are the device check's: jsdom paints the tokens, not the glass.
/**
 * A plate word and a tap label (plan S2-3, Batch A review): a sport that names its sides by a colour (chess: WHITE, BLACK)
 * puts the word on a plate in the half's head and says what the tap records in place of "Tap". The kit draws whatever
 * words it is given, so these use any dictionary words; the sport's own are its pad's tests'.
 */
describe('ScoreHalf, a plate word and a tap label', () => {
  const PLATE: PadHalf<MessageKey>['plate'] = { key: 'scoring.sanction.penalty' };
  const ACTION: PadHalf<MessageKey>['action'] = { key: 'scoring.tabletennis.half.expedite' };
  const PLATE_WORD = en['scoring.sanction.penalty'];
  const ACTION_WORDS = en['scoring.tabletennis.half.expedite'];
  const plain: PadHalf<MessageKey> = { ...gameOne, plate: PLATE, action: ACTION };

  it('draws the plate word after the names, in a plate of its own', () => {
    renderWithPorts(<ScoreHalf half={plain} flash={0} onTap={vi.fn()} />);
    expect(screen.getByTestId('plate').textContent).toBe(PLATE_WORD);
    const head = screen.getByTestId('plate').parentElement;
    if (head === null) throw new Error('no name row');
    expect([...head.children].map((child) => child.getAttribute('data-testid'))).toEqual([
      null,
      'plate',
    ]);
    expect(head.children[0]?.textContent).toBe('A. Sharma');
  });

  it('draws nothing for a half with no plate', () => {
    renderWithPorts(<ScoreHalf half={gameOne} flash={0} onTap={vi.fn()} />);
    expect(screen.queryByTestId('plate')).toBeNull();
  });

  it('is a neutral plate, not the lime serving plate: a hairline on the raised surface, ink words', () => {
    renderWithPorts(<ScoreHalf half={plain} flash={0} onTap={vi.fn()} />);
    const plate = screen.getByTestId('plate');
    expect(paintOf(plate).fill).toBe(fillOf(colour.surface2));
    expect(paintOf(plate).fill).not.toBe(fillOf(colour.lime));
    expect(paintOf(plate).edges).toEqual(Array(4).fill(edgeOf(colour.ink3)));
    expect(getComputedStyle(within(plate).getByText(PLATE_WORD)).color).toBe(edgeOf(colour.ink));
  });

  it('is never a serving claim: it stands beside the serving plate, after it, and neither replaces the other', () => {
    renderWithPorts(<ScoreHalf half={{ ...top, plate: PLATE }} flash={0} onTap={vi.fn()} />);
    expect(screen.getByTestId('serving').textContent).toBe(en['scoring.badminton.serving.right']);
    expect(screen.getByTestId('plate').textContent).toBe(PLATE_WORD);
    const head = screen.getByTestId('plate').parentElement;
    expect([...(head?.children ?? [])].map((child) => child.getAttribute('data-testid'))).toEqual([
      null,
      'serving',
      'plate',
    ]);
  });

  it('never shrinks, as the serving plate does not: only the names give way', () => {
    renderWithPorts(
      <ScoreHalf half={{ ...plain, label: 'A. Sharma / R. Iyer' }} flash={0} onTap={vi.fn()} />,
    );
    expect(declaredStyle(screen.getByTestId('plate'), 'flex-shrink')).toBe('0');
    expect(declaredStyle(screen.getByText('A. Sharma / R. Iyer'), 'flex-grow')).toBe('1');
  });

  it('is in the half’s name to a screen reader, after the serving court, and is not read twice', () => {
    renderWithPorts(<ScoreHalf half={{ ...top, plate: PLATE }} flash={0} onTap={vi.fn()} />);
    expect(screen.getByRole('button', { name: `${NAME}, ${PLATE_WORD}` })).toBeTruthy();
  });

  it('names a half with a plate and no serving as side, value and the plate word', () => {
    renderWithPorts(<ScoreHalf half={plain} flash={0} onTap={vi.fn()} />);
    expect(screen.getByRole('button', { name: `A. Sharma, 11, ${PLATE_WORD}` })).toBeTruthy();
  });

  it('keeps the plate on a half that takes no tap, and once the match is over', () => {
    renderWithPorts(<ScoreHalf half={{ ...plain, tappable: false }} flash={0} onTap={vi.fn()} />);
    expect(screen.getByTestId('plate').textContent).toBe(PLATE_WORD);
  });

  it('draws the tap label in place of the word Tap, in the same place and role, hidden from a screen reader', () => {
    renderWithPorts(<ScoreHalf half={plain} flash={0} onTap={vi.fn()} />);
    expect(screen.queryByText(TAP)).toBeNull();
    const action = screen.getByText(ACTION_WORDS);
    expect(getComputedStyle(action).textAlign).toBe('right');
    expect(getComputedStyle(action).fontSize).toBe(`${typeScale.metricUnit.fontSize}px`);
    expect(action.getAttribute('aria-hidden')).toBe('true');
    expect(action.parentElement?.children.length).toBe(1);
  });

  it('keeps the label out of the half’s name: the hint says what a tap does', () => {
    renderWithPorts(<ScoreHalf half={plain} flash={0} onTap={vi.fn()} />);
    expect(screen.getByRole('button', { name: `A. Sharma, 11, ${PLATE_WORD}` })).toBeTruthy();
  });

  it('draws no label on a half that takes no tap, as it draws no Tap', () => {
    renderWithPorts(<ScoreHalf half={{ ...plain, tappable: false }} flash={0} onTap={vi.fn()} />);
    expect(screen.queryByText(ACTION_WORDS)).toBeNull();
    expect(screen.queryByText(TAP)).toBeNull();
  });

  it('draws the word Tap for a half with no label', () => {
    renderWithPorts(<ScoreHalf half={{ ...plain, action: null }} flash={0} onTap={vi.fn()} />);
    expect(screen.getByText(TAP)).toBeTruthy();
  });

  it('gives its side the tap, whatever its label says', () => {
    const onTap = vi.fn();
    renderWithPorts(<ScoreHalf half={{ ...plain, side: 'second' }} flash={0} onTap={onTap} />);
    act(() => fireEvent.click(screen.getByTestId('half-second')));
    expect(onTap).toHaveBeenCalledExactlyOnceWith('second');
  });
});

describe('ScoreHalf, the marks in the top-right corner (owner ruling 56)', () => {
  const withMarks = (marks: PadHalf<MessageKey>['marks']): PadHalf<MessageKey> => ({
    ...top,
    marks,
  });
  const SAID_PENALTY = [{ key: 'scoring.sanction.penalty' }] as const;
  const cards = () => screen.queryAllByTestId('mark-card');
  const clock = () =>
    screen.queryAllByTestId('glyph').filter((glyph) => glyph.dataset.name === 'stopwatch');

  it('draws nothing in the corner for a half with no mark: no row, no icon', () => {
    renderWithPorts(<ScoreHalf half={top} flash={0} onTap={vi.fn()} />);
    expect(screen.queryByTestId('marks')).toBeNull();
    expect(cards()).toEqual([]);
    expect(clock()).toEqual([]);
  });

  it.each([
    ['caution', colour.cardCaution],
    ['dismissal', colour.cardDismissal],
  ] as const)(
    'draws a %s card in its token’s colour, with a hairline (ink3) round it',
    (card, token) => {
      renderWithPorts(
        <ScoreHalf
          half={withMarks({ clock: false, cards: [card], said: SAID_PENALTY })}
          flash={0}
          onTap={vi.fn()}
        />,
      );
      const [only] = cards();
      if (only === undefined || cards().length !== 1) throw new Error('one card');
      expect(paintOf(only).fill).toBe(fillOf(token));
      expect(paintOf(only).edges).toEqual(Array(4).fill(edgeOf(colour.ink3)));
    },
  );

  it('draws a card upright, 8 by 11 dp with a 1 dp radius, from the layout tokens', () => {
    renderWithPorts(
      <ScoreHalf
        half={withMarks({ clock: false, cards: ['caution'], said: SAID_PENALTY })}
        flash={0}
        onTap={vi.fn()}
      />,
    );
    const style = getComputedStyle(cards()[0] as HTMLElement);
    expect([style.width, style.height, style.borderTopLeftRadius]).toEqual(['8px', '11px', '1px']);
    expect([layout.padCardWidth, layout.padCardHeight, layout.padCardRadius]).toEqual([8, 11, 1]);
    expect(layout.padCardHeight).toBeGreaterThan(layout.padCardWidth);
  });

  it('draws a yellow and a red card side by side, the yellow first (ITTF’s yellow-red)', () => {
    renderWithPorts(
      <ScoreHalf
        half={withMarks({ clock: false, cards: ['caution', 'dismissal'], said: SAID_PENALTY })}
        flash={0}
        onTap={vi.fn()}
      />,
    );
    const [yellow, red] = cards();
    if (yellow === undefined || red === undefined || cards().length !== 2) throw new Error('two');
    expect([paintOf(yellow).fill, paintOf(red).fill]).toEqual([
      fillOf(colour.cardCaution),
      fillOf(colour.cardDismissal),
    ]);
    expect(yellow.compareDocumentPosition(red) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(yellow.parentElement).toBe(red.parentElement);
    expect(getComputedStyle(yellow.parentElement as HTMLElement).flexDirection).toBe('row');
  });

  it('draws the stopwatch before the card, both in the corner row', () => {
    renderWithPorts(
      <ScoreHalf
        half={withMarks({
          clock: true,
          cards: ['dismissal'],
          said: [...SAID_PENALTY, { key: 'scoring.tabletennis.half.expedite' }],
        })}
        flash={0}
        onTap={vi.fn()}
      />,
    );
    const row = screen.getByTestId('marks');
    const [watch] = clock();
    expect(watch?.dataset.size).toBe(String(layout.padMarkGlyph));
    expect(watch?.dataset.tone).toBe('ink');
    expect([...row.children].map((child) => child.getAttribute('data-testid'))).toEqual([
      'glyph',
      'mark-card',
    ]);
  });

  it('draws the stopwatch alone for a half under Expedite with no card', () => {
    renderWithPorts(
      <ScoreHalf
        half={withMarks({
          clock: true,
          cards: [],
          said: [{ key: 'scoring.tabletennis.half.expedite' }],
        })}
        flash={0}
        onTap={vi.fn()}
      />,
    );
    expect(clock()).toHaveLength(1);
    expect(cards()).toEqual([]);
  });

  it('puts the marks at the far right of the name row, after the serving plate', () => {
    renderWithPorts(
      <ScoreHalf
        half={withMarks({ clock: true, cards: ['caution'], said: SAID_PENALTY })}
        flash={0}
        onTap={vi.fn()}
      />,
    );
    const head = screen.getByTestId('serving').parentElement;
    if (head === null) throw new Error('no name row');
    expect([...head.children].map((child) => child.getAttribute('data-testid'))).toEqual([
      null,
      'serving',
      'marks',
    ]);
    expect(head.children[0]?.textContent).toBe('A. Sharma');
  });

  // "With a long name, the name gives way (ellipsis); the plate and the icons never do."
  it('lets the name give way and never the plate or the icons', () => {
    renderWithPorts(
      <ScoreHalf
        half={{
          ...withMarks({ clock: true, cards: ['caution'], said: SAID_PENALTY }),
          label: 'A. Sharma / R. Iyer',
        }}
        flash={0}
        onTap={vi.fn()}
      />,
    );
    const shrink = (element: HTMLElement) => declaredStyle(element, 'flex-shrink');
    const names = screen.getByText('A. Sharma / R. Iyer');
    expect([shrink(screen.getByTestId('serving')), shrink(screen.getByTestId('marks'))]).toEqual([
      '0',
      '0',
    ]);
    expect(declaredStyle(names, 'flex-grow')).toBe('1');
    expect(declaredStyle(names, 'flex-shrink')).not.toBe('0');
  });

  it('hides the drawings from a screen reader, which hears the words in the half’s name', () => {
    renderWithPorts(
      <ScoreHalf
        half={withMarks({
          clock: true,
          cards: ['caution', 'dismissal'],
          said: [...SAID_PENALTY, { key: 'scoring.tabletennis.half.expedite' }],
        })}
        flash={0}
        onTap={vi.fn()}
      />,
    );
    expect(screen.getByTestId('marks').getAttribute('aria-hidden')).toBe('true');
    const name = [
      'A. Sharma',
      '11',
      gamesSaid(en, '21, 18'),
      en['scoring.sanction.penalty'],
      en['scoring.tabletennis.half.expedite'],
      en['scoring.badminton.servingSaid.right'],
    ].join(', ');
    expect(screen.getByRole('button', { name })).toBeTruthy();
  });

  it('keeps the marks on a half that takes no tap, and draws no hint there', () => {
    renderWithPorts(
      <ScoreHalf
        half={{
          ...withMarks({ clock: true, cards: ['caution'], said: SAID_PENALTY }),
          tappable: false,
        }}
        flash={0}
        onTap={vi.fn()}
      />,
    );
    expect([clock().length, cards().length]).toEqual([1, 1]);
    expect(screen.queryByText(TAP)).toBeNull();
  });

  // The four questions: a second call (a re-render with the same marks draws one icon), and an undo (the card goes).
  it('draws one card per card, however often it renders, and none once the card is undone', () => {
    const view = renderWithPorts(
      <ScoreHalf
        half={withMarks({ clock: false, cards: ['caution'], said: SAID_PENALTY })}
        flash={0}
        onTap={vi.fn()}
      />,
    );
    view.rerender(
      <ScoreHalf
        half={withMarks({ clock: false, cards: ['caution'], said: SAID_PENALTY })}
        flash={1}
        onTap={vi.fn()}
      />,
    );
    expect(cards()).toHaveLength(1);
    view.rerender(<ScoreHalf half={top} flash={1} onTap={vi.fn()} />);
    expect(cards()).toEqual([]);
    expect(screen.queryByTestId('marks')).toBeNull();
  });

  it.each([
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)('says the card’s name in %s', (lang, words: Dictionary) => {
    renderWithPorts(
      <ScoreHalf
        half={withMarks({ clock: false, cards: ['dismissal'], said: SAID_PENALTY })}
        flash={0}
        onTap={vi.fn()}
      />,
      { deviceLanguages: [lang] },
    );
    expect(screen.getByTestId('half-first').getAttribute('aria-label')).toContain(
      words['scoring.sanction.penalty'] ?? '',
    );
    expect(cards()).toHaveLength(1);
  });
});

// Device finding, 2026-11-02: a long single-word name broke inside its word (NameText). One line the phone shrinks to
// fit; a name with gaps keeps its two lines.
describe('ScoreHalf, a name that is one long word', () => {
  const WORD = 'TEest002ashokashTEest002';

  it('is one line, never wrapped inside its word', () => {
    renderWithPorts(<ScoreHalf half={{ ...gameOne, label: WORD }} flash={0} onTap={vi.fn()} />);
    expect(linesAllowed(screen.getByText(WORD))).toBe(1);
  });

  it('keeps two lines for a name with gaps in it', () => {
    renderWithPorts(
      <ScoreHalf half={{ ...gameOne, label: 'A. Sharma / R. Iyer' }} flash={0} onTap={vi.fn()} />,
    );
    expect(linesAllowed(screen.getByText('A. Sharma / R. Iyer'))).toBe(layout.padNameLines);
  });
});

// S2-7 Task 18 (rulings 235, 239, 240, 242): tennis's half as a scoreboard row, the server's line and the final board. Sizes,
// colours and what a phone draws are the device check's; this reads what the half shows and says.
describe('ScoreHalf as a tennis scoreboard row', () => {
  const T = 'scoring.tennis.board.';
  const board = (
    dots: readonly number[] | null,
    sets: readonly string[] = [],
  ): PadHalf<MessageKey> => ({
    ...top,
    periods: null,
    serving: null,
    value: '30',
    scoreboard: {
      setsLabel: { key: `${T}sets` as MessageKey },
      sets,
      dots,
      said: [{ key: `${T}gamesWon` as MessageKey, vars: { count: 3, games: '1, 3, 4' } }],
    },
  });

  it('draws the Sets label and a box for each set over, then a numbered dot for each game won, then Tap', () => {
    renderWithPorts(<ScoreHalf half={board([1, 3, 4], ['7', '6'])} flash={0} onTap={vi.fn()} />);
    const row = screen.getByTestId('scoreboard');
    expect(within(row).getByText(en[`${T}sets` as keyof typeof en])).toBeTruthy();
    expect(screen.getAllByTestId('board-set').map((one) => one.textContent)).toEqual(['7', '6']);
    expect(screen.getAllByTestId('game-dot').map((one) => one.textContent)).toEqual([
      '1',
      '3',
      '4',
    ]);
    expect(row.textContent?.endsWith(TAP)).toBe(true);
    expect(screen.getByTestId('score').textContent).toBe('30');
  });

  it('draws no Sets label before a set is over, and no dots for a side that has won no game or in a match tie-break', () => {
    renderWithPorts(<ScoreHalf half={board([])} flash={0} onTap={vi.fn()} />);
    expect(screen.queryByText(en[`${T}sets` as keyof typeof en])).toBeNull();
    expect(screen.queryAllByTestId('game-dot')).toEqual([]);
    expect(screen.getByTestId('scoreboard')).toBeTruthy();
  });

  it('draws no dots in a match tie-break (null), the Sets boxes staying', () => {
    renderWithPorts(<ScoreHalf half={board(null, ['6', '3'])} flash={0} onTap={vi.fn()} />);
    expect(screen.queryAllByTestId('game-dot')).toEqual([]);
    expect(screen.getAllByTestId('board-set')).toHaveLength(2);
  });

  it('says the games count and which games in the half’s name, and draws no old bottom row', () => {
    renderWithPorts(<ScoreHalf half={board([1, 3, 4])} flash={0} onTap={vi.fn()} />);
    const said = en[`${T}gamesWon` as keyof typeof en]
      .replace('{count}', '3')
      .replace('{games}', '1, 3, 4');
    expect(said).toBe('Games 3: 1, 3, 4');
    expect(screen.getByRole('button', { name: `A. Sharma, 30, ${said}` })).toBeTruthy();
    expect(screen.queryByTestId('periods')).toBeNull();
  });

  it('draws the server’s line under the names and names the server before the value', () => {
    const half = {
      ...board([]),
      server: { key: 'scoring.tennis.serverPerson', vars: { person: 'Ana Ruiz' } },
    } as PadHalf<MessageKey>;
    renderWithPorts(<ScoreHalf half={half} flash={0} onTap={vi.fn()} />);
    expect(screen.getByTestId('server').textContent).toBe('Ana Ruiz serves');
    expect(
      screen.getByRole('button', {
        name: 'A. Sharma, Ana Ruiz serves, 30, Games: 0'.replace('Games: 0', 'Games 3: 1, 3, 4'),
      }),
    ).toBeTruthy();
  });

  it('draws the final board in the place of the value: a box a set with its label, the tie-break loser’s points in brackets', () => {
    const half: PadHalf<MessageKey> = {
      ...top,
      periods: null,
      serving: { shown: { key: `${T}won` as MessageKey }, said: { key: `${T}won` as MessageKey } },
      value: '',
      tappable: false,
      finalBoard: {
        boxes: [
          {
            label: { key: `${T}set` as MessageKey, vars: { set: 1 } },
            value: '6',
            bracket: '5',
            tone: 'plain',
          },
          { label: { key: `${T}sets` as MessageKey }, value: '2', tone: 'plate' },
        ],
        said: [
          {
            key: `${T}said` as MessageKey,
            vars: { label: { key: `${T}sets` as MessageKey }, value: '2' },
          },
        ],
      },
    };
    renderWithPorts(<ScoreHalf half={half} flash={0} onTap={vi.fn()} />);
    expect(screen.queryByTestId('score')).toBeNull();
    expect(screen.queryByTestId('scoreboard')).toBeNull();
    expect(screen.getAllByTestId('final-box').map((one) => one.textContent)).toEqual(['6(5)', '2']);
    expect(screen.getByTestId('final-bracket').textContent).toBe('(5)');
    expect(screen.getByTestId('serving').textContent).toBe(en[`${T}won` as keyof typeof en]);
    expect(screen.getByTestId('final-board').textContent).toContain('Set 1');
    expect(screen.getByRole('button', { name: 'A. Sharma, Sets: 2, Won' })).toBeTruthy();
  });
});
