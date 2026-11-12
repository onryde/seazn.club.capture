import { describe, expect, it } from 'vitest';
import { courtOf, exitCopy, exitRecorded, sendingCards } from '@/domain/matchday/exit';
import type { Court, MatchDay, Row } from '@/domain/matchday/matchDay';
import type { ScoringCurrent, ScoringHome, ScoringLeftover } from '@/domain/mode/scoringHome';

const row = (fixtureId: string): Row => ({
  fixtureId,
  sportKey: 'badminton',
  divisionName: "Men's singles",
  roundLabel: null,
  home: 'Ng',
  away: 'Brown',
  status: 'upcoming',
  scheduledAt: null,
  summary: null,
});
const court = (courtName: string, more: Partial<Court> = {}): Court => ({
  courtId: `id-${courtName}`,
  courtName,
  venueName: 'Hall A',
  state: 'free',
  now: null,
  next: [],
  finished: [],
  ...more,
});
const dayOf = (courts: readonly Court[]): MatchDay => ({ courts }) as unknown as MatchDay;

describe('exitCopy: what Exit asks (S4 design §4)', () => {
  it('nothing unsent is the plain body', () => {
    expect(exitCopy(0)).toEqual({ body: 'matchday.exit.body' });
  });

  it('3 unsent is the sending body with its count', () => {
    expect(exitCopy(3)).toEqual({ body: 'matchday.exit.bodySending', count: 3 });
  });

  it('one unsent is the same key with a count of 1 (the dictionary pluralises)', () => {
    expect(exitCopy(1)).toEqual({ body: 'matchday.exit.bodySending', count: 1 });
  });

  it('a queue the phone cannot read is taps at risk, never the plain body, whatever the count', () => {
    expect(exitCopy(0, true)).toEqual({ body: 'matchday.exit.bodyAtRisk' });
    expect(exitCopy(3, true)).toEqual({ body: 'matchday.exit.bodyAtRisk' });
  });

  it('a count below zero is nothing, not a sentence', () => {
    expect(exitCopy(-1)).toEqual({ body: 'matchday.exit.body' });
  });
});

describe('exitRecorded: the record line’s unsent', () => {
  it('is the count, and null for an unreadable queue', () => {
    expect(exitRecorded({ count: 3, unreadable: false })).toBe(3);
    expect(exitRecorded({ count: 3, unreadable: true })).toBeNull();
  });
});

describe('courtOf: where a match sat', () => {
  const day = dayOf([
    court('Court 1', { now: row('a'), next: [row('b')] }),
    court('Court 2', { finished: [row('c')] }),
  ]);

  it('finds a match in now, in the queue and in the finished ones', () => {
    expect(courtOf(day, 'a')).toBe('Court 1');
    expect(courtOf(day, 'b')).toBe('Court 1');
    expect(courtOf(day, 'c')).toBe('Court 2');
  });

  it('is null for a match on no court, and for an empty day', () => {
    expect(courtOf(day, 'zzz')).toBeNull();
    expect(courtOf(dayOf([]), 'a')).toBeNull();
  });
});

describe('sendingCards: Home after Exit', () => {
  const live = (fixtureId: string, unsent: number, label = ''): ScoringLeftover => ({
    kind: 'live',
    fixtureId,
    label,
    unsent,
  });
  const home = (
    leftovers: readonly ScoringLeftover[],
    current: ScoringCurrent | null = null,
  ): ScoringHome => ({ current, leftovers });
  const courts = new Map([
    ['a', 'Court 2'],
    ['b', ''],
  ]);

  it('a live queue of a match Exit left sending is a card named by its court, and leaves the leftovers', () => {
    const out = sendingCards(courts, home([live('a', 3, 'Ng v Brown'), live('other', 2)]));
    expect(out.cards).toEqual([{ fixtureId: 'a', name: 'Court 2', unsent: 3 }]);
    expect(out.leftovers).toEqual([live('other', 2)]);
  });

  it('with no court it is named by the match, and with no name either by nothing', () => {
    const out = sendingCards(courts, home([live('b', 1, 'Lee v Tan')]));
    expect(out.cards).toEqual([{ fixtureId: 'b', name: 'Lee v Tan', unsent: 1 }]);
    expect(sendingCards(courts, home([live('b', 1)])).cards[0]?.name).toBeNull();
  });

  it('a queue that cannot send or be read keeps its own card and is never told as sending', () => {
    const dead: ScoringLeftover = { kind: 'dead', fixtureId: 'a', label: 'x', unsent: 2 };
    const asked: ScoringLeftover = { kind: 'asked', fixtureId: 'b', label: 'y', unsent: 2 };
    const unreadable: ScoringLeftover = { kind: 'unreadable', fixtureId: 'a' };
    const out = sendingCards(courts, home([dead, asked, unreadable]));
    expect(out.cards).toEqual([]);
    expect(out.leftovers).toEqual([dead, asked, unreadable]);
  });

  it('a match whose queue has emptied has no card, and none is made for a match Exit did not list', () => {
    expect(sendingCards(courts, home([live('a', 0)])).cards).toEqual([]);
    expect(sendingCards(new Map(), home([live('a', 3)])).cards).toEqual([]);
  });

  it('the saved match is a card too, while it is live with taps to send', () => {
    const current: ScoringCurrent = {
      fixtureId: 'a',
      label: 'Ng v Brown',
      unsent: 3,
      state: 'live',
      finished: null,
    };
    expect(sendingCards(courts, home([], current)).cards).toEqual([
      { fixtureId: 'a', name: 'Court 2', unsent: 3 },
    ]);
    expect(sendingCards(courts, home([], { ...current, state: 'dead' })).cards).toEqual([]);
    expect(
      sendingCards(courts, home([], { ...current, finished: { score: '21-5' } })).cards,
    ).toEqual([]);
  });

  it('no court named for any match, no cards', () => {
    expect(sendingCards(new Map(), home([])).cards).toEqual([]);
  });
});
