import type { CodeError } from '@/domain/credentials/waitingFields';
import type { ReadFailure } from '@/domain/scoring/wire';

/**
 * What a bootstrap that failed at a scan says on Home's panel (plan S2-1 Task 10; design §4 step 1). The scan reuses the
 * stream code check's panel and its three answers: a link the server will not serve is a bad link (`invalid`), a call
 * that got no answer is no connection (`offline`, Try again), and the door's throttle is busy (`rate-limited`, one
 * automatic retry). Nothing is saved on any of them: the fixture id that keys the link and the queue comes only from
 * the bootstrap, so an offline scan has no key to save under.
 */
export function scanErrorOf(failure: ReadFailure): CodeError {
  switch (failure.kind) {
    case 'linkDead':
    case 'refused':
      return { kind: 'invalid' };
    case 'rateLimited':
      return {
        kind: 'rate-limited',
        retryAfterS: Math.max(1, Math.ceil(failure.retryAfterMs / 1000)),
      };
    default:
      return { kind: 'offline' };
  }
}
