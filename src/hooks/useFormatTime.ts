import { useCallback } from 'react';
import { formatTime } from '@/i18n/formatTime';
import { useLanguage } from '@/hooks/useLanguage';
import { usePorts } from '@/hooks/usePorts';

/** Times in the venue zone when known, else the phone's (spec decision 13). */
export function useFormatTime(): (at: Date, zone: string | null) => string {
  const { lang } = useLanguage();
  const { phoneZone } = usePorts();
  return useCallback((at, zone) => formatTime(at, { lang, zone, phoneZone }), [lang, phoneZone]);
}
