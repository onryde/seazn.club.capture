/** The web's four locales (decision record ruling 12). */
export type Lang = 'en' | 'es' | 'fr' | 'nl';

export const LANGS: readonly Lang[] = ['en', 'es', 'fr', 'nl'];

/** Regional forms for `Intl`, so English times read 18:40, as they do on the web console. */
export const INTL_LOCALE: Readonly<Record<Lang, string>> = {
  en: 'en-GB',
  es: 'es-ES',
  fr: 'fr-FR',
  nl: 'nl-NL',
};

export function parseLang(text: string | null): Lang | null {
  return LANGS.find((lang) => lang === text) ?? null;
}

/**
 * The operator's pick, else the phone's first language if it is one of the
 * four, else English (spec decision 8). Only the first phone language counts:
 * a German phone with French second still reads English, as agreed.
 */
export function pickLanguage(
  stored: Lang | null,
  deviceLanguageCodes: readonly (string | null)[],
): Lang {
  if (stored !== null) return stored;
  return parseLang(deviceLanguageCodes[0]?.toLowerCase() ?? null) ?? 'en';
}
