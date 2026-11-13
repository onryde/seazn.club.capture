import { describe, expect, it } from 'vitest';
import { parseDay } from '@/domain/matchday/dayWire';
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
 * capture-matchday-day.v1 (S4 Match Day design §5, §9.3), vendored at web 7c15a5a78: every expected value below is
 * typed from the contract's fixtures or its text, never computed by the parser under test.
 */
const DAY = 'capture-matchday-day.v1';

/** A fixture's `data` with its fields reachable for a test to change. */
type Wire = Record<string, unknown> & {
  competition: Record<string, unknown>;
  scope: Record<string, unknown>;
  courts: (Record<string, unknown> & {
    now: Record<string, unknown> | null;
    next: Record<string, unknown>[];
    finished: Record<string, unknown>[];
  })[];
  no_court: Record<string, unknown>[];
  online: Record<string, unknown>[];
  approvals: Record<string, unknown>[];
};
const wire = (name: string): Wire => copyOf(fixtureOf(DAY, name)) as Wire;
const read = (data: unknown) => parseDay(answered(data));
const errorOf = (data: unknown) => {
  const result = read(data);
  return result.ok ? null : result.error;
};

/**
 * The fixtures the contract refuses only for a property it does not name, with that property: the phone ignores an
 * unknown field (Postel), so it reads them, without the field. A row that carries a scoring link is the case that
 * matters: the link is dropped, never kept.
 */
const EXTRA_FIELD: Readonly<Record<string, (data: Wire) => void>> = {
  'invalid-row-carries-url': (data) => {
    delete data.courts[0]?.next[0]?.url;
  },
};

/** What the phone says of each other fixture the contract refuses: the field it names, never the value. */
const REFUSED: Readonly<Record<string, unknown>> = {
  'invalid-approval-no-round': { kind: 'missing-field', field: 'approvals[1].round' },
  'invalid-no-expires-at': { kind: 'missing-field', field: 'expires_at' },
  'invalid-row-status': {
    kind: 'invalid-field',
    field: 'courts[0].now.status',
    reason: expect.any(String),
  },
};

const answers = fixturesOf(DAY).filter(([name]) => !name.startsWith('refusal-'));
const valid = answers.filter(([name]) => name.startsWith('valid-'));

describe('parseDay runs every capture-matchday-day.v1 answer fixture', () => {
  it('accounts for every answer fixture: valid, refused, or read without an unknown field', () => {
    const named = [
      ...valid.map(([name]) => name),
      ...Object.keys(REFUSED),
      ...Object.keys(EXTRA_FIELD),
    ];
    expect(answers.map(([name]) => name).sort()).toEqual(named.sort());
    expect(valid.length).toBeGreaterThanOrEqual(3);
  });

  it.each(valid)('%s: the contract admits it and the phone reads it', (_, data) => {
    expect(contractAdmits(DAY, data)).toBe(true);
    expect(read(data).ok).toBe(true);
  });

  it.each(Object.entries(REFUSED))(
    '%s: the contract and the phone both refuse it',
    (name, error) => {
      const data = fixtureOf(DAY, name);
      expect(contractAdmits(DAY, data)).toBe(false);
      expect(errorOf(data)).toEqual(error);
    },
  );

  it.each(Object.entries(EXTRA_FIELD))(
    '%s: refused by the contract only for its extra field, which the phone ignores',
    (name, strip) => {
      const data = wire(name);
      expect(contractAdmits(DAY, data)).toBe(false);
      const stripped = wire(name);
      strip(stripped);
      expect(contractAdmits(DAY, stripped)).toBe(true);
      expect(read(data)).toEqual(read(stripped));
      expect(read(stripped).ok).toBe(true);
    },
  );

  it('keeps no scoring link from a row that carries one', () => {
    const result = read(fixtureOf(DAY, 'invalid-row-carries-url'));
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain('/score/');
  });
});

describe('parseDay reads a day in camelCase, with Dates', () => {
  it('reads valid-competition field for field', () => {
    expect(read(fixtureOf(DAY, 'valid-competition'))).toEqual({
      ok: true,
      value: {
        competition: { id: '2f0c8a51-6b8e-4d37-9a51-0c1e2d3f4a5b', name: 'SAFE Open 2026' },
        scope: { kind: 'competition', label: 'SAFE Open 2026' },
        day: '2026-11-07',
        tz: 'Europe/Amsterdam',
        opensAt: new Date('2026-11-06T23:00:00.000Z'),
        expiresAt: new Date('2026-11-07T23:00:00.000Z'),
        canApprove: false,
        courts: [
          {
            courtId: '6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
            courtName: 'Court 1',
            venueName: 'Hall A',
            state: 'playing',
            now: {
              fixtureId: '7b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e',
              sportKey: 'badminton',
              divisionName: "Men's doubles",
              roundLabel: 'R1',
              roundTag: 'R1',
              home: 'Ann & Bob',
              away: 'Cat & Dan',
              homeSlot: null,
              awaySlot: null,
              status: 'inPlay',
              scheduledAt: new Date('2026-11-07T10:00:00.000Z'),
              summary: '1–1 · 14–9',
            },
            next: [
              {
                fixtureId: '8c3d4e5f-6a7b-4c8d-ae9f-1a2b3c4d5e6f',
                sportKey: 'badminton',
                divisionName: "Men's singles",
                roundLabel: 'R2',
                roundTag: 'R2',
                home: 'Patel',
                away: 'Okafor',
                homeSlot: null,
                awaySlot: null,
                status: 'upcoming',
                scheduledAt: new Date('2026-11-07T09:40:00.000Z'),
                summary: null,
              },
            ],
            finished: [
              {
                fixtureId: '9d4e5f6a-7b8c-4d9e-bf0a-2b3c4d5e6f7a',
                sportKey: 'badminton',
                divisionName: "Men's doubles",
                roundLabel: 'R1',
                roundTag: 'R1',
                home: 'Ann & Bob',
                away: 'Cat & Dan',
                homeSlot: null,
                awaySlot: null,
                status: 'finished',
                scheduledAt: new Date('2026-11-07T08:00:00.000Z'),
                summary: '2–0',
              },
            ],
          },
          {
            courtId: '0e5f6a7b-8c9d-4e0f-8a1b-3c4d5e6f7a8b',
            courtName: 'Court 2',
            venueName: 'Hall A',
            state: 'free',
            now: null,
            next: [
              {
                fixtureId: '1f6a7b8c-9d0e-4f1a-9b2c-4d5e6f7a8b9c',
                sportKey: 'badminton',
                divisionName: "Men's doubles",
                roundLabel: 'QF',
                roundTag: 'QF',
                home: null,
                away: null,
                homeSlot: null,
                awaySlot: null,
                status: 'upcoming',
                scheduledAt: new Date('2026-11-07T09:20:00.000Z'),
                summary: null,
              },
            ],
            finished: [],
          },
        ],
        noCourt: [
          {
            fixtureId: '2a7b8c9d-0e1f-4a2b-ac3d-5e6f7a8b9c0d',
            sportKey: 'badminton',
            divisionName: "Women's singles",
            roundLabel: 'R2',
            roundTag: 'R2',
            home: 'Singh',
            away: 'Murphy',
            homeSlot: null,
            awaySlot: null,
            status: 'upcoming',
            scheduledAt: null,
            summary: null,
          },
        ],
        online: [],
        approvals: [],
      },
    });
  });

  it('reads valid-approvals: a draw with no round, a Swiss stage with its round, a court in use elsewhere', () => {
    const result = read(fixtureOf(DAY, 'valid-approvals'));
    if (!result.ok) throw new Error('valid-approvals refused');
    expect(result.value.canApprove).toBe(true);
    expect(result.value.courts[0]?.state).toBe('inUseElsewhere');
    expect(result.value.approvals).toEqual([
      {
        kind: 'draw',
        stageId: '3b8c9d0e-1f2a-4b3c-bd4e-6f7a8b9c0d1e',
        divisionName: "Men's singles",
        label: 'Finals',
        round: null,
        waiting: null,
      },
      {
        kind: 'swiss',
        stageId: '4c9d0e1f-2a3b-4c4d-8e5f-7a8b9c0d1e2f',
        divisionName: 'Open',
        label: 'Swiss',
        round: 4,
        waiting: null,
      },
      {
        kind: 'draw',
        stageId: '5d0e1f2a-3b4c-4d5e-9f6a-8b9c0d1e2f3a',
        divisionName: "Women's singles",
        label: 'Finals',
        round: null,
        waiting: 'stageComplete',
      },
    ]);
  });

  it.each([
    ['valid-competition', 'competition'],
    ['valid-approvals', 'venue'],
    ['valid-courts', 'courts'],
  ])('%s: a code scoped to its %s', (name, kind) => {
    const result = read(fixtureOf(DAY, name));
    expect(result.ok && result.value.scope.kind).toBe(kind);
  });

  it('reads a called court as called', () => {
    const data = wire('valid-competition');
    data.courts[0]!.state = 'called';
    const result = read(data);
    expect(result.ok && result.value.courts[0]?.state).toBe('called');
  });
});

/** The contract's own required list at a path of `properties`, `items` and `anyOf[0]` steps. */
function requiredAt(...steps: string[]): string[] {
  let node: unknown = schemaOf(DAY);
  for (const step of steps) node = (node as Record<string, unknown>)[step];
  return (node as { required: string[] }).required.filter((key) => !OPTIONAL.has(key));
}

/**
 * The fields the contract requires that the phone reads as optional (task 8d-B ruling: a build still reads a staging
 * web that does not send them yet): an absent one reads null, a present one of the wrong type is still refused.
 */
const OPTIONAL: ReadonlySet<string> = new Set(['round_tag', 'home_slot', 'away_slot', 'waiting']);

describe('parseDay refuses a missing field', () => {
  it.each(requiredAt())('without %s', (key) => {
    const data = wire('valid-competition');
    delete data[key];
    expect(errorOf(data)).toEqual({ kind: 'missing-field', field: key });
  });

  it.each(requiredAt('properties', 'competition'))('without competition.%s', (key) => {
    const data = wire('valid-competition');
    delete data.competition[key];
    expect(errorOf(data)).toEqual({ kind: 'missing-field', field: `competition.${key}` });
  });

  it.each(requiredAt('properties', 'scope'))('without scope.%s', (key) => {
    const data = wire('valid-competition');
    delete data.scope[key];
    expect(errorOf(data)).toEqual({ kind: 'missing-field', field: `scope.${key}` });
  });

  it.each(requiredAt('properties', 'courts', 'items'))('without courts[1].%s', (key) => {
    const data = wire('valid-competition');
    delete data.courts[1]![key];
    expect(errorOf(data)).toEqual({ kind: 'missing-field', field: `courts[1].${key}` });
  });

  it.each(requiredAt('properties', 'no_court', 'items'))(
    'without %s in Now, Next, Finished, no court and online',
    (key) => {
      const rows: [string, (data: Wire) => Record<string, unknown>][] = [
        ['courts[0].now', (data) => data.courts[0]!.now!],
        ['courts[0].next[0]', (data) => data.courts[0]!.next[0]!],
        ['courts[0].finished[0]', (data) => data.courts[0]!.finished[0]!],
        ['no_court[0]', (data) => data.no_court[0]!],
        [
          'online[0]',
          (data) => {
            data.online.push(copyOf(data.no_court[0]!));
            return data.online[0]!;
          },
        ],
      ];
      for (const [at, rowOf] of rows) {
        const data = wire('valid-competition');
        delete rowOf(data)[key];
        expect(errorOf(data)).toEqual({ kind: 'missing-field', field: `${at}.${key}` });
      }
    },
  );

  it.each(requiredAt('properties', 'approvals', 'items'))('without approvals[0].%s', (key) => {
    const data = wire('valid-approvals');
    delete data.approvals[0]![key];
    expect(errorOf(data)).toEqual({ kind: 'missing-field', field: `approvals[0].${key}` });
  });
});

describe('parseDay ignores an unknown field', () => {
  it.each([
    ['the day', (data: Wire) => data],
    ['the competition', (data: Wire) => data.competition],
    ['the scope', (data: Wire) => data.scope],
    ['a court', (data: Wire) => data.courts[0]!],
    ['Now', (data: Wire) => data.courts[0]!.now!],
    ['a Next', (data: Wire) => data.courts[0]!.next[0]!],
    ['a Finished', (data: Wire) => data.courts[0]!.finished[0]!],
    ['a match with no court', (data: Wire) => data.no_court[0]!],
  ])('on %s', (_, at) => {
    const data = wire('valid-competition');
    at(data).added_later = { anything: true };
    expect(read(data)).toEqual(read(fixtureOf(DAY, 'valid-competition')));
  });

  it('on an approval', () => {
    const data = wire('valid-approvals');
    data.approvals[1]!.added_later = 'x';
    expect(read(data)).toEqual(read(fixtureOf(DAY, 'valid-approvals')));
  });
});

describe('parseDay reads the v1 envelope and nothing else', () => {
  it.each([null, undefined, 'text', 42, []])('%s is not an object', (body) => {
    expect(parseDay(body)).toEqual({ ok: false, error: { kind: 'not-an-object' } });
  });

  it.each([
    ['a refusal', refusedWith({ code: 'MD_ENDED', message: 'm' })],
    ['a bare day with no envelope', fixtureOf(DAY, 'valid-competition')],
    ['ok as text', { ok: 'true', data: fixtureOf(DAY, 'valid-competition') }],
  ])('%s is not an answer', (_, body) => {
    const result = parseDay(body);
    expect(result.ok ? null : result.error).toEqual({
      kind: 'invalid-field',
      field: 'ok',
      reason: expect.any(String),
    });
  });

  it('an answer with no data is missing its data', () => {
    expect(parseDay({ ok: true, requestId: 'r' })).toEqual({
      ok: false,
      error: { kind: 'missing-field', field: 'data' },
    });
  });

  it('an answer whose data is a list is refused', () => {
    const result = parseDay({ ok: true, data: [] });
    expect(result.ok ? null : result.error).toMatchObject({ kind: 'invalid-field', field: 'data' });
  });
});

describe('parseDay refuses a field of the wrong shape, naming the field', () => {
  const refuses = (change: (data: Wire) => void, field: string) => {
    const data = wire('valid-competition');
    change(data);
    expect(errorOf(data)).toEqual({ kind: 'invalid-field', field, reason: expect.any(String) });
  };
  const reads = (change: (data: Wire) => void) => {
    const data = wire('valid-competition');
    change(data);
    const result = read(data);
    if (!result.ok) throw new Error(`refused ${JSON.stringify(result.error)}`);
    return result.value;
  };

  /** valid-competition's Now and valid-approvals' Swiss stage: real uuids, so only what is around them is wrong. */
  const NOW_ID = '7b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e';
  const STAGE_ID = '4c9d0e1f-2a3b-4c4d-8e5f-7a8b9c0d1e2f';

  it.each([
    ['a path', '../../x'],
    ['a uuid with a path after it', `${NOW_ID}/../x`],
    ['a uuid with a path before it', `../${NOW_ID}`],
    ['a uuid and a line break', `${NOW_ID}\n`],
  ])('a match id that is %s: refused, it is a path segment of the open', (_, id) => {
    refuses((data) => (data.courts[0]!.now!.fixture_id = id), 'courts[0].now.fixture_id');
  });

  it.each([
    ['a path', '../../x'],
    ['a uuid with a path after it', `${STAGE_ID}/confirm`],
    ['a uuid with a path before it', `../${STAGE_ID}`],
  ])('a stage id that is %s: refused, it is a path segment of the approval', (_, id) => {
    const data = wire('valid-approvals');
    data.approvals[1]!.stage_id = id;
    expect(errorOf(data)).toEqual({
      kind: 'invalid-field',
      field: 'approvals[1].stage_id',
      reason: expect.any(String),
    });
  });

  it('a court or competition id that is not a uuid', () => {
    refuses((data) => (data.courts[0]!.court_id = 'court-1'), 'courts[0].court_id');
    refuses((data) => (data.competition.id = 'not-a-uuid'), 'competition.id');
    refuses((data) => (data.competition.id = ''), 'competition.id');
  });

  it('a uuid in capitals is still a uuid', () => {
    const day = reads((data) => {
      data.courts[0]!.now!.fixture_id = '7B2C3D4E-5F6A-4B7C-9D8E-0F1A2B3C4D5E';
    });
    expect(day.courts[0]?.now?.fixtureId).toBe('7B2C3D4E-5F6A-4B7C-9D8E-0F1A2B3C4D5E');
  });

  it('an empty sport, zone or round label', () => {
    refuses((data) => (data.courts[0]!.now!.sport_key = ''), 'courts[0].now.sport_key');
    refuses((data) => (data.tz = ''), 'tz');
    refuses((data) => (data.no_court[0]!.round_label = ''), 'no_court[0].round_label');
  });

  it('a round label may be null, and a division name empty', () => {
    const day = reads((data) => {
      data.no_court[0]!.round_label = null;
      data.no_court[0]!.division_name = '';
    });
    expect(day.noCourt[0]).toMatchObject({ roundLabel: null, divisionName: '' });
  });

  it('a name that is not text', () => {
    refuses((data) => (data.courts[0]!.now!.home = 5), 'courts[0].now.home');
    refuses((data) => (data.courts[0]!.now!.summary = ['14', '9']), 'courts[0].now.summary');
    refuses((data) => (data.courts[0]!.court_name = null), 'courts[0].court_name');
    refuses((data) => (data.competition.name = 7), 'competition.name');
  });

  it('can_approve that is not a boolean', () => {
    refuses((data) => (data.can_approve = 'true'), 'can_approve');
  });

  it.each([
    ['local time', '2026-11-06T23:00:00'],
    ['an offset', '2026-11-07T00:00:00+01:00'],
    ['a day that is not in the calendar', '2026-02-30T00:00:00Z'],
    ['hour 24', '2026-11-06T24:00:00Z'],
    ['minute 60', '2026-11-07T10:60Z'],
    ['second 60', '2026-11-07T10:00:60Z'],
    ['text before it', 'x2026-11-07T10:00:00Z'],
    ['text after it', '2026-11-07T10:00:00Zx'],
    ['a date with no time', '2026-11-06'],
    ['a date and Z with no time', '2026-11-06Z'],
    ['epoch seconds', 1_762_470_000],
  ])('an instant in %s', (_, value) => {
    refuses((data) => (data.opens_at = value), 'opens_at');
  });

  it('a scheduled start that is not a UTC instant', () => {
    refuses(
      (data) => (data.courts[0]!.next[0]!.scheduled_at = '2026-11-07 09:40'),
      'courts[0].next[0].scheduled_at',
    );
  });

  it('an instant with no seconds, or with more than milliseconds, is read (the contract admits both)', () => {
    const day = reads((data) => {
      data.opens_at = '2026-11-06T23:00Z';
      data.expires_at = '2026-11-07T22:59:59.123456Z';
    });
    expect(day.opensAt).toEqual(new Date('2026-11-06T23:00:00.000Z'));
    expect(day.expiresAt).toEqual(new Date('2026-11-07T22:59:59.123Z'));
  });

  it('a fraction of a second shorter than milliseconds is read as tenths', () => {
    const day = reads((data) => (data.courts[0]!.now!.scheduled_at = '2026-11-07T10:00:00.5Z'));
    expect(day.courts[0]?.now?.scheduledAt).toEqual(new Date('2026-11-07T10:00:00.500Z'));
  });

  it.each([
    ['a 29 February outside a leap year', '2026-02-29'],
    ['a short month', '2026-11-7'],
    ['an instant', '2026-11-07T00:00:00Z'],
    ['text before it', 'x2026-11-07'],
  ])('a day that is %s', (_, value) => {
    refuses((data) => (data.day = value), 'day');
  });

  it('a 29 February in a leap year is a day', () => {
    expect(reads((data) => (data.day = '2028-02-29')).day).toBe('2028-02-29');
  });

  it('a word outside each closed list', () => {
    refuses((data) => (data.courts[0]!.state = 'paused'), 'courts[0].state');
    refuses((data) => (data.scope.kind = 'division'), 'scope.kind');
    refuses(
      (data) => (data.courts[0]!.finished[0]!.status = 'finalized'),
      'courts[0].finished[0].status',
    );
  });

  it('a list that is not a list, or holds something that is not a match', () => {
    refuses((data) => (data.courts = {} as Wire['courts']), 'courts');
    refuses((data) => (data.no_court = null as unknown as Wire['no_court']), 'no_court');
    refuses(
      (data) => (data.courts[0]!.next[1] = null as unknown as Record<string, unknown>),
      'courts[0].next[1]',
    );
    refuses(
      (data) => (data.courts[1] = 'Court 3' as unknown as Wire['courts'][number]),
      'courts[1]',
    );
  });

  it('a Now that is neither a match nor null', () => {
    refuses(
      (data) => (data.courts[0]!.now = 'Ng v Brown' as unknown as Record<string, unknown>),
      'courts[0].now',
    );
  });
});

describe('parseDay reads an approval round as the contract bounds it', () => {
  const approvals = (round: unknown) => {
    const data = wire('valid-approvals');
    data.approvals[1]!.round = round;
    return data;
  };

  it.each([0, -1, 1.5, '4', true])('refuses round %s', (round) => {
    expect(errorOf(approvals(round))).toEqual({
      kind: 'invalid-field',
      field: 'approvals[1].round',
      reason: expect.any(String),
    });
  });

  it('reads round 1, the least the contract admits', () => {
    const result = read(approvals(1));
    expect(result.ok && result.value.approvals[1]?.round).toBe(1);
  });

  it('refuses an approval of a kind outside the contract', () => {
    const data = wire('valid-approvals');
    data.approvals[0]!.kind = 'final';
    expect(errorOf(data)).toMatchObject({ kind: 'invalid-field', field: 'approvals[0].kind' });
  });
});

describe('parseDay and the four questions (AGENTS §10)', () => {
  it('a second read of the same body is the same, and the body is not changed', () => {
    const body = answered(Object.freeze(wire('valid-competition')));
    const first = parseDay(body);
    expect(parseDay(body)).toEqual(first);
    expect(body.data).toEqual(fixtureOf(DAY, 'valid-competition'));
  });

  it('an empty day (no courts, no matches, no approvals) is a day', () => {
    const data = wire('valid-courts');
    data.courts = [];
    const result = read(data);
    expect(result.ok && result.value).toMatchObject({
      courts: [],
      noCourt: [],
      online: [],
      approvals: [],
    });
  });

  it('online boards are read as rows', () => {
    const data = wire('valid-competition');
    data.online = [copyOf(data.no_court[0]!)];
    const result = read(data);
    if (!result.ok) throw new Error(`refused ${JSON.stringify(result.error)}`);
    expect(result.value.online).toEqual([
      {
        fixtureId: '2a7b8c9d-0e1f-4a2b-ac3d-5e6f7a8b9c0d',
        sportKey: 'badminton',
        divisionName: "Women's singles",
        roundLabel: 'R2',
        roundTag: 'R2',
        home: 'Singh',
        away: 'Murphy',
        homeSlot: null,
        awaySlot: null,
        status: 'upcoming',
        scheduledAt: null,
        summary: null,
      },
    ]);
  });
});

describe("parseDay reads a row's round tag and slot labels, and an approval's waiting (task 8d-B)", () => {
  const firstRow = (data: Wire) => data.courts[0]!.next[0]!;
  const rowOf = (data: unknown) => {
    const result = read(data);
    if (!result.ok) throw new Error('the day refused');
    return result.value.courts[0]!.next[0]!;
  };

  it("reads valid-courts: the desk's tag and the empty seats' words, from the fixture", () => {
    const row = rowOf(fixtureOf(DAY, 'valid-courts'));
    expect([row.roundTag, row.homeSlot, row.awaySlot]).toEqual([
      'QF·2',
      'Winner of Group A',
      'Runner-up of Group B',
    ]);
  });

  it('reads a stage the web holds as waiting, and a ready one as not', () => {
    const result = read(fixtureOf(DAY, 'valid-approvals'));
    if (!result.ok) throw new Error('valid-approvals refused');
    expect(result.value.approvals.map((a) => a.waiting)).toEqual([null, null, 'stageComplete']);
  });

  it('a row without the three fields (a web that does not send them) reads them as null', () => {
    const data = wire('valid-courts');
    for (const key of ['round_tag', 'home_slot', 'away_slot']) delete firstRow(data)[key];
    const row = rowOf(data);
    expect([row.roundTag, row.homeSlot, row.awaySlot]).toEqual([null, null, null]);
    expect(row.home).toBeNull();
  });

  it('an approval without waiting reads null', () => {
    const data = wire('valid-approvals');
    delete data.approvals[2]!.waiting;
    const result = read(data);
    expect(result.ok && result.value.approvals[2]?.waiting).toBeNull();
  });

  it.each([
    ['round_tag', 7],
    ['round_tag', ''],
    ['home_slot', 3],
    ['away_slot', false],
  ])('a row with %s %j is refused, naming the field', (key, bad) => {
    const data = wire('valid-courts');
    firstRow(data)[key] = bad;
    expect(errorOf(data)).toEqual({
      kind: 'invalid-field',
      field: `courts[0].next[0].${key}`,
      reason: expect.any(String),
    });
  });

  it.each(['pending', 7, true])('an approval with waiting %j is refused', (bad) => {
    const data = wire('valid-approvals');
    data.approvals[2]!.waiting = bad;
    expect(errorOf(data)).toEqual({
      kind: 'invalid-field',
      field: 'approvals[2].waiting',
      reason: expect.any(String),
    });
  });
});
