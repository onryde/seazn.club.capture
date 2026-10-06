import type { Result } from '@/domain/Result';
import type { StreamCode } from '@/domain/credentials/streamCode';
import type { CodeError, WaitingFields } from '@/domain/credentials/waitingFields';

/**
 * The server's word on a scanned stream code (amendment §2). Never rejects:
 * every failure is a `CodeError`, so Home always has something true to say.
 */
export interface CodePort {
  check(code: StreamCode): Promise<Result<WaitingFields, CodeError>>;
  /** Where native asks the code again (`GET code`), saved with it (CD36: the build's origin). */
  codeUrl(code: string): string;
}
