import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LANGS } from '@/i18n/language';
import { createTranslator } from '@/i18n/translate';
import { STORE_KEYS } from '@/services/modeStore';
import { LanguageRow } from '@/ui/components/LanguageRow';
import { colour } from '@/ui/theme/tokens';
import { fillOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

const NAMES = ['English', 'Español', 'Français', 'Nederlands'] as const;
const row = (name: string | RegExp) => screen.getByRole('button', { name });

function press(view: { back: { press(): boolean } }): boolean {
  let handled = false;
  act(() => {
    handled = view.back.press();
  });
  return handled;
}

describe('LanguageRow: Language and what it is now, opening a short list', () => {
  it('reads Language and the language in its own name, with the list closed', () => {
    renderWithPorts(<LanguageRow />);
    expect(row('Language · English').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('opens the four languages as radios in one group named Language, the current one checked', () => {
    renderWithPorts(<LanguageRow />);
    fireEvent.click(row('Language · English'));
    expect(row('Language · English').getAttribute('aria-expanded')).toBe('true');
    const group = screen.getByRole('radiogroup', { name: 'Language' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((radio) => radio.getAttribute('aria-label'))).toEqual([...NAMES]);
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ]);
  });

  it('draws the lime LED on the chosen language only', () => {
    renderWithPorts(<LanguageRow />);
    fireEvent.click(row('Language · English'));
    const leds = screen.getAllByTestId('language-led');
    expect(leds).toHaveLength(4);
    const filled = leds.filter(
      (led) => getComputedStyle(led).backgroundColor === fillOf(colour.lime),
    );
    expect(filled).toHaveLength(1);
    expect(screen.getByRole('radio', { name: 'English' }).contains(filled[0] as Element)).toBe(
      true,
    );
  });

  it('a pick applies at once: the row reads in the new language, the list closes and the pick is kept', () => {
    const view = renderWithPorts(<LanguageRow />);
    fireEvent.click(row('Language · English'));
    fireEvent.click(screen.getByRole('radio', { name: 'Español' }));
    expect(row('Idioma · Español').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('radio')).toBeNull();
    expect(view.kv.entries.get(STORE_KEYS.lang)).toBe('es');
    // Opened again, the checked radio follows the pick and the group is named in it.
    fireEvent.click(row('Idioma · Español'));
    expect(screen.getByRole('radiogroup', { name: 'Idioma' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Español' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByRole('radio', { name: 'English' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  // The language shown may be the phone's own (nothing stored yet). Picking it is the operator saying "this one", so it is
  // stored: a later change of the phone's language must not change the app's under them.
  it.each([
    ['en', ['en'], 'Language · English', 'English'],
    ['es', ['es'], 'Idioma · Español', 'Español'],
  ] as const)(
    'a pick of the phone’s own language (%s) closes the list and pins it in the store',
    (lang, deviceLanguages, rowName, radioName) => {
      const view = renderWithPorts(<LanguageRow />, { deviceLanguages: [...deviceLanguages] });
      expect(view.kv.entries.has(STORE_KEYS.lang)).toBe(false);
      fireEvent.click(row(rowName));
      fireEvent.click(screen.getByRole('radio', { name: radioName }));
      expect(screen.queryByRole('radio')).toBeNull();
      expect(view.kv.entries.get(STORE_KEYS.lang)).toBe(lang);
      expect(row(rowName)).toBeTruthy();
    },
  );

  it('a second tap on the row closes the list', () => {
    renderWithPorts(<LanguageRow />);
    fireEvent.click(row('Language · English'));
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    fireEvent.click(row('Language · English'));
    expect(screen.queryByRole('radio')).toBeNull();
  });

  // R31: Android Back closes what is open on top. With the list open it closes the list; with nothing open it falls
  // through to the screen's own Back, which is Settings' way home.
  it('Back closes the open list, then leaves Back to the screen', () => {
    const view = renderWithPorts(<LanguageRow />);
    expect(press(view)).toBe(false);
    fireEvent.click(row('Language · English'));
    expect(press(view)).toBe(true);
    expect(screen.queryByRole('radio')).toBeNull();
    expect(row('Language · English').getAttribute('aria-expanded')).toBe('false');
    expect(press(view)).toBe(false);
  });

  it.each(LANGS)('reads Language and its four names in %s, from the dictionary', async (lang) => {
    const { t } = createTranslator(lang);
    renderWithPorts(<LanguageRow />, { kvSeed: { [STORE_KEYS.lang]: lang } });
    await act(async () => undefined); // the saved pick is read from the store
    fireEvent.click(row(`${t('settings.language.label')} · ${t(`language.${lang}`)}`));
    const group = screen.getByRole('radiogroup', { name: t('settings.language.label') });
    const names = within(group)
      .getAllByRole('radio')
      .map((radio) => radio.getAttribute('aria-label'));
    expect(names).toEqual(LANGS.map((one) => t(`language.${one}`)));
    expect(
      within(group)
        .getByRole('radio', { name: t(`language.${lang}`) })
        .getAttribute('aria-checked'),
    ).toBe('true');
  });
});
