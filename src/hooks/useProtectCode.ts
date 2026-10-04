import { useEffect, useMemo } from 'react';
import { parseStreamCodeText } from '@/domain/credentials/streamCode';
import { usePorts } from '@/hooks/usePorts';
import { useSavedStream } from '@/hooks/useSavedStream';

/**
 * CD6 as the amendment rewrites it: the code's token is in hand from the scan
 * to the unpair, not only while the viewfinder shows. The scan protects it at
 * once (useCodeCheck); this keeps it protected while the code is saved, and
 * releases it when the code is forgotten (Task 10's N7).
 */
export function useProtectCode(): void {
  const { logger } = usePorts();
  const saved = useSavedStream();
  const token = useMemo(() => {
    const code = saved === null ? null : parseStreamCodeText(saved.raw);
    return code?.ok ? code.value.token : null;
  }, [saved]);
  useEffect(() => {
    if (token === null) return undefined;
    logger.protect({ secrets: [token], streamIds: [] });
    return () => logger.release();
  }, [token, logger]);
}
