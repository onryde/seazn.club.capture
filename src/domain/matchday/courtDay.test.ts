import { describe, expect, it } from 'vitest';
import { courtDay, courtDayOf } from '@/domain/matchday/courtDay';
import { FAKE_DAY } from '@/services/fakeMatchDayPort';
import type { Court, MatchDay, Row } from '@/domain/matchday/matchDay';

const row = (fixtureId: string, status: Row['status'] = 'upcoming'): Row => ({
  fixtureId,
  sportKey: 'badminton',
  divisionName: "Men's singles",
  roundLabel: 'R2',
  roundTag: 'R2',
  home: 'Ng',
  away: 'Brown',
  homeSlot: null,
  awaySlot: null,
  status,
  scheduledAt: null,
  summary: null,
});
const ids = (rows: readonly Row[]) => rows.map((one) => one.fixtureId);
const court = (more: Partial<Court> = {}): Court => ({
  courtId: 'c-2',
  courtName: 'Court 2',
  venueName: 'Hall A',
  state: 'free',
  now: null,
  next: [],
  finished: [],
  ...more,
});

describe('courtDay: one court as its whole day', () => {
  it.each([0, 1, 2, 5])('keeps every one of %i queued matches, in the server order', (count) => {
    const next = Array.from({ length: count }, (_, at) => row(`n-${at}`));
    expect(ids(courtDay(court({ next })).upcoming)).toEqual(ids(next));
  });

  it('carries the court as the card names it', () => {
    expect(courtDay(court({ state: 'called' }))).toMatchObject({
      courtId: 'c-2',
      name: 'Court 2',
      venueName: 'Hall A',
      state: 'called',
    });
  });

  it('has the match on the court as now, or none', () => {
    const playing = row('p-1', 'inPlay');
    expect(courtDay(court({ now: playing })).now).toBe(playing);
    expect(courtDay(court()).now).toBeNull();
  });

  it('keeps now out of the queue', () => {
    const playing = row('p-1', 'inPlay');
    expect(ids(courtDay(court({ now: playing, next: [row('n-1')] })).upcoming)).toEqual(['n-1']);
  });

  it.each([
    [0, null, 0],
    [1, 'f-0', 0],
    [3, 'f-0', 2],
  ])('with %i finished: the latest is %s and %i more wait', (count, latest, more) => {
    const finished = Array.from({ length: count }, (_, at) => row(`f-${at}`, 'finished'));
    const day = courtDay(court({ finished }));
    expect(day.latest?.fixtureId ?? null).toBe(latest);
    expect(day.more).toBe(more);
    expect(ids(day.finished)).toEqual(ids(finished));
  });
});

describe('courtDayOf: the court in a day', () => {
  const day: MatchDay = {
    ...FAKE_DAY,
    courts: [court(), court({ courtId: 'c-3', courtName: 'Court 3' })],
  };

  it('finds a court by id', () => {
    expect(courtDayOf(day, 'c-3')?.name).toBe('Court 3');
  });

  it('is null for a court no longer on the day, and for no day', () => {
    expect(courtDayOf(day, 'c-9')).toBeNull();
    expect(courtDayOf(null, 'c-3')).toBeNull();
  });
});
