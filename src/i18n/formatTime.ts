import { INTL_LOCALE, type Lang } from '@/i18n/language';

/**
 * A time as the operator should read it (spec decision 13): in the venue's
 * zone, which the server resolves (S1 onward), else the phone's. The zone name
 * is added only when the two differ, which at the ground they rarely do.
 */
export function formatTime(
  at: Date,
  options: { lang: Lang; zone: string | null; phoneZone: string },
): string {
  const zone = options.zone ?? options.phoneZone;
  try {
    return format(at, options.lang, zone, zone !== options.phoneZone);
  } catch {
    // An IANA name this platform's ICU does not know throws RangeError.
    return format(at, options.lang, options.phoneZone, false);
  }
}

function format(at: Date, lang: Lang, zone: string, showZone: boolean): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[lang], {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: zone,
    ...(showZone ? { timeZoneName: 'short' } : {}),
  }).format(at);
}
