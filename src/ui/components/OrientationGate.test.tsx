import { act, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { Target, TurnCardKind } from '@/domain/orientation/orientation';
import { useOrientationGate } from '@/hooks/useOrientationGate';
import en from '@/i18n/en.json';
import { OrientationGate } from '@/ui/components/OrientationGate';
import { Text } from '@/ui/components/Text';
import { renderWithPorts } from '../../../test/renderWithPorts';

/** The root layout's wiring: the hook's card drives the gate around the app. */
function Shell({ target, children }: { target: Target; children: ReactNode }) {
  const { card } = useOrientationGate(target);
  return <OrientationGate card={card}>{children}</OrientationGate>;
}

const BEHIND = <Text variant="body">The app behind</Text>;

describe('OrientationGate', () => {
  it('covers the app with the turn card until the phone is sideways', async () => {
    const view = renderWithPorts(<Shell target="landscape">{BEHIND}</Shell>);
    await act(async () => undefined);
    act(() => {
      for (let t = 0; t <= 400; t += 100) view.motion.emit({ x: 0, y: 1, z: 0 }, t);
    });
    expect(screen.getByLabelText(en['turn.sideways.title'])).toBeTruthy();
    act(() => {
      for (let t = 1000; t <= 1400; t += 100) view.motion.emit({ x: 1, y: 0, z: 0 }, t);
    });
    expect(screen.queryByLabelText(en['turn.sideways.title'])).toBeNull();
    expect(screen.queryByTestId('turn-glyph')).toBeNull();
  });

  it('hides the app from screen readers behind a modal, spoken card (R25)', () => {
    const { container } = renderWithPorts(
      <OrientationGate card="turnSideways">{BEHIND}</OrientationGate>,
    );
    const behind = container.querySelector('[aria-hidden="true"]');
    expect(behind?.textContent).toBe('The app behind');
    const card = container.querySelector('[aria-modal="true"]');
    expect(card?.querySelector('[data-testid="turn-glyph"]')).not.toBeNull();
    // Native reads these, not aria-*; the FadeOut stand-in surfaces them.
    expect(card?.getAttribute('data-view-is-modal')).toBe('true');
    expect(card?.getAttribute('data-live-region')).toBe('polite');
  });

  it.each<[TurnCardKind, string]>([
    ['turnSideways', en['turn.sideways.title']],
    ['turnUpright', en['turn.upright.title']],
  ])('%s speaks its title as one element, with no visible words (R28)', (kind, title) => {
    const { container } = renderWithPorts(<OrientationGate card={kind}>{null}</OrientationGate>);
    const card = container.querySelector('[aria-modal="true"]');
    expect(card?.getAttribute('aria-label')).toBe(title);
    expect(card?.getAttribute('data-accessible')).toBe('true');
    expect(card?.textContent).toBe('');
  });

  it('hides nothing when no card shows', () => {
    const { container } = renderWithPorts(<OrientationGate card="none">{BEHIND}</OrientationGate>);
    expect(screen.getByText('The app behind')).toBeTruthy();
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(container.querySelector('[aria-modal="true"]')).toBeNull();
  });
});
