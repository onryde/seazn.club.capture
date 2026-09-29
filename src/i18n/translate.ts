import type { Lang } from '@/i18n/language';
import { DICTIONARIES, type MessageKey, type Messages } from '@/i18n/messages';

export type Vars = Readonly<Record<string, string | number>>;

export type Translator = {
  readonly lang: Lang;
  t(key: MessageKey, vars?: Vars): string;
  /** `key.one` / `key.other`, the web's plural convention; `{count}` is filled. */
  tp(key: string, count: number, vars?: Vars): string;
};

/**
 * Our own table, on every platform: Hermes has no Intl.PluralRules, and one
 * answer everywhere beats a polyfill that differs from Node's ICU in tests.
 * French counts 0 and 1 (and 1.5) as singular; the other three only 1.
 */
export function pluralCategory(lang: Lang, count: number): 'one' | 'other' {
  if (lang === 'fr') return Math.trunc(Math.abs(count)) <= 1 ? 'one' : 'other';
  return count === 1 ? 'one' : 'other';
}

export function createTranslator(
  lang: Lang,
  dictionaries: Readonly<Record<Lang, Messages>> = DICTIONARIES,
): Translator {
  const lookup = (key: string): string => dictionaries[lang][key] ?? dictionaries.en[key] ?? key;
  return {
    lang,
    t: (key, vars) => fill(lookup(key), vars),
    tp: (key, count, vars) =>
      fill(lookup(`${key}.${pluralCategory(lang, count)}`), { ...vars, count }),
  };
}

/** An unfilled placeholder stays visible: a test sees `{name}`, never "undefined". */
function fill(text: string, vars: Vars | undefined): string {
  if (vars === undefined) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    vars[name] === undefined ? whole : String(vars[name]),
  );
}
