import { act, fireEvent, screen, within } from '@testing-library/react';
import { Text } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { TeamColumn, type TeamAction, type TeamColumnView } from '@/ui/components/TeamColumn';
import { goalHeight } from '@/ui/theme/columnBoard';
import { colour, layout } from '@/ui/theme/tokens';
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
  swatch: null,
  ...extra,
});

const GOAL = action('goal.first', 'Goal', { primary: true, said: 'Goal, Riverside FC, 2' });
const YELLOW = action('yellow.first', 'Yellow', { swatch: 'caution' });
const RED = action('red.first', 'Red', { swatch: 'dismissal' });
const SUB = action('sub.first', 'Sub');

const VIEW: TeamColumnView = {
  label: 'Riverside FC',
  bar: 'lit',
  value: '2',
  cards: { yellow: 0, red: 0 },
  said: [],
  tags: [],
  actions: [GOAL, YELLOW, RED, SUB],
};

function renderColumn(view: TeamColumnView, compact?: boolean) {
  const onAction = vi.fn();
  const rendered = renderWithPorts(
    <TeamColumn view={view} onAction={onAction} compact={compact} />,
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

  it('draws a disabled Sub with its note', () => {
    const { onAction } = renderColumn({
      ...VIEW,
      actions: [GOAL, YELLOW, RED, { ...SUB, enabled: false, note: 'No team sheet' }],
    });
    const sub = button('Sub, No team sheet');
    expect(sub.getAttribute('aria-disabled')).toBe('true');
    expect(within(sub).getByText('No team sheet')).toBeTruthy();
    act(() => fireEvent.click(sub));
    expect(onAction).not.toHaveBeenCalled();
    expect(getComputedStyle(within(sub).getByText('Sub')).color).toBe(edgeOf(colour.ink3));
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

  it('puts Yellow and Red in one row, outlined on surface2, each with its swatch, and Sub under them full width', () => {
    renderColumn(VIEW);
    const row = screen.getByTestId('column-cards');
    expect(
      within(row)
        .getAllByRole('button')
        .map((each) => each.textContent),
    ).toEqual(['Yellow', 'Red']);
    expect(declaredStyle(row, 'flex-direction')).toBe('row');
    for (const name of ['Yellow', 'Red']) {
      expect(getComputedStyle(button(name)).backgroundColor).toBe(fillOf(colour.surface2));
      expect(getComputedStyle(button(name)).borderColor).toBe(edgeOf(colour.ink3));
      expect(declaredStyle(button(name), 'min-height')).toBe(`${layout.touch}px`);
    }
    const swatch = (name: string) =>
      getComputedStyle(within(button(name)).getByTestId('card-swatch')).backgroundColor;
    expect(swatch('Yellow')).toBe(fillOf(colour.cardCaution));
    expect(swatch('Red')).toBe(fillOf(colour.cardDismissal));
    expect(within(row).queryByRole('button', { name: 'Sub' })).toBeNull();
    expect(getComputedStyle(button('Sub')).backgroundColor).toBe(fillOf(colour.surface2));
    expect(declaredStyle(button('Sub'), 'min-height')).toBe(`${layout.touch}px`);
  });

  it('the Goal square takes the height the column leaves, at least its own least', () => {
    renderColumn(VIEW);
    const square = button('Goal, Riverside FC, 2');
    expect(declaredStyle(square, 'flex-grow')).toBe('1');
    expect(declaredStyle(square, 'min-height')).toBe(`${goalHeight('full')}px`);
  });

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
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('draws the first side’s edge bar in lime and the second’s in lilac', () => {
    const first = renderColumn(VIEW);
    expect(getComputedStyle(screen.getByTestId('team-column')).borderLeftColor).toBe(
      edgeOf(colour.lime),
    );
    first.rendered.unmount();
    renderColumn({ ...VIEW, bar: 'dim' });
    expect(getComputedStyle(screen.getByTestId('team-column')).borderLeftColor).toBe(
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
  // numeral a step down (`tallyCompact`) beside its word, in a 48 dp square, so every button keeps a touch target on a
  // short phone; a full one, the default, keeps two lines' room and `scoreCompact` over the word.
  it('a compact column sets the name on one line, the numeral a step down, and the square a row', () => {
    renderColumn({ ...VIEW, label: 'Wanderers United Academy' }, true);
    const name = screen.getByText('Wanderers United Academy');
    const score = screen.getByTestId('column-value');
    expect(linesAllowed(name)).toBe(1);
    expect(declaredStyle(name, 'min-height')).toBe(`${typeScale.matchName.lineHeight}px`);
    expect(getComputedStyle(score).fontSize).toBe(`${typeScale.tallyCompact.fontSize}px`);
    const square = button('Goal, Riverside FC, 2');
    expect(declaredStyle(square, 'flex-direction')).toBe('row');
    expect(declaredStyle(square, 'min-height')).toBe(`${layout.touch}px`);
  });

  it('a full column, the default, keeps two lines for the name and the numeral at its size, over the word', () => {
    renderColumn({ ...VIEW, label: 'Wanderers United Academy' });
    expect(linesAllowed(screen.getByText('Wanderers United Academy'))).toBe(layout.padNameLines);
    expect(getComputedStyle(screen.getByTestId('column-value')).fontSize).toBe(
      `${typeScale.scoreCompact.fontSize}px`,
    );
    expect(declaredStyle(button('Goal, Riverside FC, 2'), 'flex-direction')).not.toBe('row');
  });
});
