import { INTL_LOCALE, type Lang } from '@/i18n/language';

/**
 * A day as the operator should read it (S4 design §3: "Match Day opens Sat 8 Nov"): the weekday, the day and the
 * month, short, in the zone given, else the phone's (spec decision 13). Only a zone name this platform's ICU does not
 * know (a RangeError) falls back to the phone's zone; anything else is a real fault and is rethrown.
 */
export function formatDay(
  at: Date,
  options: { lang: Lang; zone: string | null; phoneZone: string },
): string {
  try {
    return format(at, options.lang, options.zone ?? options.phoneZone);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return format(at, options.lang, options.phoneZone);
  }
}

function format(at: Date, lang: Lang, zone: string): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[lang], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: zone,
  }).format(at);
}
