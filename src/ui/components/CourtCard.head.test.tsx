import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CourtCard as CourtCardModel } from '@/domain/matchday/matchDay';
import en from '@/i18n/en.json';
import { CourtCard } from '@/ui/components/CourtCard';
import { renderWithPorts } from '../../../test/renderWithPorts';

// The court's head: a button that opens the court's day when the card is given a way to, and a read-only stop when not.

const CARD: CourtCardModel = {
  courtId: 'c-2',
  name: 'Court 2',
  venueName: 'Hall A',
  state: 'free',
  now: null,
  next: null,
  then: null,
  finished: [],
};
const NO_STAKE = { count: 0, unreadable: false };

describe('CourtCard: its head', () => {
  it('opens the court’s day with the court’s id, named by what it does and then the state', () => {
    const onOpenDay = vi.fn();
    renderWithPorts(
      <CourtCard card={CARD} stake={NO_STAKE} zone="Europe/London" onOpenDay={onOpenDay} />,
    );
    const name = `${en['matchday.court.openDay'].replace('{court}', 'Court 2')}, ${en['matchday.court.free']}`;
    fireEvent.click(screen.getByRole('button', { name }));
    expect(onOpenDay).toHaveBeenCalledTimes(1);
    expect(onOpenDay).toHaveBeenCalledWith('c-2');
  });

  it('is one read-only stop, "Court 2, Free", when the card has no way to open a day', () => {
    renderWithPorts(<CourtCard card={CARD} stake={NO_STAKE} zone="Europe/London" />);
    expect(screen.getByLabelText(`Court 2, ${en['matchday.court.free']}`)).toBeTruthy();
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it('gives only the button head a 48 dp minimum: the read-only head adds no height of its own', () => {
    const { unmount } = renderWithPorts(
      <CourtCard card={CARD} stake={NO_STAKE} zone="Europe/London" />,
    );
    const quiet = screen.getByLabelText(`Court 2, ${en['matchday.court.free']}`);
    expect(getComputedStyle(quiet).minHeight).not.toBe('48px');
    unmount();
    renderWithPorts(
      <CourtCard card={CARD} stake={NO_STAKE} zone="Europe/London" onOpenDay={vi.fn()} />,
    );
    expect(getComputedStyle(screen.getByTestId('court-head')).minHeight).toBe('48px');
  });
});
