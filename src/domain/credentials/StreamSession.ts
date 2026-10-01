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

/**
 * M3 (final review): what the session record must never carry, as plan B's
 * `SessionConfig.secrets()` lists it. The SRT stream id is kept apart: it is a
 * secret too, but Cloudflare also puts it in the public playback URL.
 */
export type SessionSecrets = {
  /** The token, each SRT passphrase and each RTMPS stream key. */
  readonly secrets: readonly string[];
  readonly streamIds: readonly string[];
};

export function sessionSecrets(session: StreamSession): SessionSecrets {
  const secrets = [session.token];
  const streamIds: string[] = [];
  for (const credential of [session.primary, session.fallback]) {
    if (credential.transport === 'rtmps') {
      secrets.push(credential.streamKey);
    } else {
      secrets.push(credential.passphrase);
      streamIds.push(credential.streamId);
    }
  }
  return { secrets, streamIds };
}

/** Joins the two. The descriptor's sid is checked where it is fetched (D3), not here. */
export function buildStreamSession(
  code: CaptureCode,
  descriptor: SessionDescriptor,
): StreamSession {
  const { sid, slot, token, primary, fallback } = code;
  return { sid, slot, token, primary, fallback, descriptor };
}
