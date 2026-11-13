import { useEffect } from 'react';
import type { Logger } from '@/services/logger';

/**
 * The engine threw something that is not its refusal while the pad's point calls were read (`setBasedPointCall`): the
 * half draws no plate, and the record says why, once per cause, never a console. `fault` is the thrown name, never its
 * message (which can quote the server's bytes); null when nothing threw.
 */
export function usePointCallFault(logger: Logger, fault: string | null | undefined): void {
  useEffect(() => {
    if (fault != null) logger.warn('scoring.pointCall', { reason: 'engine', cause: fault });
  }, [logger, fault]);
}
