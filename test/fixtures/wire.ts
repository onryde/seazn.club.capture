/**
 * Made-up wire payloads (spec Ask). Never paste a real code into a test: a
 * stream code's `tok` is a lasting bearer (amendment, Known gaps).
 */

/** The same instant as TEST_NOW in test/fakePorts.ts, kept here so node tests need no fake ports. */
export const FIXTURE_NOW = new Date('2026-10-03T13:00:00Z');

export const epochSeconds = (at: Date): number => Math.floor(at.getTime() / 1000);
const minutesFromNow = (minutes: number) => new Date(FIXTURE_NOW.getTime() + minutes * 60_000);

/** 12 characters of the code alphabet and 22 of base64url (capture-qr.v2 at web 5bb72e8a2). */
export const FIXTURE_CODE = 'fx42hmnp7k2q';
export const FIXTURE_TOKEN = 'tok-9f3c2a7e5b1d4680ab';
/** FNV-1a 32 of FIXTURE_TOKEN, as `wire/token-tag-vectors.json` pins it. */
export const FIXTURE_TOKEN_TAG = 'b24bb97b';

/** The stable code's QR (A1): a code and its camera position, no credentials. */
export function captureWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 2,
    code: FIXTURE_CODE,
    slot: 1,
    exp: epochSeconds(minutesFromNow(240)),
    tok: FIXTURE_TOKEN,
    ...overrides,
  };
}

/** The only secret a QR carries now. Tests assert it never reaches a record or a snapshot. */
export const FIXTURE_SECRETS: readonly string[] = [FIXTURE_TOKEN];

export const captureRaw = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify(captureWire(overrides));
