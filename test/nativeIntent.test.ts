import { describe, expect, it } from 'vitest';
import { redirectSystemPath } from '../app/+native-intent';

describe('redirectSystemPath (R22)', () => {
  it.each([
    'seazn-capture://stream',
    'seazn-capture:///stream?x=1',
    '/stream',
    'https://stg.seazn.club/anything',
  ])('starts a cold launch from %s at Home', (path) => {
    expect(redirectSystemPath({ path, initial: true })).toBe('/');
  });

  it('never navigates on a link that arrives while the app is running', () => {
    expect(redirectSystemPath({ path: 'seazn-capture://stream', initial: false })).toBeNull();
    expect(redirectSystemPath({ path: '/', initial: false })).toBeNull();
  });
});
