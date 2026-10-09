import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseWaitingFields } from '@/domain/credentials/waitingFields';

/**
 * Plan D spec §3.2: the web's round-line fixtures (the label reshaped on 2026-10-08) through the TS waiting-fields
 * parser. The labels are the spec's and the fixtures' own text, written out here; StageFixturesTest.kt holds
 * Bodies.waiting to the same four.
 */
const FIXTURES = new URL('../../../contracts/fixtures/capture-descriptor.v1/', import.meta.url);
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURES), 'utf8')) as Record<string, unknown>;
const STAGING = 'stg.seazn.club';

describe("the web's round-line fixtures, through parseWaitingFields (plan D §3.2)", () => {
  it.each([
    ['valid-waiting-stage', 'Open · Group A · Round 1'],
    ['valid-live-stage', 'Open · QF'],
    ['valid-waiting-stage-label-40', 'Girls Under-14 Championship · Round 1234'],
  ])('%s shows its label verbatim', (name, label) => {
    expect(parseWaitingFields(fixture(name), STAGING)?.stage?.label).toBe(label);
  });

  it('shows 40 characters and no line at 41, the rest of the answer still read', () => {
    expect([...'Girls Under-14 Championship · Round 1234']).toHaveLength(40);
    const raw = fixture('invalid-stage-label-41');
    expect([...(raw.stage as { label: string }).label]).toHaveLength(41);
    const read = parseWaitingFields(raw, STAGING);
    expect(read).not.toBeNull();
    expect(read?.stage).toBeNull();
    expect(read?.label).toBe('Northside Hawks v Riverside Rovers');
  });
});
