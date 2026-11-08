import { act, fireEvent, screen, within } from '@testing-library/react';
import { Text } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { TeamColumn, type TeamAction, type TeamColumnView } from '@/ui/components/TeamColumn';
import { colour, layout } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { declaredStyle } from '../../../test/declaredStyle';
import { linesAllowed } from '../../../test/linesAllowed';
import { edgeOf, fillOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

// The kit's team column (S2-5 design §6.2; plan P Task 10; the controller's ruling 5): its own action type, translated
// by the sport's screen, so nothing here names a sport. The words are any words.

const action = (id: string, label: string, primary = false): TeamAction => ({
  id,
  label,
  primary,
  enabled: true,
  note: null,
});

const GOAL = action('goal.first', 'Goal', true);
const CARD = action('card.first', 'Card');
const SUB = action('sub.first', 'Sub');

const VIEW: TeamColumnView = {
  label: 'Riverside FC',
  bar: 'lit',
  value: '2',
  lead: true,
  cards: { yellow: 0, red: 0 },
  said: [],
  tags: [],
  actions: [GOAL, CARD, SUB],
};

function renderColumn(view: TeamColumnView) {
  const onAction = vi.fn();
  const rendered = renderWithPorts(<TeamColumn view={view} onAction={onAction} />);
  return { onAction, rendered };
}

const button = (name: string) => screen.getByRole('button', { name });

describe('TeamColumn', () => {
  it('names the team and its score, and hands each action’s id back', () => {
    const { onAction } = renderColumn(VIEW);
    expect(screen.getByText('Riverside FC')).toBeTruthy();
    expect(screen.getByTestId('column-value').textContent).toBe('2');
    expect(screen.getAllByRole('button').map((each) => each.textContent)).toEqual([
      'Goal',
      'Card',
      'Sub',
    ]);
    act(() => fireEvent.click(button('Card')));
    expect(onAction).toHaveBeenCalledExactlyOnceWith('card.first');
  });

  it('TeamColumn draws a disabled Sub with its note', () => {
    const { onAction } = renderColumn({
      ...VIEW,
      actions: [GOAL, CARD, { ...SUB, enabled: false, note: 'No team sheet' }],
    });
    const sub = button('Sub, No team sheet');
    expect(sub.getAttribute('aria-disabled')).toBe('true');
    expect(within(sub).getByText('No team sheet')).toBeTruthy();
    act(() => fireEvent.click(sub));
    expect(onAction).not.toHaveBeenCalled();
    expect(getComputedStyle(within(sub).getByText('Sub')).color).toBe(edgeOf(colour.ink3));
  });

  it('marks are absent at zero', () => {
    renderColumn(VIEW);
    expect(screen.queryByTestId('column-marks')).toBeNull();
    expect(screen.queryAllByTestId('mark-card')).toEqual([]);
  });

  it('draws one card icon per colour with its count, and the sport’s tags, in one row', () => {
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
    expect(screen.getByLabelText('Riverside FC, 2, Yellow, Yellow, Red')).toBeTruthy();
  });

  it('draws the marks for a tag alone, and a yellow alone, with no icon for the colour it has none of', () => {
    const tagged = renderColumn({ ...VIEW, tags: [<Text key="bin">#6</Text>] });
    expect(screen.getByTestId('column-marks')).toBeTruthy();
    expect(screen.queryAllByTestId('mark-card')).toEqual([]);
    tagged.rendered.unmount();
    renderColumn({ ...VIEW, cards: { yellow: 1, red: 0 } });
    expect(screen.getAllByTestId('mark-card')).toHaveLength(1);
  });

  it('sets the score in lime when the team leads, and in cream when it does not', () => {
    const leading = renderColumn(VIEW);
    expect(getComputedStyle(screen.getByTestId('column-value')).color).toBe(edgeOf(colour.lime));
    leading.rendered.unmount();
    renderColumn({ ...VIEW, lead: false });
    expect(getComputedStyle(screen.getByTestId('column-value')).color).toBe(edgeOf(colour.ink));
  });

  it('draws the primary action as the lime plate with night ink, the others on surface2', () => {
    renderColumn(VIEW);
    expect(getComputedStyle(button('Goal')).backgroundColor).toBe(fillOf(colour.lime));
    expect(getComputedStyle(within(button('Goal')).getByText('Goal')).color).toBe(
      edgeOf(colour.ground),
    );
    expect(getComputedStyle(button('Card')).backgroundColor).toBe(fillOf(colour.surface2));
    expect(getComputedStyle(button('Sub')).backgroundColor).toBe(fillOf(colour.surface2));
  });

  it('shares the actions’ height 3 : 2 : 2, each at least the touch height', () => {
    renderColumn(VIEW);
    expect(layout.columnPrimary / layout.columnAction).toBe(3 / 2);
    expect(declaredStyle(button('Goal'), 'flex-grow')).toBe(String(layout.columnPrimary));
    for (const name of ['Card', 'Sub'])
      expect(declaredStyle(button(name), 'flex-grow')).toBe(String(layout.columnAction));
    for (const name of ['Goal', 'Card', 'Sub'])
      expect(declaredStyle(button(name), 'min-height')).toBe(`${layout.touch}px`);
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

  // Two columns stand side by side (plan P Task 12's fit): a name of one line keeps the room of two, so the two scores
  // and the two rows of buttons line up whatever each team is called (footballFit.test.ts).
  it('keeps two lines’ room for a name of one, so the score and the buttons sit where a long name puts them', () => {
    renderColumn({ ...VIEW, label: 'Riverside FC' });
    expect(declaredStyle(screen.getByText('Riverside FC'), 'min-height')).toBe(
      `${layout.padNameLines * typeScale.matchName.lineHeight}px`,
    );
  });
});
