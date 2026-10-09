import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import vectors from './wire/scoring-link-vectors.json';

const contract = JSON.parse(
  readFileSync(new URL('../../../contracts/capture-scoring-link.v1.json', import.meta.url), 'utf8'),
) as { $id: string };
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(contract);
const ok = ajv.getSchema(`${contract.$id}#/$defs/ok`)!;
const refusal = ajv.getSchema(`${contract.$id}#/$defs/refusal`)!;

// A 2xx body is held to $defs.ok and anything else to $defs.refusal, unless the row says the contract refuses it too.
const rows = vectors.cases.filter((row) => 'body' in row);

describe('the made-up scoring-link bodies are the contract’s shapes', () => {
  it('sweeps 18 of the 19 rows (the portal page has no JSON body)', () => {
    expect(vectors.cases).toHaveLength(19);
    expect(rows).toHaveLength(18);
  });

  it.each(rows.map((row) => [row.why, row] as const))('%s', (_why, row) => {
    const validate = row.status >= 200 && row.status < 300 ? ok : refusal;
    const expectedValid = (row as { contractValid?: boolean }).contractValid ?? true;
    expect(validate(row.body)).toBe(expectedValid);
  });
});
