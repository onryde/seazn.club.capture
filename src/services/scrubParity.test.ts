import { describe, expect, it } from 'vitest';
import list from '../../modules/capture-engine/src/scrub/allow-list.json';
import vectors from '../../modules/capture-engine/src/scrub/vectors.json';
import {
  NEVER_KEYS,
  PLAIN_KEYS,
  PUBLIC_URL_KEYS,
  SCRUBBED,
  TEXT_KEYS,
  scrubEvent,
  scrubFields,
  type LogFields,
} from '@/services/scrub';

describe('carry 11: one scrub, pinned by the file native reads too', () => {
  it('keeps the shared key sets and marker', () => {
    expect([...PLAIN_KEYS].sort()).toEqual([...list.plain].sort());
    expect([...PUBLIC_URL_KEYS].sort()).toEqual([...list.publicUrl].sort());
    expect([...TEXT_KEYS].sort()).toEqual([...list.text].sort());
    expect([...NEVER_KEYS].sort()).toEqual([...list.never].sort());
    expect(SCRUBBED).toBe(list.mask);
  });

  // The files' row counts, so an emptied or truncated file cannot pass by sweeping nothing (PV12).
  it('sweeps all 27 shared cases and 3 shared kinds', () => {
    expect(vectors.cases).toHaveLength(27);
    expect(vectors.kinds).toHaveLength(3);
  });

  it.each(vectors.cases.map((c) => [c.why, c] as const))('%s', (_why, c) => {
    const fields = { [c.key]: c.value } as LogFields;
    expect(scrubFields(fields, vectors.held)[c.key]).toEqual(c.expected);
  });

  it.each(vectors.kinds.map((c) => [c.why, c] as const))('event: %s', (_why, c) => {
    expect(scrubEvent(c.value, vectors.held)).toBe(c.expected);
  });

  // Beyond the brief: the kind rule is one rule on both sides, so each kind the core writes
  // passes JS's event rule as itself too.
  it('passes each of the 52 record kinds the core writes as itself', () => {
    const kinds = Object.keys(list.kinds);
    expect(kinds).toHaveLength(52);
    for (const kind of kinds) expect(scrubEvent(kind, vectors.held)).toBe(kind);
  });
});
