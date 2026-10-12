import { act, fireEvent, render, screen } from '@testing-library/react';
import { StyleSheet, Text, type TextStyle } from 'react-native';
import { describe, expect, it } from 'vitest';
import { LANGS } from '@/i18n/language';
import { createTranslator } from '@/i18n/translate';
import { PowerRow } from '@/ui/components/PowerRow';
import { colour } from '@/ui/theme/tokens';
import { createFakePower } from '../../../test/fakePorts';
import { renderWithPorts } from '../../../test/renderWithPorts';

/** What the cascade paints a token as (the settings tests' reading): a reference element wearing it. */
function painted(style: TextStyle): string {
  const reference = render(
    <Text testID="paint-reference" style={style}>
      x
    </Text>,
  );
  const colourOf = getComputedStyle(reference.getByTestId('paint-reference')).color;
  reference.unmount();
  return colourOf;
}
const PAINT = StyleSheet.create({ caution: { color: colour.caution } });

describe('the battery row (R5, N27)', () => {
  it('reads Restricted, gives its one-line hint, and opens the battery page once per tap', () => {
    const power = createFakePower(false);
    renderWithPorts(<PowerRow />, { power });
    expect(screen.getByText('Background activity')).toBeTruthy();
    expect(screen.getByText('Restricted')).toBeTruthy();
    expect(
      screen.getByText('Allow it so a Go live from the console works with the screen locked.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Battery settings' }));
    expect(power.opened).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Battery settings' }));
    expect(power.opened).toBe(2);
  });

  it('reads it again on the return to the foreground: the operator chose Unrestricted', () => {
    const power = createFakePower(false);
    const view = renderWithPorts(<PowerRow />, { power });
    power.set(true);
    expect(screen.getByText('Restricted')).toBeTruthy();
    act(() => view.foreground.fire());
    expect(screen.getByText('Allowed')).toBeTruthy();
    expect(screen.queryByText('Restricted')).toBeNull();
  });

  it('is absent where the state is unknown: iOS, or no module (an empty input)', () => {
    renderWithPorts(<PowerRow />, { power: createFakePower(null) });
    expect(screen.queryByTestId('power-row')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Battery settings' })).toBeNull();
  });

  it('comes back if a later read knows it, and goes again if it does not', () => {
    const power = createFakePower(null);
    const view = renderWithPorts(<PowerRow />, { power });
    power.set(true);
    act(() => view.foreground.fire());
    expect(screen.getByText('Allowed')).toBeTruthy();
    power.set(null);
    act(() => view.foreground.fire());
    expect(screen.queryByTestId('power-row')).toBeNull();
  });

  // Restricted is a degraded condition: caution, never red (AGENTS §5). Allowed is the plain state word.
  it('sets Restricted in caution, and Allowed not', () => {
    const power = createFakePower(false);
    const view = renderWithPorts(<PowerRow />, { power });
    const caution = painted(PAINT.caution);
    expect(getComputedStyle(screen.getByText('Restricted')).color).toBe(caution);
    power.set(true);
    act(() => view.foreground.fire());
    expect(getComputedStyle(screen.getByText('Allowed')).color).not.toBe(caution);
  });

  it.each(LANGS)('reads in %s', (lang) => {
    const { t } = createTranslator(lang);
    const power = createFakePower(true);
    renderWithPorts(<PowerRow />, { power, deviceLanguages: [lang] });
    expect(screen.getByText(t('settings.power.background'))).toBeTruthy();
    expect(screen.getByText(t('settings.power.allowed'))).toBeTruthy();
    expect(screen.getByText(t('settings.power.hint'))).toBeTruthy();
    expect(screen.getByRole('button', { name: t('settings.power.open') })).toBeTruthy();
  });
});
