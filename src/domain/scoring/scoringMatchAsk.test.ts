import { describe, expect, it } from 'vitest';
import { openMatch, step } from '@/domain/scoring/scoringMatch';
import { askOf, askSaying, copiesOf, noteForeign } from '@/domain/scoring/scoringMatchAsk';
import type { MatchEvent, MatchState } from '@/domain/scoring/scoringMatchState';
import type { LedgerEvent } from '@/domain/scoring/wire';
import {
  PHONE_LINK,
  SINGLES,
  ledgerOf,
  queuedOf,
  rallies,
  rally,
  start,
  voiding,
  type Spec,
} from '../../../test/badmintonLedger';
import {
  ACCEPTED,
  AT,
  NOW,
  held,
  opened,
  queueOf,
  savesOf,
  sendsOf,
  sentOnce,
  tapped,
} from '../../../test/scoringMatchFixtures';

// The reconnect question (owner ruling 43, 2026-11-02): the owner scored offline, someone scored on the web, the data
// came back, and the phone sent its own taps on top of the web's. Two people scoring the same rallies count them twice,
// so a fetch that brings events the phone did not make, while it has taps queued, stops the sender until the scorer
// answers. Literal numbers: seq 1 is the start, seq 2 on is what the fetches bring.

/**
 * The phone's taps are made at 10:30 (`queuedOf`). What the web records after that is another scorer's, so a ledger
 * for a fetch is clocked from a minute after: its first event is 10:31:01, a second apart.
 */
const AFTER = '2026-11-01T10:31:00.000Z';
const web = (specs: readonly Spec[]): LedgerEvent[] => ledgerOf(specs, AFTER);

/** The events at seq `from` on of a ledger built from `specs`, as a fetch since the tip brings them. */
const fetching = (specs: readonly Spec[], from: number): MatchEvent => ({
  kind: 'fetched',
  events: web(specs).slice(from - 1),
});

const two = [queuedOf('k1', rally('H')), queuedOf('k2', rally('H'))];
const elsewhere: Spec[] = [start(), rally('A')];

/** The queue saves the runner has made land, as it does: a send waits for every save before it. */
function landed(state: MatchState): MatchState {
  let now = state;
  while (now.saving > 0) now = step(now, { kind: 'saved', n: 99 }, NOW).state;
  return now;
}

/** A match reopened with two taps queued, whose first read brings the web's rally at seq 2: the question stands. */
function asked(): MatchState {
  return landed(step(opened(tapped(two)), fetching(elsewhere, 2), NOW).state);
}

/** One event on the state, the saves before it landed: what the runner would have done by then. */
const run = (state: MatchState, event: MatchEvent) => step(landed(state), event, NOW);

describe('the reconnect question stands when a fetch brings events another scorer made', () => {
  it('asks, with the count and the taps waiting, and sends nothing', () => {
    const read = step(opened(tapped(two)), fetching(elsewhere, 2), NOW);
    expect(askOf(read.state)).toEqual({ foreign: 1, queued: 2 });
    expect(sendsOf(read.effects)).toEqual([]);
    expect(read.state.sync.queue.pending.map((tap) => tap.key)).toEqual(['k1', 'k2']);
  });

  it('asks nothing when the fetch brings nothing: the phone alone offline goes on by itself', () => {
    const read = step(opened(tapped(two)), { kind: 'fetched', events: [] }, NOW);
    expect(askOf(read.state)).toBeNull();
    expect(sendsOf(read.effects)).toHaveLength(1);
  });

  it('asks nothing with nothing queued, and nothing for a queue the link no longer takes', () => {
    const none = step(opened(), fetching(elsewhere, 2), NOW);
    expect(askOf(none.state)).toBeNull();
    const dead = step(
      opened({ queue: queueOf({ pending: two, dead: 'LINK_REVOKED' }) }),
      fetching(elsewhere, 2),
      NOW,
    );
    expect(askOf(dead.state)).toBeNull();
    expect(dead.state.sync.queue.askedAbout).toBeUndefined();
  });

  it('counts one question for the several events one fetch brings', () => {
    const read = step(
      opened(tapped(two)),
      fetching([start(), rally('A'), rally('A'), rally('H')], 2),
      NOW,
    );
    expect(askOf(read.state)).toEqual({ foreign: 3, queued: 2 });
  });

  it('does not count the phone’s own event whose id the queue file holds (the ledger cache was lost, the file was not)', () => {
    const read = step(
      opened({ queue: queueOf({ pending: two, ownEventIds: ['ev-2'] }) }),
      fetching(elsewhere, 2),
      NOW,
    );
    expect(askOf(read.state)).toBeNull();
  });

  it('does not count the copy of a tap whose answer was lost: the phone’s link, the tap’s type and payload', () => {
    const lost = [{ ...queuedOf('k1', rally('H')), attempts: 1 }, queuedOf('k2', rally('H'))];
    const own = web([start(), { ...rally('H'), link: PHONE_LINK }]).slice(1);
    const read = step(opened(tapped(lost)), { kind: 'fetched', events: own }, NOW);
    expect(askOf(read.state)).toBeNull();
  });

  it('counts an identical rally from another link: a co-scorer’s is theirs', () => {
    const lost = [{ ...queuedOf('k1', rally('H')), attempts: 1 }];
    const theirs = web([start(), rally('H')]).slice(1);
    const read = step(opened(tapped(lost)), { kind: 'fetched', events: theirs }, NOW);
    expect(askOf(read.state)).toEqual({ foreign: 1, queued: 1 });
  });

  it('does not count the copy of the tap in flight a ping’s fetch beat the answer with, but counts a co-scorer’s at that seq', () => {
    const { state } = sentOnce([queuedOf('k2', rally('H'))]);
    const mine = web([start(), { ...rally('H'), link: PHONE_LINK }]).slice(1);
    expect(askOf(run(state, { kind: 'fetched', events: mine }).state)).toBeNull();
    const theirs = web([start(), rally('H')]).slice(1);
    expect(askOf(run(state, { kind: 'fetched', events: theirs }).state)).toEqual({
      foreign: 1,
      queued: 1,
    });
  });

  it('does not ask for a rally and its Undo that came together: they cancel', () => {
    const read = step(opened(tapped(two)), fetching([start(), rally('A'), voiding(2)], 2), NOW);
    expect(askOf(read.state)).toBeNull();
    expect(sendsOf(read.effects)).toHaveLength(1);
  });

  it('does not ask for another scorer’s Undo of the phone’s own event: nothing was scored', () => {
    const queue = queueOf({ pending: two, ownEventIds: ['ev-2'] });
    const read = step(
      opened({ queue, ledger: web([start(), { ...rally('H'), link: PHONE_LINK }]) }),
      fetching([start(), rally('H'), voiding(2)], 3),
      NOW,
    );
    expect(askOf(read.state)).toBeNull();
  });

  it('asks the same of a sender with no screen: it holds, and sends nothing, without a bootstrap or a fold', () => {
    const headless = held({ judge: 'trust', bootstrap: null, queue: queueOf({ pending: two }) });
    const read = step(openMatch(headless, NOW).state, fetching(elsewhere, 2), NOW);
    expect(read.state.sync.queue.askedAbout).toEqual(['ev-2']);
    expect(sendsOf(read.effects)).toEqual([]);
  });
});

describe('while the question stands', () => {
  it('sends nothing, on a tick, on the app coming back, or on a ping’s fetch', () => {
    const state = asked();
    for (const event of [
      { kind: 'tick' },
      { kind: 'foreground' },
      { kind: 'read' },
      { kind: 'fetched', events: [] },
    ] as const) {
      expect(sendsOf(run(state, event).effects), event.kind).toEqual([]);
    }
  });

  it('counts the events that land meanwhile, and the ones taken back', () => {
    let state = asked();
    state = run(state, fetching([...elsewhere, rally('A')], 3)).state;
    expect(askOf(state)).toEqual({ foreign: 2, queued: 2 });
    state = run(state, fetching([...elsewhere, rally('A'), voiding(3)], 4)).state;
    expect(askOf(state)).toEqual({ foreign: 1, queued: 2 });
  });

  it('is no question once every event it was about was taken back: the taps go on, judged again', () => {
    const state = asked();
    const read = run(state, fetching([...elsewhere, voiding(2)], 3));
    expect(askOf(read.state)).toBeNull();
    expect(read.state.sync.queue.askedAbout).toBeUndefined();
    expect(sendsOf(read.effects)).toHaveLength(1);
    expect(sendsOf(read.effects)[0].body.expected_seq).toBe(3);
  });

  it('ends with the queue: nothing left to send or discard asks nothing', () => {
    const state = asked();
    const emptied = {
      ...state,
      sync: { ...state.sync, queue: { ...state.sync.queue, pending: [] } },
    };
    const read = run(emptied, { kind: 'tick' });
    expect(askOf(read.state)).toBeNull();
  });

  it('is not askable for a link the door does not take, or an app too old: those have their own say', () => {
    const state = asked();
    const dead = {
      ...state,
      sync: { ...state.sync, queue: { ...state.sync.queue, dead: 'gone' as const } },
    };
    expect(askOf(dead)).toBeNull();
    expect(
      askOf({ ...state, bootstrap: { ...SINGLES, epochRequired: state.sync.engineEpoch + 1 } }),
    ).toBeNull();
  });
});

describe('the answer: send', () => {
  it('lifts the question, judges the queue on the ledger as it stands, and sends the head at the tip', () => {
    const answered = run(asked(), { kind: 'answerAsk', answer: 'send' });
    expect(askOf(answered.state)).toBeNull();
    expect(answered.state.sync.queue.askedAbout).toBeUndefined();
    const sends = sendsOf(answered.effects);
    expect(sends).toHaveLength(1);
    expect(sends[0].body.expected_seq).toBe(2);
    expect(sends[0].sent.key).toBe('k1');
    expect(savesOf(answered.effects).some((save) => save.queue?.askedAbout === undefined)).toBe(
      true,
    );
  });

  it('is judged on the ledger as it stands, as every send is: what the web’s events made illegal never goes', () => {
    // Away wins 42 straight (two games of 21): the match is over, so the phone's two rallies are no longer legal.
    const decided: Spec[] = [start(), ...rallies('A'.repeat(42))];
    const read = run(opened(tapped(two)), fetching(decided, 2));
    expect(read.state.sync.queue.pending).toEqual([]);
    expect(read.state.line).toEqual({ kind: 'refusal', key: 'scoring.refusal.notCounted' });
    expect(askOf(read.state)).toBeNull();
    expect(sendsOf(read.effects)).toEqual([]);
  });

  it('is judged again when answered: a tap the ledger made illegal while the question stood is not sent', () => {
    const state = asked();
    const late = fetching([...elsewhere, ...rallies('A'.repeat(41))], 3);
    const read = run(state, late);
    expect(read.state.sync.queue.pending).toEqual([]);
    const answered = run(read.state, { kind: 'answerAsk', answer: 'send' });
    expect(sendsOf(answered.effects)).toEqual([]);
  });

  it('waits for a read that is out: the answer does not clear the hold the question stands under', () => {
    // A rules read asked for while the sheet was open (`retryRules` does it between steps), still on its way.
    const reading = asked();
    const holding = { ...reading, sync: { ...reading.sync, hold: 'rules' as const } };
    const answered = run(holding, { kind: 'answerAsk', answer: 'send' });
    expect(sendsOf(answered.effects)).toEqual([]);
    expect(answered.state.sync.hold).toBe('rules');
    expect(answered.state.sync.revalidateOwed).toBe(true);
    expect(answered.state.sync.queue.askedAbout).toBeUndefined();
  });

  // A ledger the pump never leaves a queue behind (it judges at every move, so a question never stands on a stale
  // judgement), built by hand: the answer itself judges again, so a tap the ledger no longer allows never goes.
  it('judges the queue again when it is answered, whatever the ledger became while the question stood', () => {
    const state = asked();
    const decided = web([start(), ...rallies('A'.repeat(42))]);
    const stale = { ...state, sync: { ...state.sync, ledger: decided, tip: decided.length } };
    const answered = run(stale, { kind: 'answerAsk', answer: 'send' });
    expect(answered.state.sync.queue.pending).toEqual([]);
    expect(sendsOf(answered.effects)).toEqual([]);
  });

  it('is taken once: a second tap on the button that has gone changes nothing', () => {
    const once = run(asked(), { kind: 'answerAsk', answer: 'send' });
    const twice = run(once.state, { kind: 'answerAsk', answer: 'send' });
    expect(sendsOf(twice.effects)).toEqual([]);
    expect(twice.state.sync.queue).toEqual(once.state.sync.queue);
  });
});

describe('the answer: discard', () => {
  it('deletes every queued tap, sends nothing, and leaves the ledger as the web has it', () => {
    const answered = run(asked(), { kind: 'answerAsk', answer: 'discard' });
    expect(answered.state.sync.queue.pending).toEqual([]);
    expect(answered.state.sync.queue.askedAbout).toBeUndefined();
    expect(askOf(answered.state)).toBeNull();
    expect(sendsOf(answered.effects)).toEqual([]);
    expect(answered.state.sync.ledger.map((event) => event.id)).toEqual(['ev-1', 'ev-2']);
    const saved = savesOf(answered.effects).at(-1);
    expect(saved?.queue?.pending).toEqual([]);
  });

  it('keeps the event whose answer was lost: it is the phone’s own now, not a tap to delete', () => {
    const lost = [{ ...queuedOf('k1', rally('H')), attempts: 1 }, queuedOf('k2', rally('H'))];
    const cache = web([start(), { ...rally('H'), link: PHONE_LINK }]);
    const read = run(
      opened({ ...tapped(lost), ledger: cache }),
      fetching([start(), rally('H'), rally('A')], 3),
    );
    expect(askOf(read.state)).toEqual({ foreign: 1, queued: 2 });
    const answered = run(read.state, { kind: 'answerAsk', answer: 'discard' });
    expect(answered.state.sync.queue.pending).toEqual([]);
    expect(answered.state.sync.queue.ownEventIds).toEqual(['ev-2']);
  });

  it('forgets a tap in flight: its answer, when it comes, is taken as any late answer is', () => {
    const { state } = sentOnce([queuedOf('k2', rally('H'))]);
    const read = run(state, fetching([start(), rally('A'), rally('A')], 2));
    expect(askOf(read.state)).not.toBeNull();
    const answered = run(read.state, { kind: 'answerAsk', answer: 'discard' });
    expect(answered.state.sync.queue.pending).toEqual([]);
    expect(answered.state.sent).toBeNull();
    expect(answered.state.sync.inFlight).toBeNull();
    const late = run(answered.state, {
      kind: 'answered',
      sent: read.state.sync.queue.pending[0],
      answer: { ...ACCEPTED, seq: 4 },
    });
    expect(late.state.sync.queue.pending).toEqual([]);
    expect(sendsOf(late.effects)).toEqual([]);
    // It was sent, so it counts: the event lands in the ledger as the phone's own, and Undo reaches it.
    expect(late.state.sync.ledger.map((event) => event.id)).toEqual([
      'ev-1',
      'ev-2',
      'ev-3',
      'srv-1',
    ]);
    expect(late.state.sync.queue.ownEventIds).toEqual(['srv-1']);
    const undone = run(late.state, { kind: 'undo', key: 'u1', at: AT });
    expect(undone.state.sync.queue.pending.map((tap) => [tap.type, tap.payload])).toEqual([
      ['core.void', { event_id: 'srv-1' }],
    ]);
  });

  it('is taken once, and with nothing asked does nothing', () => {
    const none = run(opened(tapped(two)), { kind: 'answerAsk', answer: 'discard' });
    expect(none.state.sync.queue.pending).toHaveLength(2);
  });
});

describe('the question survives a kill', () => {
  it('is in the queue file the step saves, and stands again when that file is read back with its ledger', () => {
    const read = step(opened(tapped(two)), fetching(elsewhere, 2), NOW);
    const file = savesOf(read.effects).find((save) => save.queue !== null);
    expect(file?.queue?.askedAbout).toEqual(['ev-2']);
    const reopened = openMatch(
      held({ queue: file?.queue ?? queueOf(), ledger: read.state.sync.ledger }),
      NOW,
    );
    expect(askOf(reopened.state)).toEqual({ foreign: 1, queued: 2 });
    const first = step(reopened.state, { kind: 'fetched', events: [] }, NOW);
    expect(askOf(first.state)).toEqual({ foreign: 1, queued: 2 });
    expect(sendsOf(first.effects)).toEqual([]);
  });

  it('stands again when the ledger cache was lost with the kill: the id is in the file, and the refetch finds the events', () => {
    const read = step(opened(tapped(two)), fetching(elsewhere, 2), NOW);
    const file = savesOf(read.effects).find((save) => save.queue !== null);
    const reopened = openMatch(
      held({ queue: file?.queue ?? queueOf(), ledger: web([start()]) }),
      NOW,
    );
    const first = step(reopened.state, fetching(elsewhere, 2), NOW);
    expect(askOf(first.state)).toEqual({ foreign: 1, queued: 2 });
    expect(sendsOf(first.effects)).toEqual([]);
  });
});

describe('the ledger a fetch brings is read, not trusted blind', () => {
  it('a batch that does not continue the ledger asks nothing and is fetched again', () => {
    const gap = web([start(), rally('A'), rally('A')]).slice(2);
    const read = step(opened(tapped(two)), { kind: 'fetched', events: gap }, NOW);
    expect(askOf(read.state)).toBeNull();
    expect(read.state.sync.queue.askedAbout).toBeUndefined();
  });

  it('events already held are no news: a repeated fetch does not ask again', () => {
    const once = run(opened(tapped(two)), { kind: 'fetched', events: web([start()]) });
    expect(askOf(once.state)).toBeNull();
  });
});

// What counts as another scorer's, read on the functions themselves: through `step` a second rule (a question that is
// no question, `releaseMoot`; the refusal a revalidation makes) can stand in for a guard, so the guards are read bare.
describe('what the question counts, guard by guard', () => {
  const unresolved = (key: string, spec: Spec = rally('H')) => ({
    ...queuedOf(key, spec),
    attempts: 1,
  });
  const withLedger = (state: MatchState, ledger: readonly LedgerEvent[]): MatchState => ({
    ...state,
    sync: { ...state.sync, ledger },
  });

  it('a fetch that brings nothing new changes nothing, asking or not: the state itself comes back', () => {
    const quiet = opened(tapped(two));
    expect(noteForeign(quiet, [])).toBe(quiet);
    const standing = asked();
    expect(noteForeign(standing, [])).toBe(standing);
    expect(noteForeign(standing, standing.sync.ledger.slice(1))).toBe(standing);
  });

  it('a rally and its Undo, both in the ledger, are not a question: nothing is marked', () => {
    const events = web([start(), rally('A'), voiding(2)]);
    const merged = withLedger(opened(tapped(two)), events);
    expect(noteForeign(merged, events.slice(1))).toBe(merged);
    expect(merged.sync.queue.askedAbout).toBeUndefined();
  });

  it('an event that takes another back is never scored, by its type or by what it voids', () => {
    const [first, voided] = web([start(), voiding(1)]);
    const noTarget = { ...voided, voids: null };
    const otherType = { ...voided, type: 'badminton.rally' };
    for (const odd of [noTarget, otherType]) {
      const merged = withLedger(opened(tapped(two)), [first, odd]);
      expect(noteForeign(merged, [odd]), odd.type).toBe(merged);
    }
  });

  it('a tap never sent has no copy: an identical rally with no link (the organiser’s console) is another scorer’s', () => {
    const neverSent = opened(tapped([queuedOf('k1', rally('H'))]));
    const theirs = web([start(), { ...rally('H'), link: null }]).slice(1);
    const read = step(neverSent, { kind: 'fetched', events: theirs }, NOW);
    expect(askOf(read.state)).toEqual({ foreign: 1, queued: 1 });
  });

  it('a copy is of the tap’s own type: the phone’s link and the same payload, another type, is foreign', () => {
    const lost = opened(tapped([unresolved('k1')]));
    const other = web([start(), { ...rally('H'), link: PHONE_LINK }]).slice(1);
    const read = step(
      lost,
      { kind: 'fetched', events: [{ ...other[0], type: 'badminton.fault' }] },
      NOW,
    );
    expect(askOf(read.state)).toEqual({ foreign: 1, queued: 1 });
  });

  it('the tap in flight is copied only at the seq it was sent for: the phone’s identical rally later on is foreign', () => {
    const { state } = sentOnce([queuedOf('k2', rally('H'))]);
    const mine = { ...rally('H'), link: PHONE_LINK };
    // The tip is 1 and the tap went with expected_seq 1, so its copy is seq 2: this one is seq 3, behind another's.
    const later = web([start(), rally('A'), mine]).slice(1);
    expect(askOf(run(state, { kind: 'fetched', events: later }).state)).toEqual({
      foreign: 2,
      queued: 1,
    });
  });

  it('the later tap takes the later of two identical events, and the earlier tap the earlier', () => {
    const mine = { ...rally('H'), link: PHONE_LINK };
    const both = opened({
      queue: queueOf({ pending: [unresolved('k1'), unresolved('k2')] }),
      ledger: web([start(), mine, mine]),
    });
    const copies = copiesOf(both, both.sync.ledger);
    expect([copies.get('k1')?.id, copies.get('k2')?.id]).toEqual(['ev-2', 'ev-3']);
    expect([...copies.keys()]).toEqual(['k1', 'k2']);
  });

  it('each event is the copy of one tap, and an owned one is nobody’s', () => {
    const mine = { ...rally('H'), link: PHONE_LINK };
    const twice = opened({
      queue: queueOf({ pending: [unresolved('k1'), unresolved('k2')], ownEventIds: [] }),
      ledger: web([start(), mine]),
    });
    expect(copiesOf(twice, twice.sync.ledger).size).toBe(1);
    const owning = opened({
      queue: queueOf({ pending: [unresolved('k1')], ownEventIds: ['ev-2'] }),
      ledger: web([start(), mine, mine]),
    });
    expect([...copiesOf(owning, owning.sync.ledger).values()].map((copy) => copy.id)).toEqual([
      'ev-3',
    ]);
  });

  it('a question whose events were all taken back is none, before anything has released it', () => {
    const state = asked();
    const taken = withLedger(state, web([start(), rally('A'), voiding(2)]));
    expect(taken.sync.queue.askedAbout).toEqual(['ev-2']);
    expect(askOf(taken)).toBeNull();
  });
});

// The clock-skew margin (round 4, item 2): the phone's taps are made at 10:30. An event the web recorded long before
// is history that a lost ledger cache brought back, not another scorer's scoring on top of the phone's. Two minutes of
// margin (literal here) cover the phone's clock being behind the server's.
describe('events recorded before the phone’s taps are history, not a question', () => {
  const stamped = (events: readonly LedgerEvent[], at: readonly string[]): LedgerEvent[] =>
    events.map((event, i) => ({ ...event, recordedAt: at[i] }));
  const OLD = '2026-11-01T08:00:00.000Z';
  const taps = (...made: readonly string[]) =>
    made.map((createdAt, i) => ({ ...queuedOf(`k${i + 1}`, rally('H')), createdAt }));
  /** The start and one rally of the web's, the rally recorded at `recordedAt`: what a fetch brings after a lost cache. */
  const fetchOf = (recordedAt: string): MatchEvent => ({
    kind: 'fetched',
    events: stamped(ledgerOf([start(), rally('A')]), [OLD, recordedAt]),
  });
  const lost = (queue: ReturnType<typeof taps>) =>
    opened({ queue: queueOf({ pending: queue }), ledger: [] });

  it('a ledger cache lost with the kill: the refetch brings hours of history and asks nothing', () => {
    const history = ledgerOf([start(), rally('A'), rally('A'), rally('H')], OLD);
    const read = step(
      lost(taps('2026-11-01T10:30:00.000Z', '2026-11-01T10:30:05.000Z')),
      {
        kind: 'fetched',
        events: history,
      },
      NOW,
    );
    expect(askOf(read.state)).toBeNull();
    expect(read.state.sync.queue.askedAbout).toBeUndefined();
    expect(sendsOf(read.effects)).toHaveLength(1);
  });

  it('counts only what was recorded since: the history before the taps is left out of the count', () => {
    const events = stamped(ledgerOf([start(), rally('A'), rally('A')]), [
      OLD,
      '2026-11-01T08:05:00.000Z',
      '2026-11-01T10:35:00.000Z',
    ]);
    const read = step(lost(taps('2026-11-01T10:30:00.000Z')), { kind: 'fetched', events }, NOW);
    expect(askOf(read.state)).toEqual({ foreign: 1, queued: 1 });
  });

  it('the margin is two minutes: an event on that edge counts, one a millisecond before it does not', () => {
    const queue = taps('2026-11-01T10:30:00.000Z');
    expect(askOf(step(lost(queue), fetchOf('2026-11-01T10:28:00.000Z'), NOW).state)).toEqual({
      foreign: 1,
      queued: 1,
    });
    expect(askOf(step(lost(queue), fetchOf('2026-11-01T10:27:59.999Z'), NOW).state)).toBeNull();
  });

  it('a time it cannot read is asked about, not dropped', () => {
    const read = step(lost(taps('2026-11-01T10:30:00.000Z')), fetchOf('not a time'), NOW);
    expect(askOf(read.state)).toEqual({ foreign: 1, queued: 1 });
  });

  it('is measured from the oldest tap queued, not the newest', () => {
    const events = stamped(ledgerOf([start(), rally('A'), rally('A')]), [
      OLD,
      '2026-11-01T10:20:00.000Z',
      '2026-11-01T10:35:00.000Z',
    ]);
    const queue = taps('2026-11-01T10:30:00.000Z', '2026-11-01T10:50:00.000Z');
    const read = step(lost(queue), { kind: 'fetched', events }, NOW);
    expect(askOf(read.state)).toEqual({ foreign: 1, queued: 2 });
  });
});

// One answer covers the queue as it stood (round 4, item 1b): two scorers at once double-count whether the phone was
// offline or not, so the question is asked online too; but once the scorer has said Send, the drain of that same queue
// is not asked about again, whoever scores meanwhile.
describe('one answer covers the queue as it stood', () => {
  const sendAnswered = () => run(asked(), { kind: 'answerAsk', answer: 'send' });
  const accepted = (seq: number, eventId: string) =>
    ({ kind: 'accepted', seq, eventId, rulesVersion: 1 }) as const;
  const k3 = { kind: 'tap', tap: { kind: 'rally', side: 'first' }, key: 'k3', at: AT } as const;

  it('after Send, a fetch with another scorer’s event asks nothing', () => {
    const answered = sendAnswered();
    const read = run(answered.state, fetching([...elsewhere, rally('A')], 3));
    expect(askOf(read.state)).toBeNull();
    expect(read.state.sync.queue.askedAbout).toBeUndefined();
  });

  it('the whole drain is never asked about again, however the web scores while it goes', () => {
    const answered = sendAnswered();
    const k1 = sendsOf(answered.effects)[0].sent;
    // The web scores at seq 3 before k1 lands: k1 is turned back and goes again on top of it.
    let now = run(answered.state, fetching([...elsewhere, rally('A')], 3));
    expect(askOf(now.state)).toBeNull();
    now = run(now.state, {
      kind: 'answered',
      sent: k1,
      answer: { kind: 'seqConflict', currentSeq: 3 },
    });
    expect(askOf(now.state)).toBeNull();
    now = run(now.state, { kind: 'fetched', events: [] });
    expect(askOf(now.state)).toBeNull();
    expect(sendsOf(now.effects).map((send) => send.sent.key)).toEqual(['k1']);
    expect(sendsOf(now.effects)[0].body.expected_seq).toBe(3);
    now = run(now.state, { kind: 'answered', sent: k1, answer: accepted(4, 'srv-1') });
    expect(askOf(now.state)).toBeNull();
    const k2 = sendsOf(now.effects)[0].sent;
    expect(k2.key).toBe('k2');
    // Another web rally lands on top of k1 while k2 is out.
    now = run(now.state, fetching([...elsewhere, rally('A'), rally('H'), rally('A')], 5));
    expect(askOf(now.state)).toBeNull();
    expect(now.state.sync.queue.askedAbout).toBeUndefined();
    now = run(now.state, { kind: 'answered', sent: k2, answer: accepted(6, 'srv-2') });
    expect(now.state.sync.queue.pending).toEqual([]);
  });

  it('a tap queued after the answer is not covered: the next event another scorer makes asks again, about that event alone', () => {
    const answered = sendAnswered();
    const added = run(answered.state, k3);
    expect(added.state.sync.queue.pending.map((tap) => tap.key)).toEqual(['k1', 'k2', 'k3']);
    const read = run(added.state, fetching([...elsewhere, rally('A')], 3));
    expect(askOf(read.state)).toEqual({ foreign: 1, queued: 2 });
    expect(read.state.sync.queue.askedAbout).toEqual(['ev-3']);
    expect(sendsOf(read.effects)).toEqual([]);
  });

  it('is in the queue file, so a kill mid-drain and a reopen do not ask for the same queue', () => {
    const answered = sendAnswered();
    const file = savesOf(answered.effects).find((save) => save.queue !== null)?.queue;
    expect(file?.answeredSend).toEqual(['k1', 'k2']);
    const reopened = openMatch(
      held({ queue: file ?? queueOf(), ledger: answered.state.sync.ledger }),
      NOW,
    );
    const read = step(reopened.state, fetching([...elsewhere, rally('A')], 3), NOW);
    expect(askOf(read.state)).toBeNull();
  });

  it('is forgotten once the queue has emptied: the file holds no answer, and the next queue is asked about afresh', () => {
    const answered = sendAnswered();
    const k1 = sendsOf(answered.effects)[0].sent;
    let now = run(answered.state, { kind: 'answered', sent: k1, answer: accepted(3, 'srv-1') });
    now = run(now.state, {
      kind: 'answered',
      sent: sendsOf(now.effects)[0].sent,
      answer: accepted(4, 'srv-2'),
    });
    expect(now.state.sync.queue.pending).toEqual([]);
    expect(now.state.sync.queue.answeredSend).toBeUndefined();
    const last = savesOf(now.effects).at(-1);
    expect(last?.queue?.answeredSend).toBeUndefined();
  });

  it('Discard leaves nothing to cover: the file holds no answer, even one an earlier Send left', () => {
    // Send, a tap queued behind it, another scorer's rally: asked again with the earlier answer still in the file.
    const sent = run(run(asked(), { kind: 'answerAsk', answer: 'send' }).state, k3);
    const again = run(sent.state, fetching([...elsewhere, rally('A')], 3));
    expect(again.state.sync.queue.answeredSend).toEqual(['k1', 'k2']);
    expect(askOf(again.state)).not.toBeNull();
    const answered = run(again.state, { kind: 'answerAsk', answer: 'discard' });
    expect(answered.state.sync.queue.pending).toEqual([]);
    expect(answered.state.sync.queue.answeredSend).toBeUndefined();
    expect(savesOf(answered.effects).at(-1)?.queue?.answeredSend).toBeUndefined();
  });

  it('read bare: covered only when every tap waiting was in the answer', () => {
    const covered = { ...asked().sync.queue, askedAbout: undefined, answeredSend: ['k1', 'k2'] };
    const base = opened({ queue: covered });
    const foreign = web(elsewhere).slice(1);
    expect(noteForeign(base, foreign)).toBe(base);
    const fresh = { ...covered, pending: [...covered.pending, queuedOf('k3', rally('H'))] };
    const next = noteForeign(opened({ queue: fresh }), foreign);
    expect(next.sync.queue.askedAbout).toEqual(['ev-2']);
  });
});

// The tap in flight has been sent: the question is about the taps still to go (round 4, item 3).
describe('a tap in flight is not one of the taps the question is about', () => {
  it('counts only the taps waiting: the one sent is on its way whatever is answered', () => {
    const { state } = sentOnce([queuedOf('k2', rally('H')), queuedOf('k3', rally('H'))]);
    const read = run(state, fetching([start(), rally('A'), rally('A')], 2));
    expect(askOf(read.state)).toEqual({ foreign: 2, queued: 2 });
  });

  it('with only the tap in flight there is nothing to ask yet, and nothing goes: its answer decides', () => {
    const { state, sent } = sentOnce();
    const read = run(state, fetching(elsewhere, 2));
    expect(askOf(read.state)).toBeNull();
    expect(read.state.sync.queue.askedAbout).toEqual(['ev-2']);
    expect(sendsOf(run(read.state, { kind: 'tick' }).effects)).toEqual([]);
    // It lands (a cooperating server): nothing is left, so nothing was ever asked.
    const landed = run(read.state, {
      kind: 'answered',
      sent,
      answer: { ...ACCEPTED, seq: 3 },
    });
    expect(landed.state.sync.queue.pending).toEqual([]);
    expect(landed.state.sync.queue.askedAbout).toBeUndefined();
    expect(askOf(landed.state)).toBeNull();
  });

  it('turned back by the other scorer’s event, the tap is waiting again and the question is put', () => {
    const { state, sent } = sentOnce();
    const read = run(state, fetching(elsewhere, 2));
    const back = run(read.state, {
      kind: 'answered',
      sent,
      answer: { kind: 'seqConflict', currentSeq: 2 },
    });
    expect(askOf(back.state)).toEqual({ foreign: 1, queued: 1 });
    expect(sendsOf(back.effects)).toEqual([]);
  });
});

// Discard adopts the copy the lost answer made, and no other (round 4, item 5).
describe('the adopted copy of a tap whose answer was lost', () => {
  const mine = { ...rally('H'), link: PHONE_LINK };
  const lostTap = { ...queuedOf('k1', rally('H')), attempts: 1 };
  const at = (events: readonly LedgerEvent[], stamps: readonly string[]): LedgerEvent[] =>
    events.map((event, i) => ({ ...event, recordedAt: stamps[i] ?? event.recordedAt }));

  /** The phone's cached ledger, then a fetch that brings the web's rally on top: the question stands. */
  function questionOver(cache: readonly LedgerEvent[]): MatchState {
    const next = ledgerOf([start(), mine, mine, rally('A')], AFTER)[cache.length];
    const read = run(opened({ ...tapped([lostTap]), ledger: cache }), {
      kind: 'fetched',
      events: [{ ...next, seq: cache.length + 1, id: `ev-${cache.length + 1}` }],
    });
    expect(askOf(read.state)).toEqual({ foreign: 1, queued: 1 });
    return read.state;
  }

  it('is the latest of the identical events: the older one is what the phone made before', () => {
    const cache = web([start(), mine, mine]);
    const state = questionOver(cache);
    const answered = run(state, { kind: 'answerAsk', answer: 'discard' });
    expect(answered.state.sync.queue.ownEventIds).toEqual(['ev-3']);
  });

  it('is one recorded since the oldest tap: an identical event from before it is no copy', () => {
    const cache = at(web([start(), mine, mine]), [
      '2026-11-01T08:00:00.000Z',
      '2026-11-01T08:01:00.000Z',
      '2026-11-01T10:31:30.000Z',
    ]);
    const answered = run(questionOver(cache), { kind: 'answerAsk', answer: 'discard' });
    expect(answered.state.sync.queue.ownEventIds).toEqual(['ev-3']);
    const history = at(web([start(), mine, mine]), [
      '2026-11-01T08:00:00.000Z',
      '2026-11-01T08:01:00.000Z',
      '2026-11-01T08:02:00.000Z',
    ]);
    const none = run(questionOver(history), { kind: 'answerAsk', answer: 'discard' });
    expect(none.state.sync.queue.ownEventIds).toEqual([]);
  });
});

// What the record says of the question (round 4, items 4 and 7): said when it begins, once; said moot once while a dead
// link hides it, and not said again as new when the link is back; said with the answer when it ends. Read on the pure
// function: a dead link that comes back cannot be made to happen through the runner (a queue's `dead` stays until a fresh
// scan opens another runner).
describe('what the record says of the question', () => {
  const ASK = { event: 'scoring.ask', fields: { foreign: 1, queued: 2 } };
  const said = (answer: string) => ({ event: 'scoring.asked', fields: { answer } });
  const hiddenBy = (state: MatchState, dead: boolean): MatchState =>
    dead
      ? { ...state, sync: { ...state.sync, queue: { ...state.sync.queue, dead: 'gone' as const } } }
      : { ...state, bootstrap: { ...SINGLES, epochRequired: state.sync.engineEpoch + 1 } };
  const ended = (state: MatchState): MatchState => ({
    ...state,
    sync: { ...state.sync, queue: { ...state.sync.queue, askedAbout: undefined } },
  });

  it('says it once when it begins, and nothing while it stands', () => {
    const standing = asked();
    expect(askSaying('idle', standing, null)).toEqual({ said: 'open', line: ASK });
    expect(askSaying('open', standing, null)).toEqual({ said: 'open', line: null });
  });

  it('says nothing when no question has been said, whatever hides or ends one', () => {
    const none = opened(tapped(two));
    expect(askSaying('idle', none, null)).toEqual({ said: 'idle', line: null });
    expect(askSaying('idle', hiddenBy(asked(), true), null).line).toBeNull();
    expect(askSaying('idle', ended(asked()), 'send').line).toBeNull();
  });

  it('a dead link makes it moot, said once however many steps the link stays dead', () => {
    const dead = hiddenBy(asked(), true);
    const first = askSaying('open', dead, null);
    expect(first).toEqual({ said: 'mooted', line: said('moot') });
    expect(askSaying(first.said, dead, null)).toEqual({ said: 'mooted', line: null });
  });

  it('the link back, the same question stands again and is not said as a new one', () => {
    const back = askSaying('mooted', asked(), null);
    expect(back).toEqual({ said: 'open', line: null });
  });

  it('an app too old hides it without ending it: nothing is said, going or coming back', () => {
    const old = hiddenBy(asked(), false);
    expect(askSaying('open', old, null)).toEqual({ said: 'open', line: null });
    expect(askSaying('open', asked(), null)).toEqual({ said: 'open', line: null });
  });

  it('ends with the answer, said once, or as moot when it ended by itself', () => {
    const gone = ended(asked());
    expect(askSaying('open', gone, 'send')).toEqual({ said: 'idle', line: said('send') });
    expect(askSaying('open', gone, 'discard')).toEqual({ said: 'idle', line: said('discard') });
    expect(askSaying('open', gone, null)).toEqual({ said: 'idle', line: said('moot') });
  });

  it('one that was said moot while hidden is not said moot again when it ends by itself, but an answer is said', () => {
    const gone = ended(asked());
    expect(askSaying('mooted', gone, null)).toEqual({ said: 'idle', line: null });
    expect(askSaying('mooted', gone, 'send')).toEqual({ said: 'idle', line: said('send') });
  });
});
