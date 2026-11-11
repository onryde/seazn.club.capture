import { act, fireEvent, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { Text } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { TeamColumn, type TeamAction, type TeamColumnView } from '@/ui/components/TeamColumn';
import { goalHeight, NOTE_HEIGHT } from '@/ui/theme/columnBoard';
import { layOut } from '../../../test/layOut';
import { colour, layout, radius, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { declaredStyle } from '../../../test/declaredStyle';
import { linesAllowed } from '../../../test/linesAllowed';
import { edgeOf, fillOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

// The kit's team column (S2-5 design §6.2; plan P Task 10; the controller's ruling 5): its own action type, translated
// by the sport's screen, so nothing here names a sport. The words are any words.

const action = (id: string, label: string, extra: Partial<TeamAction> = {}): TeamAction => ({
  id,
  label,
  said: null,
  primary: false,
  enabled: true,
  note: null,
  mark: null,
  ...extra,
});

const GOAL = action('goal.first', 'Goal', { primary: true, said: 'Goal, Riverside FC, 2' });
const YELLOW = action('yellow.first', 'Yellow', { mark: 'caution' });
const RED = action('red.first', 'Red', { mark: 'dismissal' });
const SUB = action('sub.first', 'Sub', { mark: 'sub' });

const VIEW: TeamColumnView = {
  label: 'Riverside FC',
  bar: 'lit',
  value: '2',
  cards: { yellow: 0, red: 0 },
  said: [],
  tags: [],
  actions: [GOAL, YELLOW, RED, SUB],
};

function renderColumn(view: TeamColumnView, compact?: boolean, reserveNote?: boolean) {
  const onAction = vi.fn();
  const rendered = renderWithPorts(
    <TeamColumn view={view} onAction={onAction} compact={compact} reserveNote={reserveNote} />,
  );
  return { onAction, rendered };
}

const button = (name: string) => screen.getByRole('button', { name });

describe('TeamColumn', () => {
  it('heads the column with the name, puts the score in the Goal square, and hands each id back', () => {
    const { onAction } = renderColumn(VIEW);
    expect(screen.getByText('Riverside FC')).toBeTruthy();
    const square = button('Goal, Riverside FC, 2');
    expect(within(square).getByTestId('column-value').textContent).toBe('2');
    expect(within(square).getByText('Goal')).toBeTruthy();
    expect(screen.getAllByRole('button').map((each) => each.getAttribute('aria-label'))).toEqual([
      'Goal, Riverside FC, 2',
      'Yellow',
      'Red',
      'Sub',
    ]);
    act(() => fireEvent.click(button('Yellow')));
    act(() => fireEvent.click(button('Red')));
    act(() => fireEvent.click(square));
    expect(onAction.mock.calls).toEqual([['yellow.first'], ['red.first'], ['goal.first']]);
  });

  it('draws no separate score line: the numeral is only in the square', () => {
    renderColumn(VIEW);
    expect(screen.getAllByTestId('column-value')).toHaveLength(1);
    expect(screen.getAllByText('2')).toHaveLength(1);
  });

  // A note is too long for a small square (fr "Plus de remplacement" is 127.7 dp, the square 37): it sits on the one line
  // under the three, and the square keeps its short word, greyed, with the note in its accessible name (ruling 144).
  it('draws a disabled Sub dimmed whole, with its note on the line under the squares', () => {
    const { onAction } = renderColumn({
      ...VIEW,
      actions: [GOAL, YELLOW, RED, { ...SUB, enabled: false, note: 'No team sheet' }],
    });
    const sub = button('Sub, No team sheet');
    expect(sub.getAttribute('aria-disabled')).toBe('true');
    expect(within(sub).queryByText('No team sheet')).toBeNull();
    expect(within(screen.getByTestId('column-note-room')).getByText('No team sheet')).toBeTruthy();
    act(() => fireEvent.click(sub));
    expect(onAction).not.toHaveBeenCalled();
    expect(declaredStyle(sub, 'opacity')).toBe(`${layout.disabledMark}`);
  });

  it('draws the disabled note once for a screen reader: the line is hidden, the name has it', () => {
    renderColumn({
      ...VIEW,
      actions: [GOAL, YELLOW, RED, { ...SUB, enabled: false, note: 'No team sheet' }],
    });
    expect(screen.getByTestId('column-note').getAttribute('aria-hidden')).toBe('true');
    expect(button('Sub, No team sheet')).toBeTruthy();
  });

  it('dims only the disabled square, by the token: an enabled one is whole', () => {
    renderColumn({
      ...VIEW,
      actions: [GOAL, YELLOW, RED, { ...SUB, enabled: false, note: 'No team sheet' }],
    });
    expect(declaredStyle(button('Sub, No team sheet'), 'opacity')).toBe(`${layout.disabledMark}`);
    expect(declaredStyle(button('Yellow'), 'opacity')).not.toBe(`${layout.disabledMark}`);
  });

  // jsdom has no font padding, so nothing renders the difference: this guards the declaration (device-only effect, the
  // empty band over the big digits on Android; owner ruling 146).
  it('keeps includeFontPadding false on the clock hero role and on the Goal numeral style', () => {
    expect(typeScale.clockHero.includeFontPadding).toBe(false);
    const source = readFileSync(`${process.cwd()}/src/ui/components/TeamColumn.tsx`, 'utf8');
    expect(source).toMatch(/numeral: \{[^}]*includeFontPadding: false/);
  });

  it('keeps the note line’s room with no note, so no team’s squares sit off the other’s', () => {
    renderColumn(VIEW);
    const room = screen.getByTestId('column-note-room');
    expect(declaredStyle(room, 'height')).toBe(`${NOTE_HEIGHT}px`);
    expect(screen.queryByTestId('column-note')).toBeNull();
  });

  // Build 1060: the runtime shrink did not run on the NE2211 and "YELLOW" read "YELLO". The size is now set from the
  // measured square (smallLabelFit.test.ts holds the numbers); here, that the column applies it.
  it('sets the small squares’ word from the measured square: full size and a 3 dp inset at 54, smaller at 38.7', () => {
    renderColumn(VIEW);
    const square = button('Yellow');
    const word = () => within(square).getByText('Yellow');
    expect(declaredStyle(word(), 'font-size')).toBe('14px');
    layOut(square, { width: 54, height: 54 });
    expect(declaredStyle(word(), 'font-size')).toBe('14px');
    expect(declaredStyle(word(), 'padding-left')).toBe('3px');
    layOut(square, { width: 38.7, height: 48 });
    expect(declaredStyle(word(), 'font-size')).toBe('10px');
    expect(declaredStyle(word(), 'padding-left')).not.toBe('0px');
  });

  it('draws no note line at all when told none is reserved and the column has no note', () => {
    renderColumn(VIEW, undefined, false);
    expect(screen.queryByTestId('column-note-room')).toBeNull();
  });

  it('a second tap on Sub is a second call: the column debounces nothing, the screen’s sheet does', () => {
    const { onAction } = renderColumn(VIEW);
    act(() => fireEvent.click(button('Sub')));
    act(() => fireEvent.click(button('Sub')));
    expect(onAction.mock.calls).toEqual([['sub.first'], ['sub.first']]);
  });

  it('greys a disabled Goal square: surface2 with ink3 digits, and no press', () => {
    const { onAction } = renderColumn({ ...VIEW, actions: [{ ...GOAL, enabled: false }, SUB] });
    const square = button('Goal, Riverside FC, 2');
    expect(getComputedStyle(square).backgroundColor).toBe(fillOf(colour.surface2));
    expect(getComputedStyle(screen.getByTestId('column-value')).color).toBe(edgeOf(colour.ink3));
    act(() => fireEvent.click(square));
    expect(onAction).not.toHaveBeenCalled();
  });

  it('marks are absent at zero', () => {
    renderColumn(VIEW);
    expect(screen.queryByTestId('column-marks')).toBeNull();
    expect(screen.queryAllByTestId('mark-card')).toEqual([]);
  });

  it('draws one card icon per colour with its count, and the sport’s tags, in one row under the name', () => {
    renderColumn({
      ...VIEW,
      cards: { yellow: 2, red: 1 },
      said: ['Yellow', 'Yellow', 'Red'],
      tags: [
        <Text key="bin" testID="tag">
          #6
        </Text>,
      ],
    });
    const marks = screen.getByTestId('column-marks');
    const cards = within(marks).getAllByTestId('mark-card');
    expect(cards.map((card) => getComputedStyle(card).backgroundColor)).toEqual([
      fillOf(colour.cardCaution),
      fillOf(colour.cardDismissal),
    ]);
    expect(
      within(marks)
        .getAllByTestId('mark-count')
        .map((count) => count.textContent),
    ).toEqual(['2', '1']);
    expect(within(marks).getByTestId('tag').textContent).toBe('#6');
    expect(marks.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByLabelText('Riverside FC, Yellow, Yellow, Red')).toBeTruthy();
  });

  it('draws the marks for a tag alone, and a yellow alone, with no icon for the colour it has none of', () => {
    const tagged = renderColumn({ ...VIEW, tags: [<Text key="bin">#6</Text>] });
    expect(screen.getByTestId('column-marks')).toBeTruthy();
    expect(screen.queryAllByTestId('mark-card')).toEqual([]);
    tagged.rendered.unmount();
    renderColumn({ ...VIEW, cards: { yellow: 1, red: 0 } });
    expect(screen.getAllByTestId('mark-card')).toHaveLength(1);
  });

  // The lead mark is gone (the controller's ruling 135): the bigger number says who leads, so both numerals are night
  // ink on the lime plate, whoever is ahead.
  it('sets the numeral in night ink on the lime plate, the same for every team', () => {
    renderColumn(VIEW);
    expect(getComputedStyle(button('Goal, Riverside FC, 2')).backgroundColor).toBe(
      fillOf(colour.lime),
    );
    expect(getComputedStyle(screen.getByTestId('column-value')).color).toBe(edgeOf(colour.ground));
    expect(getComputedStyle(within(button('Goal, Riverside FC, 2')).getByText('Goal')).color).toBe(
      edgeOf(colour.ground),
    );
  });

  // Ruling 144: Yellow, Red and Sub are one row of three equal squares, each as tall as it is wide (aspect ratio 1), never
  // under a touch target (ruling 145: under about 160 dp the 48 dp height beats the shape); jsdom has no layout, so the
  // styles are read; the sides at each phone are footballFit.test.ts's.
  it('puts Yellow, Red and Sub in one row of three outlined squares on the column’s own surface, a mark over each word', () => {
    renderColumn(VIEW);
    const row = screen.getByTestId('column-cards');
    expect(
      within(row)
        .getAllByRole('button')
        .map((each) => each.textContent),
    ).toEqual(['Yellow', 'Red', 'Sub']);
    expect(declaredStyle(row, 'flex-direction')).toBe('row');
    expect(declaredStyle(row, 'gap')).toBe(`${space.xs}px`);
    for (const name of ['Yellow', 'Red', 'Sub']) {
      // Outlined as the mockup's buttons: the hairline in ink3, 12 dp round, and no grey fill.
      expect(getComputedStyle(button(name)).borderTopColor).toBe(edgeOf(colour.ink3));
      expect(declaredStyle(button(name), 'border-top-width')).toBe(`${layout.iconBorder}px`);
      expect(getComputedStyle(button(name)).borderTopLeftRadius).toBe(`${radius.card}px`);
      expect(getComputedStyle(button(name)).backgroundColor).not.toBe(fillOf(colour.surface2));
      expect(declaredStyle(button(name), 'flex-grow')).toBe('1');
      expect(declaredStyle(button(name), 'aspect-ratio')).toBe('1 / 1');
      expect(declaredStyle(button(name), 'min-height')).toBe(`${layout.touch}px`);
    }
    const swatch = (name: string) =>
      getComputedStyle(within(button(name)).getByTestId('card-swatch')).backgroundColor;
    expect(swatch('Yellow')).toBe(fillOf(colour.cardCaution));
    expect(swatch('Red')).toBe(fillOf(colour.cardDismissal));
    expect(within(button('Sub')).queryByTestId('card-swatch')).toBeNull();
    expect(within(button('Sub')).getByTestId('sub-glyph')).toBeTruthy();
    expect(within(button('Yellow')).queryByTestId('sub-glyph')).toBeNull();
  });

  it('Sub’s glyph is two arrows, one pointing each way, from boxes', () => {
    renderColumn(VIEW);
    const glyph = within(button('Sub')).getByTestId('sub-glyph');
    expect(glyph.children).toHaveLength(2);
    const heads = [...glyph.children].map((arrow) => [...arrow.children] as HTMLElement[]);
    expect(declaredStyle(heads[0]![1]!, 'border-left-width')).toBe(`${layout.padSubHead}px`);
    expect(declaredStyle(heads[1]![0]!, 'border-right-width')).toBe(`${layout.padSubHead}px`);
  });

  // Owner ruling 152: the card hugs its content. The room does not grow into spare height (it is as tall as it is wide,
  // from its measured width) and gives way when the column is held short; so does the card.
  it('the Goal square’s room is as tall as it is wide, never grows, gives way, and the card does not grow', () => {
    renderColumn(VIEW);
    const room = screen.getByTestId('goal-room');
    expect(declaredStyle(room, 'flex-grow')).toBe('0');
    expect(declaredStyle(room, 'flex-shrink')).toBe('1');
    expect(declaredStyle(room, 'min-height')).toBe(`${goalHeight('full')}px`);
    layOut(room, { width: 140, height: 140 });
    expect(declaredStyle(room, 'height')).toBe('140px');
    expect(declaredStyle(screen.getByTestId('team-column'), 'flex-grow')).not.toBe('1');
    expect(declaredStyle(screen.getByTestId('team-column'), 'flex-shrink')).toBe('1');
  });

  // Ruling 144: the square is as wide as the room, or as tall when the room is shorter, and centred in it.
  it.each([
    [140, 166, 140],
    [140, 80, 80],
    [120, 160, 120],
  ] as const)(
    'a room %i wide and %i tall makes a Goal square %i dp a side',
    (width, height, side) => {
      renderColumn(VIEW, true);
      layOut(screen.getByTestId('goal-room'), { width, height });
      const square = button('Goal, Riverside FC, 2');
      expect(declaredStyle(square, 'width')).toBe(`${side}px`);
      expect(declaredStyle(square, 'height')).toBe(`${side}px`);
      expect(declaredStyle(screen.getByTestId('goal-room'), 'align-items')).toBe('center');
      expect(declaredStyle(screen.getByTestId('goal-room'), 'justify-content')).toBe('center');
    },
  );

  it('in the shootout the column is Scored (the square) and Missed, with no card row', () => {
    renderColumn({
      ...VIEW,
      value: '5 (4)',
      actions: [
        action('scored.first', 'Scored', { primary: true, said: 'Scored, Riverside FC, 5 (4)' }),
        action('missed.first', 'Missed'),
      ],
    });
    const square = button('Scored, Riverside FC, 5 (4)');
    expect(within(square).getByTestId('column-value').textContent).toBe('5 (4)');
    expect(button('Missed')).toBeTruthy();
    expect(screen.queryByTestId('column-cards')).toBeNull();
    expect(screen.queryByTestId('column-note-room')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(2);
    // Missed is one full-width row, a touch target tall (ruling 144), under the square.
    expect(declaredStyle(button('Missed'), 'min-height')).toBe(`${layout.touch}px`);
    expect(declaredStyle(button('Missed'), 'aspect-ratio')).toBe('');
  });

  it('draws the first side’s colour bar on the top edge in lime and the second’s in lilac, and none on the left', () => {
    const first = renderColumn(VIEW);
    expect(getComputedStyle(screen.getByTestId('team-column')).borderTopColor).toBe(
      edgeOf(colour.lime),
    );
    expect(declaredStyle(screen.getByTestId('team-column'), 'border-top-width')).toBe(
      `${layout.padSideBar}px`,
    );
    expect(declaredStyle(screen.getByTestId('team-column'), 'border-left-width')).not.toBe(
      `${layout.padSideBar}px`,
    );
    first.rendered.unmount();
    renderColumn({ ...VIEW, bar: 'dim' });
    expect(getComputedStyle(screen.getByTestId('team-column')).borderTopColor).toBe(
      edgeOf(colour.ink3),
    );
  });

  it('caps the name at two lines', () => {
    renderColumn({ ...VIEW, label: 'Riverside Athletic Football Club Reserves' });
    const name = screen.getByText('Riverside Athletic Football Club Reserves');
    expect(linesAllowed(name)).toBe(layout.padNameLines);
  });

  // Two columns stand side by side (plan P Task 12's fit): a name of one line keeps the room of two, so the two squares
  // and the two rows of buttons line up whatever each team is called (footballFit.test.ts).
  it('keeps two lines’ room for a name of one, so the square and the buttons sit where a long name puts them', () => {
    renderColumn({ ...VIEW, label: 'Riverside FC' });
    expect(declaredStyle(screen.getByText('Riverside FC'), 'min-height')).toBe(
      `${layout.padNameLines * typeScale.matchName.lineHeight}px`,
    );
  });
  // The controller's fix-round ruling (b): the marks' row is one line of fixed height, there with no marks too, so a
  // card or a sin-bin tag never moves the buttons.
  it('keeps the marks’ row one line of fixed height, marks or none', () => {
    const none = renderColumn(VIEW);
    const room = () => screen.getByTestId('column-marks-room');
    expect(declaredStyle(room(), 'height')).toBe(`${typeScale.periodScore.lineHeight}px`);
    none.rendered.unmount();
    renderColumn({ ...VIEW, cards: { yellow: 1, red: 1 }, tags: [<Text key="bin">#6</Text>] });
    expect(declaredStyle(room(), 'height')).toBe(`${typeScale.periodScore.lineHeight}px`);
    expect(declaredStyle(screen.getByTestId('column-marks'), 'flex-wrap')).toBe('nowrap');
  });

  // The controller's fix-round 2 ruling (R1): the board picks its tier. A compact column sets the name on one line and the
  // numeral a step down (`tallyCompact`) in a 48 dp square at the least, so every button keeps a touch target on a short
  // phone; a full one, the default, keeps two lines' room and `scoreCompact` over the word.
  it('a compact column sets the name on one line, the numeral a step down, over its word', () => {
    renderColumn({ ...VIEW, label: 'Wanderers United Academy' }, true);
    const name = screen.getByText('Wanderers United Academy');
    const score = screen.getByTestId('column-value');
    expect(linesAllowed(name)).toBe(1);
    expect(declaredStyle(name, 'min-height')).toBe(`${typeScale.matchName.lineHeight}px`);
    expect(getComputedStyle(score).fontSize).toBe(`${typeScale.tallyCompact.fontSize}px`);
    expect(declaredStyle(screen.getByTestId('goal-room'), 'min-height')).toBe(`${layout.touch}px`);
    expect(declaredStyle(button('Goal, Riverside FC, 2'), 'flex-direction')).not.toBe('row');
  });

  it('a full column, the default, keeps two lines for the name and the numeral at its size, over the word', () => {
    renderColumn({ ...VIEW, label: 'Wanderers United Academy' });
    expect(linesAllowed(screen.getByText('Wanderers United Academy'))).toBe(layout.padNameLines);
    expect(getComputedStyle(screen.getByTestId('column-value')).fontSize).toBe(
      `${typeScale.scoreCompact.fontSize}px`,
    );
    expect(declaredStyle(button('Goal, Riverside FC, 2'), 'flex-direction')).not.toBe('row');
  });

  // Controller ruling 138: a compact square's numeral scales from its measured height, 0.4375 of it (56 dp at 128), never
  // under tallyCompact's 30 (what 48 dp holds beside the word) nor over the full tier's 64; a full square stays at 64.
  it.each([
    [48, 30],
    [128, 56],
    [201, 64],
  ] as const)('a compact square %i dp a side sets its numeral at %i dp', (height, size) => {
    renderColumn(VIEW, true);
    layOut(screen.getByTestId('goal-room'), { width: 400, height });
    expect(getComputedStyle(screen.getByTestId('column-value')).fontSize).toBe(`${size}px`);
  });

  it('a full square stays at the full numeral, whatever it measures', () => {
    renderColumn(VIEW);
    layOut(screen.getByTestId('goal-room'), { width: 112, height: 100 });
    expect(getComputedStyle(screen.getByTestId('column-value')).fontSize).toBe(
      `${typeScale.scoreCompact.fontSize}px`,
    );
  });

  it('the numeral follows a square that shrinks again', () => {
    renderColumn(VIEW, true);
    const room = screen.getByTestId('goal-room');
    layOut(room, { width: 400, height: 128 });
    layOut(room, { width: 400, height: 48 });
    expect(getComputedStyle(screen.getByTestId('column-value')).fontSize).toBe('30px');
  });

  it('the accessible name carries the sport’s words and then a disabled note', () => {
    renderColumn({
      ...VIEW,
      actions: [
        GOAL,
        { ...SUB, said: 'Substitution, Riverside FC', enabled: false, note: 'No subs left' },
      ],
    });
    expect(button('Substitution, Riverside FC, No subs left')).toBeTruthy();
  });
});
