import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STAGE_KINDS } from '@/domain/credentials/waitingFields';
import shared from './wire/stage-kinds.json';

type Json = Record<string, unknown>;
const contract = JSON.parse(
  readFileSync(
    new URL('../../../test/fixtures/contracts/capture-descriptor.v1.json', import.meta.url),
    'utf8',
  ),
) as { oneOf: Json[] };

const at = (value: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((node, key) => (node as Json | undefined)?.[key], value);

/** `stage.role.kind`'s description in every branch of the descriptor that carries a stage. */
const descriptions = contract.oneOf
  .map((branch) =>
    at(branch, 'properties', 'stage', 'properties', 'role', 'properties', 'kind', 'description'),
  )
  .filter((text): text is string => typeof text === 'string');

/** The backticked words of the description: today's values, which the contract calls an OPEN string. */
const listed = (text: string) => [...text.matchAll(/`([a-z0-9_]+)`/g)].map((match) => match[1]);

describe('the stage role kinds: the contract, the shared file and the app agree (R-F20)', () => {
  it('finds the description in all 6 branches of the descriptor, and they say the same 15', () => {
    expect(contract.oneOf).toHaveLength(6);
    expect(descriptions).toHaveLength(6);
    const first = listed(descriptions[0] ?? '');
    expect(first).toHaveLength(15);
    for (const text of descriptions) expect(listed(text)).toEqual(first);
  });

  it('the shared file lists exactly the contract’s kinds, in its order', () => {
    expect(shared.kinds).toEqual(listed(descriptions[0] ?? ''));
  });

  it('the TS set is the shared file’s, no more and no fewer', () => {
    expect([...STAGE_KINDS].sort()).toEqual([...shared.kinds].sort());
    expect(STAGE_KINDS.size).toBe(15);
  });
});
