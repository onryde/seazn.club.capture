import { type Result, err, ok } from '@/domain/Result';
import { parseCaptureQrText } from '@/domain/credentials/parseCaptureQr';
import { buildStreamSession, type StreamSession } from '@/domain/credentials/StreamSession';
import type { SavedCode } from '@/domain/mode/savedCode';

export type SavedSessionProblem = 'unreadable-code' | 'no-descriptor';

/**
 * What the viewfinder arms with: the saved raw parsed again (it was only
 * recognised at scan) joined to the saved descriptor.
 */
export function sessionFromSaved(saved: SavedCode): Result<StreamSession, SavedSessionProblem> {
  if (saved.descriptor === null) return err('no-descriptor');
  const code = parseCaptureQrText(saved.raw);
  if (!code.ok) return err('unreadable-code');
  return ok(buildStreamSession(code.value, saved.descriptor));
}
