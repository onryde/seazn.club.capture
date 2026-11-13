import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PadMatchDetails } from '@/domain/scoring/padView';
import en from '@/i18n/en.json';
import type { MessageKey } from '@/i18n/messages';
import { MatchDetailsView, SetScoreSheet } from '@/ui/components/PadSheets';
import { Text } from '@/ui/components/Text';
import { renderWithPorts } from '../../../test/renderWithPorts';

// Match details in the kit's sheet (S2-4 plan Task 18): a sport may add one block of its own under the match card. A sport
// that adds none is drawn as it was before the prop: the card and Close, no wrapper, nothing empty.

const DETAILS: PadMatchDetails<MessageKey> = {
  context: {
    competition: 'Summer Bash 2026',
    division: 'Open T2',
    round: 'Final',
    match: 'Match 7',
    sides: ['Riverside CC', 'Hillcrest CC'],
  },
  rules: [
    {
      label: { key: 'scoring.cricket.rules.over.label' },
      value: { key: 'scoring.cricket.rules.over.value', vars: { balls: 6 } },
    },
  ],
};

const scroll = () => within(screen.getByTestId('details-scroll'));

describe('MatchDetailsView', () => {
  it('shows the match card and Close, and no sport block when the sport gives none', () => {
    renderWithPorts(<MatchDetailsView details={DETAILS} onClose={vi.fn()} />);
    expect(scroll().getByTestId('match-card')).toBeTruthy();
    expect(screen.queryByTestId('details-sport')).toBeNull();
    expect(screen.getByRole('button', { name: en['panel.close'] })).toBeTruthy();
    // The scroll holds the card alone (its content wrapper has one child).
    const content = screen.getByTestId('details-scroll').firstElementChild;
    expect(content?.children).toHaveLength(1);
  });

  it('draws the sport’s block under the card, inside the scroll', () => {
    renderWithPorts(
      <MatchDetailsView
        details={DETAILS}
        onClose={vi.fn()}
        sport={<Text variant="body">sport words</Text>}
      />,
    );
    const block = scroll().getByTestId('details-sport');
    expect(block.textContent).toBe('sport words');
    const card = scroll().getByTestId('match-card');
    // The block follows the card in the document, in the same scroll.
    expect(card.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a block that is null draws no wrapper, as no block at all', () => {
    renderWithPorts(<MatchDetailsView details={DETAILS} onClose={vi.fn()} sport={null} />);
    expect(screen.queryByTestId('details-sport')).toBeNull();
  });

  it('Close closes, with or without a block', () => {
    const onClose = vi.fn();
    renderWithPorts(
      <MatchDetailsView
        details={DETAILS}
        onClose={onClose}
        sport={<Text variant="body">x</Text>}
      />,
    );
    act(() => fireEvent.click(screen.getByRole('button', { name: en['panel.close'] })));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// G4 (S2-7 Task 11): Set score's title and field words are the sport's to name; the sports that name none keep the shared
// ones (badminton's, table tennis's and volleyball's own sheet tests stay as they were).
describe('SetScoreSheet', () => {
  const props = {
    game: 2,
    names: ['Ana', 'Bea'] as const,
    points: [0, 0] as const,
    onSave: vi.fn(),
    onCancel: vi.fn(),
  };

  it('with no title or field key, says the shared Game and Points words', () => {
    renderWithPorts(<SetScoreSheet {...props} />);
    const sheet = within(screen.getByTestId('score-sheet'));
    expect(sheet.getByText('Set score · Game 2')).toBeTruthy();
    expect(sheet.getByText('Points — Ana')).toBeTruthy();
    expect(sheet.getByText('Points — Bea')).toBeTruthy();
  });

  it('a title and a field key replace them', () => {
    renderWithPorts(
      <SetScoreSheet
        {...props}
        title="Set score · Set 3"
        fieldKey="scoring.tennis.setScore.games"
      />,
    );
    const sheet = within(screen.getByTestId('score-sheet'));
    expect(sheet.getByText('Set score · Set 3')).toBeTruthy();
    expect(sheet.getByText('Games — Ana')).toBeTruthy();
    expect(sheet.queryByText('Points — Ana')).toBeNull();
  });
});
