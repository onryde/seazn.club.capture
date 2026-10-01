import { describe, expect, it } from 'vitest';
import { tokenTag } from '@/domain/credentials/tokenTag';
import vectors from './wire/token-tag-vectors.json';

describe('carry 2: one token tag in two languages', () => {
  // The file's row count, so an emptied or truncated file cannot pass by sweeping nothing (PV12).
  it('sweeps all 8 shared vectors', () => {
    expect(vectors.vectors).toHaveLength(8);
  });

  it.each(vectors.vectors.map((row) => [row.token, row.tag] as const))(
    'tags %j as %s, as TokenTag.kt does',
    (token, tag) => {
      expect(tokenTag(token)).toBe(tag);
    },
  );
});
