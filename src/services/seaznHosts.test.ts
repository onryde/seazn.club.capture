import { describe, expect, it } from 'vitest';
import { descriptorOrigin, isSeaznUrl, seaznHosts } from '@/services/seaznHosts';

describe('seaznHosts', () => {
  it('uses production only when the build says production', () => {
    expect(seaznHosts('production')).toEqual(['seazn.club']);
  });

  it.each([undefined, '', 'staging', 'PRODUCTION '])('uses staging for %j', (env) => {
    expect(seaznHosts(env)).toEqual(['stg.seazn.club']);
  });
});

describe('descriptorOrigin', () => {
  it('asks staging for descriptors unless explicitly production', () => {
    expect(descriptorOrigin(undefined)).toBe('https://stg.seazn.club');
    expect(descriptorOrigin('production')).toBe('https://seazn.club');
  });

  it.each(['', 'staging', 'PRODUCTION '])('asks staging for %j', (env) => {
    expect(descriptorOrigin(env)).toBe('https://stg.seazn.club');
  });
});

describe('isSeaznUrl (ruling 6)', () => {
  const STAGING = ['stg.seazn.club'];
  const PRODUCTION = ['seazn.club'];

  it.each([
    ['the host itself', 'https://stg.seazn.club/api/hb', STAGING],
    ['the host, any case, with a port', 'HTTPS://STG.Seazn.Club:443/api/hb', STAGING],
    ['a bare host', 'https://stg.seazn.club', STAGING],
    ['a proper subdomain', 'https://api.stg.seazn.club/hb', STAGING],
    ['the production host', 'https://seazn.club/overlay/fixtures/x', PRODUCTION],
    ['a query straight after the host', 'https://seazn.club?x=1', PRODUCTION],
  ])('accepts %s', (_label, url, hosts) => {
    expect(isSeaznUrl(url, hosts)).toBe(true);
  });

  it.each([
    ['a foreign suffix', 'https://stg.seazn.club.evil.example/hb', STAGING],
    ['a name ending in the host, with no dot', 'https://evilstg.seazn.club/hb', STAGING],
    ['a name ending in the production host', 'https://evilseazn.club/hb', PRODUCTION],
    ['the production host on a staging build', 'https://seazn.club/hb', STAGING],
    ['userinfo naming the host', 'https://stg.seazn.club@evil.example/hb', STAGING],
    ['plain http', 'http://stg.seazn.club/hb', STAGING],
    ['a trailing dot', 'https://stg.seazn.club./hb', STAGING],
    ['a port that is not a number', 'https://stg.seazn.club:x/hb', STAGING],
    ['the host only in the path', 'https://evil.example/stg.seazn.club', STAGING],
    ['no host list', 'https://stg.seazn.club/hb', []],
  ])('refuses %s', (_label, url, hosts) => {
    expect(isSeaznUrl(url, hosts)).toBe(false);
  });
});
