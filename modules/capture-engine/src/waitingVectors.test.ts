import { describe, expect, it } from 'vitest';
import { parseWaitingFields } from '@/domain/credentials/waitingFields';
import { seaznHosts } from '@/services/seaznHosts';
import vectors from './wire/waiting-vectors.json';

const inSeconds = (at: Date | null) => (at === null ? null : at.getTime() / 1000);

// The kotlinOnly rows are a beat's answer, which only native reads (the file's own `about`).
const rows = vectors.cases.filter((row) => !('kotlinOnly' in row && row.kotlinOnly === true));

describe('the waiting fields: one reading in two languages (Bodies.waiting in Kotlin)', () => {
  // The file's counts, so an emptied or truncated file cannot pass by sweeping nothing (PV12).
  it("sweeps 39 of the file's 41 rows, readable and unreadable both", () => {
    expect(vectors.cases).toHaveLength(41);
    expect(rows).toHaveLength(39);
    expect(rows.filter((row) => row.expected === null)).toHaveLength(19);
  });

  it.each(rows.map((row) => [row.why, row] as const))('%s', (_why, row) => {
    const read = parseWaitingFields(row.fields, seaznHosts(row.env)[0] ?? '');
    const seen = read === null ? null : { ...read, scheduledStart: inSeconds(read.scheduledStart) };
    expect(seen).toEqual(row.expected);
  });
});
