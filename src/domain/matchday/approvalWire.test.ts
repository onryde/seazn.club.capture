import { describe, expect, it } from 'vitest';
import { approveRequest, parseApproval, parseApproved } from '@/domain/matchday/approvalWire';
import {
  answered,
  contractAdmits,
  copyOf,
  fixtureOf,
  fixturesOf,
  refusedWith,
} from '../../../test/matchDayContracts';

/**
 * capture-matchday-approval.v1 (S4 Match Day design §7, §9.5), vendored at web 7c15a5a78: the review a ticked code
 * reads (GET), the approve's body (`$defs.request`) and its 200 (`$defs.ok`). Every expected value is typed from the
 * contract's fixtures or its text, never computed by the parser under test. Its refusals are refusalWire.test.ts's.
 */
const APPROVAL = 'capture-matchday-approval.v1';

/** A fixture's `data` with its fields reachable for a test to change. */
type Wire = Record<string, unknown> & { rows: Record<string, unknown>[] };
const wire = (name: string): Wire => copyOf(fixtureOf(APPROVAL, name)) as Wire;
const read = (data: unknown) => parseApproval(answered(data));
const errorOf = (data: unknown) => {
  const result = read(data);
  return result.ok ? null : result.error;
};

/** valid-swiss's hash and valid-draw's, typed from the fixtures: the approve hands each back unchanged. */
const SWISS_HASH = '3f6c1e0b9a8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b';
const DRAW_HASH = '8c3d4e5f-6a7b-4c8d-8e9f-1a2b3c4d5e6f';
const SWISS_STAGE = '6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const DRAW_STAGE = '7b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e';

/** What the phone reads from each valid review: typed from the fixture, field by field. */
const VALID: Readonly<Record<string, unknown>> = {
  'valid-swiss': {
    kind: 'swiss',
    stageId: SWISS_STAGE,
    divisionName: 'Open',
    round: 4,
    rows: [
      { label: 'R4 1', home: 'Anna de Vries', away: 'Bram Jansen' },
      { label: 'R4 2', home: 'Chloé Martin', away: 'Daan Visser' },
      { label: 'R4 3', home: 'Eva Bakker', away: null },
    ],
    hash: SWISS_HASH,
    ties: false,
  },
  'valid-draw': {
    kind: 'draw',
    stageId: DRAW_STAGE,
    divisionName: 'Mixed doubles',
    round: null,
    rows: [
      { label: 'SF 1', home: 'Anna / Bram', away: 'Chloé / Daan' },
      { label: 'SF 2', home: 'Eva / Finn', away: 'Gina / Hugo' },
    ],
    hash: DRAW_HASH,
    ties: false,
  },
  'valid-draw-ties': {
    kind: 'draw',
    stageId: DRAW_STAGE,
    divisionName: 'Mixed doubles',
    round: null,
    rows: [{ label: 'F', home: 'Anna / Bram', away: 'Chloé / Daan' }],
    hash: '9d4e5f6a-7b8c-4d9e-9f0a-2b3c4d5e6f7a',
    ties: true,
  },
};

/** What the phone says of each review the contract refuses: the field it names, never the value. */
const REFUSED: Readonly<Record<string, unknown>> = {
  'invalid-no-hash': { kind: 'missing-field', field: 'hash' },
  'invalid-round-zero': { kind: 'invalid-field', field: 'round', reason: expect.any(String) },
  'invalid-row-no-home': {
    kind: 'invalid-field',
    field: 'rows[0].home',
    reason: expect.any(String),
  },
};

/**
 * Refused by the contract only for a property it does not name: the phone ignores an unknown field, so it reads it
 * without the field. A row carrying a scoring link is the case that matters: the link is dropped, never kept.
 */
const EXTRA_FIELD: Readonly<Record<string, (data: Wire) => void>> = {
  'invalid-row-carries-url': (data) => {
    delete data.rows[0]?.url;
  },
};

/** The approve's 200 (`$defs.ok`): what the phone reads from each. */
const OK: Readonly<Record<string, boolean>> = { 'ok-valid': true, 'ok-invalid-false': false };

/** The approve's body (`$defs.request`): the phone writes these, never reads them. */
const REQUEST: Readonly<Record<string, boolean>> = {
  'request-valid-swiss': true,
  'request-valid-draw': true,
  'request-valid-draw-null-round': true,
  'request-invalid-no-hash': false,
  'request-invalid-tie-picks': false,
};

const fixtures = fixturesOf(APPROVAL).filter(([name]) => !name.startsWith('refusal-'));

describe('parseApproval runs every capture-matchday-approval.v1 fixture', () => {
  it('accounts for every fixture but the refusals: review, approve body, approve answer', () => {
    const named = [
      ...Object.keys(VALID),
      ...Object.keys(REFUSED),
      ...Object.keys(EXTRA_FIELD),
      ...Object.keys(OK),
      ...Object.keys(REQUEST),
    ];
    expect(fixtures.map(([name]) => name).sort()).toEqual(named.sort());
  });

  it.each(Object.entries(VALID))(
    '%s: the contract admits it and the phone reads it as typed',
    (name, value) => {
      const data = fixtureOf(APPROVAL, name);
      expect(contractAdmits(APPROVAL, data)).toBe(true);
      expect(read(data)).toEqual({ ok: true, value });
    },
  );

  it.each(Object.entries(REFUSED))(
    '%s: the contract and the phone both refuse it',
    (name, error) => {
      const data = fixtureOf(APPROVAL, name);
      expect(contractAdmits(APPROVAL, data)).toBe(false);
      expect(errorOf(data)).toEqual(error);
    },
  );

  it.each(Object.entries(EXTRA_FIELD))(
    '%s: refused by the contract only for its extra field, which the phone reads without',
    (name, strip) => {
      const data = wire(name);
      expect(contractAdmits(APPROVAL, data)).toBe(false);
      const stripped = copyOf(data);
      strip(stripped);
      expect(contractAdmits(APPROVAL, stripped)).toBe(true);
      const result = read(data);
      if (!result.ok) throw new Error('the review was refused');
      expect(result.value.rows).toEqual([
        { label: 'F', home: 'Anna / Bram', away: 'Chloé / Daan' },
      ]);
      expect(JSON.stringify(result.value)).not.toContain('dl_');
      expect(JSON.stringify(result.value)).not.toContain('score/');
    },
  );
});

describe('parseApproval refuses a missing field and ignores an unknown one', () => {
  it.each(['kind', 'stage_id', 'division_name', 'round', 'rows', 'hash', 'ties'])(
    'a review without %s',
    (key) => {
      const data = wire('valid-swiss');
      delete data[key];
      expect(errorOf(data)).toEqual({ kind: 'missing-field', field: key });
    },
  );

  it.each(['label', 'home', 'away'])('a row without %s', (key) => {
    const data = wire('valid-swiss');
    delete data.rows[2]?.[key];
    expect(errorOf(data)).toEqual({ kind: 'missing-field', field: `rows[2].${key}` });
  });

  it('a field the contract does not name, on the review or a row, is ignored', () => {
    const data = wire('valid-draw');
    data.added_later = { at: 1 };
    if (data.rows[1] !== undefined) data.rows[1].seed = 3;
    expect(read(data)).toEqual({ ok: true, value: VALID['valid-draw'] });
  });

  it('a second read of the same body is the same', () => {
    const body = answered(fixtureOf(APPROVAL, 'valid-swiss'));
    expect(parseApproval(body)).toEqual(parseApproval(body));
  });

  it('an empty round: no rows is read as none, not refused', () => {
    const data = wire('valid-swiss');
    data.rows = [];
    expect(contractAdmits(APPROVAL, data)).toBe(true);
    const result = read(data);
    expect(result.ok && result.value.rows).toEqual([]);
  });
});

describe('parseApproval holds each field to the contract', () => {
  it.each([
    ['kind', 'knockout'],
    ['kind', 'Swiss'],
    ['stage_id', 'stage-1'],
    ['stage_id', `../${SWISS_STAGE}`],
    ['stage_id', `${SWISS_STAGE}/../x`],
    ['division_name', 7],
    ['round', 0],
    ['round', 1.5],
    ['round', '4'],
    ['rows', 'none'],
    ['hash', ''],
    ['hash', 42],
    ['hash', ['h']],
    ['ties', 'false'],
  ])('refuses %s %j, and the contract does too', (key, value) => {
    const data = wire('valid-swiss');
    data[key] = value;
    expect(contractAdmits(APPROVAL, data)).toBe(false);
    expect(errorOf(data)).toEqual({
      kind: 'invalid-field',
      field: key,
      reason: expect.any(String),
    });
  });

  it.each([
    ['label', ''],
    ['home', null],
    ['away', 3],
  ])('refuses a row whose %s is %j, and the contract does too', (key, value) => {
    const data = wire('valid-swiss');
    if (data.rows[1] !== undefined) data.rows[1][key] = value;
    expect(contractAdmits(APPROVAL, data)).toBe(false);
    expect(errorOf(data)).toEqual({
      kind: 'invalid-field',
      field: `rows[1].${key}`,
      reason: expect.any(String),
    });
  });

  it('a row that is not an object is refused', () => {
    const data = wire('valid-swiss');
    data.rows = ['R4 1'] as unknown as Record<string, unknown>[];
    expect(errorOf(data)).toEqual({
      kind: 'invalid-field',
      field: 'rows[0]',
      reason: expect.any(String),
    });
  });

  // The contract's maxLength 128: the approve hands the hash back, and the server's own check of its body refuses one
  // longer (`$defs.request.hash`).
  it('reads a hash of 128 characters, and refuses one of 129, as the contract does', () => {
    const at = (length: number) => ({ ...wire('valid-swiss'), hash: 'h'.repeat(length) });
    expect(contractAdmits(APPROVAL, at(128))).toBe(true);
    const longest = read(at(128));
    expect(longest.ok && longest.value.hash).toBe('h'.repeat(128));
    expect(contractAdmits(APPROVAL, at(129))).toBe(false);
    expect(errorOf(at(129))).toEqual({
      kind: 'invalid-field',
      field: 'hash',
      reason: expect.any(String),
    });
  });

  it('reads an empty division name and an empty side as the text they are: the contract sets no minimum', () => {
    const data = wire('valid-swiss');
    data.division_name = '';
    if (data.rows[0] !== undefined) data.rows[0].home = '';
    expect(contractAdmits(APPROVAL, data)).toBe(true);
    const result = read(data);
    if (!result.ok) throw new Error('the review was refused');
    expect(result.value.divisionName).toBe('');
    expect(result.value.rows[0]?.home).toBe('');
  });

  it('reads a one-character hash, the contract’s shortest', () => {
    const data = { ...wire('valid-draw'), hash: 'h' };
    expect(contractAdmits(APPROVAL, data)).toBe(true);
    const result = read(data);
    expect(result.ok && result.value.hash).toBe('h');
  });

  it('a stage id in capitals is still a uuid', () => {
    const data = { ...wire('valid-swiss'), stage_id: SWISS_STAGE.toUpperCase() };
    expect(contractAdmits(APPROVAL, data)).toBe(true);
    const result = read(data);
    expect(result.ok && result.value.stageId).toBe(SWISS_STAGE.toUpperCase());
  });
});

describe('parseApproval reads the v1 success envelope and nothing else', () => {
  it.each([
    ['the review with no envelope', fixtureOf(APPROVAL, 'valid-swiss')],
    ['a refusal', refusedWith(fixtureOf(APPROVAL, 'refusal-valid-ties'))],
    ['null', null],
    ['a page', '<html>Sign in to the Wi-Fi</html>'],
  ])('%s is no review', (_, body) => {
    expect(parseApproval(body).ok).toBe(false);
  });
});

describe('parseApproved reads the approve’s 200', () => {
  it.each(Object.entries(OK))(
    '%s: the contract says %s, and so does the phone',
    (name, admitted) => {
      const data = fixtureOf(APPROVAL, `${name}`);
      expect(contractAdmits(APPROVAL, data, '/$defs/ok')).toBe(admitted);
      expect(parseApproved(answered(data)).ok).toBe(admitted);
    },
  );

  it('ok-valid is read as approved', () => {
    expect(parseApproved(answered(fixtureOf(APPROVAL, 'ok-valid')))).toEqual({
      ok: true,
      value: { ok: true },
    });
  });

  it.each([
    ['ok missing', {}, { kind: 'missing-field', field: 'ok' }],
    [
      'ok as text',
      { ok: 'true' },
      { kind: 'invalid-field', field: 'ok', reason: expect.any(String) },
    ],
    ['ok false', { ok: false }, { kind: 'invalid-field', field: 'ok', reason: expect.any(String) }],
  ])('refuses %s', (_, data, error) => {
    expect(parseApproved(answered(data))).toEqual({ ok: false, error });
  });

  it('ignores a field the contract does not name', () => {
    expect(parseApproved(answered({ ok: true, added_later: 1 }))).toEqual({
      ok: true,
      value: { ok: true },
    });
  });

  it.each([
    ['the answer with no envelope', { ok: true }],
    ['the envelope with no data', { ok: true, requestId: 'req-made-up' }],
    ['a refusal', refusedWith({ code: 'MD_ALREADY', message: 'm' })],
  ])('%s is not approved', (_, body) => {
    expect(parseApproved(body).ok).toBe(false);
  });
});

describe('approveRequest writes the approve’s body as the contract’s fixtures do', () => {
  it.each(Object.entries(REQUEST))('%s: the contract says %s', (name, admitted) => {
    expect(contractAdmits(APPROVAL, fixtureOf(APPROVAL, name), '/$defs/request')).toBe(admitted);
  });

  it('a Swiss round: the hash and its round (request-valid-swiss)', () => {
    const body = approveRequest(SWISS_HASH, 4);
    expect(body).toEqual(fixtureOf(APPROVAL, 'request-valid-swiss'));
    expect(contractAdmits(APPROVAL, body, '/$defs/request')).toBe(true);
  });

  it('a draw: the hash and a null round (request-valid-draw-null-round), never omitted', () => {
    const body = approveRequest(DRAW_HASH, null);
    expect(body).toEqual(fixtureOf(APPROVAL, 'request-valid-draw-null-round'));
    expect(contractAdmits(APPROVAL, body, '/$defs/request')).toBe(true);
    expect(Object.keys(body)).toEqual(['hash', 'round']);
  });
});
