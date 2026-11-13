import { readdirSync, readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

/**
 * The web's Match Day contracts as the domain tests read them: vendored by `pnpm contracts:vendor` and pinned by
 * contractPins.test.ts. Each contract's root is the v1 envelope's `data`, and its `$defs.refusal` is the envelope's
 * `error` (the contracts' own descriptions), so a test wraps a fixture in the envelope the server sends it in.
 */
export type MatchDayContract =
  | 'capture-matchday-day.v1'
  | 'capture-matchday-open.v1'
  | 'capture-matchday-approval.v1'
  | 'capture-matchday-call.v1';

const CONTRACTS = new URL('../contracts/', import.meta.url);

const readJson = (url: URL): unknown => JSON.parse(readFileSync(url, 'utf8'));

/** Every fixture of a contract, by name (its file name without `.json`), in name order. */
export function fixturesOf(contract: MatchDayContract): readonly (readonly [string, unknown])[] {
  const folder = new URL(`fixtures/${contract}/`, CONTRACTS);
  return readdirSync(folder)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => [file.replace(/\.json$/, ''), readJson(new URL(file, folder))] as const);
}

/** One fixture of a contract, by name. */
export function fixtureOf(contract: MatchDayContract, name: string): unknown {
  return readJson(new URL(`fixtures/${contract}/${name}.json`, CONTRACTS));
}

/** The contract's schema, as the web wrote it. */
export function schemaOf(contract: MatchDayContract): {
  readonly $id: string;
  readonly $defs: {
    readonly refusal: { readonly properties: { readonly code: { readonly enum: string[] } } };
  };
} {
  return readJson(new URL(`${contract}.json`, CONTRACTS)) as ReturnType<typeof schemaOf>;
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
for (const contract of [
  'capture-matchday-day.v1',
  'capture-matchday-open.v1',
  'capture-matchday-approval.v1',
  'capture-matchday-call.v1',
] as const) {
  ajv.addSchema(schemaOf(contract) as object);
}

/**
 * Whether the contract admits a value: at its root (the envelope's `data`), at `/$defs/refusal` (its `error`), or, in
 * the approval contract, at `/$defs/request` (the approve's body) or `/$defs/ok` (the approve's `data`); in the call contract, at `/$defs/request`, `/$defs/preview`, `/$defs/call` or
 * `/$defs/undo`.
 */
export function contractAdmits(
  contract: MatchDayContract,
  value: unknown,
  pointer:
    | ''
    | '/$defs/refusal'
    | '/$defs/request'
    | '/$defs/ok'
    | '/$defs/preview'
    | '/$defs/call'
    | '/$defs/undo' = '',
): boolean {
  const id = schemaOf(contract).$id;
  const validate = ajv.getSchema(pointer === '' ? id : `${id}#${pointer}`);
  if (validate === undefined) throw new Error(`no schema at ${contract}${pointer}`);
  return validate(value) === true;
}

/** A 200's body: `{ok: true, data, requestId}`. */
export const answered = (data: unknown) => ({ ok: true, data, requestId: 'req-made-up' });

/** A refusal's body: `{ok: false, error, requestId}`. */
export const refusedWith = (error: unknown) => ({ ok: false, error, requestId: 'req-made-up' });

/** A deep copy of a fixture, to change one field of without touching the next test's. */
export const copyOf = <T>(value: T): T => structuredClone(value);
