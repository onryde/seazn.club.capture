import { describe, expect, it } from 'vitest';
import { openMatch, step } from '@/domain/scoring/scoringMatch';
import { askOf, copiesOf, noteForeign } from '@/domain/scoring/scoringMatchAsk';
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

/** The events at seq `from` on of a ledger built from `specs`, as a fetch since the tip brings them. */
const fetching = (specs: readonly Spec[], from: number): MatchEvent => ({
  kind: 'fetched',
  events: ledgerOf(specs).slice(from - 1),
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
    const own = ledgerOf([start(), { ...rally('H'), link: PHONE_LINK }]).slice(1);
    const read = step(opened(tapped(lost)), { kind: 'fetched', events: own }, NOW);
    expect(askOf(read.state)).toBeNull();
  });

  it('counts an identical rally from another link: a co-scorer’s is theirs', () => {
    const lost = [{ ...queuedOf('k1', rally('H')), attempts: 1 }];
    const theirs = ledgerOf([start(), rally('H')]).slice(1);
    const read = step(opened(tapped(lost)), { kind: 'fetched', events: theirs }, NOW);
    expect(askOf(read.state)).toEqual({ foreign: 1, queued: 1 });
  });

  it('does not count the copy of the tap in flight a ping’s fetch beat the answer with, but counts a co-scorer’s at that seq', () => {
    const { state } = sentOnce();
    const mine = ledgerOf([start(), { ...rally('H'), link: PHONE_LINK }]).slice(1);
    expect(askOf(run(state, { kind: 'fetched', events: mine }).state)).toBeNull();
    const theirs = ledgerOf([start(), rally('H')]).slice(1);
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
      opened({ queue, ledger: ledgerOf([start(), { ...rally('H'), link: PHONE_LINK }]) }),
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
    const decided = ledgerOf([start(), ...rallies('A'.repeat(42))]);
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
    const cache = ledgerOf([start(), { ...rally('H'), link: PHONE_LINK }]);
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
      held({ queue: file?.queue ?? queueOf(), ledger: ledgerOf([start()]) }),
      NOW,
    );
    const first = step(reopened.state, fetching(elsewhere, 2), NOW);
    expect(askOf(first.state)).toEqual({ foreign: 1, queued: 2 });
    expect(sendsOf(first.effects)).toEqual([]);
  });
});

describe('the ledger a fetch brings is read, not trusted blind', () => {
  it('a batch that does not continue the ledger asks nothing and is fetched again', () => {
    const gap = ledgerOf([start(), rally('A'), rally('A')]).slice(2);
    const read = step(opened(tapped(two)), { kind: 'fetched', events: gap }, NOW);
    expect(askOf(read.state)).toBeNull();
    expect(read.state.sync.queue.askedAbout).toBeUndefined();
  });

  it('events already held are no news: a repeated fetch does not ask again', () => {
    const once = run(opened(tapped(two)), { kind: 'fetched', events: ledgerOf([start()]) });
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
    const events = ledgerOf([start(), rally('A'), voiding(2)]);
    const merged = withLedger(opened(tapped(two)), events);
    expect(noteForeign(merged, events.slice(1))).toBe(merged);
    expect(merged.sync.queue.askedAbout).toBeUndefined();
  });

  it('an event that takes another back is never scored, by its type or by what it voids', () => {
    const [first, voided] = ledgerOf([start(), voiding(1)]);
    const noTarget = { ...voided, voids: null };
    const otherType = { ...voided, type: 'badminton.rally' };
    for (const odd of [noTarget, otherType]) {
      const merged = withLedger(opened(tapped(two)), [first, odd]);
      expect(noteForeign(merged, [odd]), odd.type).toBe(merged);
    }
  });

  it('a tap never sent has no copy: an identical rally with no link (the organiser’s console) is another scorer’s', () => {
    const neverSent = opened(tapped([queuedOf('k1', rally('H'))]));
    const theirs = ledgerOf([start(), { ...rally('H'), link: null }]).slice(1);
    const read = step(neverSent, { kind: 'fetched', events: theirs }, NOW);
    expect(askOf(read.state)).toEqual({ foreign: 1, queued: 1 });
  });

  it('a copy is of the tap’s own type: the phone’s link and the same payload, another type, is foreign', () => {
    const lost = opened(tapped([unresolved('k1')]));
    const other = ledgerOf([start(), { ...rally('H'), link: PHONE_LINK }]).slice(1);
    const read = step(
      lost,
      { kind: 'fetched', events: [{ ...other[0], type: 'badminton.fault' }] },
      NOW,
    );
    expect(askOf(read.state)).toEqual({ foreign: 1, queued: 1 });
  });

  it('the tap in flight is copied only at the seq it was sent for: the phone’s identical rally later on is foreign', () => {
    const { state } = sentOnce();
    const mine = { ...rally('H'), link: PHONE_LINK };
    // The tip is 1 and the tap went with expected_seq 1, so its copy is seq 2: this one is seq 3, behind another's.
    const later = ledgerOf([start(), rally('A'), mine]).slice(1);
    expect(askOf(run(state, { kind: 'fetched', events: later }).state)).toEqual({
      foreign: 2,
      queued: 1,
    });
  });

  it('each event is the copy of one tap, and an owned one is nobody’s', () => {
    const mine = { ...rally('H'), link: PHONE_LINK };
    const twice = opened({
      queue: queueOf({ pending: [unresolved('k1'), unresolved('k2')], ownEventIds: [] }),
      ledger: ledgerOf([start(), mine]),
    });
    expect(copiesOf(twice, twice.sync.ledger).size).toBe(1);
    const owning = opened({
      queue: queueOf({ pending: [unresolved('k1')], ownEventIds: ['ev-2'] }),
      ledger: ledgerOf([start(), mine, mine]),
    });
    expect([...copiesOf(owning, owning.sync.ledger).values()].map((copy) => copy.id)).toEqual([
      'ev-3',
    ]);
  });

  it('a question whose events were all taken back is none, before anything has released it', () => {
    const state = asked();
    const taken = withLedger(state, ledgerOf([start(), rally('A'), voiding(2)]));
    expect(taken.sync.queue.askedAbout).toEqual(['ev-2']);
    expect(askOf(taken)).toBeNull();
  });
});
