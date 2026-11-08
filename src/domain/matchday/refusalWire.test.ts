import { describe, expect, it } from 'vitest';
import { MATCHDAY_REFUSALS } from '@/domain/matchday/matchDay';
import { parseRefusal } from '@/domain/matchday/refusalWire';
import {
  answered,
  contractAdmits,
  fixtureOf,
  fixturesOf,
  refusedWith,
  schemaOf,
  type MatchDayContract,
} from '../../../test/matchDayContracts';

/**
 * Every md_ route refuses in one shape, the v1 envelope's `error`: `{ok: false, error: {code, message, opens_at?}}`,
 * the code one of a closed list of nine (`$defs.refusal` of capture-matchday-day.v1, capture-matchday-open.v1 and
 * capture-matchday-approval.v1). The envelope's own answers (429 RATE_LIMITED, 404 NOT_FOUND, 422) are not md_
 * refusals: the port reads them by status.
 */
const CONTRACTS: readonly MatchDayContract[] = [
  'capture-matchday-day.v1',
  'capture-matchday-open.v1',
  'capture-matchday-approval.v1',
];

/** Each refusal fixture, its status from its contract's text, and the word the phone reads, or null. */
const EXPECTED: Readonly<
  Record<string, Readonly<Record<string, readonly [number, string | null]>>>
> = {
  'capture-matchday-day.v1': {
    'refusal-invalid-envelope-word': [429, null],
    'refusal-invalid-no-code': [410, null],
    'refusal-invalid-opens-at-local': [403, null],
    'refusal-valid-not-open': [403, 'MD_NOT_OPEN'],
    'refusal-valid-withdrawn': [410, 'MD_WITHDRAWN'],
  },
  'capture-matchday-open.v1': {
    'refusal-invalid-no-code': [403, null],
    'refusal-invalid-not-found': [404, null],
    'refusal-valid-not-open': [403, 'MD_NOT_OPEN'],
    'refusal-valid-out-of-scope': [403, 'MD_OUT_OF_SCOPE'],
  },
  'capture-matchday-approval.v1': {
    'refusal-invalid-seeding-word': [409, null],
    'refusal-valid-no-approve': [403, 'MD_NO_APPROVE'],
    'refusal-valid-ties': [409, 'MD_TIES'],
  },
};

const NINE = [
  'MD_UNKNOWN',
  'MD_WITHDRAWN',
  'MD_ENDED',
  'MD_NOT_OPEN',
  'MD_OUT_OF_SCOPE',
  'MD_NO_APPROVE',
  'MD_STALE',
  'MD_ALREADY',
  'MD_TIES',
];

const refusal = (error: Record<string, unknown>) => refusedWith({ message: 'm', ...error });

describe.each(CONTRACTS)('parseRefusal runs every %s refusal fixture', (contract) => {
  const refusals = fixturesOf(contract).filter(([name]) => name.startsWith('refusal-'));

  it('accounts for every refusal fixture', () => {
    expect(refusals.map(([name]) => name)).toEqual(Object.keys(EXPECTED[contract] ?? {}).sort());
  });

  it.each(refusals)('%s', (name, error) => {
    const [status, word] = EXPECTED[contract]?.[name] ?? [0, 'not listed'];
    expect(contractAdmits(contract, error, '/$defs/refusal')).toBe(word !== null);
    expect(name.startsWith('refusal-valid-')).toBe(word !== null);
    expect(parseRefusal(status, refusedWith(error))?.code ?? null).toBe(word);
  });
});

describe('parseRefusal reads the nine words, and only them', () => {
  it.each(CONTRACTS)("the nine are %s's closed list, and the phone's", (contract) => {
    expect(schemaOf(contract).$defs.refusal.properties.code.enum).toEqual(NINE);
    expect(MATCHDAY_REFUSALS).toEqual(NINE);
  });

  /** Each at the status its contract's refusal description gives (the approval contract's for the last four). */
  it.each([
    [401, 'MD_UNKNOWN'],
    [410, 'MD_WITHDRAWN'],
    [410, 'MD_ENDED'],
    [403, 'MD_NOT_OPEN'],
    [403, 'MD_OUT_OF_SCOPE'],
    [403, 'MD_NO_APPROVE'],
    [409, 'MD_STALE'],
    [409, 'MD_ALREADY'],
    [409, 'MD_TIES'],
  ])('%s %s', (status, code) => {
    expect(parseRefusal(status, refusal({ code }))).toEqual({ code });
  });

  it.each([
    [429, 'RATE_LIMITED'],
    [404, 'NOT_FOUND'],
    [400, 'VALIDATION'],
    [410, 'md_ended'],
    [410, 'MD_ENDED '],
    [410, ''],
  ])('refuses %s %s: not an md_ word', (status, code) => {
    expect(parseRefusal(status, refusal({ code }))).toBeNull();
  });

  it('refuses a code that is not text', () => {
    expect(parseRefusal(410, refusal({ code: ['MD_ENDED'] }))).toBeNull();
  });
});

describe('parseRefusal reads a refusal status only', () => {
  it.each([400, 403, 499])('%s is a refusal status', (status) => {
    expect(parseRefusal(status, refusal({ code: 'MD_ENDED' }))).toEqual({ code: 'MD_ENDED' });
  });

  it.each([200, 201, 399, 500, 503])('%s is not', (status) => {
    expect(parseRefusal(status, refusal({ code: 'MD_ENDED' }))).toBeNull();
  });
});

describe('parseRefusal reads the v1 error envelope and nothing else', () => {
  it.each([
    ['a success', answered({ code: 'MD_ENDED', message: 'm' })],
    ['a bare error with no envelope', { code: 'MD_ENDED', message: 'm' }],
    ['ok as text', { ok: 'false', error: { code: 'MD_ENDED', message: 'm' } }],
    ['an error that is text', { ok: false, error: 'MD_ENDED' }],
    ['no error', { ok: false, requestId: 'r' }],
    ['null', null],
    ['a page', '<html>Sign in to the Wi-Fi</html>'],
  ])('%s is not a refusal', (_, body) => {
    expect(parseRefusal(410, body)).toBeNull();
  });

  it('ignores a field the contract does not name', () => {
    expect(parseRefusal(410, refusal({ code: 'MD_ENDED', added_later: { at: 1 } }))).toEqual({
      code: 'MD_ENDED',
    });
  });

  it('reads a refusal with no message: the phone never shows it', () => {
    expect(parseRefusal(401, refusedWith({ code: 'MD_UNKNOWN' }))).toEqual({ code: 'MD_UNKNOWN' });
  });
});

describe("parseRefusal holds MD_NOT_OPEN's opens_at to a UTC instant, and hands it on", () => {
  it('reads MD_NOT_OPEN with its opens_at, as the instant it names', () => {
    const body = refusal({ code: 'MD_NOT_OPEN', opens_at: '2026-11-07T23:00:00.000Z' });
    expect(parseRefusal(403, body)).toEqual({
      code: 'MD_NOT_OPEN',
      opensAt: new Date(Date.UTC(2026, 10, 7, 23, 0, 0)),
    });
  });

  it('reads MD_NOT_OPEN without one: the contract makes it optional', () => {
    const read = parseRefusal(403, refusal({ code: 'MD_NOT_OPEN' }));
    expect(read).toEqual({ code: 'MD_NOT_OPEN' });
    expect(read !== null && 'opensAt' in read).toBe(false);
  });

  // The contract's opens_at is MD_NOT_OPEN's only ("MD_NOT_OPEN only"): on another word it is held to the same form,
  // and never handed on, so no other refusal says when a day opens.
  it('hands on no opens_at with another word', () => {
    const body = refusal({ code: 'MD_ENDED', opens_at: '2026-11-07T23:00:00.000Z' });
    const read = parseRefusal(410, body);
    expect(read).toEqual({ code: 'MD_ENDED' });
    expect(read !== null && 'opensAt' in read).toBe(false);
  });

  it.each([
    ['local time', '2026-11-08T00:00:00'],
    ['an offset', '2026-11-08T00:00:00+01:00'],
    ['a day that is not in the calendar', '2026-11-31T00:00:00Z'],
    ['a number', 1_762_556_400],
    ['null', null],
  ])('refuses an opens_at in %s', (_, opensAt) => {
    expect(parseRefusal(403, refusal({ code: 'MD_NOT_OPEN', opens_at: opensAt }))).toBeNull();
  });

  it('a second read of the same body is the same', () => {
    const body = refusal({ code: 'MD_NOT_OPEN', opens_at: '2026-11-07T23:00:00.000Z' });
    expect(parseRefusal(403, body)).toEqual(parseRefusal(403, body));
  });
});
