import { act, fireEvent, render, screen } from '@testing-library/react';
import { StyleSheet, Text, type TextStyle } from 'react-native';
import { describe, expect, it } from 'vitest';
import type { FakeScene } from '@/engine/FakeCaptureEngine';
import { LANGS } from '@/i18n/language';
import { createTranslator } from '@/i18n/translate';
import type { PowerMode } from '@/services/devicePorts';
import { PowerRow } from '@/ui/components/PowerRow';
import { colour } from '@/ui/theme/tokens';
import { createFakePower, readRecord } from '../../../test/fakePorts';
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

const appSettings = () => screen.getByRole('button', { name: 'App settings' });
const powerLines = (view: ReturnType<typeof renderWithPorts>) =>
  readRecord(view.record).filter((entry) => entry.event === 'power');

describe('the battery row (R5, N27)', () => {
  it('reads Optimized, gives its hint and the path, and opens App info once per tap', () => {
    const power = createFakePower('optimized');
    renderWithPorts(<PowerRow />, { power });
    expect(screen.getByText('Background activity')).toBeTruthy();
    expect(screen.getByText('Optimized')).toBeTruthy();
    expect(
      screen.getByText('Allow it so a Go live from the console works with the screen locked.'),
    ).toBeTruthy();
    expect(screen.getByText('Battery → Unrestricted')).toBeTruthy();
    fireEvent.click(appSettings());
    expect(power.opened).toBe(1);
    fireEvent.click(appSettings());
    expect(power.opened).toBe(2);
  });

  // M5 of the Batch 5 review: three readings, each Android's own word; only Unrestricted is not a caution.
  it.each([
    ['unrestricted', 'Unrestricted', false],
    ['optimized', 'Optimized', true],
    ['restricted', 'Restricted', true],
  ] as const)('reads %s as "%s" (caution: %s)', (mode: PowerMode, word, caution) => {
    renderWithPorts(<PowerRow />, { power: createFakePower(mode) });
    const shown = screen.getByText(word);
    expect(getComputedStyle(shown).color === painted(PAINT.caution)).toBe(caution);
    for (const other of ['Unrestricted', 'Optimized', 'Restricted'].filter((w) => w !== word)) {
      expect(screen.queryByText(other)).toBeNull();
    }
  });

  it('reads it again on the return to the foreground: the operator chose Unrestricted', () => {
    const power = createFakePower('optimized');
    const view = renderWithPorts(<PowerRow />, { power });
    power.set('unrestricted');
    expect(screen.getByText('Optimized')).toBeTruthy();
    act(() => view.foreground.fire());
    expect(screen.getByText('Unrestricted')).toBeTruthy();
    expect(screen.queryByText('Optimized')).toBeNull();
  });

  it('is absent where the mode is unknown: iOS, or no module (an empty input)', () => {
    renderWithPorts(<PowerRow />, { power: createFakePower(null) });
    expect(screen.queryByTestId('power-row')).toBeNull();
    expect(screen.queryByRole('button', { name: 'App settings' })).toBeNull();
  });

  it('comes back if a later read knows it, and goes again if it does not', () => {
    const power = createFakePower(null);
    const view = renderWithPorts(<PowerRow />, { power });
    power.set('restricted');
    act(() => view.foreground.fire());
    expect(screen.getByText('Restricted')).toBeTruthy();
    power.set(null);
    act(() => view.foreground.fire());
    expect(screen.queryByTestId('power-row')).toBeNull();
  });

  it.each(LANGS)('reads in %s', (lang) => {
    const { t } = createTranslator(lang);
    renderWithPorts(<PowerRow />, {
      power: createFakePower('optimized'),
      deviceLanguages: [lang],
    });
    expect(screen.getByText(t('settings.power.background'))).toBeTruthy();
    expect(screen.getByText(t('settings.power.optimized'))).toBeTruthy();
    expect(screen.getByText(t('settings.power.hint'))).toBeTruthy();
    expect(screen.getByText(t('settings.power.path'))).toBeTruthy();
    expect(screen.getByRole('button', { name: t('settings.power.open') })).toBeTruthy();
  });

  // The path names the state word the operator is asked to choose, in every language.
  it.each(LANGS)('%s: the path ends in the Unrestricted word', (lang) => {
    const { t } = createTranslator(lang);
    expect(t('settings.power.path').endsWith(` ${t('settings.power.unrestricted')}`)).toBe(true);
  });
});

// I3 of the Batch 5 review (the controller's ruling, 2026-10-12): App info is one tap from Force stop and from the
// camera and microphone permissions, and the app in the background is N27's condition. From Arming on, the button is
// disabled with its reason, AGENTS §6's protection on the control; the mode stays readable.
describe('the battery row on air (I3)', () => {
  const HELD: readonly FakeScene[] = ['arming-retrying', 'connecting', 'live', 'holding'];
  it.each(HELD)('%s: the button is disabled, says why, and opens nothing', (scene) => {
    const power = createFakePower('optimized');
    const view = renderWithPorts(<PowerRow />, { power });
    act(() => view.engine.scene(scene));
    expect(appSettings().getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Change it after the broadcast')).toBeTruthy();
    expect(screen.getByText('Optimized')).toBeTruthy();
    fireEvent.click(appSettings());
    expect(power.opened).toBe(0);
  });

  const FREE: readonly FakeScene[] = ['pairing', 'paired-ready', 'stopped'];
  it.each(FREE)('%s: the button works, with no reason', (scene) => {
    const power = createFakePower('optimized');
    const view = renderWithPorts(<PowerRow />, { power });
    act(() => view.engine.scene(scene));
    expect(appSettings().getAttribute('aria-disabled')).toBeNull();
    expect(screen.queryByText('Change it after the broadcast')).toBeNull();
    fireEvent.click(appSettings());
    expect(power.opened).toBe(1);
  });

  it('works again once the broadcast stops', () => {
    const power = createFakePower('optimized');
    const view = renderWithPorts(<PowerRow />, { power });
    act(() => view.engine.scene('live'));
    expect(appSettings().getAttribute('aria-disabled')).toBe('true');
    act(() => view.engine.scene('stopped'));
    expect(screen.queryByText('Change it after the broadcast')).toBeNull();
    fireEvent.click(appSettings());
    expect(power.opened).toBe(1);
  });

  it.each(LANGS)('says why in %s', (lang) => {
    const { t } = createTranslator(lang);
    const view = renderWithPorts(<PowerRow />, {
      power: createFakePower('restricted'),
      deviceLanguages: [lang],
    });
    act(() => view.engine.scene('live'));
    expect(screen.getByText(t('settings.power.onAir'))).toBeTruthy();
  });
});

// M4 of the Batch 5 review: the Hold's line says which mode the pairing began in; a change the operator makes in
// App info and comes back from is recorded too, so a later locked failure is put down to the right mode.
describe('the record follows a change of mode (M4)', () => {
  it('records the new mode once when a return reads a change, and not again at the next return', () => {
    const power = createFakePower('optimized');
    const view = renderWithPorts(<PowerRow />, { power });
    expect(powerLines(view)).toEqual([]);
    power.set('unrestricted');
    act(() => view.foreground.fire());
    act(() => view.foreground.fire());
    expect(powerLines(view)).toEqual([
      { level: 'info', event: 'power', fields: { mode: 'unrestricted' } },
    ]);
  });

  it('records nothing for a return that reads the same mode, twice', () => {
    const view = renderWithPorts(<PowerRow />, { power: createFakePower('restricted') });
    act(() => view.foreground.fire());
    act(() => view.foreground.fire());
    expect(powerLines(view)).toEqual([]);
  });

  it('records each change in turn, unknown included', () => {
    const power = createFakePower('optimized');
    const view = renderWithPorts(<PowerRow />, { power });
    power.set('unrestricted');
    act(() => view.foreground.fire());
    power.set(null);
    act(() => view.foreground.fire());
    expect(powerLines(view).map((entry) => entry.fields.mode)).toEqual(['unrestricted', null]);
  });
});
