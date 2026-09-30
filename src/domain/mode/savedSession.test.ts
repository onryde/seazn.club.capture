import { describe, expect, it } from 'vitest';
import { sessionFromSaved } from '@/domain/mode/savedSession';
import { savedStreamCode } from '../../../test/fixtures/savedStream';

describe('sessionFromSaved', () => {
  it('builds the session arm needs', () => {
    const result = sessionFromSaved(savedStreamCode());
    expect(result).toMatchObject({
      ok: true,
      value: {
        slot: 1,
        primary: { transport: 'srt' },
        fallback: { transport: 'rtmps' },
        token: 'fake-token-00000000000000000000',
        descriptor: { label: 'Seazn XI v Fake CC' },
      },
    });
  });

  it('says when the saved raw no longer parses', () => {
    expect(sessionFromSaved(savedStreamCode({ raw: '{"fake":true}' }))).toEqual({
      ok: false,
      error: 'unreadable-code',
    });
    expect(sessionFromSaved(savedStreamCode({ raw: 'not json' }))).toEqual({
      ok: false,
      error: 'unreadable-code',
    });
  });

  it('says when there is no descriptor', () => {
    expect(sessionFromSaved(savedStreamCode({ descriptor: null }))).toEqual({
      ok: false,
      error: 'no-descriptor',
    });
  });
});
