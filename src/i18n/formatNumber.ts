import { INTL_LOCALE, type Lang } from '@/i18n/language';

/**
 * A measured number in the operator's language (fix round 1, ruling 2): the
 * language's decimal separator ("9,2" in es, fr and nl), at most one decimal.
 * Never grouped: fr groups with a narrow no-break space and es and nl with a
 * dot, so a grouped count would change width, and mean something else, by
 * language. Intl.NumberFormat is on Hermes, as Intl.DateTimeFormat is for
 * `formatTime`.
 */
export function formatNumber(value: number, lang: Lang): string {
  return new Intl.NumberFormat(INTL_LOCALE[lang], {
    maximumFractionDigits: 1,
    useGrouping: false,
  }).format(value);
}
