import { describe, expect, it } from 'vitest';
import { parseDay } from '@/domain/matchday/dayWire';
import {
  bannerFor,
  courtCards,
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
  home,
  away,
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
};
const DRAW: Approval = {
  kind: 'draw',
  stageId: '3b8c9d0e-1f2a-4b3c-bd4e-6f7a8b9c0d1e',
  divisionName: "Men's singles",
  label: 'Finals',
  round: null,
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

  it('a court with no now and no next is Free', () => {
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
      },
      canApprove: true,
    });
  });
});
