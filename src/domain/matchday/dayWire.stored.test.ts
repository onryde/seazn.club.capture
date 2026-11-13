import { describe, expect, it } from 'vitest';
import type { MatchDay } from '@/domain/matchday/matchDay';
import { parseDay, readStoredDay } from '@/domain/matchday/dayWire';
import { answered, fixtureOf, fixturesOf } from '../../../test/matchDayContracts';

// Final review M3: the day's copy is read back through the day parser's full check, every row, court and approval, so
// a copy that parses but is wrong inside its lists never reaches the screen. The expected days are the parser's reading
// of the contract's own fixtures, never `readStoredDay`'s.

const DAY = 'capture-matchday-day.v1';
const valid = fixturesOf(DAY).filter(([name]) => name.startsWith('valid-'));

const parsed = (name: string): MatchDay => {
  const result = parseDay(answered(fixtureOf(DAY, name)));
  if (!result.ok) throw new Error(`the contract's ${name} reads`);
  return result.value;
};

/** The copy as the store's file holds it: JSON, its Dates as ISO text. */
const stored = (day: MatchDay): Record<string, unknown> =>
  JSON.parse(JSON.stringify(day)) as Record<string, unknown>;

/** The copy with its Dates revived, as the store's reader hands it on. */
const revived = (day: MatchDay): unknown =>
  JSON.parse(JSON.stringify(day), (key, value: unknown) =>
    ['opensAt', 'expiresAt', 'scheduledAt'].includes(key) && typeof value === 'string'
      ? new Date(value)
      : value,
  );

describe('readStoredDay', () => {
  it.each(valid)('reads back the day %s parsed to, as text or with its Dates revived', (name) => {
    const day = parsed(name);
    expect(readStoredDay(stored(day))).toEqual(day);
    expect(readStoredDay(revived(day))).toEqual(day);
  });

  it('reads a copy stored before the calling flag as one that may not call, and keeps a true one', () => {
    const calling = parsed('valid-courts');
    expect(calling.canCall).toBe(true);
    expect(readStoredDay(stored(calling))?.canCall).toBe(true);
    const old = stored(calling);
    delete old.canCall;
    expect(readStoredDay(old)).toEqual({ ...calling, canCall: false });
  });

  it('there are valid fixtures with rows, courts and approvals to read', () => {
    const days = valid.map(([name]) => parsed(name));
    expect(days.some((day) => day.courts.some((court) => court.now !== null))).toBe(true);
    expect(days.some((day) => day.approvals.length > 0)).toBe(true);
    expect(days.some((day) => day.courts.some((court) => court.state === 'inUseElsewhere'))).toBe(
      true,
    );
  });

  /** The first valid fixture with a court that has a row on it now. */
  const base = (): Record<string, unknown> & {
    courts: Record<string, unknown>[];
    approvals: Record<string, unknown>[];
  } => {
    const name = valid.find(([n]) => parsed(n).courts.some((court) => court.now !== null))?.[0];
    if (name === undefined) throw new Error('a fixture with a row playing');
    return stored(parsed(name)) as ReturnType<typeof base>;
  };
  const nowRow = (copy: ReturnType<typeof base>): Record<string, unknown> => {
    const court = copy.courts.find((c) => c.now !== null);
    return court?.now as Record<string, unknown>;
  };

  const waitingApproval = (): Record<string, unknown> => ({
    kind: 'draw',
    stageId: '3b8c9d0e-1f2a-4b3c-8d4e-6f7a8b9c0d1e',
    divisionName: 'Open',
    label: 'Finals',
    round: null,
  });

  it('reads a copy kept before the round tag, the slots and waiting existed, as null', () => {
    const copy = base();
    const row = nowRow(copy);
    for (const key of ['roundTag', 'homeSlot', 'awaySlot']) delete row[key];
    copy.approvals.push(waitingApproval());
    const day = readStoredDay(copy);
    const court = day?.courts.find((c) => c.now !== null);
    expect([court?.now?.roundTag, court?.now?.homeSlot, court?.now?.awaySlot]).toEqual([
      null,
      null,
      null,
    ]);
    expect(day?.approvals.at(-1)?.waiting).toBeNull();
  });

  it.each([
    [
      'a row status that is no status',
      (c: ReturnType<typeof base>) => (nowRow(c).status = 'bogus'),
    ],
    [
      'a row status in the wire’s spelling',
      (c: ReturnType<typeof base>) => (nowRow(c).status = 'in_play'),
    ],
    [
      'a row field in the wire’s spelling',
      (c: ReturnType<typeof base>) => {
        const row = nowRow(c);
        row.fixture_id = row.fixtureId;
        delete row.fixtureId;
      },
    ],
    ['a fixture id that is no id', (c: ReturnType<typeof base>) => (nowRow(c).fixtureId = 'x')],
    [
      'a waiting that is no word',
      (c: ReturnType<typeof base>) => c.approvals.push({ ...waitingApproval(), waiting: 'bogus' }),
    ],
    [
      'a waiting in the wire’s spelling',
      (c: ReturnType<typeof base>) =>
        c.approvals.push({ ...waitingApproval(), waiting: 'stage_complete' }),
    ],
    ['a round tag that is a number', (c: ReturnType<typeof base>) => (nowRow(c).roundTag = 7)],
    ['a slot that is a number', (c: ReturnType<typeof base>) => (nowRow(c).homeSlot = 7)],
    ['a row with no home', (c: ReturnType<typeof base>) => delete nowRow(c).home],
    [
      'a row time that is no time',
      (c: ReturnType<typeof base>) => (nowRow(c).scheduledAt = 'soon'),
    ],
    ['a court with no name', (c: ReturnType<typeof base>) => delete c.courts[0]?.courtName],
    [
      'a court state that is no state',
      (c: ReturnType<typeof base>) => c.courts[0] && (c.courts[0].state = 'busy'),
    ],
    [
      'a court list item that is none',
      (c: ReturnType<typeof base>) => c.courts.push(null as never),
    ],
    [
      'an approval round that is text',
      (c: ReturnType<typeof base>) =>
        c.approvals.push({
          kind: 'swiss',
          stageId: '3b8c9d0e-1f2a-4b3c-8d4e-6f7a8b9c0d1e',
          divisionName: 'Open',
          label: 'S',
          round: '4',
        }),
    ],
    ['no competition', (c: ReturnType<typeof base>) => delete c.competition],
    ['a day that is no day', (c: ReturnType<typeof base>) => (c.day = '7 Nov')],
    ['no flag for approving', (c: ReturnType<typeof base>) => delete c.canApprove],
    ['a calling flag that is text', (c: ReturnType<typeof base>) => (c.canCall = 'yes')],
  ])('%s is no day', (_, spoil) => {
    const copy = base();
    expect(readStoredDay(copy)).not.toBeNull();
    spoil(copy);
    expect(readStoredDay(copy)).toBeNull();
  });

  it.each([null, 'day', 3, []])('%j is no day', (raw) => {
    expect(readStoredDay(raw)).toBeNull();
  });
});
