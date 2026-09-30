import { describe, expect, it } from 'vitest';
import { overlayPreviewUrl, withQueryParam } from '@/domain/session/previewUrls';

describe('withQueryParam', () => {
  it('adds a query to a URL with none', () => {
    expect(withQueryParam('https://a.example/p', 'k', 'v')).toBe('https://a.example/p?k=v');
  });

  it('keeps an existing query', () => {
    expect(withQueryParam('https://a.example/p?x=1', 'k', 'v')).toBe('https://a.example/p?x=1&k=v');
  });

  it('replaces the same parameter rather than repeating it', () => {
    expect(withQueryParam('https://a.example/p?k=old&x=1', 'k', 'v')).toBe(
      'https://a.example/p?x=1&k=v',
    );
  });

  it('replaces a bare flag of the same name, and every repeat of it', () => {
    expect(withQueryParam('https://a.example/p?k&x=1&k=2', 'k', 'v')).toBe(
      'https://a.example/p?x=1&k=v',
    );
  });

  it('keeps a parameter whose name only starts the same', () => {
    expect(withQueryParam('https://a.example/p?kk=1', 'k', 'v')).toBe(
      'https://a.example/p?kk=1&k=v',
    );
  });

  it('keeps a fragment after the query', () => {
    expect(withQueryParam('https://a.example/p#top', 'k', 'v')).toBe('https://a.example/p?k=v#top');
    expect(withQueryParam('https://a.example/p?x=1#top', 'k', 'v')).toBe(
      'https://a.example/p?x=1&k=v#top',
    );
  });

  it('drops empty pairs left by a trailing ? or &&', () => {
    expect(withQueryParam('https://a.example/p?', 'k', 'v')).toBe('https://a.example/p?k=v');
    expect(withQueryParam('https://a.example/p?x=1&&', 'k', 'v')).toBe(
      'https://a.example/p?x=1&k=v',
    );
  });

  it('encodes what it adds', () => {
    expect(withQueryParam('https://a.example/p', 'k', 'a b&c')).toBe(
      'https://a.example/p?k=a%20b%26c',
    );
  });
});

/**
 * Carry 6: the Tier A route reads `?delay=`, not `delayMs` — seazn.club
 * apps/web/src/app/overlay/fixtures/[fixtureId]/page.tsx:54 (`Query`), :65 and
 * :75 (`resolveDelayMs(delay)`), where "0" resolves to 0 ms.
 */
describe('overlayPreviewUrl (AGENTS §7: the phone runs delayMs = 0)', () => {
  it('asks the Tier A route for no delay', () => {
    expect(overlayPreviewUrl('https://stg.seazn.club/overlay/fixtures/f1')).toBe(
      'https://stg.seazn.club/overlay/fixtures/f1?delay=0',
    );
  });

  it('overrides a broadcast delay the URL carries: the operator sees the score ahead', () => {
    expect(overlayPreviewUrl('https://stg.seazn.club/overlay/fixtures/f1?delay=8000')).toBe(
      'https://stg.seazn.club/overlay/fixtures/f1?delay=0',
    );
  });

  it('keeps the theme, language and realtime key the organiser put on it', () => {
    expect(
      overlayPreviewUrl('https://stg.seazn.club/overlay/fixtures/f1?style=bold&lang=nl&key=k1'),
    ).toBe('https://stg.seazn.club/overlay/fixtures/f1?style=bold&lang=nl&key=k1&delay=0');
  });
});
