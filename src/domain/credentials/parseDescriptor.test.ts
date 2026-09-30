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

  it('survives a round trip through storage', () => {
    expect(parseDescriptor(descriptorToWire(EXPECTED))).toEqual({ ok: true, value: EXPECTED });
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
