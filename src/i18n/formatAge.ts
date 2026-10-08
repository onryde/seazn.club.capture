import type { Translator } from '@/i18n/translate';

/**
 * How long ago something was, in the operator's language. Diagnostics shows ages beside a label in a row
 * that cannot grow, and off air the heartbeat runs every `pollSeconds` (5 to 300 s), so an age of minutes
 * or hours is ordinary and the text must stay short at every size:
 *
 * - under 100 s, tenths of a second ("99.9 s ago"; the language's decimal separator);
 * - 100 to 599 s, whole seconds ("300 s ago");
 * - 10 to 99 min (600 to 5999 s), whole minutes ("10 min ago");
 * - from 6000 s, whole hours ("1 h ago").
 *
 * Minutes and hours are floored, as an age is: 1 h 59 min is "1 h ago". A negative age (a clock a moment
 * ahead of the phone's, an NTP step) reads 0, never Intl's "-0". `num` is `formatNumber` in the language.
 */
export function formatAge(
  seconds: number,
  t: Translator['t'],
  num: (value: number) => string,
): string {
  const age = Math.max(0, seconds);
  if (age < 100) return t('diag.unit.ago', { value: num(age) });
  if (age < 600) return t('diag.unit.ago', { value: num(Math.floor(age)) });
  if (age < 6000) return t('diag.unit.agoMin', { value: num(Math.floor(age / 60)) });
  return t('diag.unit.agoHour', { value: num(Math.floor(age / 3600)) });
}
