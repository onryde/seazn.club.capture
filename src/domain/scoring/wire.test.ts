import { describe, expect, it } from 'vitest';
import {
  matchContextOf,
  parseAppendAnswer,
  parseBootstrap,
  parseEvents,
  parseFailure,
  parseRealtimeGrant,
  parseRules,
} from '@/domain/scoring/wire';

/**
 * The shapes are the web's v1 envelope as the endpoint and the scouted routes answer them (web onryde/seazn.club#1102,
 * `edc1076dba`): `{ok:true, data, requestId}` and `{ok:false, error:{code, message, ...extras}, requestId}`. Every id
 * and name is made up.
 */
const REQUEST_ID = '0d6c1c1e-6f3e-4f56-9a43-5b1d2f2a9c11';
const FIXTURE = '6f0c5a52-3d1e-4a0b-8f55-0c2f6d7b9e10';
const LINK = '9a7e4b83-1c52-4f9d-b0a6-7e3d5c1f2a44';

const CFG = { bestOf: 3, setTo: 21, finalSetTo: 21, winBy: 2, cap: 30 };

const singlesSide = (entrant: string, name: string, person: string) => ({
  entrant_id: entrant,
  name,
  kind: 'individual',
  members: [{ person_id: person, full_name: name }],
  lineup: [{ person_id: person, pair_order: null }],
});

const doublesSide = (entrant: string, name: string, one: string, two: string) => ({
  entrant_id: entrant,
  name,
  kind: 'pair',
  members: [
    { person_id: one, full_name: `${name} one` },
    { person_id: two, full_name: `${name} two` },
  ],
  lineup: [
    { person_id: one, pair_order: 1 },
    { person_id: two, pair_order: 2 },
  ],
});

const bootstrapData = (overrides: Record<string, unknown> = {}) => ({
  fixture_id: FIXTURE,
  link_id: LINK,
  sport_key: 'badminton',
  module_version: '1.0.0',
  cfg: CFG,
  rules_version: 2,
  engine_epoch_required: 2,
  screen: 'pad',
  view_only_reason: null,
  names: {
    competition: 'Spring Open 2026',
    division: 'U15 Boys Singles',
    round_label: 'Round 1',
    ref: 'QF·1',
  },
  sides: {
    home: singlesSide('ent-home', 'A. Sharma', 'p-sharma'),
    away: singlesSide('ent-away', 'L. Chen', 'p-chen'),
  },
  state: { status: 'in_progress', last_seq: 41 },
  ...overrides,
});

const envelope = (data: unknown) => ({ ok: true, data, requestId: REQUEST_ID });
const failure = (code: string, extras: Record<string, unknown> = {}) => ({
  ok: false,
  error: { code, message: 'a developer string', ...extras },
  requestId: REQUEST_ID,
});

describe('parseBootstrap', () => {
  it('reads every field of a singles match, the wire names turned into the app’s', () => {
    expect(parseBootstrap(envelope(bootstrapData()))).toEqual({
      fixtureId: FIXTURE,
      linkId: LINK,
      sportKey: 'badminton',
      moduleVersion: '1.0.0',
      cfg: CFG,
      rulesVersion: 2,
      epochRequired: 2,
      screen: 'pad',
      viewOnlyReason: null,
      context: {
        competition: 'Spring Open 2026',
        division: 'U15 Boys Singles',
        round: 'Round 1',
        match: 'QF·1',
      },
      sides: {
        home: {
          entrantId: 'ent-home',
          name: 'A. Sharma',
          kind: 'individual',
          members: [{ personId: 'p-sharma', fullName: 'A. Sharma' }],
          lineup: [{ personId: 'p-sharma', pairOrder: null }],
        },
        away: {
          entrantId: 'ent-away',
          name: 'L. Chen',
          kind: 'individual',
          members: [{ personId: 'p-chen', fullName: 'L. Chen' }],
          lineup: [{ personId: 'p-chen', pairOrder: null }],
        },
      },
      lastSeq: 41,
      status: 'in_progress',
    });
  });

  it('reads a doubles side: both members and each one’s pair order', () => {
    const parsed = parseBootstrap(
      envelope(
        bootstrapData({
          sides: {
            home: doublesSide('ent-h', 'Sharma/Iyer', 'p1', 'p2'),
            away: doublesSide('ent-a', 'Chen/Wong', 'p3', 'p4'),
          },
        }),
      ),
    );
    expect(parsed?.sides.home?.members.map((m) => m.personId)).toEqual(['p1', 'p2']);
    expect(parsed?.sides.home?.lineup).toEqual([
      { personId: 'p1', pairOrder: 1 },
      { personId: 'p2', pairOrder: 2 },
    ]);
    expect(parsed?.sides.away?.kind).toBe('pair');
  });

  // The endpoint answers a seat with no entrant (a bye, a waiting match) as null: a side the match does not have yet
  // is never made up.
  it('keeps a seat with no entrant as null, whichever seat it is', () => {
    const awayEmpty = parseBootstrap(
      envelope(
        bootstrapData({
          sides: { home: singlesSide('ent-home', 'A. Sharma', 'p'), away: null },
          screen: 'waiting',
        }),
      ),
    );
    expect(awayEmpty?.sides.away).toBeNull();
    expect(awayEmpty?.sides.home?.name).toBe('A. Sharma');
    const homeEmpty = parseBootstrap(
      envelope(
        bootstrapData({ sides: { home: null, away: singlesSide('ent-away', 'L. Chen', 'p') } }),
      ),
    );
    expect(homeEmpty?.sides.home).toBeNull();
    expect(homeEmpty?.sides.away?.name).toBe('L. Chen');
    const neither = parseBootstrap(envelope(bootstrapData({ sides: { home: null, away: null } })));
    expect(neither?.sides).toEqual({ home: null, away: null });
  });

  it.each([
    ['view_only', 'viewOnly'],
    ['division_not_started', 'divisionNotStarted'],
    ['waiting', 'waiting'],
    ['confirm', 'confirm'],
    ['pad', 'pad'],
  ])('reads the wire screen %s as %s', (wire, screen) => {
    expect(parseBootstrap(envelope(bootstrapData({ screen: wire })))?.screen).toBe(screen);
  });

  it('says why a link is view only, when the server does', () => {
    const parsed = parseBootstrap(
      envelope(bootstrapData({ screen: 'view_only', view_only_reason: 'match_finalized' })),
    );
    expect(parsed?.viewOnlyReason).toBe('match_finalized');
  });

  it('reads a round, division or reference the organiser left out as null', () => {
    const parsed = parseBootstrap(
      envelope(
        bootstrapData({
          names: { competition: 'Spring Open 2026', division: null, round_label: null, ref: null },
        }),
      ),
    );
    expect(parsed?.context).toEqual({
      competition: 'Spring Open 2026',
      division: null,
      round: null,
      match: null,
    });
  });

  it('ignores a field it does not use, as every reader of the wire does', () => {
    expect(parseBootstrap(envelope(bootstrapData({ added_later: { x: 1 } })))).not.toBeNull();
  });

  it('takes an engine epoch floor of 0: no phone is behind it', () => {
    expect(
      parseBootstrap(envelope(bootstrapData({ engine_epoch_required: 0 })))?.epochRequired,
    ).toBe(0);
  });

  it('takes an engine epoch floor of the server’s own number, whatever it is', () => {
    expect(
      parseBootstrap(envelope(bootstrapData({ engine_epoch_required: 7 })))?.epochRequired,
    ).toBe(7);
  });

  it.each([
    ['an unknown screen word', bootstrapData({ screen: 'scoreboard' })],
    ['a screen that is no string', bootstrapData({ screen: 3 })],
    ['a screen named for an object property', bootstrapData({ screen: 'constructor' })],
    ['no fixture id', bootstrapData({ fixture_id: undefined })],
    ['an empty fixture id', bootstrapData({ fixture_id: '' })],
    ['no link id', bootstrapData({ link_id: undefined })],
    ['no sport', bootstrapData({ sport_key: undefined })],
    ['no cfg at all', bootstrapData({ cfg: undefined })],
    ['a rules version of text', bootstrapData({ rules_version: '2' })],
    ['a fractional rules version', bootstrapData({ rules_version: 1.5 })],
    ['a negative rules version', bootstrapData({ rules_version: -1 })],
    ['an engine floor of text', bootstrapData({ engine_epoch_required: '2' })],
    ['no engine floor', bootstrapData({ engine_epoch_required: undefined })],
    ['no names', bootstrapData({ names: undefined })],
    [
      'a competition that is no string',
      bootstrapData({ names: { competition: 4, division: null, round_label: null, ref: null } }),
    ],
    [
      'a division that is a number',
      bootstrapData({ names: { competition: 'C', division: 4, round_label: null, ref: null } }),
    ],
    ['no sides', bootstrapData({ sides: undefined })],
    ['a side that is a string', bootstrapData({ sides: { home: 'A', away: null } })],
    [
      'a side missing its entrant',
      bootstrapData({
        sides: { home: { ...singlesSide('e', 'n', 'p'), entrant_id: undefined }, away: null },
      }),
    ],
    [
      'a member with no name',
      bootstrapData({
        sides: {
          home: { ...singlesSide('e', 'n', 'p'), members: [{ person_id: 'p' }] },
          away: null,
        },
      }),
    ],
    [
      'a lineup slot with a pair order of text',
      bootstrapData({
        sides: {
          home: { ...singlesSide('e', 'n', 'p'), lineup: [{ person_id: 'p', pair_order: 'one' }] },
          away: null,
        },
      }),
    ],
    [
      'members that are no list',
      bootstrapData({
        sides: { home: { ...singlesSide('e', 'n', 'p'), members: {} }, away: null },
      }),
    ],
    ['no state', bootstrapData({ state: undefined })],
    ['a last seq of text', bootstrapData({ state: { status: 'x', last_seq: '41' } })],
    ['a negative last seq', bootstrapData({ state: { status: 'x', last_seq: -1 } })],
    ['no status', bootstrapData({ state: { last_seq: 1 } })],
    ['a view-only reason that is a number', bootstrapData({ view_only_reason: 5 })],
  ])('is null for %s', (_name, data) => {
    expect(parseBootstrap(envelope(data))).toBeNull();
  });

  it.each([
    ['null', null],
    ['text', 'ok'],
    ['an array', []],
    ['an envelope that says not ok', { ok: false, data: bootstrapData(), requestId: REQUEST_ID }],
    ['an envelope with no data', { ok: true, requestId: REQUEST_ID }],
    ['data that is an array', envelope([bootstrapData()])],
    ['data that is null', envelope(null)],
    ['the data without its envelope', bootstrapData()],
    ['an error envelope', failure('LINK_INVALID')],
  ])('is null for a body that is %s', (_name, body) => {
    expect(parseBootstrap(body)).toBeNull();
  });
});

describe('matchContextOf', () => {
  it('is the pad’s match context: the names as typed, the sides’ names top first', () => {
    const parsed = parseBootstrap(envelope(bootstrapData()));
    expect(parsed && matchContextOf(parsed)).toEqual({
      competition: 'Spring Open 2026',
      division: 'U15 Boys Singles',
      round: 'Round 1',
      match: 'QF·1',
      sides: ['A. Sharma', 'L. Chen'],
    });
  });

  it('is null while a seat has no entrant: a side is never made up for it', () => {
    const away = parseBootstrap(
      envelope(bootstrapData({ sides: { home: singlesSide('e', 'A. Sharma', 'p'), away: null } })),
    );
    const home = parseBootstrap(
      envelope(bootstrapData({ sides: { home: null, away: singlesSide('e', 'L. Chen', 'p') } })),
    );
    expect(away && matchContextOf(away)).toBeNull();
    expect(home && matchContextOf(home)).toBeNull();
  });
});

const wireEvent = (overrides: Record<string, unknown> = {}) => ({
  id: 'ev-1',
  seq: 1,
  type: 'core.start',
  payload: {},
  recorded_at: '2026-11-01T10:00:00.000Z',
  recorded_by: null,
  voids_event_id: null,
  device_link_id: null,
  ...overrides,
});

describe('parseEvents', () => {
  it('reads the ledger in order, the voided event’s id as `voids`', () => {
    const parsed = parseEvents(
      envelope([
        wireEvent(),
        wireEvent({
          id: 'ev-2',
          seq: 2,
          type: 'badminton.rally',
          payload: { wonBy: 'ent-home', serving: 'ent-home' },
          recorded_by: 'user-9',
          device_link_id: LINK,
        }),
        wireEvent({
          id: 'ev-3',
          seq: 3,
          type: 'core.void',
          payload: { event_id: 'ev-2' },
          voids_event_id: 'ev-2',
        }),
      ]),
    );
    expect(parsed).toEqual([
      {
        id: 'ev-1',
        seq: 1,
        type: 'core.start',
        payload: {},
        recordedAt: '2026-11-01T10:00:00.000Z',
        voids: null,
        deviceLinkId: null,
      },
      {
        id: 'ev-2',
        seq: 2,
        type: 'badminton.rally',
        payload: { wonBy: 'ent-home', serving: 'ent-home' },
        recordedAt: '2026-11-01T10:00:00.000Z',
        voids: null,
        deviceLinkId: LINK,
      },
      {
        id: 'ev-3',
        seq: 3,
        type: 'core.void',
        payload: { event_id: 'ev-2' },
        recordedAt: '2026-11-01T10:00:00.000Z',
        voids: 'ev-2',
        deviceLinkId: null,
      },
    ]);
  });

  // Nothing since the seq asked is a ledger, not a failure: the caller must tell it from null.
  it('reads an empty list as an empty ledger, not as garbage', () => {
    expect(parseEvents(envelope([]))).toEqual([]);
  });

  it('takes a ledger that starts after seq 1 (a fetch since seq 40)', () => {
    const parsed = parseEvents(
      envelope([wireEvent({ id: 'ev-41', seq: 41 }), wireEvent({ id: 'ev-42', seq: 42 })]),
    );
    expect(parsed?.map((e) => e.seq)).toEqual([41, 42]);
  });

  it.each([
    ['an event with no id', [wireEvent({ id: undefined })]],
    ['an event with an empty id', [wireEvent({ id: '' })]],
    ['a seq of zero', [wireEvent({ seq: 0 })]],
    ['a fractional seq', [wireEvent({ seq: 1.5 })]],
    ['a seq of text', [wireEvent({ seq: '1' })]],
    ['no type', [wireEvent({ type: undefined })]],
    ['a recorded_at that is no string', [wireEvent({ recorded_at: 5 })]],
    ['a voids_event_id that is a number', [wireEvent({ voids_event_id: 5 })]],
    ['a device_link_id that is a number', [wireEvent({ device_link_id: 5 })]],
    ['an element that is null', [wireEvent(), null]],
    [
      'a good event then a bad one: no ledger with a hole in it',
      [wireEvent(), wireEvent({ id: 'ev-2', seq: 2, type: 3 })],
    ],
    ['a repeated seq', [wireEvent(), wireEvent({ id: 'ev-2' })]],
    ['seqs out of order', [wireEvent({ id: 'ev-2', seq: 2 }), wireEvent()]],
  ])('is null for %s', (_name, events) => {
    expect(parseEvents(envelope(events))).toBeNull();
  });

  it.each([
    ['null', null],
    ['an object', {}],
    ['not ok', { ok: false, data: [], requestId: REQUEST_ID }],
    ['data that is an object', envelope({ events: [] })],
    ['a bare list with no envelope', [wireEvent()]],
  ])('is null for a body that is %s', (_name, body) => {
    expect(parseEvents(body)).toBeNull();
  });
});

describe('parseRules', () => {
  it('reads the cfg, its version and the rules line the organiser sees', () => {
    expect(
      parseRules(envelope({ cfg: CFG, rules_version: 3, format_line: 'Best of 3 games to 21' })),
    ).toEqual({ cfg: CFG, rulesVersion: 3, formatLine: 'Best of 3 games to 21' });
  });

  it('reads a missing rules line as null', () => {
    expect(
      parseRules(envelope({ cfg: CFG, rules_version: 3, format_line: null }))?.formatLine,
    ).toBeNull();
  });

  it.each([
    ['no cfg', envelope({ rules_version: 3, format_line: null })],
    ['a version of text', envelope({ cfg: CFG, rules_version: '3', format_line: null })],
    ['a negative version', envelope({ cfg: CFG, rules_version: -1, format_line: null })],
    ['a rules line that is a number', envelope({ cfg: CFG, rules_version: 3, format_line: 4 })],
    ['not ok', { ok: false, data: { cfg: CFG, rules_version: 3, format_line: null } }],
    ['data that is a list', envelope([])],
    ['null', null],
  ])('is null for %s', (_name, body) => {
    expect(parseRules(body)).toBeNull();
  });
});

describe('parseRealtimeGrant', () => {
  const grant = (overrides: Record<string, unknown> = {}) =>
    envelope({
      token: 'rt-token-made-up',
      channel: `fixture:${FIXTURE}`,
      url: 'https://abcdefgh.supabase.co',
      apikey: 'anon-key-made-up',
      ...overrides,
    });

  it('reads the token, the channel, and the project’s url and key the server sends', () => {
    expect(parseRealtimeGrant(grant())).toEqual({
      token: 'rt-token-made-up',
      channel: `fixture:${FIXTURE}`,
      url: 'https://abcdefgh.supabase.co',
      apikey: 'anon-key-made-up',
    });
  });

  // The route answers null for both while the web has none configured: no grant, so the phone polls.
  it.each([
    ['a null url', { url: null }],
    ['a null apikey', { apikey: null }],
    ['no url', { url: undefined }],
    ['no apikey', { apikey: undefined }],
    ['an empty url', { url: '' }],
    ['an empty apikey', { apikey: '' }],
    ['no token', { token: undefined }],
    ['no channel', { channel: undefined }],
    ['a token that is a number', { token: 5 }],
  ])('is null for %s', (_name, overrides) => {
    expect(parseRealtimeGrant(grant(overrides))).toBeNull();
  });

  it('is null for a body that is not the envelope', () => {
    expect(parseRealtimeGrant(null)).toBeNull();
    expect(parseRealtimeGrant({ ok: false })).toBeNull();
    expect(parseRealtimeGrant(envelope('token'))).toBeNull();
  });
});

const created = (overrides: Record<string, unknown> = {}) =>
  envelope({
    seq: 42,
    state_summary: { home: 3, away: 1 },
    outcome: null,
    status: 'in_progress',
    event_id: 'ev-42',
    rules_version: 2,
    ...overrides,
  });

describe('parseAppendAnswer: an accepted tap', () => {
  it('201 is accepted, with the seq, the event id and the rules version it was folded under', () => {
    expect(parseAppendAnswer(201, created())).toEqual({
      kind: 'accepted',
      seq: 42,
      eventId: 'ev-42',
      rulesVersion: 2,
    });
  });

  // §7.3: a retry with the same key is answered 201 with the original event: the phone cannot tell it from a first
  // accept, and must not need to.
  it('a replay of a key is 201 with the same event id: the very same answer as the first', () => {
    expect(parseAppendAnswer(201, created())).toEqual(parseAppendAnswer(201, created()));
  });

  // The server wrote it, the phone cannot read it: offline resends the same key and gets the original event back,
  // where `refused` would drop a tap the match already holds.
  it.each([
    ['no event id', created({ event_id: undefined })],
    ['an event id of text that is empty', created({ event_id: '' })],
    ['a seq of zero', created({ seq: 0 })],
    ['a seq of text', created({ seq: '42' })],
    ['no rules version', created({ rules_version: undefined })],
    ['a body that is not JSON', null],
    ['a portal’s page read as text', '<!doctype html>'],
    ['an envelope that says not ok', { ok: false, error: { code: 'X' }, requestId: REQUEST_ID }],
  ])('a 201 with %s is offline, so the same key is sent again', (_name, body) => {
    expect(parseAppendAnswer(201, body)).toEqual({ kind: 'offline' });
  });

  it.each([200, 202, 204, 301, 302])('%d is no answer the server gives: offline', (status) => {
    expect(parseAppendAnswer(status, created())).toEqual({ kind: 'offline' });
  });
});

describe('parseAppendAnswer: the server’s refusals', () => {
  it('409 SEQ_CONFLICT carries the tip to resync from', () => {
    expect(parseAppendAnswer(409, failure('SEQ_CONFLICT', { current_seq: 41 }))).toEqual({
      kind: 'seqConflict',
      currentSeq: 41,
    });
  });

  it('409 SEQ_CONFLICT without a tip is still a conflict, the tip unknown', () => {
    expect(parseAppendAnswer(409, failure('SEQ_CONFLICT'))).toEqual({
      kind: 'seqConflict',
      currentSeq: null,
    });
    expect(parseAppendAnswer(409, failure('SEQ_CONFLICT', { current_seq: 'x' }))).toEqual({
      kind: 'seqConflict',
      currentSeq: null,
    });
  });

  it('409 FIXTURE_RULES_CHANGED carries the match’s rules version now', () => {
    expect(
      parseAppendAnswer(
        409,
        failure('FIXTURE_RULES_CHANGED', { rules_version: 3, format: 'Best of 1' }),
      ),
    ).toEqual({ kind: 'rulesChanged', rulesVersion: 3 });
  });

  it('409 FIXTURE_RULES_CHANGED with no readable version is offline: the tap stays queued, never dropped', () => {
    expect(parseAppendAnswer(409, failure('FIXTURE_RULES_CHANGED'))).toEqual({ kind: 'offline' });
    expect(
      parseAppendAnswer(409, failure('FIXTURE_RULES_CHANGED', { rules_version: '3' })),
    ).toEqual({
      kind: 'offline',
    });
  });

  it('426 ENGINE_OUTDATED carries the epoch the server now requires', () => {
    expect(
      parseAppendAnswer(
        426,
        failure('ENGINE_OUTDATED', { sport: 'badminton', required: 3, got: 2 }),
      ),
    ).toEqual({ kind: 'outdated', required: 3 });
  });

  it('426 ENGINE_OUTDATED with no readable epoch is offline, the tap kept', () => {
    expect(parseAppendAnswer(426, failure('ENGINE_OUTDATED'))).toEqual({ kind: 'offline' });
  });

  it.each(['LINK_INVALID', 'LINK_REVOKED', 'LINK_EXPIRED'] as const)(
    '401 %s is a dead link',
    (code) => {
      expect(parseAppendAnswer(401, failure(code))).toEqual({ kind: 'linkDead', code });
    },
  );

  it('401 with any other word is the server’s refusal of that tap, not a dead link', () => {
    expect(parseAppendAnswer(401, failure('UNAUTHORIZED'))).toEqual({
      kind: 'refused',
      status: 401,
      code: 'UNAUTHORIZED',
    });
  });

  // The status is half of the word: the same code under another status is a refusal of that tap, nothing to resync.
  it.each([
    [422, 'SEQ_CONFLICT', { current_seq: 4 }],
    [422, 'FIXTURE_RULES_CHANGED', { rules_version: 3 }],
    [422, 'ENGINE_OUTDATED', { required: 3 }],
  ])(
    '%d %s is refused, not the case the word names under its own status',
    (status, code, extras) => {
      expect(parseAppendAnswer(status, failure(code, extras))).toEqual({
        kind: 'refused',
        status,
        code,
      });
    },
  );

  it('a link word under any other status is not a dead link', () => {
    expect(parseAppendAnswer(403, failure('LINK_REVOKED'))).toEqual({
      kind: 'refused',
      status: 403,
      code: 'LINK_REVOKED',
    });
  });

  it('429 is rate limited, for as long as the caller says Retry-After was', () => {
    expect(parseAppendAnswer(429, failure('RATE_LIMITED'), 2000)).toEqual({
      kind: 'rateLimited',
      retryAfterMs: 2000,
    });
  });

  it('429 with no Retry-After handed on waits 5 s, the contract’s default', () => {
    expect(parseAppendAnswer(429, failure('RATE_LIMITED'))).toEqual({
      kind: 'rateLimited',
      retryAfterMs: 5000,
    });
  });

  it.each([
    [422, 'WRONG_PHASE'],
    [422, 'INVALID_EVENT'],
    [422, 'ENDING_SANCTION_PENDING'],
    [409, 'ALREADY_DECIDED'],
    [409, 'UNDO_TARGET_NOT_FOUND'],
    [402, 'PAYMENT_REQUIRED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [400, 'VALIDATION'],
  ])('%d %s is refused, the status and the word kept', (status, code) => {
    expect(parseAppendAnswer(status, failure(code))).toEqual({ kind: 'refused', status, code });
  });
});

describe('parseAppendAnswer: what is not the server’s word', () => {
  // A captive portal or a proxy answers in HTML or a bare JSON; a tap must never be dropped on its say-so.
  it.each([
    [400, 'a bad request page'],
    [401, 'a sign-in page'],
    [403, 'a proxy’s forbidden page'],
    [404, 'a not-found page'],
    [409, 'a conflict page'],
    [422, 'an unprocessable page'],
    [426, 'an upgrade page'],
    [429, 'a throttle page'],
  ])('%d with no envelope (%s) is offline, never refused', (status) => {
    expect(parseAppendAnswer(status, '<html>blocked</html>')).toEqual({ kind: 'offline' });
    expect(parseAppendAnswer(status, null)).toEqual({ kind: 'offline' });
    expect(parseAppendAnswer(status, { message: 'Forbidden' })).toEqual({ kind: 'offline' });
    expect(parseAppendAnswer(status, { error: { code: 'FORBIDDEN' } })).toEqual({
      kind: 'offline',
    });
  });

  it('an envelope whose error has no code is no refusal', () => {
    expect(parseAppendAnswer(422, { ok: false, error: { message: 'x' }, requestId: 'r' })).toEqual({
      kind: 'offline',
    });
    expect(parseAppendAnswer(422, { ok: false, error: { code: '' }, requestId: 'r' })).toEqual({
      kind: 'offline',
    });
  });

  it('an envelope that says ok is no refusal under a 4xx', () => {
    expect(parseAppendAnswer(422, created())).toEqual({ kind: 'offline' });
  });

  it.each([500, 502, 503, 504])('%d is offline even with the envelope', (status) => {
    expect(parseAppendAnswer(status, failure('INTERNAL'))).toEqual({ kind: 'offline' });
    expect(parseAppendAnswer(status, null)).toEqual({ kind: 'offline' });
  });

  it.each([200, 302, 399])('%d is no refusal even with an error envelope: offline', (status) => {
    expect(parseAppendAnswer(status, failure('FORBIDDEN'))).toEqual({ kind: 'offline' });
    expect(parseFailure(status, failure('SEQ_CONFLICT', { current_seq: 4 }))).toEqual({
      kind: 'offline',
    });
  });

  it('a success envelope that also carries an error object is not a refusal', () => {
    expect(
      parseAppendAnswer(422, { ok: true, error: { code: 'WRONG_PHASE' }, requestId: 'r' }),
    ).toEqual({
      kind: 'offline',
    });
  });

  it('409 SEQ_CONFLICT at tip 0 is a conflict with the tip 0: an empty ledger is a tip', () => {
    expect(parseAppendAnswer(409, failure('SEQ_CONFLICT', { current_seq: 0 }))).toEqual({
      kind: 'seqConflict',
      currentSeq: 0,
    });
  });

  it('426 ENGINE_OUTDATED asking for epoch 0 asks for nothing a phone lacks: offline, not Update needed', () => {
    expect(parseAppendAnswer(426, failure('ENGINE_OUTDATED', { required: 0 }))).toEqual({
      kind: 'offline',
    });
  });

  it('parseFailure never says accepted, whatever the status', () => {
    expect(parseFailure(201, created())).toEqual({ kind: 'offline' });
    expect(parseFailure(200, created())).toEqual({ kind: 'offline' });
  });
});
