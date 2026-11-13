import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDay } from '@/i18n/formatDay';

// 00:00 UTC on Saturday 7 November 2026: still Friday in New York.
const AT = new Date('2026-11-07T00:00:00Z');

/** A day as the operator reads it (S4 design §3, "Match Day opens Sat 8 Nov"): weekday, day and month, short. */
describe('formatDay', () => {
  it.each([
    ['en', 'Sat 7 Nov'],
    ['es', 'sáb, 7 nov'],
    ['fr', 'sam. 7 nov.'],
    ['nl', 'za 7 nov'],
  ] as const)('reads %s as %s', (lang, text) => {
    expect(formatDay(AT, { lang, zone: null, phoneZone: 'Europe/London' })).toBe(text);
  });

  it('is the day in the zone it is given, else the phone’s', () => {
    expect(
      formatDay(AT, { lang: 'en', zone: 'America/New_York', phoneZone: 'Europe/London' }),
    ).toBe('Fri 6 Nov');
    expect(formatDay(AT, { lang: 'en', zone: null, phoneZone: 'America/New_York' })).toBe(
      'Fri 6 Nov',
    );
  });

  it('falls back to the phone zone for a zone name the platform rejects', () => {
    expect(formatDay(AT, { lang: 'en', zone: 'Not/AZone', phoneZone: 'Europe/London' })).toBe(
      'Sat 7 Nov',
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
      formatDay(AT, { lang: 'en', zone: 'Europe/Madrid', phoneZone: 'Europe/London' }),
    ).toThrow('not a zone problem');
  });
});
