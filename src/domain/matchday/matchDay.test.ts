import { describe, expect, it } from 'vitest';
import { parseDay } from '@/domain/matchday/dayWire';
import {
  bannerFor,
  canReview,
  courtCards,
  courtCardsAt,
  isEmptyDay,
  noonOf,
  roundChipOf,
  rowDetail,
  seated,
  noCourtStake,
  sendingByCourt,
  totalStake,
  venuesOf,
  type Approval,
  type Court,
  type MatchDay,
  type Row,
} from '@/domain/matchday/matchDay';
import { answered, fixtureOf } from '../../../test/matchDayContracts';

/** Made-up matches and courts, in the shapes `parseDay` hands on (S4 Match Day design §5). */
const row = (fixtureId: string, home: string, away: string): Row => ({
  fixtureId,
  sportKey: 'badminton',
  divisionName: "Men's singles",
  roundLabel: 'R2',
  roundTag: 'R2',
  home,
  away,
  homeSlot: null,
  awaySlot: null,
  status: 'upcoming',
  scheduledAt: new Date('2026-11-07T09:40:00.000Z'),
  summary: null,
});
const NG = {
  ...row('7b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e', 'Ng', 'Brown'),
  status: 'inPlay' as const,
};
const PATEL = row('8c3d4e5f-6a7b-4c8d-ae9f-1a2b3c4d5e6f', 'Patel', 'Okafor');
const LEE = row('1f6a7b8c-9d0e-4f1a-9b2c-4d5e6f7a8b9c', 'Lee / Tan', 'Ashok / Ravi');
const SINGH = row('2a7b8c9d-0e1f-4a2b-ac3d-5e6f7a8b9c0d', 'Singh', 'Murphy');
const DONE = {
  ...row('9d4e5f6a-7b8c-4d9e-bf0a-2b3c4d5e6f7a', 'Ann', 'Cat'),
  status: 'finished' as const,
};

const court = (courtName: string, change: Partial<Court> = {}): Court => ({
  courtId: `0e5f6a7b-8c9d-4e0f-8a1b-3c4d5e6f7a${courtName.length}b`,
  courtName,
  venueName: 'Hall A',
  state: 'free',
  now: null,
  next: [],
  finished: [],
  ...change,
});

const day = (change: Partial<MatchDay> = {}): MatchDay => ({
  competition: { id: '2f0c8a51-6b8e-4d37-9a51-0c1e2d3f4a5b', name: 'SAFE Open 2026' },
  scope: { kind: 'venue', label: 'Hall A' },
  day: '2026-11-07',
  tz: 'Europe/Amsterdam',
  opensAt: new Date('2026-11-06T23:00:00.000Z'),
  expiresAt: new Date('2026-11-07T23:00:00.000Z'),
  canApprove: true,
  courts: [],
  noCourt: [],
  online: [],
  approvals: [],
  ...change,
});

const SWISS: Approval = {
  kind: 'swiss',
  stageId: '4c9d0e1f-2a3b-4c4d-8e5f-7a8b9c0d1e2f',
  divisionName: 'Open',
  label: 'Swiss',
  round: 4,
  waiting: null,
};
const DRAW: Approval = {
  kind: 'draw',
  stageId: '3b8c9d0e-1f2a-4b3c-bd4e-6f7a8b9c0d1e',
  divisionName: "Men's singles",
  label: 'Finals',
  round: null,
  waiting: null,
};

describe('courtCards (S4 Match Day design §5: one card per court, in the order the web gives)', () => {
  it("courtCards keeps the server's court order", () => {
    const cards = courtCards(
      day({ courts: [court('Court 2'), court('Court 10'), court('Court 1'), court('Annex')] }),
    );
    expect(cards.map((card) => card.name)).toEqual(['Court 2', 'Court 10', 'Court 1', 'Annex']);
  });

  it("keeps the order of the contract's own fixture", () => {
    const result = parseDay(answered(fixtureOf('capture-matchday-day.v1', 'valid-competition')));
    if (!result.ok) throw new Error('valid-competition refused');
    expect(courtCards(result.value).map((card) => [card.name, card.venueName])).toEqual([
      ['Court 1', 'Hall A'],
      ['Court 2', 'Hall A'],
    ]);
  });

  it("next and then come from the queue's first two", () => {
    const [card] = courtCards(day({ courts: [court('Court 1', { next: [PATEL, LEE, SINGH] })] }));
    expect(card?.next).toEqual(PATEL);
    expect(card?.then).toEqual(LEE);
    expect(JSON.stringify(card)).not.toContain('Singh');
  });

  it('a queue of one has a next and no then', () => {
    const [card] = courtCards(day({ courts: [court('Court 2', { next: [LEE] })] }));
    expect(card).toMatchObject({ now: null, next: LEE, then: null });
  });

  it('a court the server calls free, with nothing on it, is a Free card, not dropped', () => {
    const cards = courtCards(day({ courts: [court('Court 3', { state: 'free' })] }));
    expect(cards).toEqual([
      {
        courtId: court('Court 3').courtId,
        name: 'Court 3',
        venueName: 'Hall A',
        state: 'free',
        now: null,
        next: null,
        then: null,
        finished: [],
      },
    ]);
  });

  it("keeps the server's state, never one worked out on the phone (a court another competition holds)", () => {
    const [card] = courtCards(day({ courts: [court('Court 2', { state: 'inUseElsewhere' })] }));
    expect(card?.state).toBe('inUseElsewhere');
  });

  it('carries Now, and the finished matches as the server lists them, newest first', () => {
    const older = { ...DONE, fixtureId: '3b8c9d0e-1f2a-4b3c-bd4e-6f7a8b9c0d1e' };
    const [card] = courtCards(
      day({ courts: [court('Court 1', { state: 'playing', now: NG, finished: [DONE, older] })] }),
    );
    expect(card).toMatchObject({ state: 'playing', now: NG, next: null, then: null });
    expect(card?.finished).toEqual([DONE, older]);
  });

  it('a day with no courts has no cards, and the matches with no court are not on one', () => {
    expect(courtCards(day({ noCourt: [SINGH], online: [LEE] }))).toEqual([]);
  });

  it('a second call gives the same cards and leaves the day as it was', () => {
    const today = day({ courts: [court('Court 1', { next: [PATEL, LEE] })] });
    const before = structuredClone(today);
    expect(courtCards(today)).toEqual(courtCards(today));
    expect(today).toEqual(before);
  });
});

describe('bannerFor (S4 Match Day design §7: a banner only when an approval waits)', () => {
  it('bannerFor is null without approvals', () => {
    expect(bannerFor(day({ approvals: [] }))).toBeNull();
    expect(bannerFor(day({ approvals: [], canApprove: false }))).toBeNull();
  });

  it('takes the first approval, round kept, on a code that can approve', () => {
    expect(bannerFor(day({ approvals: [SWISS, DRAW] }))).toEqual({
      approval: SWISS,
      canApprove: true,
    });
  });

  it('takes a draw first when the server lists it first: its round is null', () => {
    expect(bannerFor(day({ approvals: [DRAW, SWISS] }))).toEqual({
      approval: DRAW,
      canApprove: true,
    });
  });

  it('on a code without the tick, the banner has no button (matchday.approve.webOnly)', () => {
    expect(bannerFor(day({ approvals: [SWISS], canApprove: false }))).toEqual({
      approval: SWISS,
      canApprove: false,
    });
  });

  it("reads the contract's own approvals fixture", () => {
    const result = parseDay(answered(fixtureOf('capture-matchday-day.v1', 'valid-approvals')));
    if (!result.ok) throw new Error('valid-approvals refused');
    expect(bannerFor(result.value)).toEqual({
      approval: {
        kind: 'draw',
        stageId: '3b8c9d0e-1f2a-4b3c-bd4e-6f7a8b9c0d1e',
        divisionName: "Men's singles",
        label: 'Finals',
        round: null,
        waiting: null,
      },
      canApprove: true,
    });
  });
});

/** Three courts in two halls, each with its own id (the helper's are not unique enough for a map keyed by court). */
const C1 = court('Court 1', { courtId: '11111111-1111-4111-8111-111111111111', now: NG });
const C2 = court('Court 2', {
  courtId: '22222222-2222-4222-8222-222222222222',
  next: [PATEL, LEE],
  finished: [DONE],
});
const C3 = court('Court 3', {
  courtId: '33333333-3333-4333-8333-333333333333',
  venueName: 'Hall B',
  next: [SINGH],
});

describe('venuesOf (S4 design §5: the venue filter, only on a whole-competition code over two venues or more)', () => {
  const whole = { kind: 'competition', label: 'SAFE Open 2026' } as const;

  it('lists each venue once, in the order its first court comes', () => {
    expect(venuesOf(day({ scope: whole, courts: [C3, C1, C2] }))).toEqual(['Hall B', 'Hall A']);
  });

  it('shows none for a competition code whose courts are all in one venue', () => {
    expect(venuesOf(day({ scope: whole, courts: [C1, C2] }))).toEqual([]);
  });

  it('shows none for a venue code or a courts code, whatever venues their courts name', () => {
    expect(venuesOf(day({ scope: { kind: 'venue', label: 'Hall A' }, courts: [C1, C3] }))).toEqual(
      [],
    );
    expect(
      venuesOf(day({ scope: { kind: 'courts', label: 'Court 1, Court 3' }, courts: [C1, C3] })),
    ).toEqual([]);
  });

  it('shows none for a day with no courts', () => {
    expect(venuesOf(day({ scope: whole }))).toEqual([]);
  });
});

describe('courtCardsAt (the cards a venue chip leaves)', () => {
  const both = day({
    scope: { kind: 'competition', label: 'SAFE Open 2026' },
    courts: [C1, C2, C3],
  });
  const names = (venue: string | null) => courtCardsAt(both, venue).map((card) => card.name);

  it('keeps every card when no venue is picked', () => {
    expect(names(null)).toEqual(['Court 1', 'Court 2', 'Court 3']);
  });

  it('keeps only the picked venue’s cards, in the server’s order', () => {
    expect(names('Hall A')).toEqual(['Court 1', 'Court 2']);
    expect(names('Hall B')).toEqual(['Court 3']);
  });

  it('keeps every card when the picked venue is no longer one of the day’s (a poll moved its courts)', () => {
    expect(names('Hall C')).toEqual(['Court 1', 'Court 2', 'Court 3']);
  });
});

describe('sendingByCourt (S4 design §5: "Sending N" on a court with unsent taps)', () => {
  const both = day({ courts: [C1, C2, C3] });
  const none = { count: 0, unreadable: false };

  it('adds the unsent taps of the court’s own matches: now, its whole queue and its finished ones', () => {
    const unsent = new Map([
      [NG.fixtureId, 2],
      [LEE.fixtureId, 3],
      [DONE.fixtureId, 1],
    ]);
    expect(Object.fromEntries(sendingByCourt(both, unsent))).toEqual({
      [C1.courtId]: { count: 2, unreadable: false },
      [C2.courtId]: { count: 4, unreadable: false },
      [C3.courtId]: none,
    });
  });

  it('a queue it cannot read puts its court’s taps at risk, with the others still counted, and no other court', () => {
    const unsent = new Map<string, number | null>([
      [NG.fixtureId, null],
      [LEE.fixtureId, 3],
    ]);
    expect(Object.fromEntries(sendingByCourt(both, unsent))).toEqual({
      [C1.courtId]: { count: 0, unreadable: true },
      [C2.courtId]: { count: 3, unreadable: false },
      [C3.courtId]: none,
    });
  });

  it('counts nothing for a match on no court, and nothing at all with no unsent taps', () => {
    const unsent = new Map([[SINGH.fixtureId, 5]]);
    expect(Object.fromEntries(sendingByCourt(day({ courts: [C1, C2] }), unsent))).toEqual({
      [C1.courtId]: none,
      [C2.courtId]: none,
    });
    expect(Object.fromEntries(sendingByCourt(both, new Map()))).toEqual({
      [C1.courtId]: none,
      [C2.courtId]: none,
      [C3.courtId]: none,
    });
  });
});

describe('noCourtStake (review M2: the matches on no court queue taps too)', () => {
  it('adds the unsent taps of the matches on no court only, and says a queue it cannot read', () => {
    const noCourt = day({ courts: [C1], noCourt: [SINGH] });
    expect(
      noCourtStake(
        noCourt,
        new Map([
          [SINGH.fixtureId, 5],
          [NG.fixtureId, 2],
        ]),
      ),
    ).toEqual({
      count: 5,
      unreadable: false,
    });
    expect(noCourtStake(noCourt, new Map([[SINGH.fixtureId, null]]))).toEqual({
      count: 0,
      unreadable: true,
    });
    expect(noCourtStake(noCourt, new Map([[NG.fixtureId, null]]))).toEqual({
      count: 0,
      unreadable: false,
    });
  });
});

describe('totalStake (what Exit puts at stake: every match opened from Match Day, listed today or not)', () => {
  it('adds every count and says any queue it cannot read', () => {
    expect(totalStake(new Map())).toEqual({ count: 0, unreadable: false });
    expect(
      totalStake(
        new Map([
          ['a', 2],
          ['b', 3],
        ]),
      ),
    ).toEqual({ count: 5, unreadable: false });
    expect(
      totalStake(
        new Map<string, number | null>([
          ['a', 2],
          ['b', null],
        ]),
      ),
    ).toEqual({
      count: 2,
      unreadable: true,
    });
  });
});

describe('rowDetail (what a row shows at its right)', () => {
  it('a match not started shows its planned time, or nothing without one', () => {
    expect(rowDetail(PATEL)).toEqual({ kind: 'time', at: new Date('2026-11-07T09:40:00.000Z') });
    expect(rowDetail({ ...PATEL, scheduledAt: null })).toBeNull();
  });

  it('a match in play shows its short score, never its planned time; nothing before the first point', () => {
    expect(rowDetail({ ...NG, summary: '14-9' })).toEqual({ kind: 'score', text: '14-9' });
    expect(rowDetail({ ...NG, summary: null })).toBeNull();
  });

  it('a finished match shows its result', () => {
    expect(rowDetail({ ...DONE, summary: '21-15 21-18' })).toEqual({
      kind: 'score',
      text: '21-15 21-18',
    });
    expect(rowDetail({ ...DONE, summary: null })).toBeNull();
  });

  it('an upcoming match with a summary still shows its time (the summary is a score, and it has none)', () => {
    expect(rowDetail({ ...PATEL, summary: '0-0' })).toEqual({
      kind: 'time',
      at: new Date('2026-11-07T09:40:00.000Z'),
    });
  });
});

describe('noonOf (the code’s calendar day, to say in the header)', () => {
  it('is that day at noon UTC, so the day is the same in any zone the header could be read in', () => {
    expect(noonOf('2026-11-07').toISOString()).toBe('2026-11-07T12:00:00.000Z');
    expect(noonOf('2026-02-28').toISOString()).toBe('2026-02-28T12:00:00.000Z');
  });
});

describe('isEmptyDay (a day with nothing in the code’s scope)', () => {
  it('is empty with no courts, no matches without one and no online boards', () => {
    expect(isEmptyDay(day())).toBe(true);
  });

  it.each([
    ['a court, even a free one', { courts: [court('Court 9')] }],
    ['a match on no court', { noCourt: [SINGH] }],
    ['an online board', { online: [SINGH] }],
  ])('is not empty with %s', (_what, change: Partial<MatchDay>) => {
    expect(isEmptyDay(day(change))).toBe(false);
  });
});

describe('canReview: the banner offers Review (S4 design §7)', () => {
  const stage = '4c9d0e1f-2a3b-4c4d-8e5f-7a8b9c0d1e2f';
  const swiss = (round: number | null): Approval => ({
    kind: 'swiss',
    stageId: stage,
    divisionName: 'Open',
    label: 'Swiss',
    round,
    waiting: null,
  });
  const draw: Approval = { ...swiss(null), kind: 'draw' };

  it.each([
    ['a draw on a code with approvals', draw, true, true],
    ['a draw on a code without', draw, false, false],
    ['Swiss round 4', swiss(4), true, true],
    ['Swiss round 2', swiss(2), true, true],
    ['Swiss round 1, no round before it', swiss(1), true, false],
    ['Swiss with no round', swiss(null), true, false],
    ['Swiss round 4 on a code without approvals', swiss(4), false, false],
    // Task 8d-B: groups decided but the stage not complete: the web desk finishes it, whatever the tick says.
    ['a waiting draw on a code with the tick', { ...draw, waiting: 'stageComplete' }, true, false],
    ['a waiting draw on a code without', { ...draw, waiting: 'stageComplete' }, false, false],
  ] as const)('%s', (_what, approval, canApprove, offered) => {
    expect(canReview({ approval, canApprove })).toBe(offered);
  });
});

describe('roundChipOf: the chip a row starts with (task 8d-B, F-T8-3)', () => {
  const tagged = (roundTag: string | null, roundLabel: string | null): Row => ({
    ...PATEL,
    roundTag,
    roundLabel,
  });

  it.each([
    ['the desk’s tag', 'SF·1', 'SF', 'SF·1'],
    ['the board’s label when the web sent no tag', null, 'QF', 'QF'],
    ['nothing when it has neither', null, null, null],
    ['the tag alone', 'F', null, 'F'],
  ])('is %s', (_what, tag, label, chip) => {
    expect(roundChipOf(tagged(tag, label))).toBe(chip);
  });
});

describe('seated: a match opens only with both seats filled (task 8d-B)', () => {
  it.each([
    ['both named', 'Eva', 'Bea', true],
    ['no home', null, 'Bea', false],
    ['no away', 'Eva', null, false],
    ['neither', null, null, false],
  ])('%s', (_what, home, away, yes) => {
    expect(seated({ ...PATEL, home, away })).toBe(yes);
  });

  it('a slot label does not seat a match', () => {
    expect(seated({ ...PATEL, home: null, homeSlot: 'Winner of Group A' })).toBe(false);
  });
});
