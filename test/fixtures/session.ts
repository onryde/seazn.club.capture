import { parseCaptureQr } from '@/domain/credentials/parseCaptureQr';
import { parseDescriptor } from '@/domain/credentials/parseDescriptor';
import { buildStreamSession, type StreamSession } from '@/domain/credentials/StreamSession';
import { captureWire, descriptorWire } from './wire';

/**
 * A made-up armed session: the v2 fixture joined to the descriptor fixture.
 * `code` overrides the capture wire (e.g. `{ preferred: 'rtmps' }`).
 */
export function streamSession(
  descriptor: Record<string, unknown> = {},
  code: Record<string, unknown> = {},
): StreamSession {
  const scanned = parseCaptureQr(captureWire(code));
  const parsed = parseDescriptor(descriptorWire(descriptor));
  if (!scanned.ok || !parsed.ok) throw new Error('fixtures must parse');
  return buildStreamSession(scanned.value, parsed.value);
}
