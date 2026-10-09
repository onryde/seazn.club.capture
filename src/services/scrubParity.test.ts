import { describe, expect, it } from 'vitest';
import list from '../../modules/capture-engine/src/scrub/allow-list.json';
import vectors from '../../modules/capture-engine/src/scrub/vectors.json';
import { createLogger } from '@/services/logger';
import {
  NEVER_KEYS,
  PLAIN_KEYS,
  PLAIN_WORD,
  PUBLIC_URL_KEYS,
  SCRUBBED,
  TEXT_KEYS,
  scrubEvent,
  type LogFields,
} from '@/services/scrub';
import { RESERVED_KEYS, createRingRecord } from '@/services/sessionRecord';

/**
 * A row through the production path, as native's runner writes one: the
 * logger protects `held` twice (a second code, or StrictMode's re-run of the
 * protecting effect, protects again), scrubs, and the record writes the flat
 * line, a reserved key as `field_<key>` (CD7).
 */
function written(event: string, fields: LogFields = {}): Record<string, unknown> {
  const record = createRingRecord();
  const logger = createLogger({ record, now: () => 0 });
  logger.protect(vectors.held);
  logger.protect(vectors.held);
  logger.info(event, fields);
  return JSON.parse(record.lines()[0] ?? '{}') as Record<string, unknown>;
}

describe('carry 11: one scrub, pinned by the file native reads too', () => {
  it('keeps the shared key sets, word rule and marker', () => {
    expect([...PLAIN_KEYS].sort()).toEqual([...list.plain].sort());
    expect([...PUBLIC_URL_KEYS].sort()).toEqual([...list.publicUrl].sort());
    expect([...TEXT_KEYS].sort()).toEqual([...list.text].sort());
    expect([...NEVER_KEYS].sort()).toEqual([...list.never].sort());
    expect([...RESERVED_KEYS].sort()).toEqual([...list.reserved].sort());
    // The word rule is the file's too, character for character (review I1).
    expect(PLAIN_WORD.source).toBe(list.plainWord);
    expect(SCRUBBED).toBe(list.mask);
  });

  // The files' row counts, so an emptied or truncated file cannot pass by sweeping nothing (PV12).
  it('sweeps all 48 shared cases and 4 shared kinds', () => {
    expect(vectors.cases).toHaveLength(48);
    expect(vectors.kinds).toHaveLength(4);
  });

  // The written name comes from the file's reserved list, not the code under test.
  it.each(vectors.cases.map((c) => [c.why, c] as const))('%s', (_why, c) => {
    const writtenAs = list.reserved.includes(c.key) ? `field_${c.key}` : c.key;
    // A path array, so a key is never read as a dotted path; a missing key fails here, not as undefined.
    expect(written('probe', { [c.key]: c.value } as LogFields)).toHaveProperty(
      [writtenAs],
      c.expected,
    );
  });

  it.each(vectors.kinds.map((c) => [c.why, c] as const))('event: %s', (_why, c) => {
    expect(written(c.value).kind).toBe(c.expected);
  });

  // Beyond the brief: the kind rule is one rule on both sides, so each kind the record holds
  // passes JS's event rule as itself too: the core's 63, and JS's malformed-snapshot line (C4c I-4).
  it("passes each of the record's 87 kinds as itself", () => {
    const kinds = Object.keys(list.kinds);
    expect(kinds).toHaveLength(87);
    for (const kind of kinds) expect(scrubEvent(kind, vectors.held)).toBe(kind);
  });
});
