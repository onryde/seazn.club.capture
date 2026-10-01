import { type Result, err, ok } from '@/domain/Result';
import type { SessionDescriptor } from '@/domain/credentials/SessionDescriptor';
import { httpsHost } from '@/domain/credentials/wire';

export type ForeignHeartbeat = 'foreign-heartbeat';

/**
 * Ruling 6: a descriptor's own URLs sit on the one host the build trusts —
 * `host` exactly, never a subdomain or a suffix of it. The heartbeat carries
 * the Bearer, so a heartbeat anywhere else refuses the whole descriptor. An
 * overlay anywhere else is no overlay, as `/relay` is (AGENTS §7): the
 * WebView never loads a page nobody vouched for. `host` is a bare, lower-case
 * name; an empty one trusts nothing.
 */
export function descriptorOnHost(
  descriptor: SessionDescriptor,
  host: string,
): Result<SessionDescriptor, ForeignHeartbeat> {
  if (httpsHost(descriptor.heartbeatUrl) !== host) return err('foreign-heartbeat');
  const { overlayUrl } = descriptor;
  if (overlayUrl === null || httpsHost(overlayUrl) === host) return ok(descriptor);
  return ok({ ...descriptor, overlayUrl: null });
}
