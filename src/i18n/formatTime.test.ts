import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatTime } from '@/i18n/formatTime';

// 17:40 UTC on a BST day: 18:40 in London, 19:40 in Madrid.
const AT = new Date('2026-10-03T17:40:00Z');

describe('formatTime', () => {
  it('shows the venue time with no zone name when it matches the phone', () => {
    expect(formatTime(AT, { lang: 'en', zone: 'Europe/London', phoneZone: 'Europe/London' })).toBe(
      '18:40',
    );
  });

  it('uses the phone zone until the server supplies one', () => {
    expect(formatTime(AT, { lang: 'nl', zone: null, phoneZone: 'Europe/Amsterdam' })).toBe('19:40');
  });

  it('adds the zone name when the venue is elsewhere', () => {
    const text = formatTime(AT, { lang: 'en', zone: 'Europe/Madrid', phoneZone: 'Europe/London' });
    expect(text).toMatch(/19:40/);
    expect(text).not.toBe('19:40');
  });

  it('falls back to the phone zone for a zone name the platform rejects', () => {
    expect(formatTime(AT, { lang: 'en', zone: 'Not/AZone', phoneZone: 'Europe/London' })).toBe(
      '18:40',
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not hide a failure that is not an unknown zone', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementationOnce(function () {
      throw new TypeError('not a zone problem');
    });
    expect(() =>
      formatTime(AT, { lang: 'en', zone: 'Europe/Madrid', phoneZone: 'Europe/London' }),
    ).toThrow('not a zone problem');
  });
});
