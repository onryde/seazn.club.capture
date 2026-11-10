import { describe, expect, it } from 'vitest';
import { cricketKeys, FIT_FILES, LANGUAGES, ownsKey, unmeasured } from './cricketFit.testkit';

// The partition under the cricket fit files' sweeps (plan Task 18, split by concern): each file sweeps the keys it owns,
// so this one proves the owners are right, from the dictionary and not from the files' own lists: every
// `scoring.cricket.` key is owned by exactly one file. A key owned by none has no sweep; one owned by two is swept in a
// file that may not measure it.
describe('the cricket fit files own every key once', () => {
  const keys = cricketKeys();

  it('there are keys to own (anti-vacuity)', () => {
    expect(keys.length).toBeGreaterThan(250);
  });

  it('every scoring.cricket key has exactly one owner', () => {
    const orphans = keys.filter((key) => FIT_FILES.every((file) => !ownsKey(file, key)));
    const doubled = keys.filter((key) => FIT_FILES.filter((file) => ownsKey(file, key)).length > 1);
    expect(orphans).toEqual([]);
    expect(doubled).toEqual([]);
  });

  it.each(LANGUAGES)('%s has every cricket key English has, and none it lacks', (_, dictionary) => {
    expect([...cricketKeys(dictionary)].sort()).toEqual([...keys].sort());
  });

  it('a sweep of no keys is a failure, and one with a key unread names it', () => {
    expect(() => unmeasured([], new Set(['scoring.cricket.a']))).toThrow();
    expect(
      unmeasured(['scoring.cricket.a', 'scoring.cricket.b'], new Set(['scoring.cricket.a'])),
    ).toEqual(['scoring.cricket.b']);
  });
});
