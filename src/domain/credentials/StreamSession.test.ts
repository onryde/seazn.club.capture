import { describe, expect, it } from 'vitest';
import { parseCaptureQr } from '@/domain/credentials/parseCaptureQr';
import { parseDescriptor } from '@/domain/credentials/parseDescriptor';
import { buildStreamSession, sessionSecrets } from '@/domain/credentials/StreamSession';
import { captureWire, descriptorWire, FIXTURE_SID } from '../../../test/fixtures/wire';

describe('buildStreamSession', () => {
  it('joins the code and its descriptor', () => {
    const code = parseCaptureQr(captureWire());
    const descriptor = parseDescriptor(descriptorWire());
    if (!code.ok || !descriptor.ok) throw new Error('fixtures must parse');
    const session = buildStreamSession(code.value, descriptor.value);
    expect(session.sid).toBe(FIXTURE_SID);
    expect(session.token).toBe('fake-token-00000000000000000000');
    expect(session.primary.transport).toBe('srt');
    expect(session.descriptor.label).toBe('Seazn XI v Fake CC');
  });

  it('carries exactly what arm needs, and not the code’s own expiry', () => {
    const code = parseCaptureQr(captureWire({ preferred: 'rtmps', slot: 3 }));
    const descriptor = parseDescriptor(descriptorWire());
    if (!code.ok || !descriptor.ok) throw new Error('fixtures must parse');
    expect(buildStreamSession(code.value, descriptor.value)).toEqual({
      sid: FIXTURE_SID,
      slot: 3,
      token: 'fake-token-00000000000000000000',
      primary: {
        transport: 'rtmps',
        url: 'rtmps://ingest.example:443/live/',
        streamKey: 'fake-key-0000',
      },
      fallback: {
        transport: 'srt',
        url: 'srt://ingest.example:778',
        streamId: 'fake-stream-id',
        passphrase: 'fake-pass-0000',
        latencyMs: 2000,
      },
      descriptor: descriptor.value,
    });
  });
});

/** M3 (final review): plan B's SessionConfig.secrets(), with the stream id apart. */
describe('sessionSecrets', () => {
  it.each(['srt', 'rtmps'])(
    'names the token, passphrase and key, and the stream id apart, preferring %s',
    (preferred) => {
      const code = parseCaptureQr(captureWire({ preferred }));
      const descriptor = parseDescriptor(descriptorWire());
      if (!code.ok || !descriptor.ok) throw new Error('fixtures must parse');
      const { secrets, streamIds } = sessionSecrets(
        buildStreamSession(code.value, descriptor.value),
      );
      expect([...secrets].sort()).toEqual([
        'fake-key-0000',
        'fake-pass-0000',
        'fake-token-00000000000000000000',
      ]);
      expect(streamIds).toEqual(['fake-stream-id']);
    },
  );
});
