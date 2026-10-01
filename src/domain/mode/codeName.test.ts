import { describe, expect, it } from 'vitest';
import { NO_NAME, sameCode, savedCodeName, type CodeName } from '@/domain/mode/codeName';
import { captureRaw, FIXTURE_SID } from '../../../test/fixtures/wire';
import { savedStreamCode } from '../../../test/fixtures/savedStream';

/** FNV-1a 32 of the fixture token, computed with an independent Python FNV-1a. */
const FIXTURE_TAG = 'e5da86ff';

describe('savedCodeName (I1, C7, N2)', () => {
  it('names a saved code by its descriptor sid, its slot and its token tag, never the token', () => {
    const name = savedCodeName(savedStreamCode());
    expect(name).toEqual({ sid: FIXTURE_SID, slot: 1, tokenTag: FIXTURE_TAG });
    expect(JSON.stringify(name)).not.toContain('fake-token');
  });

  it('knows no sid without a descriptor', () => {
    expect(savedCodeName(savedStreamCode({ descriptor: null }))).toEqual({
      sid: null,
      slot: 1,
      tokenTag: FIXTURE_TAG,
    });
  });

  it('knows no token tag for a raw it cannot read', () => {
    expect(savedCodeName(savedStreamCode({ raw: 'not a capture code' })).tokenTag).toBeNull();
  });

  it('tags a re-issued code apart from the first', () => {
    const reissued = savedStreamCode({
      raw: captureRaw({ tok: 'fake-token-reissued-00000000000' }),
    });
    expect(savedCodeName(reissued).tokenTag).toBe('2bdf2246');
  });
});

describe('sameCode', () => {
  const A1: CodeName = { sid: 'a', slot: 1, tokenTag: 't1' };
  it.each<[string, CodeName, CodeName, boolean]>([
    ['the same code', A1, { ...A1 }, true],
    ['another match', { ...A1, sid: 'b' }, A1, false],
    ['another slot', { ...A1, slot: 2 }, A1, false],
    ['another issue', { ...A1, tokenTag: 't2' }, A1, false],
    ['a held session with no sid', { ...A1, sid: null }, A1, false],
    ['a held session with no slot', { ...A1, slot: null }, A1, false],
    ['a held session with no tag', { ...A1, tokenTag: null }, A1, false],
    ['nothing named on either side', NO_NAME, NO_NAME, false],
    ['no sid on either side', { ...A1, sid: null }, { ...A1, sid: null }, false],
    ['no slot on either side', { ...A1, slot: null }, { ...A1, slot: null }, false],
    ['no tag on either side', { ...A1, tokenTag: null }, { ...A1, tokenTag: null }, false],
  ])('%s → %s', (_, held, code, expected) => {
    expect(sameCode(held, code)).toBe(expected);
  });
});
