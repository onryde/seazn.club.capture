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
import { edgeOf, paintOf, unpaintedFill } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

/** Game 3 under way (owner ruling 16's sample): game 1 won 21-15, game 2 lost 18-21; a penalty; serving from the right. */
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
  sub: { key: 'scoring.sanction.penalty' },
  serving: {
    shown: { key: 'scoring.badminton.serving.right' },
    said: { key: 'scoring.badminton.servingSaid.right' },
  },
  bar: 'lit',
  hint: { key: 'scoring.badminton.hint' },
  hintLine: { key: 'scoring.badminton.hintLine', vars: { side: 'A. Sharma' } },
  tappable: true,
};

/** Game 1: no finished game, no sanction, receiving. */
const gameOne: PadHalf<MessageKey> = { ...top, periods: null, sub: null, serving: null };

type Dictionary = Readonly<Record<string, string>>;
const gamesSaid = (words: Dictionary, scores: string) =>
  (words['scoring.badminton.gamesSaid.other'] ?? '').replace('{scores}', scores);
const hintFor = (side: string) => en['scoring.badminton.hintLine'].replace('{side}', side);
/** The half's name, as a screen reader hears it: side, value, finished games, sanction, serving with the court. */
const NAME = [
  'A. Sharma',
  '11',
  gamesSaid(en, '21, 18'),
  en['scoring.sanction.penalty'],
  en['scoring.badminton.servingSaid.right'],
].join(', ');
const boxes = () => screen.queryAllByTestId('period');
const SEPARATOR = '·';

describe('ScoreHalf', () => {
  it('shows the names, the big value, the finished games’ scores, the sanction and the plate with its court', () => {
    renderWithPorts(<ScoreHalf half={top} flash={0} onTap={vi.fn()} />);
    expect(screen.getByText('A. Sharma')).toBeTruthy();
    expect(screen.getByText('11')).toBeTruthy();
    expect(boxes().map((box) => box.textContent)).toEqual(['21', '18']);
    expect(screen.getByText(en['scoring.sanction.penalty'])).toBeTruthy();
    expect(screen.getByTestId('serving').textContent).toBe(en['scoring.badminton.serving.right']);
  });

  // Owner rulings 16 and 17: "Games: 21, 18" and "Serving, right service court".
  it('is one button a screen reader names by side, value, finished games, sanction and serving with the court', () => {
    renderWithPorts(<ScoreHalf half={top} flash={0} onTap={vi.fn()} />);
    expect(screen.getByRole('button', { name: NAME })).toBeTruthy();
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
    renderWithPorts(<ScoreHalf half={{ ...top, serving: null }} flash={0} onTap={vi.fn()} />);
    expect(screen.queryByTestId('serving')).toBeNull();
    const name = ['A. Sharma', '11', gamesSaid(en, '21, 18'), en['scoring.sanction.penalty']];
    expect(screen.getByRole('button', { name: name.join(', ') })).toBeTruthy();
  });

  // Owner ruling 16: "Game 1 has no boxes yet: the row shows only the hint."
  it('shows only the hint in game 1: no box, no dot, and no games in its name', () => {
    renderWithPorts(<ScoreHalf half={gameOne} flash={0} onTap={vi.fn()} />);
    expect(boxes()).toEqual([]);
    expect(screen.queryByText(SEPARATOR)).toBeNull();
    const hint = screen.getByText(hintFor('A. Sharma'));
    // Only: an empty box group or sanction would still take the row's gap from the hint (mutation check, 2026-11-01).
    expect([...(hint.parentElement?.children ?? [])]).toEqual([hint]);
    expect(screen.getByRole('button', { name: 'A. Sharma, 11' })).toBeTruthy();
  });

  it('names a sanction with no box before it, and no dot', () => {
    renderWithPorts(
      <ScoreHalf
        half={{ ...gameOne, sub: { key: 'scoring.sanction.warning' } }}
        flash={0}
        onTap={vi.fn()}
      />,
    );
    const sanction = screen.getByText(en['scoring.sanction.warning']);
    expect(screen.queryByText(SEPARATOR)).toBeNull();
    expect([...(sanction.parentElement?.children ?? [])]).toEqual([
      sanction,
      screen.getByText(hintFor('A. Sharma')),
    ]);
  });

  it('draws no dot after the boxes when there is no sanction', () => {
    renderWithPorts(<ScoreHalf half={{ ...top, sub: null }} flash={0} onTap={vi.fn()} />);
    expect(boxes()).toHaveLength(2);
    expect(screen.queryByText(SEPARATOR)).toBeNull();
  });

  // Owner ruling 16: "[21] [18] … [21] · Penalty", in one row with the hint, which gives way first.
  it('puts the scores first, then a dot and the sanction, then the hint, in one row', () => {
    renderWithPorts(<ScoreHalf half={top} flash={0} onTap={vi.fn()} />);
    const group = screen.getByTestId('periods');
    const dot = screen.getByText(SEPARATOR);
    const sanction = screen.getByText(en['scoring.sanction.penalty']);
    const hint = screen.getByText(hintFor('A. Sharma'));
    const row = group.parentElement;
    if (row === null) throw new Error('no bottom row');
    expect([...row.children]).toEqual([group, dot, sanction, hint]);
    expect(getComputedStyle(row).flexDirection).toBe('row');
    expect([group.getAttribute('aria-hidden'), dot.getAttribute('aria-hidden')]).toEqual([
      'true',
      'true',
    ]);
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
    sub: { key: 'scoring.sanction.disqualification' },
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
  it('never shrinks a box or the sanction: the hint alone gives way, one line', () => {
    renderWithPorts(<ScoreHalf half={top} flash={0} onTap={vi.fn()} />);
    const shrink = (element: HTMLElement) => declaredStyle(element, 'flex-shrink');
    // A View's own 0 (react-native-web's view class, as Yoga's default); a Text is told.
    expect(shrink(screen.getByTestId('periods'))).toBe('0');
    for (const box of boxes()) expect(shrink(box)).toBe('0');
    expect(shrink(screen.getByText(en['scoring.sanction.penalty']))).toBe('0');
    const hint = screen.getByText(hintFor('A. Sharma'));
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

  // Owner ruling 14: "a one-line hint at the bottom of each half", on the bottom row so it costs no height.
  it('shows the hint at the bottom row’s right, in the unit role, hidden from a screen reader', () => {
    renderWithPorts(<ScoreHalf half={top} flash={0} onTap={vi.fn()} />);
    const hint = screen.getByText(hintFor('A. Sharma'));
    expect(getComputedStyle(hint).textAlign).toBe('right');
    expect(getComputedStyle(hint).fontSize).toBe(`${typeScale.metricUnit.fontSize}px`);
    expect(hint.getAttribute('aria-hidden')).toBe('true');
    // The button's name is as it was: the hint is not read with it.
    expect(screen.getByRole('button', { name: NAME })).toBeTruthy();
  });

  it('shows no hint on a half that takes no tap, and keeps its boxes and sanction', () => {
    renderWithPorts(<ScoreHalf half={{ ...top, tappable: false }} flash={0} onTap={vi.fn()} />);
    expect(screen.queryByText(hintFor('A. Sharma'))).toBeNull();
    expect(boxes()).toHaveLength(2);
    expect(screen.getByText(en['scoring.sanction.penalty'])).toBeTruthy();
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
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)('says it in %s', (lang, words: Dictionary) => {
    renderWithPorts(<ScoreHalf half={top} flash={0} onTap={vi.fn()} />, {
      deviceLanguages: [lang],
    });
    const plain = (text: string) => text.split(String.fromCodePoint(0x00a0)).join(' ');
    expect(screen.getByTestId('serving').textContent).toBe(
      words['scoring.badminton.serving.right'],
    );
    expect(screen.getByText(words['scoring.sanction.penalty'] ?? '')).toBeTruthy();
    const hint = (words['scoring.badminton.hintLine'] ?? '').replace('{side}', 'A. Sharma');
    expect(screen.getByText(plain(hint))).toBeTruthy();
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
