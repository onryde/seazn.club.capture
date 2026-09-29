import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContinueCard } from '@/ui/components/ContinueCard';
import { colour } from '@/ui/theme/tokens';
import { renderWithPorts } from '../../../test/renderWithPorts';

const noop = () => undefined;

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

  it('draws its title in ink, not the platform default black', () => {
    renderWithPorts(
      <ContinueCard mode="stream" slot={2} validTill="18:40" onContinue={noop} onForget={noop} />,
    );
    // react-native-web moves a StyleSheet colour into an atomic CSS class, so
    // read the computed colour, and run the token through jsdom's normaliser too.
    const expected = document.createElement('span');
    expected.style.color = colour.ink;
    const title = screen.getByText('Continue Live Stream');
    expect(expected.style.color).not.toBe('');
    expect(getComputedStyle(title).color).toBe(expected.style.color);
  });
});
