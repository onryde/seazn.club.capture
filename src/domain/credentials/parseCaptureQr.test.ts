import { describe, expect, it } from 'vitest';
import { parseCaptureQr, parseCaptureQrText } from '@/domain/credentials/parseCaptureQr';
import { captureRaw, captureWire, FIXTURE_SECRETS, FIXTURE_SID } from '../../../test/fixtures/wire';

const SRT = {
  transport: 'srt',
  url: 'srt://ingest.example:778',
  streamId: 'fake-stream-id',
  passphrase: 'fake-pass-0000',
  latencyMs: 2000,
} as const;
const RTMPS = {
  transport: 'rtmps',
  url: 'rtmps://ingest.example:443/live/',
  streamKey: 'fake-key-0000',
} as const;

const cred = captureWire().cred as {
  srt: Record<string, unknown>;
  rtmps: Record<string, unknown>;
};
const withSrt = (srt: Record<string, unknown>) =>
  captureWire({ cred: { srt: { ...cred.srt, ...srt }, rtmps: cred.rtmps } });
const withRtmps = (rtmps: Record<string, unknown>) =>
  captureWire({ cred: { srt: cred.srt, rtmps: { ...cred.rtmps, ...rtmps } } });

describe('parseCaptureQr (spec §2)', () => {
  it('reads a v2 code, primary first by `preferred`', () => {
    expect(parseCaptureQr(captureWire())).toEqual({
      ok: true,
      value: {
        sid: FIXTURE_SID,
        slot: 1,
        token: 'fake-token-00000000000000000000',
        primary: SRT,
        fallback: RTMPS,
        expiresAt: new Date('2026-10-03T17:00:00Z'),
      },
    });
  });

  it('swaps the pair when RTMPS is preferred', () => {
    expect(parseCaptureQr(captureWire({ preferred: 'rtmps' }))).toMatchObject({
      ok: true,
      value: { primary: RTMPS, fallback: SRT },
    });
  });

  it('reads both SRT url forms, keeping the separate fields canonical (lane D)', () => {
    const embedded = withSrt({ url: 'srt://ingest.example:778?streamid=other&passphrase=other' });
    expect(parseCaptureQr(embedded)).toMatchObject({ ok: true, value: { primary: SRT } });
  });

  it('refuses a code with no token', () => {
    expect(parseCaptureQr(captureWire({ tok: undefined }))).toEqual({
      ok: false,
      error: { kind: 'missing-field', field: 'tok' },
    });
  });

  it('refuses an empty token', () => {
    expect(parseCaptureQr(captureWire({ tok: '' }))).toMatchObject({
      ok: false,
      error: { kind: 'invalid-field', field: 'tok' },
    });
  });

  it.each([
    [1, 1],
    [3, 3],
    [undefined, null],
    ['2', null],
  ])('refuses version %j, reporting it as %j', (v, found) => {
    expect(parseCaptureQr(captureWire({ v }))).toEqual({
      ok: false,
      error: { kind: 'unsupported-version', found },
    });
  });

  it('refuses garbled text without throwing', () => {
    expect(parseCaptureQrText('{"v":2,')).toEqual({ ok: false, error: { kind: 'not-an-object' } });
  });

  it('refuses empty text without throwing', () => {
    expect(parseCaptureQrText('')).toEqual({ ok: false, error: { kind: 'not-an-object' } });
  });

  it.each([[[]], [42], ['text'], [null]])('refuses foreign JSON %j', (input) => {
    expect(parseCaptureQr(input)).toEqual({ ok: false, error: { kind: 'not-an-object' } });
  });

  it('refuses a bare version, naming the first field', () => {
    expect(parseCaptureQr({ v: 2 })).toEqual({
      ok: false,
      error: { kind: 'missing-field', field: 'sid' },
    });
  });

  it.each(['sid', 'slot', 'exp', 'tok', 'cred', 'preferred'])(
    'refuses a code missing %s',
    (field) => {
      expect(parseCaptureQr(captureWire({ [field]: undefined }))).toEqual({
        ok: false,
        error: { kind: 'missing-field', field },
      });
    },
  );

  it('requires the SRT passphrase (D7)', () => {
    expect(parseCaptureQr(withSrt({ passphrase: undefined }))).toEqual({
      ok: false,
      error: { kind: 'missing-field', field: 'cred.srt.passphrase' },
    });
  });

  it('refuses an empty SRT passphrase (D7)', () => {
    expect(parseCaptureQr(withSrt({ passphrase: '' }))).toMatchObject({
      ok: false,
      error: { kind: 'invalid-field', field: 'cred.srt.passphrase' },
    });
  });

  it.each(['url', 'streamId', 'latencyMs'])('names a missing cred.srt.%s', (key) => {
    expect(parseCaptureQr(withSrt({ [key]: undefined }))).toEqual({
      ok: false,
      error: { kind: 'missing-field', field: `cred.srt.${key}` },
    });
  });

  it.each(['url', 'streamKey'])('names a missing cred.rtmps.%s', (key) => {
    expect(parseCaptureQr(withRtmps({ [key]: undefined }))).toEqual({
      ok: false,
      error: { kind: 'missing-field', field: `cred.rtmps.${key}` },
    });
  });

  it('refuses an SRT url on another scheme', () => {
    expect(parseCaptureQr(withSrt({ url: 'udp://ingest.example:778' }))).toMatchObject({
      ok: false,
      error: { kind: 'invalid-field', field: 'cred.srt.url' },
    });
  });

  it('refuses plain RTMP, which has no TLS', () => {
    const wire = captureWire({
      cred: { srt: cred.srt, rtmps: { url: 'rtmp://ingest.example/live', streamKey: 'k' } },
    });
    expect(parseCaptureQr(wire)).toMatchObject({
      ok: false,
      error: { kind: 'invalid-field', field: 'cred.rtmps.url' },
    });
  });

  it('refuses a transport it does not know as preferred', () => {
    expect(parseCaptureQr(captureWire({ preferred: 'udp' }))).toMatchObject({
      ok: false,
      error: { kind: 'invalid-field', field: 'preferred' },
    });
  });

  it.each([
    ['SRT', { srt: cred.srt }],
    ['RTMPS', { rtmps: cred.rtmps }],
  ])('refuses a code carrying only %s, which leaves no fallback (C1)', (_only, pair) => {
    expect(parseCaptureQr(captureWire({ cred: pair }))).toEqual({
      ok: false,
      error: { kind: 'missing-fallback' },
    });
  });

  it.each([
    ['slot', -1],
    ['slot', 1.5],
    ['exp', 0],
    ['exp', 1e20],
  ])('refuses %s of %j', (field, value) => {
    expect(parseCaptureQr(captureWire({ [field]: value }))).toMatchObject({
      ok: false,
      error: { kind: 'invalid-field', field },
    });
  });

  it('parses an expired code: expiry is recognise’s call, against the clock', () => {
    expect(parseCaptureQrText(captureRaw({ exp: 1 }))).toMatchObject({ ok: true });
  });
});

describe('parseCaptureQr never echoes a secret (ruling 3)', () => {
  it('knows every secret the fixture carries', () => {
    const wire = JSON.stringify(captureWire());
    for (const secret of FIXTURE_SECRETS) expect(wire).toContain(secret);
  });

  it.each<[string, Record<string, unknown>]>([
    ['a version', { v: 'fake-token-00000000000000000000' }],
    ['a sid', { sid: { tok: 'fake-token-00000000000000000000' } }],
    ['a slot', { slot: 'fake-token-00000000000000000000' }],
    ['an expiry', { exp: 'fake-pass-0000' }],
    ['a preferred transport', { preferred: 'fake-key-0000' }],
    ['an SRT url', withSrt({ url: 'srt://ingest.example:778?passphrase=fake-pass-0000 x' })],
    ['an SRT latency', withSrt({ latencyMs: 'fake-stream-id' })],
    ['an RTMPS url', withRtmps({ url: 'rtmp://ingest.example/live/fake-key-0000' })],
  ])('in the error for %s', (_what, overrides) => {
    const result = parseCaptureQr(captureWire(overrides));
    expect(result.ok).toBe(false);
    const said = JSON.stringify(result);
    for (const secret of FIXTURE_SECRETS) expect(said).not.toContain(secret);
  });
});
