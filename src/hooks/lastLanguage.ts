import type { Lang } from '@/i18n/language';

/**
 * P1 (2026-10-01): the crash screen reads the app's last resolved language.
 * The root boundary sits outside the language provider, which may be what
 * crashed, so it reads this module-level holder instead: no context and no
 * storage read on the crash path.
 */
let last: Lang | null = null;

/** Set by LanguageProvider each time it resolves a language. An idempotent write, safe in render. */
export function noteLanguage(lang: Lang): void {
  last = lang;
}

/** The language the provider last resolved, or null before it first did (a crash at launch). */
export function lastLanguage(): Lang | null {
  return last;
}

/** Tests only: forget the last language, so each test starts as a cold launch. */
export function resetLastLanguage(): void {
  last = null;
}
