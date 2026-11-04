import { describe, expect, it } from 'vitest';
import type { MatchQueue } from '@/domain/scoring/queue';
import { openMatch, step } from '@/domain/scoring/scoringMatch';
import type { MatchHeld, MatchState } from '@/domain/scoring/scoringMatchState';
import { tableTennisSport } from '@/domain/scoring/tableTennisSport';
import type { TableTennisTypes } from '@/domain/scoring/tableTennisPad';
import { NOW, savesOf, sendsOf } from '../../../test/scoringMatchFixtures';
import {
  PHONE_LINK,
  SINGLES,
  ledgerOf,
  rally,
  start,
  type Spec,
} from '../../../test/tableTennisLedger';

// Plan S2-2 Task 4 fix round 1 (the controller's ruling, 2026-11-04): the runtime copies the sport's `base` from the event
// a tap is onto the queued tap, and the sport's `payloadForSend` reads it back at the first send. This drives a table
// tennis match through the real reducer: the phone queues the Start pick's rally while a co-scorer's points land, and
// the send that follows must not carry a `serving` that was made at another score. Expected payloads are literals.

const AT = '2026-11-04T09:00:00.000Z';
const QUEUE: MatchQueue = {
  fixtureId: SINGLES.fixtureId,
  label: 'A. Sharma v L. Chen',
  pending: [],
  ownEventIds: [],
  dead: null,
};

const held = (
  specs: readonly Spec[],
  toss: 'first' | 'second' | null,
): MatchHeld<TableTennisTypes> => ({
  sport: tableTennisSport,
  queue: QUEUE,
  ledger: ledgerOf(specs),
  bootstrap: SINGLES,
  toss,
  judge: 'fold',
  foreground: true,
  rulesVersion: 1,
  decidedAt: null,
});

/** The match opened and its first reads answered with nothing new: the state a scorer finds. */
function ready(
  specs: readonly Spec[],
  toss: 'first' | 'second' | null,
): MatchState<TableTennisTypes> {
  const opened = openMatch(held(specs, toss), NOW);
  return step(opened.state, { kind: 'fetched', events: [] }, NOW).state;
}

/** The scorer taps `tap`; the save of the queue has not landed yet (the phone is mid-write, or offline). */
function tapped(from: MatchState<TableTennisTypes>, tap: TableTennisTypes['tap']) {
  return step(from, { kind: 'tap', tap, key: 'k-tap', at: AT }, NOW);
}

/** The ledger, held as `before`, gains `landed` (a co-scorer's), then the tap's save lands: the send that follows. */
function sentAfter(
  made: ReturnType<typeof tapped>,
  before: readonly Spec[],
  landed: readonly Spec[],
) {
  const [save] = savesOf(made.effects);
  const events = ledgerOf([...before, ...landed]).slice(before.length);
  const read = step(made.state, { kind: 'fetched', events }, NOW);
  const saved = step(read.state, { kind: 'saved', n: save.n }, NOW);
  return sendsOf([...read.effects, ...saved.effects])[0];
}

/** A point; a held answer says the count of score events it was made at (`servingAt`), as the hook's `carry` does. */
const point = (
  side: 'first' | 'second',
  serving: 'first' | 'second' | null = null,
  servingAt: number | null = null,
) => ({ kind: 'rally', side, serving, servingAt }) as const;

/** Three points a browser scorer records, none of them naming who served. */
const CO_SCORER: readonly Spec[] = [
  rally({ wonBy: 'A' }),
  rally({ wonBy: 'A' }),
  rally({ wonBy: 'H' }),
];

describe('a Start pick’s rally, queued at 0–0 while a co-scorer scores', () => {
  const made = () => tapped(ready([start()], 'second'), point('first'));

  it('is queued with the score count it was made at, the pick naming the side picked as serving', () => {
    const { pending } = made().state.sync.queue;
    expect(pending[0]).toMatchObject({
      key: 'k-tap',
      type: 'tabletennis.rally',
      payload: { wonBy: 'ent-home', serving: 'ent-away', scorer: 'p-sharma' },
      base: 0,
    });
  });

  it('is sent with its serving when no point landed first', () => {
    expect(sentAfter(made(), [start()], []).body.payload).toEqual({
      wonBy: 'ent-home',
      serving: 'ent-away',
      scorer: 'p-sharma',
    });
  });

  // The reviewer's probe: after 2 and after 3 co-scorer points the engine would name the wrong next server for the match.
  it.each([1, 2, 3])(
    'is sent without its serving when %i co-scorer points landed first',
    (landed) => {
      const send = sentAfter(made(), [start()], CO_SCORER.slice(0, landed));
      expect(send.body.payload).toEqual({ wonBy: 'ent-home', scorer: 'p-sharma' });
      expect(send.sent.payload).toEqual({ wonBy: 'ent-home', scorer: 'p-sharma' });
      expect(send.sent.attempts).toBe(1);
    },
  );
});

describe('a held Who is serving? answer rides the next point', () => {
  const ledger: readonly Spec[] = [start(), rally({ wonBy: 'A' })];
  const made = () => tapped(ready(ledger, null), point('first', 'second', 1));

  it('is queued with the count of the one point that stands', () => {
    expect(made().state.sync.queue.pending[0]).toMatchObject({
      payload: { wonBy: 'ent-home', serving: 'ent-away', scorer: 'p-sharma' },
      base: 1,
    });
  });

  it('is sent as answered while the score is where it was made', () => {
    expect(sentAfter(made(), ledger, []).body.payload).toEqual({
      wonBy: 'ent-home',
      serving: 'ent-away',
      scorer: 'p-sharma',
    });
  });

  it('is sent without it once another point has landed', () => {
    expect(sentAfter(made(), ledger, [rally({ wonBy: 'H' })]).body.payload).toEqual({
      wonBy: 'ent-home',
      scorer: 'p-sharma',
    });
  });
});

describe('a tap that names no serving', () => {
  it('is queued with no base', () => {
    const made = tapped(
      ready([start(), rally({ wonBy: 'A', serving: 'H' })], null),
      point('second'),
    );
    expect(made.state.sync.queue.pending[0]).not.toHaveProperty('base');
  });
});

// Fix round 2 (I2 of the Batch C review, probe rv-bc/resend): the phone is offline when it taps the Start pick's rally, so
// the send is marked as an attempt and answered `offline`. A browser scorer then scores, and on reconnect the phone
// reads their points and resends. The web matches a resend by its key and never compares payloads, so a first attempt it
// never stored is appended as new: the resend goes without the stamp unless the ledger holds a copy of the tap.
describe('a Start pick’s rally sent once while offline, then resent after a co-scorer scored', () => {
  /** The pick's rally tapped at 0–0, sent (attempt 1) and answered `offline`; its saves landed. */
  function offlineAfterFirstSend() {
    const made = tapped(ready([start()], 'second'), point('first'));
    let state = step(made.state, { kind: 'saved', n: savesOf(made.effects)[0].n }, NOW);
    const [first] = sendsOf(state.effects);
    let held = state.state;
    for (const save of savesOf(state.effects))
      held = step(held, { kind: 'saved', n: save.n }, NOW).state;
    const off = step(
      held,
      { kind: 'answered', sent: first.sent, answer: { kind: 'offline' } },
      NOW,
    );
    held = off.state;
    for (const save of savesOf(off.effects))
      held = step(held, { kind: 'saved', n: save.n }, NOW).state;
    return { state: held, first };
  }

  /**
   * The fetch on reconnect brings in `landed` (recorded a second apart from 08:59:01, a minute before the tap, so each is
   * recorded since the tap was made, with the margin the reconnect question allows); the question, if it asks, is answered
   * Send; the clock moves past the retry wait. Returns the resends.
   */
  function resends(landed: readonly Spec[], from = '2026-11-04T08:59:00.000Z') {
    const events = ledgerOf([start(), ...landed], from).slice(1);
    const sends: ReturnType<typeof sendsOf> = [];
    const saves: number[] = [];
    const take = (done: ReturnType<typeof step<TableTennisTypes>>) => {
      saves.push(...savesOf(done.effects).map((save) => save.n));
      sends.push(...sendsOf(done.effects));
      return done.state;
    };
    let now = NOW + 1_000;
    let current = take(step(offlineAfterFirstSend().state, { kind: 'fetched', events }, now));
    if (current.sync.queue.askedAbout !== undefined) {
      current = take(step(current, { kind: 'answerAsk', answer: 'send' }, now));
    }
    while (saves.length > 0)
      current = take(step(current, { kind: 'saved', n: saves.shift()! }, now));
    now += 60_000;
    take(step(current, { kind: 'tick' }, now));
    return sends;
  }

  it('is first sent with its stamp, and answered offline with the attempt kept', () => {
    const { state, first } = offlineAfterFirstSend();
    expect(first.body.payload).toEqual({
      wonBy: 'ent-home',
      serving: 'ent-away',
      scorer: 'p-sharma',
    });
    expect(state.sync.queue.pending[0]).toMatchObject({ key: 'k-tap', attempts: 1, base: 0 });
  });

  it('drops the stamp from the resend when two co-scorer points landed and the ledger holds no copy', () => {
    const [resend] = resends(CO_SCORER.slice(0, 2));
    expect(resend.sent.attempts).toBe(2);
    expect(resend.body.payload).toEqual({ wonBy: 'ent-home', scorer: 'p-sharma' });
    expect(resend.sent.payload).toEqual({ wonBy: 'ent-home', scorer: 'p-sharma' });
  });

  it('does so whether or not the reconnect question asked (the points were recorded long before the tap)', () => {
    const [resend] = resends(CO_SCORER.slice(0, 2), '2026-11-03T10:00:00.000Z');
    expect(resend.body.payload).toEqual({ wonBy: 'ent-home', scorer: 'p-sharma' });
  });

  it('keeps the stamp when nothing landed: the score is where it was made', () => {
    const [resend] = resends([]);
    expect(resend.body.payload).toEqual({
      wonBy: 'ent-home',
      serving: 'ent-away',
      scorer: 'p-sharma',
    });
  });

  it('keeps the payload as first sent when the ledger holds the phone’s own copy of the tap', () => {
    const copy: Spec = {
      ...rally({ wonBy: 'H', serving: 'A' }),
      payload: { wonBy: 'ent-home', serving: 'ent-away', scorer: 'p-sharma' },
      link: PHONE_LINK,
    };
    const [resend] = resends([copy, rally({ wonBy: 'A' }), rally({ wonBy: 'H' })]);
    expect(resend.sent.attempts).toBe(2);
    expect(resend.body.payload).toEqual({
      wonBy: 'ent-home',
      serving: 'ent-away',
      scorer: 'p-sharma',
    });
  });

  it('does not take a co-scorer’s identical rally for the copy: it is the other scorer’s', () => {
    const lookalike: Spec = {
      ...rally({ wonBy: 'H', serving: 'A' }),
      payload: { wonBy: 'ent-home', serving: 'ent-away', scorer: 'p-sharma' },
    };
    const [resend] = resends([lookalike, rally({ wonBy: 'A' }), rally({ wonBy: 'H' })]);
    expect(resend.body.payload).toEqual({ wonBy: 'ent-home', scorer: 'p-sharma' });
  });
});
