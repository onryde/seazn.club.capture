import { describe, expect, it } from 'vitest';
import { parseStreamCode } from '@/domain/credentials/streamCode';
import vectors from './wire/code-vectors.json';

// Carry G1: the QR's code and tok are held to capture-qr.v2's patterns at the scan, on the rows
// PairRequest.problems() is held to in Kotlin (CodeVectorsTest.kt). A bad QR is refused, never saved.
const qr = (overrides: Record<string, unknown>) => ({
  v: 2,
  code: 'fx42hmnp7k2q',
  slot: 1,
  tok: 'tok-9f3c2a7e5b1d4680ab',
  ...overrides,
});

describe('the QR code and token: one rule in two languages', () => {
  // The file's row counts, so an emptied or truncated file cannot pass by sweeping nothing (PV12).
  it('sweeps all 17 codes and 14 tokens, each list with rows of both verdicts', () => {
    expect(vectors.codes).toHaveLength(17);
    expect(vectors.tokens).toHaveLength(14);
    for (const rows of [vectors.codes, vectors.tokens]) {
      expect(new Set(rows.map((row) => row.ok))).toEqual(new Set([true, false]));
    }
  });

  it.each(vectors.codes.map((row) => [row.why, row] as const))('code: %s', (_why, row) => {
    expect(parseStreamCode(qr({ code: row.value })).ok).toBe(row.ok);
  });

  it.each(vectors.tokens.map((row) => [row.why, row] as const))('token: %s', (_why, row) => {
    expect(parseStreamCode(qr({ tok: row.value })).ok).toBe(row.ok);
  });
});
