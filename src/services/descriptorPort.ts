import type { Result } from '@/domain/Result';
import type { DescriptorError, SessionDescriptor } from '@/domain/credentials/SessionDescriptor';

/**
 * The server's word on a scanned stream code (spec §2). Never rejects: every
 * failure is a `DescriptorError`, so Home always has something true to say.
 */
export interface DescriptorPort {
  fetch(sid: string, token: string): Promise<Result<SessionDescriptor, DescriptorError>>;
}
