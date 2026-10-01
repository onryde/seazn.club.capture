import { describe, expect, it } from 'vitest';
import { tokenTag } from '@/domain/credentials/tokenTag';

describe('tokenTag (N2: which issue of a code native holds, never the token)', () => {
  // FNV-1a 32-bit reference vectors (Noll's FNV test suite); 'cfx' was found
  // with an independent Python FNV-1a, for a tag that needs its zero padding.
  it.each([
    ['', '811c9dc5'],
    ['a', 'e40c292c'],
    ['foobar', 'bf9cf968'],
    ['cfx', '0076912c'],
  ])('tags %j as %s', (token, tag) => {
    expect(tokenTag(token)).toBe(tag);
  });

  it('is eight hex digits, zero-padded, and never contains the token', () => {
    const token = 'fake-token-00000000000000000000';
    const tag = tokenTag(token);
    expect(tag).toMatch(/^[0-9a-f]{8}$/);
    expect(tag).not.toContain('fake');
  });

  it('tells a re-issued token from the first', () => {
    expect(tokenTag('fake-token-00000000000000000000')).not.toBe(
      tokenTag('fake-token-00000000000000000001'),
    );
  });
});
