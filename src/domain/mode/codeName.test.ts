import { describe, expect, it } from 'vitest';
import { NO_NAME, sameCode, savedCodeName, type CodeName } from '@/domain/mode/codeName';
import { captureRaw, FIXTURE_CODE, FIXTURE_TOKEN } from '../../../test/fixtures/wire';
import { savedStreamCode } from '../../../test/fixtures/savedStream';

/** FNV-1a 32 of the fixture token, from an independent FNV-1a (token-tag-vectors.json pins it). */
const FIXTURE_TAG = 'b24bb97b';

describe('savedCodeName (amendment, Identity rules in JS)', () => {
  it('names a saved code by its code, its slot and its token tag, never the token', () => {
    const name = savedCodeName(savedStreamCode());
    expect(name).toEqual({ code: FIXTURE_CODE, slot: 1, tokenTag: FIXTURE_TAG });
    expect(JSON.stringify(name)).not.toContain(FIXTURE_TOKEN);
  });

  it('reads the slot from the QR, not the saved field', () => {
    const saved = savedStreamCode({ raw: captureRaw({ slot: 3 }), slot: 1 });
    expect(savedCodeName(saved).slot).toBe(3);
  });

  it('names nothing for a raw it cannot read', () => {
    expect(savedCodeName(savedStreamCode({ raw: 'not a capture code' }))).toEqual(NO_NAME);
  });

  it('tags a re-issued code apart from the first', () => {
    const reissued = savedStreamCode({ raw: captureRaw({ tok: 'tok-reissued-000000000' }) });
    // From an independent FNV-1a, outside the code under test.
    expect(savedCodeName(reissued).tokenTag).toBe('cd2b4f7d');
  });
});

describe('sameCode', () => {
  const A1: CodeName = { code: 'a', slot: 1, tokenTag: 't1' };
  it.each<[string, CodeName, CodeName, boolean]>([
    ['the same code', A1, { ...A1 }, true],
    ['another code', { ...A1, code: 'b' }, A1, false],
    ['another slot', { ...A1, slot: 2 }, A1, false],
    ['another issue', { ...A1, tokenTag: 't2' }, A1, false],
    ['a held pairing with no code', { ...A1, code: null }, A1, false],
    ['a held pairing with no slot', { ...A1, slot: null }, A1, false],
    ['a held pairing with no tag', { ...A1, tokenTag: null }, A1, false],
    ['nothing named on either side', NO_NAME, NO_NAME, false],
    ['no code on either side', { ...A1, code: null }, { ...A1, code: null }, false],
    ['no slot on either side', { ...A1, slot: null }, { ...A1, slot: null }, false],
    ['no tag on either side', { ...A1, tokenTag: null }, { ...A1, tokenTag: null }, false],
  ])('%s → %s', (_, held, code, expected) => {
    expect(sameCode(held, code)).toBe(expected);
  });
});
