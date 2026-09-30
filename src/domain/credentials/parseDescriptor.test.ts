import { describe, expect, it } from 'vitest';
import {
  descriptorToWire,
  parseDescriptor,
  parseEndReason,
} from '@/domain/credentials/parseDescriptor';
import type { SessionDescriptor } from '@/domain/credentials/SessionDescriptor';
import { descriptorWire, FIXTURE_SECRETS, FIXTURE_SID } from '../../../test/fixtures/wire';

const EXPECTED: SessionDescriptor = {
  sid: FIXTURE_SID,
  state: 'warming',
  endReason: null,
  playbackUrl: 'https://video.example/fake/manifest/video.m3u8',
  overlayUrl: 'https://stg.seazn.club/overlay/fixtures/fake-fixture',
  holdWindowSeconds: { srt: 183, rtmps: 183 },
  venueTimezone: 'Europe/London',
  label: 'Seazn XI v Fake CC',
  scoreUpdates: 'realtime',
  maxDurationMinutes: 300,
  warmingDeadline: new Date('2026-10-03T13:10:00Z'),
  expiresAt: new Date('2026-10-03T17:00:00Z'),
  heartbeatUrl: 'https://stg.seazn.club/api/capture/sessions/fake/heartbeat',
};

describe('parseDescriptor', () => {
  it('reads the descriptor the web serves (spec Ask)', () => {
    expect(parseDescriptor(descriptorWire())).toEqual({ ok: true, value: EXPECTED });
  });

  it.each([[null], [undefined], [[]], ['descriptor'], [42]])(
    'refuses %j as not an object',
    (input) => {
      expect(parseDescriptor(input)).toEqual({ ok: false, error: { kind: 'not-an-object' } });
    },
  );

  it('refuses an empty descriptor, naming the first field', () => {
    expect(parseDescriptor({})).toEqual({
      ok: false,
      error: { kind: 'missing-field', field: 'sid' },
    });
  });

  it.each([
    'sid',
    'state',
    'playbackUrl',
    'overlayUrl',
    'holdWindowSeconds',
    'venueTimezone',
    'label',
    'scoreUpdates',
    'maxDurationMinutes',
    'warmingDeadline',
    'exp',
    'heartbeatUrl',
  ])('refuses a descriptor missing %s', (field) => {
    expect(parseDescriptor(descriptorWire({ [field]: undefined }))).toEqual({
      ok: false,
      error: { kind: 'missing-field', field },
    });
  });

  it.each(['playbackUrl', 'overlayUrl', 'heartbeatUrl'])(
    'refuses a %s that is not https',
    (field) => {
      const result = parseDescriptor(descriptorWire({ [field]: 'http://video.example/a' }));
      expect(result).toMatchObject({ ok: false, error: { kind: 'invalid-field', field } });
    },
  );

  it.each([
    'https://user@video.example/a',
    'https://video.example/a b',
    'https:///a',
    'see https://video.example/a',
  ])('refuses %j: no userinfo, no whitespace, a host, and nothing before the scheme', (url) => {
    const result = parseDescriptor(descriptorWire({ playbackUrl: url }));
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'invalid-field', field: 'playbackUrl' },
    });
  });

  it.each([
    ['playbackUrl', 'https://evil.example\\.video.example/a'],
    ['overlayUrl', 'https://evil.example\\.stg.seazn.club/overlay/fixtures/x'],
    ['heartbeatUrl', 'https://evil.example\\.stg.seazn.club/hb'],
    ['playbackUrl', 'https://video.example\\@evil.example/a'],
    ['overlayUrl', 'https://stg.seazn.club\\evil.example/overlay'],
    ['heartbeatUrl', 'https://stg.seazn.club:443\\@evil.example/hb'],
  ])('refuses a %s with a backslash in its authority: WHATWG reads it as a slash', (field, url) => {
    const result = parseDescriptor(descriptorWire({ [field]: url }));
    expect(result).toMatchObject({ ok: false, error: { kind: 'invalid-field', field } });
  });

  it.each([
    ['playbackUrl', 'https://user@video.example/a'],
    ['overlayUrl', 'https://stg.seazn.club@evil.example/overlay/fixtures/x'],
    ['heartbeatUrl', 'https://stg.seazn.club:443@evil.example/hb'],
    ['heartbeatUrl', 'https://@stg.seazn.club/hb'],
  ])('refuses a %s with userinfo in its authority', (field, url) => {
    const result = parseDescriptor(descriptorWire({ [field]: url }));
    expect(result).toMatchObject({ ok: false, error: { kind: 'invalid-field', field } });
  });

  it.each([
    ['https://stg.seazn.club/hb\\x', 'a backslash in the path'],
    ['https://stg.seazn.club/@x', 'an @ in the path'],
  ])('keeps %j: %s leaves the host alone', (url) => {
    const result = parseDescriptor(descriptorWire({ heartbeatUrl: url }));
    expect(result).toMatchObject({ ok: true, value: { heartbeatUrl: url } });
  });

  it.each([
    ['playbackUrl', 'https://fake-pass-0000@video.example/a'],
    ['overlayUrl', 'https://evil.example\\fake-key-0000.stg.seazn.club/o'],
    ['heartbeatUrl', 'https://fake-token-00000000000000000000\\@evil.example/hb'],
    ['heartbeatUrl', 'https://fake-stream-id:fake-pass-0000@evil.example/hb'],
  ])('never echoes a refused %s authority (ruling 7)', (field, url) => {
    const result = parseDescriptor(descriptorWire({ [field]: url }));
    expect(result.ok).toBe(false);
    const said = JSON.stringify(result);
    for (const secret of FIXTURE_SECRETS) expect(said).not.toContain(secret);
  });

  it.each([
    ['https://stg.seazn.club/relay'],
    ['https://stg.seazn.club/relay/'],
    ['https://stg.seazn.club/x/relay/y'],
    ['https://stg.seazn.club/overlay/fixtures/fake-fixture/relay?delayMs=0'],
    ['https://stg.seazn.club/Relay'],
  ])('reads an overlay with a relay path segment, %s, as no overlay (AGENTS §7)', (url) => {
    const result = parseDescriptor(descriptorWire({ overlayUrl: url }));
    expect(result).toMatchObject({ ok: true, value: { overlayUrl: null } });
  });

  it.each([
    ['https://stg.seazn.club/relayed'],
    ['https://stg.seazn.club/overlay/fixtures/relay-cup'],
    ['https://stg.seazn.club/overlay/fixtures/prerelay'],
    ['https://stg.seazn.club/overlay/fixtures/fake-fixture?next=/relay'],
    ['https://stg.seazn.club/overlay/fixtures/fake-fixture#/relay'],
    ['https://relay.seazn.club/overlay/fixtures/fake-fixture'],
  ])('keeps %s: relay is not a path segment there', (url) => {
    const result = parseDescriptor(descriptorWire({ overlayUrl: url }));
    expect(result).toMatchObject({ ok: true, value: { overlayUrl: url } });
  });

  it('reads an explicit null overlay as no overlay, the form storage keeps', () => {
    const result = parseDescriptor(descriptorWire({ overlayUrl: null }));
    expect(result).toMatchObject({ ok: true, value: { overlayUrl: null } });
  });

  it('refuses a state it does not know, rather than guessing', () => {
    const result = parseDescriptor(descriptorWire({ state: 'paused' }));
    expect(result).toMatchObject({ ok: false, error: { kind: 'invalid-field', field: 'state' } });
  });

  it.each([
    ['sid', ''],
    ['label', ''],
    ['label', 42],
    ['venueTimezone', null],
  ])('refuses a %s of %j: text fields are non-empty strings', (field, value) => {
    const result = parseDescriptor(descriptorWire({ [field]: value }));
    expect(result).toMatchObject({ ok: false, error: { kind: 'invalid-field', field } });
  });

  it('names the transport whose hold window is missing', () => {
    const result = parseDescriptor(descriptorWire({ holdWindowSeconds: { srt: 183 } }));
    expect(result).toEqual({
      ok: false,
      error: { kind: 'missing-field', field: 'holdWindowSeconds.rtmps' },
    });
  });

  it.each([[183], [null], [[]]])('refuses hold windows of %j without throwing', (value) => {
    const result = parseDescriptor(descriptorWire({ holdWindowSeconds: value }));
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'invalid-field', field: 'holdWindowSeconds' },
    });
  });

  it('refuses a hold window of zero seconds', () => {
    const result = parseDescriptor(descriptorWire({ holdWindowSeconds: { srt: 0, rtmps: 183 } }));
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'invalid-field', field: 'holdWindowSeconds.srt' },
    });
  });

  it.each([[0], [-1], [Infinity], [NaN], ['300']])('refuses a maximum duration of %s', (value) => {
    const result = parseDescriptor(descriptorWire({ maxDurationMinutes: value }));
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'invalid-field', field: 'maxDurationMinutes' },
    });
  });

  it.each([0, 1.5, -60, 1e20, '1791033000'])('refuses a warming deadline of %j', (value) => {
    const result = parseDescriptor(descriptorWire({ warmingDeadline: value }));
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'invalid-field', field: 'warmingDeadline' },
    });
  });

  it('keeps the organiser end reason when present', () => {
    const result = parseDescriptor(descriptorWire({ state: 'completed', endReason: 'stopped' }));
    expect(result).toMatchObject({ ok: true, value: { state: 'completed', endReason: 'stopped' } });
  });

  it('reads a null end reason as none', () => {
    const result = parseDescriptor(descriptorWire({ endReason: null }));
    expect(result).toMatchObject({ ok: true, value: { endReason: null } });
  });

  it('stores exactly the wire form, with no key the parser would ignore (D28)', () => {
    expect(descriptorToWire(EXPECTED)).toStrictEqual(descriptorWire({ endReason: null }));
  });

  it('stores no overlay as null', () => {
    expect(descriptorToWire({ ...EXPECTED, overlayUrl: null })).toStrictEqual(
      descriptorWire({ endReason: null, overlayUrl: null }),
    );
  });

  it('survives a round trip through storage', () => {
    expect(parseDescriptor(descriptorToWire(EXPECTED))).toEqual({ ok: true, value: EXPECTED });
  });

  it('keeps no overlay through storage', () => {
    const bare: SessionDescriptor = { ...EXPECTED, overlayUrl: null };
    expect(parseDescriptor(descriptorToWire(bare))).toEqual({ ok: true, value: bare });
  });

  it.each(['stopped', 'no-inbound-timeout', 'target-rejected', 'max-duration', 'unknown'] as const)(
    'keeps the end reason %s through storage',
    (endReason) => {
      const ended: SessionDescriptor = { ...EXPECTED, state: 'completed', endReason };
      expect(parseDescriptor(descriptorToWire(ended))).toEqual({ ok: true, value: ended });
    },
  );

  it.each<[string, unknown]>([
    ['sid', { tok: 'fake-token-00000000000000000000' }],
    ['state', 'fake-token-00000000000000000000'],
    ['scoreUpdates', 'fake-key-0000'],
    ['playbackUrl', 'http://video.example/a?passphrase=fake-pass-0000'],
    ['overlayUrl', 'https://video.example/a?streamid=fake-stream-id x'],
    ['holdWindowSeconds', { srt: 'fake-pass-0000', rtmps: 183 }],
    ['holdWindowSeconds', 'fake-pass-0000'],
    ['warmingDeadline', 'fake-key-0000'],
  ])('never echoes the value of a refused %s (ruling 3)', (field, value) => {
    const result = parseDescriptor(descriptorWire({ [field]: value }));
    expect(result.ok).toBe(false);
    const said = JSON.stringify(result);
    for (const secret of FIXTURE_SECRETS) expect(said).not.toContain(secret);
  });
});

describe('parseEndReason (D4)', () => {
  it.each([
    ['stopped', 'stopped'],
    ['no_inbound_timeout', 'no-inbound-timeout'],
    ['target_rejected', 'target-rejected'],
    ['max_duration', 'max-duration'],
    ['something_new', 'unknown'],
    ['constructor', 'unknown'],
    [undefined, 'unknown'],
    [7, 'unknown'],
  ])('maps %j to %s', (wire, domain) => {
    expect(parseEndReason(wire)).toBe(domain);
  });
});
