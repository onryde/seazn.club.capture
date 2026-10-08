import { useCallback, useMemo, useRef, useState } from 'react';
import { usePorts } from '@/hooks/usePorts';
import type { PhotoOutcome } from '@/services/photoPort';

/** R3: the line stays this long. */
export const PHOTO_NOTICE_MS = 3_000;

export type Photo = {
  /** The line to show: the last photo's word, for [PHOTO_NOTICE_MS]; null otherwise. */
  readonly notice: PhotoOutcome | null;
  /** A tap while a photo is saving does nothing. */
  take(): void;
};

export function usePhoto(): Photo {
  const { photo, logger, clock } = usePorts();
  const [notice, setNotice] = useState<PhotoOutcome | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const take = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    const startedAt = clock().getTime();
    void photo.take().then((outcome) => {
      inFlight.current = false;
      logger.info('photo.result', { result: outcome, ms: clock().getTime() - startedAt });
      if (timer.current !== null) clearTimeout(timer.current);
      setNotice(outcome);
      timer.current = setTimeout(() => {
        timer.current = null;
        setNotice(null);
      }, PHOTO_NOTICE_MS);
    });
  }, [photo, logger, clock]);
  return useMemo(() => ({ notice, take }), [notice, take]);
}
