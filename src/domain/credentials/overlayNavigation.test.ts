import { describe, expect, it } from 'vitest';
import { navigationHost, staysOnOverlayOrigin } from '@/domain/credentials/overlayNavigation';

const OVERLAY = 'https://stg.seazn.club/overlay/fixtures/fake-fixture?delayMs=0';

describe('staysOnOverlayOrigin (I1: the overlay WebView keeps to its own origin)', () => {
  it.each([
    ['the overlay itself', OVERLAY],
    ['another page on the same origin', 'https://stg.seazn.club/overlay/fixtures/other'],
    ['the origin with no path', 'https://stg.seazn.club'],
    ['the same origin, shouted', 'HTTPS://STG.SEAZN.CLUB/overlay/fixtures/fake-fixture'],
    ['the default port spelled out', 'https://stg.seazn.club:443/overlay'],
    ['a query or fragment on the same origin', 'https://stg.seazn.club/o?x=1#y'],
  ])('allows %s', (_, target) => {
    expect(staysOnOverlayOrigin(OVERLAY, target)).toBe(true);
  });

  it.each([
    ['another https origin', 'https://evil.example/overlay'],
    ['a subdomain', 'https://evil.stg.seazn.club/overlay'],
    ['a suffix trick', 'https://stg.seazn.club.evil.example/overlay'],
    ['another port', 'https://stg.seazn.club:8443/overlay'],
    ['http on the same host', 'http://stg.seazn.club/overlay'],
    ['an Android intent', 'intent://scan/#Intent;scheme=zxing;package=com.example;end'],
    ['a phone call', 'tel:+441234567890'],
    ['a mail link', 'mailto:someone@example.com'],
    ['a custom app scheme', 'whatsapp://send?text=hi'],
    ['about:blank', 'about:blank'],
    ['javascript', 'javascript:alert(1)'],
    ['a data URL', 'data:text/html,<p>hi</p>'],
    ['a blob on the same origin', 'blob:https://stg.seazn.club/0f0f0f0f'],
    ['userinfo that reads as the host', 'https://stg.seazn.club@evil.example/overlay'],
    ['a backslash that reads as a path', 'https://evil.example\\.stg.seazn.club/overlay'],
    ['nothing at all', ''],
  ])('refuses %s', (_, target) => {
    expect(staysOnOverlayOrigin(OVERLAY, target)).toBe(false);
  });

  it('trusts nothing when the overlay URL itself has no https origin', () => {
    expect(
      staysOnOverlayOrigin('http://stg.seazn.club/overlay', 'http://stg.seazn.club/overlay'),
    ).toBe(false);
    expect(staysOnOverlayOrigin('', '')).toBe(false);
  });
});

describe('navigationHost (what a refused navigation is logged as)', () => {
  it.each([
    ['https://Evil.Example/path?token=secret#frag', 'evil.example'],
    ['http://evil.example:8080/x', 'evil.example'],
    ['intent://scan/#Intent;end', 'scan'],
    ['tel:+441234567890', null],
    ['about:blank', null],
    ['https://user:pass@evil.example/', null],
    ['', null],
  ])('reads %s as %s: the host only, never a path, query or userinfo', (url, host) => {
    expect(navigationHost(url)).toBe(host);
  });
});
