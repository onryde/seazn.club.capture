import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ContinueCopy } from '@/domain/mode/continueCard';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { ContinueCard } from '@/ui/components/ContinueCard';
import { colour } from '@/ui/theme/tokens';
import { fillOf, heldOnGround } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

const noop = () => undefined;
const SAVED: ContinueCopy = { kind: 'saved', slot: 2, validTill: '18:40', court: null };

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
      { kind: 'paired', label: 'Seazn XI v Fake CC', court: null },
      'Paired · Seazn XI v Fake CC',
      'Waiting for Go live',
    ],
    [
      { kind: 'saved', slot: 2, validTill: '18:40', court: null },
      'Continue Live Stream',
      'Slot 2 · code valid till 18:40',
    ],
    // Review C5 I-4: while Pairing, the card says so, in Pairing's own words.
    [{ kind: 'pairing', court: null }, 'Continue Live Stream', 'Pairing this phone…'],
    // CD39: no `exp`, so no "code valid till ." either.
    [{ kind: 'saved', slot: 2, validTill: null, court: null }, 'Continue Live Stream', 'Slot 2'],
    [{ kind: 'saved', slot: null, validTill: null, court: null }, 'Continue Live Stream', 'Slot –'],
  ])('says %j as %s / %s', (copy, title, detail) => {
    renderWithPorts(<ContinueCard mode="stream" copy={copy} onContinue={noop} onForget={noop} />);
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText(detail)).toBeTruthy();
    expect(screen.queryByText(/valid till\s*$/)).toBeNull();
  });

  // The controller's press-fill ruling (2026-10-13): a held ghost's fill must not depend on the ground. The card is
  // surface, pinned here in both shapes, so a card repainted under Forget fails too.
  it.each(['stacked', 'row'] as const)(
    '%s: a held Forget takes the press fill on the card’s surface ground',
    (layout) => {
      renderWithPorts(
        <ContinueCard
          mode="stream"
          copy={SAVED}
          layout={layout}
          onContinue={noop}
          onForget={noop}
        />,
      );
      const { ground, held, released } = heldOnGround(
        () => screen.getByRole('button', { name: 'Forget' }),
        () => screen.getByTestId('continue-card'),
      );
      expect(ground).toBe(fillOf(colour.surface));
      expect(held).toBe(fillOf(colour.pressFill));
      expect(held).not.toBe(ground);
      expect(released).not.toBe(held);
    },
  );
});

// Court stream (spec 2026-11-14 §6.5, RP4): a court code's card names the court, and a phone that holds the court has no
// Forget on it: the only way off a court is Exit, on the waiting screen, which asks first (O5, O12).
describe('ContinueCard on a court code', () => {
  const forgetButton = () => screen.queryByRole('button', { name: 'Forget' });

  it.each<[ContinueCopy, string]>([
    [
      { kind: 'saved', slot: 2, validTill: '18:40', court: 'Court 2' },
      'Slot 2 · code valid till 18:40',
    ],
    [{ kind: 'paired', label: 'Seazn XI v Fake CC', court: 'Court 2' }, 'Waiting for Go live'],
    [{ kind: 'pairing', court: 'Court 2' }, 'Pairing this phone…'],
  ])('titles %j "Court 2 · Live Stream", with the kind’s own detail', (copy, detail) => {
    renderWithPorts(<ContinueCard mode="stream" copy={copy} onContinue={noop} onForget={noop} />);
    expect(screen.getByText('Court 2 · Live Stream')).toBeTruthy();
    expect(screen.getByText(detail)).toBeTruthy();
    expect(screen.queryByText('Continue Live Stream')).toBeNull();
    expect(screen.queryByText(/^Paired ·/)).toBeNull();
  });

  it.each<[string, ContinueCopy]>([
    ['paired', { kind: 'paired', label: 'A v B', court: 'Court 2' }],
    ['pairing', { kind: 'pairing', court: 'Court 2' }],
  ])(
    'offers no Forget while the phone holds the court (%s), and still offers Continue',
    (_kind, copy) => {
      const onForget = vi.fn();
      renderWithPorts(
        <ContinueCard mode="stream" copy={copy} onContinue={noop} onForget={onForget} />,
      );
      expect(forgetButton()).toBeNull();
      expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
    },
  );

  // A saved court code with the engine idle is not held by a pairing: nothing to leave, so Forget stays (a stuck code).
  it('keeps Forget on a saved court code the engine does not hold', () => {
    const onForget = vi.fn();
    const copy: ContinueCopy = { kind: 'saved', slot: 2, validTill: null, court: 'Court 2' };
    renderWithPorts(
      <ContinueCard mode="stream" copy={copy} onContinue={noop} onForget={onForget} />,
    );
    fireEvent.click(forgetButton() as HTMLElement);
    expect(onForget).toHaveBeenCalledOnce();
  });

  it('keeps Forget on a fixture code’s paired card (the twin)', () => {
    const onForget = vi.fn();
    const copy: ContinueCopy = { kind: 'paired', label: 'A v B', court: null };
    renderWithPorts(
      <ContinueCard mode="stream" copy={copy} onContinue={noop} onForget={onForget} />,
    );
    fireEvent.click(forgetButton() as HTMLElement);
    expect(onForget).toHaveBeenCalledOnce();
  });

  it('reads the court title in Spanish, French and Dutch, with each language’s own mode name', () => {
    for (const [lang, dictionary] of [
      ['es', es],
      ['fr', fr],
      ['nl', nl],
    ] as const) {
      const view = renderWithPorts(
        <ContinueCard
          mode="stream"
          copy={{ kind: 'pairing', court: 'Court 2' }}
          onContinue={noop}
        />,
        { deviceLanguages: [lang] },
      );
      expect(screen.getByText(`Court 2 · ${dictionary['mode.stream']}`)).toBeTruthy();
      view.unmount();
    }
  });
});
