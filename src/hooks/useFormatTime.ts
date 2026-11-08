import { useCallback } from 'react';
import { formatDay } from '@/i18n/formatDay';
import { formatTime } from '@/i18n/formatTime';
import { useLanguage } from '@/hooks/useLanguage';
import { usePorts } from '@/hooks/usePorts';

/** Times in the venue zone when known, else the phone's (spec decision 13). */
export function useFormatTime(): (at: Date, zone: string | null) => string {
  const { lang } = useLanguage();
  const { phoneZone } = usePorts();
  return useCallback((at, zone) => formatTime(at, { lang, zone, phoneZone }), [lang, phoneZone]);
}

/** A day ("Sat 7 Nov"), in the zone given when known, else the phone's (spec decision 13). */
export function useFormatDay(): (at: Date, zone: string | null) => string {
  const { lang } = useLanguage();
  const { phoneZone } = usePorts();
  return useCallback((at, zone) => formatDay(at, { lang, zone, phoneZone }), [lang, phoneZone]);
}
