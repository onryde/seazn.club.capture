import { describe, expect, it } from 'vitest';
import { descriptorOnHost } from '@/domain/credentials/descriptorOnHost';
import type { SessionDescriptor } from '@/domain/credentials/SessionDescriptor';
import { httpsHost } from '@/domain/credentials/wire';

const HOST = 'stg.seazn.club';

const DESCRIPTOR: SessionDescriptor = {
  sid: '5d9c1d0e-0000-4000-8000-000000000001',
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

const descriptor = (overrides: Partial<SessionDescriptor> = {}): SessionDescriptor => ({
  ...DESCRIPTOR,
  ...overrides,
});

/** None is trusted as `stg.seazn.club`. All but the second backslash are off it in a WebView too. */
const FOREIGN: readonly (readonly [string, string])[] = [
  ['a proper subdomain: exact names only', 'https://api.stg.seazn.club/hb'],
  ['the parent name', 'https://seazn.club/hb'],
  ['a Seazn name with a foreign suffix', 'https://stg.seazn.club.evil.example/hb'],
  ['a name that merely ends in the host', 'https://evilstg.seazn.club/hb'],
  ['userinfo naming the host', 'https://stg.seazn.club@evil.example/hb'],
  [
    'a backslash, which WHATWG reads as the end of the host',
    'https://evil.example\\.stg.seazn.club/hb',
  ],
  ['a backslash in the authority at all', 'https://stg.seazn.club\\@evil.example/hb'],
  ['a trailing dot', 'https://stg.seazn.club./hb'],
  ['plain http', 'http://stg.seazn.club/hb'],
  ['the host only in the path', 'https://evil.example/stg.seazn.club'],
];

describe('descriptorOnHost (ruling 6)', () => {
  it('keeps a descriptor whose heartbeat and overlay sit on the host', () => {
    expect(descriptorOnHost(DESCRIPTOR, HOST)).toEqual({ ok: true, value: DESCRIPTOR });
  });

  it('keeps the host in any case, with a port', () => {
    const shouted = descriptor({ heartbeatUrl: 'HTTPS://STG.Seazn.Club:443/hb' });
    expect(descriptorOnHost(shouted, HOST)).toEqual({ ok: true, value: shouted });
  });

  it('keeps no overlay when there was none', () => {
    const bare = descriptor({ overlayUrl: null });
    expect(descriptorOnHost(bare, HOST)).toEqual({ ok: true, value: bare });
  });

  it.each(FOREIGN)('refuses a heartbeat on %s: the heartbeat carries the Bearer', (_label, url) => {
    expect(descriptorOnHost(descriptor({ heartbeatUrl: url }), HOST)).toEqual({
      ok: false,
      error: 'foreign-heartbeat',
    });
  });

  it.each(FOREIGN)('drops an overlay on %s, and keeps the rest', (_label, url) => {
    expect(descriptorOnHost(descriptor({ overlayUrl: url }), HOST)).toEqual({
      ok: true,
      value: descriptor({ overlayUrl: null }),
    });
  });

  it('refuses the heartbeat before looking at the overlay', () => {
    const both = descriptor({
      heartbeatUrl: 'https://evil.example/hb',
      overlayUrl: 'https://evil.example/overlay',
    });
    expect(descriptorOnHost(both, HOST)).toEqual({ ok: false, error: 'foreign-heartbeat' });
  });

  it('trusts nothing for an empty host', () => {
    expect(descriptorOnHost(DESCRIPTOR, '')).toEqual({ ok: false, error: 'foreign-heartbeat' });
  });

  it('trusts the production host on a production build, and only it', () => {
    const production = descriptor({
      heartbeatUrl: 'https://seazn.club/hb',
      overlayUrl: 'https://seazn.club/overlay/fixtures/x',
    });
    expect(descriptorOnHost(production, 'seazn.club')).toEqual({ ok: true, value: production });
    expect(descriptorOnHost(DESCRIPTOR, 'seazn.club')).toEqual({
      ok: false,
      error: 'foreign-heartbeat',
    });
  });

  it.each([
    ['www, a proper subdomain', 'https://www.seazn.club/hb'],
    ['a name that merely ends in the host', 'https://evilseazn.club/hb'],
    [
      'a backslash, which WHATWG reads as the end of the host',
      'https://evil.example\\.seazn.club/hb',
    ],
  ])('refuses a heartbeat on %s on a production build', (_label, url) => {
    expect(descriptorOnHost(descriptor({ heartbeatUrl: url }), 'seazn.club')).toEqual({
      ok: false,
      error: 'foreign-heartbeat',
    });
  });
});

describe('httpsHost', () => {
  it.each([
    ['https://stg.seazn.club/hb', 'stg.seazn.club'],
    ['https://stg.seazn.club', 'stg.seazn.club'],
    ['HTTPS://STG.Seazn.Club:8443?x=1', 'stg.seazn.club'],
    ['https://seazn.club#top', 'seazn.club'],
  ])('reads %j as %j', (url, host) => {
    expect(httpsHost(url)).toBe(host);
  });

  it.each([
    'http://stg.seazn.club/hb',
    'https://stg.seazn.club@evil.example/hb',
    'https://evil.example\\.stg.seazn.club/hb',
    'https://stg.seazn.club:x/hb',
    'https://stg.seazn.club:/hb',
    'https:///stg.seazn.club/hb',
    ' https://stg.seazn.club/hb',
    'https://stg.seazn.club /hb',
    '',
  ])('reads no host from %j', (url) => {
    expect(httpsHost(url)).toBeNull();
  });

  it('refuses the backslash because WHATWG URL, which the WebView uses, ends the host there', () => {
    expect(new URL('https://evil.example\\.stg.seazn.club/hb').hostname).toBe('evil.example');
  });
});
