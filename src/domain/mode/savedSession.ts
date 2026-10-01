import { type Result, err, ok } from '@/domain/Result';
import { descriptorOnHost, type ForeignHeartbeat } from '@/domain/credentials/descriptorOnHost';
import { parseCaptureQrText } from '@/domain/credentials/parseCaptureQr';
import { buildStreamSession, type StreamSession } from '@/domain/credentials/StreamSession';
import type { SavedCode } from '@/domain/mode/savedCode';

export type SavedSessionProblem = 'unreadable-code' | 'no-descriptor' | ForeignHeartbeat;

/**
 * What the viewfinder arms with: the saved raw parsed again (it was only
 * recognised at scan) joined to the saved descriptor. The descriptor's URLs
 * are checked against the build's one `host` again (ruling 6, carry 7): a
 * record saved under the other environment never sends its Bearer anywhere,
 * and an overlay on another host is no overlay.
 */
export function sessionFromSaved(
  saved: SavedCode,
  host: string,
): Result<StreamSession, SavedSessionProblem> {
  if (saved.descriptor === null) return err('no-descriptor');
  const code = parseCaptureQrText(saved.raw);
  if (!code.ok) return err('unreadable-code');
  const descriptor = descriptorOnHost(saved.descriptor, host);
  if (!descriptor.ok) return err(descriptor.error);
  return ok(buildStreamSession(code.value, descriptor.value));
}
