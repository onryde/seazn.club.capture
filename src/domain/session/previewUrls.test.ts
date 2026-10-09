import { describe, expect, it } from 'vitest';
import { PEEK_BANDWIDTH_MBPS, peekPlaybackUrl, withQueryParam } from '@/domain/session/previewUrls';

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

const PLAYBACK = 'https://customer-x.cloudflarestream.com/abc/manifest/video.m3u8';

describe('peekPlaybackUrl (D35: a capped rendition, so a peek costs little)', () => {
  it('hints 1.0 Mbps, the coordinator’s figure (D35)', () => {
    expect(PEEK_BANDWIDTH_MBPS).toBe('1.0');
  });

  it('asks for the rendition closest to 1 Mbps', () => {
    expect(peekPlaybackUrl(PLAYBACK)).toBe(`${PLAYBACK}?clientBandwidthHint=1.0`);
  });

  it('keeps a query the server already put on the URL', () => {
    expect(peekPlaybackUrl(`${PLAYBACK}?token=abc`)).toBe(
      `${PLAYBACK}?token=abc&clientBandwidthHint=1.0`,
    );
  });

  it('replaces a hint already there instead of sending two', () => {
    expect(peekPlaybackUrl(`${PLAYBACK}?clientBandwidthHint=8`)).toBe(
      `${PLAYBACK}?clientBandwidthHint=1.0`,
    );
  });

  it('never asks for LL-HLS, pending lane D (D36)', () => {
    expect(peekPlaybackUrl(PLAYBACK)).not.toContain('protocol=');
  });
});
