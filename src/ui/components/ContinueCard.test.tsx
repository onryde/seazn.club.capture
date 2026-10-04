import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ContinueCopy } from '@/domain/mode/continueCard';
import { ContinueCard } from '@/ui/components/ContinueCard';
import { colour } from '@/ui/theme/tokens';
import { renderWithPorts } from '../../../test/renderWithPorts';

const noop = () => undefined;
const SAVED: ContinueCopy = { kind: 'saved', slot: 2, validTill: '18:40' };

describe('ContinueCard', () => {
  it('offers to continue or forget the left mode', () => {
    const onContinue = vi.fn();
    const onForget = vi.fn();
    renderWithPorts(
      <ContinueCard mode="stream" copy={SAVED} onContinue={onContinue} onForget={onForget} />,
    );
    expect(screen.getByText('Continue Live Stream')).toBeTruthy();
    expect(screen.getByText('Slot 2 · code valid till 18:40')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forget' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onForget).toHaveBeenCalledTimes(1);
  });

  it('draws its title in ink, not the platform default black', () => {
    renderWithPorts(<ContinueCard mode="stream" copy={SAVED} onContinue={noop} onForget={noop} />);
    // react-native-web moves a StyleSheet colour into an atomic CSS class, so
    // read the computed colour, and run the token through jsdom's normaliser too.
    const expected = document.createElement('span');
    expected.style.color = colour.ink;
    const title = screen.getByText('Continue Live Stream');
    expect(expected.style.color).not.toBe('');
    expect(getComputedStyle(title).color).toBe(expected.style.color);
  });

  /** Amendment §2, Home: each copy's title and detail, from en.json with the vars filled by hand. */
  it.each<[ContinueCopy, string, string]>([
    [
      { kind: 'paired', label: 'Seazn XI v Fake CC' },
      'Paired · Seazn XI v Fake CC',
      'Waiting for Go live',
    ],
    [
      { kind: 'saved', slot: 2, validTill: '18:40' },
      'Continue Live Stream',
      'Slot 2 · code valid till 18:40',
    ],
    // CD39: no `exp`, so no "code valid till ." either.
    [{ kind: 'saved', slot: 2, validTill: null }, 'Continue Live Stream', 'Slot 2'],
    [{ kind: 'saved', slot: null, validTill: null }, 'Continue Live Stream', 'Slot –'],
  ])('says %j as %s / %s', (copy, title, detail) => {
    renderWithPorts(<ContinueCard mode="stream" copy={copy} onContinue={noop} onForget={noop} />);
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText(detail)).toBeTruthy();
    expect(screen.queryByText(/valid till\s*$/)).toBeNull();
  });
});
