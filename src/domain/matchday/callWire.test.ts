import { describe, expect, it } from 'vitest';
import {
  callRequest,
  parseCalled,
  parseCallPreview,
  parseCallRefusal,
  parseCandidates,
  parseUncalled,
  CALL_WORDS,
} from '@/domain/matchday/callWire';
import {
  answered,
  contractAdmits,
  copyOf,
  fixtureOf,
  fixturesOf,
  refusedWith,
  schemaOf,
} from '../../../test/matchDayContracts';

/**
 * capture-matchday-call.v1 (S4 Match Day design §7a; owner 2026-11-13), vendored at web 17a33079f1: a free court's
 * candidates (the root), the call's preview, the call, its Undo, the request's body and the refusals only these routes
 * answer. Every expected value is typed from the contract's fixtures or its text, never computed by the parser under
 * test.
 */
const CALL = 'capture-matchday-call.v1';

type Wire = { candidates: { match: Record<string, unknown>; blocked: unknown }[] } & Record<
  string,
  unknown
>;
const wire = (name: string): Wire => copyOf(fixtureOf(CALL, name)) as Wire;
const names = fixturesOf(CALL).map(([name]) => name);
const named = (prefix: string) => names.filter((name) => name.startsWith(prefix));

const COURT = '7b1e4c2a-3d5f-4a6b-8c9d-0e1f2a3b4c5d';
const ROW = {
  sportKey: 'badminton',
  divisionName: "Men's Doubles",
  roundLabel: 'R2',
  roundTag: 'R2',
  homeSlot: null,
  awaySlot: null,
  status: 'upcoming',
  summary: null,
};

describe('parseCandidates reads the root fixtures', () => {
  const root = names.filter((name) => /^(valid|invalid)/.test(name));

  it('accounts for every root fixture: valid, refused, or read without an unknown field', () => {
    expect(root.sort()).toEqual(
      [
        'valid',
        'valid-none',
        'invalid-blocked-no-person',
        'invalid-match-carries-url',
        'invalid-source',
      ].sort(),
    );
  });

  it('reads valid field for field: three candidates, one on each source, the last blocked', () => {
    const result = parseCandidates(answered(fixtureOf(CALL, 'valid')));
    expect(contractAdmits(CALL, fixtureOf(CALL, 'valid'))).toBe(true);
    expect(result).toEqual({
      ok: true,
      value: {
        courtId: COURT,
        courtName: 'Court 1',
        candidates: [
          {
            match: {
              ...ROW,
              fixtureId: '0a1b2c3d-4e5f-4a6b-9c8d-7e6f5a4b3c2d',
              home: 'Ann & Bob',
              away: 'Cat & Dan',
              scheduledAt: new Date('2026-11-07T11:30:00.000Z'),
            },
            source: 'thisCourt',
            fromCourtName: null,
            called: false,
            plannedAt: new Date('2026-11-07T11:30:00.000Z'),
            waitingMinutes: 0,
            behindMinutes: 0,
            blocked: null,
          },
          {
            match: {
              ...ROW,
              fixtureId: '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e',
              home: 'Eve & Fay',
              away: 'Gus & Hal',
              scheduledAt: null,
            },
            source: 'noCourt',
            fromCourtName: null,
            called: false,
            plannedAt: null,
            waitingMinutes: 0,
            behindMinutes: 0,
            blocked: null,
          },
          {
            match: {
              ...ROW,
              fixtureId: '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f',
              home: 'Ann & Cat',
              away: 'Eve & Gus',
              scheduledAt: new Date('2026-11-07T11:00:00.000Z'),
            },
            source: 'otherCourt',
            fromCourtName: 'Court 2',
            called: true,
            plannedAt: new Date('2026-11-07T11:00:00.000Z'),
            waitingMinutes: 25,
            behindMinutes: 10,
            blocked: { personName: 'Ann Archer', courtName: 'Court 3' },
          },
        ],
      },
    });
  });

  it('reads valid-none as no candidate, not as a refusal', () => {
    expect(contractAdmits(CALL, fixtureOf(CALL, 'valid-none'))).toBe(true);
    expect(parseCandidates(answered(fixtureOf(CALL, 'valid-none')))).toEqual({
      ok: true,
      value: { courtId: COURT, courtName: 'Court 2', candidates: [] },
    });
  });

  it.each([
    ['invalid-blocked-no-person', 'candidates[2].blocked.person_name', 'missing-field'],
    ['invalid-source', 'candidates[0].source', 'invalid-field'],
  ])('%s: the contract and the phone both refuse it, naming %s', (name, field, kind) => {
    expect(contractAdmits(CALL, fixtureOf(CALL, name))).toBe(false);
    const result = parseCandidates(answered(fixtureOf(CALL, name)));
    expect(result.ok ? null : result.error).toMatchObject({ kind, field });
  });

  it('invalid-match-carries-url: refused by the contract only for its extra field, which the phone drops', () => {
    const data = wire('invalid-match-carries-url');
    expect(contractAdmits(CALL, data)).toBe(false);
    const stripped = wire('invalid-match-carries-url');
    delete stripped.candidates[0]?.match.url;
    expect(contractAdmits(CALL, stripped)).toBe(true);
    const read = parseCandidates(answered(data));
    expect(read).toEqual(parseCandidates(answered(stripped)));
    expect(read.ok).toBe(true);
    expect(JSON.stringify(read)).not.toContain('seazn.club/x');
  });

  it.each([
    ['court_id', 'court_id'],
    ['court_name', 'court_name'],
    ['candidates', 'candidates'],
  ])('without %s', (key, field) => {
    const data = wire('valid');
    delete data[key];
    const result = parseCandidates(answered(data));
    expect(result.ok ? null : result.error).toEqual({ kind: 'missing-field', field });
  });

  it.each([
    'source',
    'from_court_name',
    'planned_at',
    'waiting_minutes',
    'behind_minutes',
    'blocked',
    'match',
  ])('a candidate without %s', (key) => {
    const data = wire('valid');
    delete (data.candidates[0] as Record<string, unknown>)[key];
    const result = parseCandidates(answered(data));
    expect(result.ok ? null : result.error).toEqual({
      kind: 'missing-field',
      field: `candidates[0].${key}`,
    });
  });

  it('reads called as written, and absent as false (a web before the field)', () => {
    const read = (mutate: (c: Record<string, unknown>) => void) => {
      const data = wire('valid');
      mutate(data.candidates[2] as Record<string, unknown>);
      const result = parseCandidates(answered(data));
      return result.ok ? result.value.candidates[2]?.called : result.error;
    };
    expect(read(() => undefined)).toBe(true);
    expect(read((c) => (c.called = false))).toBe(false);
    expect(read((c) => delete c.called)).toBe(false);
  });

  it('refuses a called that is not a boolean, or null', () => {
    for (const bad of ['yes', 1, null]) {
      const data = wire('valid');
      (data.candidates[2] as Record<string, unknown>).called = bad;
      const result = parseCandidates(answered(data));
      expect(result.ok ? null : result.error).toMatchObject({ field: 'candidates[2].called' });
    }
  });

  it('a candidate with minutes that are not whole, or negative', () => {
    for (const bad of [-1, 1.5, '3']) {
      const data = wire('valid');
      (data.candidates[0] as Record<string, unknown>).waiting_minutes = bad;
      const result = parseCandidates(answered(data));
      expect(result.ok ? null : result.error).toMatchObject({
        field: 'candidates[0].waiting_minutes',
      });
    }
    const zero = wire('valid');
    expect(parseCandidates(answered(zero)).ok).toBe(true);
  });

  it('a blocked that is not player_busy', () => {
    const data = wire('valid');
    (data.candidates[2]!.blocked as Record<string, unknown>).kind = 'tired';
    const result = parseCandidates(answered(data));
    expect(result.ok ? null : result.error).toMatchObject({
      field: 'candidates[2].blocked.kind',
    });
  });

  it('a blocked on no court reads its court as null', () => {
    const data = wire('valid');
    (data.candidates[2]!.blocked as Record<string, unknown>).court_name = null;
    const result = parseCandidates(answered(data));
    expect(result.ok && result.value.candidates[2]?.blocked).toEqual({
      personName: 'Ann Archer',
      courtName: null,
    });
  });

  it('a row with an empty seat reads its slot words, as the day does', () => {
    const data = wire('valid');
    Object.assign(data.candidates[0]!.match, {
      home: null,
      home_slot: 'Winner of SF·1',
    });
    const result = parseCandidates(answered(data));
    expect(result.ok && result.value.candidates[0]?.match).toMatchObject({
      home: null,
      homeSlot: 'Winner of SF·1',
    });
  });

  it.each([null, 'x', 3, [], { ok: false }, { ok: true, data: [] }])('%j is no answer', (body) => {
    expect(parseCandidates(body).ok).toBe(false);
  });
});

describe('parseCallPreview', () => {
  it('accounts for every preview fixture', () => {
    expect(named('preview-').sort()).toEqual(
      ['preview-invalid-unknown-warning', 'preview-valid', 'preview-valid-quiet'].sort(),
    );
  });

  it('reads preview-valid: its shift and each of the five warnings', () => {
    const data = fixtureOf(CALL, 'preview-valid');
    expect(contractAdmits(CALL, data, '/$defs/preview')).toBe(true);
    expect(parseCallPreview(answered(data))).toEqual({
      ok: true,
      value: {
        shifts: [
          {
            fixtureId: '0a1b2c3d-4e5f-4a6b-9c8d-7e6f5a4b3c2d',
            label: 'Ann & Bob v Cat & Dan',
            roundLabel: 'R2',
            plannedAt: new Date('2026-11-07T11:30:00.000Z'),
            estimatedAt: new Date('2026-11-07T11:45:00.000Z'),
          },
        ],
        warnings: [
          { kind: 'pushesLater', count: 1 },
          { kind: 'restGap', personName: 'Eve Ellis', minutes: 5, minRest: 20 },
          { kind: 'pastDayEnd', courtName: 'Court 1', until: new Date('2026-11-07T21:00:00.000Z') },
          {
            kind: 'crossesClosure',
            courtName: 'Court 1',
            from: new Date('2026-11-07T12:00:00.000Z'),
            until: new Date('2026-11-07T13:00:00.000Z'),
          },
          {
            kind: 'courtClosed',
            courtName: 'Court 1',
            until: null,
            since: new Date('2026-11-07T20:00:00.000Z'),
          },
        ],
      },
    });
  });

  it('reads preview-valid-quiet as no warning', () => {
    const data = fixtureOf(CALL, 'preview-valid-quiet');
    expect(contractAdmits(CALL, data, '/$defs/preview')).toBe(true);
    const result = parseCallPreview(answered(data));
    expect(result.ok && result.value.warnings).toEqual([]);
  });

  it('refuses preview-invalid-unknown-warning, naming the warning', () => {
    const data = fixtureOf(CALL, 'preview-invalid-unknown-warning');
    expect(contractAdmits(CALL, data, '/$defs/preview')).toBe(false);
    const result = parseCallPreview(answered(data));
    expect(result.ok ? null : result.error).toMatchObject({
      kind: 'invalid-field',
      field: 'warnings[0].kind',
    });
  });

  it.each([
    [{ kind: 'pushes_later', count: 0 }, 'warnings[0].count'],
    [{ kind: 'pushes_later' }, 'warnings[0].count'],
    [{ kind: 'rest_gap', person_name: 'A', minutes: 5, min_rest: 0 }, 'warnings[0].min_rest'],
    [{ kind: 'past_day_end', court_name: 'C', until: 'soon' }, 'warnings[0].until'],
    [
      { kind: 'crosses_closure', court_name: 'C', from: '2026-11-07T12:00:00Z' },
      'warnings[0].until',
    ],
    [{ kind: 'court_closed', court_name: 'C', until: null }, 'warnings[0].since'],
    ['pushes_later', 'warnings[0]'],
  ])('refuses the warning %j at %s', (warning, field) => {
    const data = copyOf(fixtureOf(CALL, 'preview-valid-quiet')) as Record<string, unknown>;
    data.warnings = [warning];
    expect(contractAdmits(CALL, data, '/$defs/preview')).toBe(false);
    const result = parseCallPreview(answered(data));
    expect(result.ok ? null : result.error).toMatchObject({ field });
  });

  it.each(['shifts', 'warnings'])('without %s', (key) => {
    const data = copyOf(fixtureOf(CALL, 'preview-valid')) as Record<string, unknown>;
    delete data[key];
    const result = parseCallPreview(answered(data));
    expect(result.ok ? null : result.error).toEqual({ kind: 'missing-field', field: key });
  });
});

describe('parseCalled and parseUncalled', () => {
  it('accounts for every call and undo fixture', () => {
    expect(named('call-').sort()).toEqual(['call-invalid-no-called-at', 'call-valid']);
    expect(named('undo-').sort()).toEqual(['undo-valid', 'undo-valid-no-court']);
  });

  it('reads call-valid', () => {
    const data = fixtureOf(CALL, 'call-valid');
    expect(contractAdmits(CALL, data, '/$defs/call')).toBe(true);
    expect(parseCalled(answered(data))).toEqual({
      ok: true,
      value: {
        fixtureId: '0a1b2c3d-4e5f-4a6b-9c8d-7e6f5a4b3c2d',
        courtId: COURT,
        calledAt: new Date('2026-11-07T10:30:00.000Z'),
      },
    });
  });

  it('refuses call-invalid-no-called-at, naming the field', () => {
    const data = fixtureOf(CALL, 'call-invalid-no-called-at');
    expect(contractAdmits(CALL, data, '/$defs/call')).toBe(false);
    const result = parseCalled(answered(data));
    expect(result.ok ? null : result.error).toEqual({ kind: 'missing-field', field: 'called_at' });
  });

  it('reads undo-valid and undo-valid-no-court', () => {
    expect(contractAdmits(CALL, fixtureOf(CALL, 'undo-valid'), '/$defs/undo')).toBe(true);
    expect(contractAdmits(CALL, fixtureOf(CALL, 'undo-valid-no-court'), '/$defs/undo')).toBe(true);
    expect(parseUncalled(answered(fixtureOf(CALL, 'undo-valid')))).toEqual({
      ok: true,
      value: {
        fixtureId: '0a1b2c3d-4e5f-4a6b-9c8d-7e6f5a4b3c2d',
        courtId: COURT,
        scheduledAt: new Date('2026-11-07T11:30:00.000Z'),
      },
    });
    expect(parseUncalled(answered(fixtureOf(CALL, 'undo-valid-no-court')))).toEqual({
      ok: true,
      value: {
        fixtureId: '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e',
        courtId: null,
        scheduledAt: null,
      },
    });
  });

  it.each(['fixture_id', 'court_id', 'scheduled_at'])('an undo without %s', (key) => {
    const data = copyOf(fixtureOf(CALL, 'undo-valid')) as Record<string, unknown>;
    delete data[key];
    const result = parseUncalled(answered(data));
    expect(result.ok ? null : result.error).toEqual({ kind: 'missing-field', field: key });
  });

  it('a fixture id that is no id is refused in both answers', () => {
    const call = copyOf(fixtureOf(CALL, 'call-valid')) as Record<string, unknown>;
    call.fixture_id = '../x';
    expect(parseCalled(answered(call)).ok).toBe(false);
    const undo = copyOf(fixtureOf(CALL, 'undo-valid')) as Record<string, unknown>;
    undo.fixture_id = '../x';
    expect(parseUncalled(answered(undo)).ok).toBe(false);
  });
});

describe('callRequest', () => {
  it('accounts for every request fixture', () => {
    expect(named('request-').sort()).toEqual([
      'request-invalid-extra-key',
      'request-invalid-no-preview',
      'request-valid-call',
      'request-valid-preview',
    ]);
  });

  it.each([
    ['request-valid-preview', true],
    ['request-valid-call', false],
  ])('writes what %s is', (name, preview) => {
    const fixture = fixtureOf(CALL, name);
    expect(contractAdmits(CALL, fixture, '/$defs/request')).toBe(true);
    expect(callRequest(COURT, preview)).toEqual(fixture);
  });

  it('the contract refuses an extra key and a missing preview, which the phone never writes', () => {
    expect(
      contractAdmits(CALL, fixtureOf(CALL, 'request-invalid-extra-key'), '/$defs/request'),
    ).toBe(false);
    expect(
      contractAdmits(CALL, fixtureOf(CALL, 'request-invalid-no-preview'), '/$defs/request'),
    ).toBe(false);
    for (const preview of [true, false]) {
      expect(contractAdmits(CALL, callRequest(COURT, preview), '/$defs/request')).toBe(true);
    }
  });
});

describe('parseCallRefusal', () => {
  /** Each refusal fixture, its status from the contract's text, and the word the phone reads, or null. */
  const EXPECTED: Readonly<Record<string, readonly [number, unknown]>> = {
    'refusal-valid-no-call': [403, { code: 'MD_NO_CALL' }],
    'refusal-valid-out-of-scope': [403, { code: 'MD_OUT_OF_SCOPE' }],
    'refusal-valid-not-open': [
      403,
      { code: 'MD_NOT_OPEN', opensAt: new Date('2026-11-06T23:00:00.000Z') },
    ],
    'refusal-valid-not-called': [
      409,
      {
        code: 'MD_CALL_REFUSED',
        reason: 'notCalled',
        personName: null,
        courtName: null,
      },
    ],
    'refusal-valid-player-busy': [
      409,
      {
        code: 'MD_CALL_REFUSED',
        reason: 'playerBusy',
        personName: 'Ann Archer',
        courtName: 'Court 3',
      },
    ],
    'refusal-valid-not-code-call': [
      409,
      { code: 'MD_CALL_REFUSED', reason: 'notCodeCall', personName: null, courtName: null },
    ],
    'refusal-invalid-approval-word': [403, null],
    'refusal-invalid-desk-word': [409, null],
    // A later web's reason: the contract refuses it, the phone reads it as a refusal it has no word for (final review m4),
    // never as offline.
    'refusal-invalid-unknown-reason': [
      409,
      { code: 'MD_CALL_REFUSED', reason: 'unknown', personName: null, courtName: null },
    ],
    // Refused by the contract only for a reason on a word that has none: the phone reads the word.
    'refusal-invalid-reason-on-no-call': [403, { code: 'MD_NO_CALL' }],
  };

  it('accounts for every refusal fixture', () => {
    expect(named('refusal-').sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(Object.entries(EXPECTED))('%s', (name, [status, expected]) => {
    const error = fixtureOf(CALL, name);
    const body = refusedWith(error);
    expect(parseCallRefusal(status, body)).toEqual(expected);
    if (name !== 'refusal-invalid-reason-on-no-call') {
      expect(contractAdmits(CALL, error, '/$defs/refusal')).toBe(name.startsWith('refusal-valid'));
    }
  });

  it('the six words are the contract’s own list, less the desk’s', () => {
    const schema = schemaOf(CALL) as unknown as {
      $defs: { refusal: { anyOf: { properties: { code: { enum?: string[] } } }[] } };
    };
    const words = schema.$defs.refusal.anyOf.flatMap((arm) => arm.properties.code.enum ?? []);
    expect([...CALL_WORDS].sort()).toEqual([...words].sort());
  });

  it('reads every status of 4xx and nothing else', () => {
    const body = refusedWith(fixtureOf(CALL, 'refusal-valid-no-call'));
    expect(parseCallRefusal(403, body)).not.toBeNull();
    expect(parseCallRefusal(400, body)).not.toBeNull();
    expect(parseCallRefusal(499, body)).not.toBeNull();
    for (const status of [200, 399, 500, 503]) expect(parseCallRefusal(status, body)).toBeNull();
  });

  it.each([
    null,
    'x',
    [],
    { ok: true, error: { code: 'MD_NO_CALL' } },
    { ok: false },
    { ok: false, error: 'MD_NO_CALL' },
    { ok: false, error: { code: 'NOT_FOUND' } },
    { error: { code: 'MD_NO_CALL' } },
  ])('%j is not a call refusal', (body) => {
    expect(parseCallRefusal(403, body)).toBeNull();
  });

  it('refuses a person or court name of the wrong type, and an opens_at that is no instant', () => {
    const refused = (over: Record<string, unknown>) =>
      parseCallRefusal(
        409,
        refusedWith({ code: 'MD_CALL_REFUSED', reason: 'player_busy', ...over }),
      );
    expect(refused({ person_name: 5 })).toBeNull();
    expect(refused({ person_name: null })).toBeNull();
    expect(refused({ court_name: 5 })).toBeNull();
    expect(refused({ court_name: null })).toMatchObject({ courtName: null });
    expect(
      parseCallRefusal(403, refusedWith({ code: 'MD_NOT_OPEN', opens_at: 'tomorrow' })),
    ).toBeNull();
    expect(parseCallRefusal(403, refusedWith({ code: 'MD_NOT_OPEN' }))).toEqual({
      code: 'MD_NOT_OPEN',
    });
  });

  it('hands opens_at on with MD_NOT_OPEN alone', () => {
    const at = '2026-11-06T23:00:00.000Z';
    expect(parseCallRefusal(403, refusedWith({ code: 'MD_ENDED', opens_at: at }))).toEqual({
      code: 'MD_ENDED',
    });
  });
});
