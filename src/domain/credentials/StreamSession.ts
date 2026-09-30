import type { CaptureCode } from '@/domain/credentials/parseCaptureQr';
import type { SessionDescriptor } from '@/domain/credentials/SessionDescriptor';
import type { StreamCredentials } from '@/domain/credentials/StreamCredentials';

/**
 * Everything `arm` needs (spec §2): the scanned code's credentials plus the
 * server's descriptor. Replaces S0's credentials-plus-URLs type. `token` is a
 * secret: it goes to native and nowhere else.
 */
export type StreamSession = {
  readonly sid: string;
  readonly slot: number;
  readonly token: string;
  readonly primary: StreamCredentials;
  readonly fallback: StreamCredentials;
  readonly descriptor: SessionDescriptor;
};

/** Joins the two. The descriptor's sid is checked where it is fetched (D3), not here. */
export function buildStreamSession(
  code: CaptureCode,
  descriptor: SessionDescriptor,
): StreamSession {
  const { sid, slot, token, primary, fallback } = code;
  return { sid, slot, token, primary, fallback, descriptor };
}
