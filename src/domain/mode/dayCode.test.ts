import { describe, expect, it } from 'vitest';
import { dayCodeOf } from '@/domain/mode/dayCode';
import { dayLink, FIXTURE_DAY_TOKEN } from '../../../test/fixtures/dayCode';

const HOSTS = ['stg.seazn.club'];

/**
 * A saved Match Day code is its QR whole (`code.matchday`'s `raw`, S4 design §3); what the port sends is the origin
 * the link names and its `md_` token, read again by the recogniser's own rules, so a link the recogniser would refuse
 * names no code here either.
 */
describe('dayCodeOf', () => {
  it('reads the build host’s day link as its origin and its token', () => {
    expect(dayCodeOf(dayLink(), HOSTS)).toEqual({
      origin: 'https://stg.seazn.club',
      token: FIXTURE_DAY_TOKEN,
    });
  });

  it('reads a trailing slash and a capitalised host as the recogniser does, with the origin in lower case', () => {
    expect(dayCodeOf(`HTTPS://STG.Seazn.Club/day/${FIXTURE_DAY_TOKEN}/`, HOSTS)).toEqual({
      origin: 'https://stg.seazn.club',
      token: FIXTURE_DAY_TOKEN,
    });
  });

  it.each([
    ['another host', dayLink('seazn.club')],
    ['a host that ends like the build’s', dayLink('evil-stg.seazn.club')],
    ['userinfo', `https://stg.seazn.club@evil.example/day/${FIXTURE_DAY_TOKEN}`],
    ['a port', `https://stg.seazn.club:8443/day/${FIXTURE_DAY_TOKEN}`],
    ['http', `http://stg.seazn.club/day/${FIXTURE_DAY_TOKEN}`],
    ['a scoring link', 'https://stg.seazn.club/score/dl_abc'],
    ['a short token', 'https://stg.seazn.club/day/md_short'],
    ['nothing', ''],
  ])('names no code for %s', (_, raw) => {
    expect(dayCodeOf(raw, HOSTS)).toBeNull();
  });

  it('a build with no host trusts no link', () => {
    expect(dayCodeOf(dayLink(), [])).toBeNull();
  });
});
