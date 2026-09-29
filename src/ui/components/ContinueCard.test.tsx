import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContinueCard } from '@/ui/components/ContinueCard';
import { renderWithPorts } from '../../../test/renderWithPorts';

describe('ContinueCard', () => {
  it('offers to continue or forget the left mode', () => {
    const onContinue = vi.fn();
    const onForget = vi.fn();
    renderWithPorts(
      <ContinueCard
        mode="stream"
        slot={2}
        validTill="18:40"
        onContinue={onContinue}
        onForget={onForget}
      />,
    );
    expect(screen.getByText('Continue Live Stream')).toBeTruthy();
    expect(screen.getByText('Slot 2 · code valid till 18:40')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forget' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onForget).toHaveBeenCalledTimes(1);
  });
});
