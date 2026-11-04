import { describe, expect, it } from 'vitest';
import { badmintonSport } from '@/domain/scoring/badmintonSport';
import { deadOf, foldQueue, ownIds, type MatchState } from '@/domain/scoring/scoringMatchState';
import { openMatch, step, wakeAt } from '@/domain/scoring/scoringMatch';
import type { QueuedEvent } from '@/domain/scoring/queue';
import {
  AWAY,
  BROWSER_LINK,
  HOME,
  PHONE_LINK,
  SINGLES,
  eventId,
  ledgerOf,
  queuedOf,
  rally,
  start,
  voiding,
} from '../../../test/badmintonLedger';
import {
  ACCEPTED,
  AT,
  FIXTURE,
  NOW,
  drive,
  held,
  kinds,
  opened,
  queueOf,
  ready,
  savesOf,
  sendsOf,
  sentOnce,
  tapped,
} from '../../../test/scoringMatchFixtures';

// The match reducer (plan S2-1 Task 9). Every expectation is a literal: the engine's epoch is 2, a rally by the first
// side is the home entrant's, the first send is at the ledger's last seq. Hooks and files are the runner's, not here.

const RALLY_FIRST = { kind: 'rally', side: 'first' } as const;
const RALLY_BODY = { wonBy: HOME, scorer: 'p-sharma' };

/** The first rally of the match, taken. Returns the state with the tap queued (not yet saved or sent). */
function tappedOnce(from: MatchState = ready(), key = 'k1') {
  return drive(from, [{ kind: 'tap', tap: RALLY_FIRST, key, at: AT }]);
}

describe('the engine epoch', () => {
  it('is the badminton fold epoch this build sends, 2', () => {
    expect(badmintonSport.epoch).toBe(2);
  });
});

describe('opening a match', () => {
  it('takes the tip from the ledger, never from the bootstrap’s lastSeq, and reads from that tip', () => {
    const opened = openMatch(
      held({
        bootstrap: { ...SINGLES, lastSeq: 99 },
        ledger: ledgerOf([start(), rally('H'), rally('A')]),
      }),
      NOW,
    );
    expect(opened.state.sync.tip).toBe(3);
    expect(opened.effects).toEqual([{ kind: 'fetch', since: 3 }, { kind: 'loadBootstrap' }]);
  });

  it('owes the queue a judgement on the ledger before anything is sent, and says so with a hold', () => {
    const queue = [queuedOf('k1', rally('H'))];
    const opened = openMatch(held(tapped(queue)), NOW);
    expect(opened.state.sync.hold).toBe('ledger');
    expect(opened.state.sync.revalidateOwed).toBe(true);
    const ticked = step(opened.state, { kind: 'tick' }, NOW);
    expect(sendsOf(ticked.effects)).toEqual([]);
  });

  it('an empty queue owes nothing: no hold, no revalidation', () => {
    const opened = openMatch(held(), NOW);
    expect(opened.state.sync.hold).toBeNull();
    expect(opened.state.sync.revalidateOwed).toBe(false);
  });

  it('reads nothing for a queue that is already dead', () => {
    const queue = queueOf({ pending: [queuedOf('k1', rally('H'))], dead: 'LINK_REVOKED' });
    expect(openMatch(held({ queue }), NOW).effects).toEqual([]);
  });

  it('a background sender reads the ledger but never the bootstrap: it judges nothing', () => {
    const queue = queueOf({ pending: [queuedOf('k1', rally('H'))] });
    const opened = openMatch(held({ queue, judge: 'trust', bootstrap: null }), NOW);
    expect(opened.effects).toEqual([{ kind: 'fetch', since: 1 }]);
  });

  it('a background sender sends its queue once the ledger is read, judging nothing: the server judges each tap', () => {
    const queue = queueOf({ pending: [queuedOf('k1', rally('H'))] });
    const opened = openMatch(
      held({ queue, judge: 'trust', bootstrap: null, ledger: ledgerOf([start()]) }),
      NOW,
    );
    const read = step(opened.state, { kind: 'fetched', events: [] }, NOW);
    expect(sendsOf(read.effects).map((send) => send.body.idempotency_key)).toEqual(['k1']);
    expect(sendsOf(read.effects)[0].body.rules_version).toBe(1);
  });

  it('a queue reopened under a bootstrap that needs a newer app is not sent: the server would only refuse it', () => {
    const queue = [queuedOf('k1', rally('H'))];
    const state = opened({ ...tapped(queue), bootstrap: { ...SINGLES, epochRequired: 3 } });
    const read = step(state, { kind: 'fetched', events: [] }, NOW);
    expect(sendsOf(read.effects)).toEqual([]);
  });

  it('sends the reopened queue only after the ledger is read: the save of the attempt, then the send', () => {
    const queue = [queuedOf('k1', rally('H'))];
    const opened = openMatch(held(tapped(queue)), NOW);
    const read = step(opened.state, { kind: 'fetched', events: [] }, NOW);
    expect(kinds(read.effects)).toEqual(['save', 'send']);
    expect(sendsOf(read.effects)[0].body).toEqual({
      expected_seq: 1,
      type: 'badminton.rally',
      payload: { wonBy: HOME },
      idempotency_key: 'k1',
      engine_epoch: 2,
      rules_version: 1,
    });
  });
});

describe('a tap', () => {
  it('goes into the queue with its key, the time and the rules it was made under, and is not sent in the same step', () => {
    const { state, steps } = tappedOnce();
    const [first] = steps;
    expect(first.outcome).toEqual({ ok: true });
    expect(state.sync.queue.pending).toEqual([
      {
        key: 'k1',
        type: 'badminton.rally',
        payload: RALLY_BODY,
        rulesVersion: 1,
        createdAt: AT,
        attempts: 0,
      },
    ]);
    expect(sendsOf(first.effects)).toEqual([]);
  });

  it('is saved BEFORE it is shown or sent: the step’s save names the tap it makes durable', () => {
    const { steps } = tappedOnce();
    const saves = savesOf(steps[0].effects);
    expect(saves).toHaveLength(1);
    expect(saves[0].tap).toBe('k1');
    expect(saves[0].queue?.pending.map((tap) => tap.key)).toEqual(['k1']);
  });

  it('is sent once its save has landed, after one more save that counts the attempt', () => {
    const { steps } = drive(tappedOnce().state, [{ kind: 'saved', n: 99 }]);
    expect(kinds(steps[0].effects)).toEqual(['save', 'send']);
    const [mark] = savesOf(steps[0].effects);
    expect(mark.queue?.pending[0].attempts).toBe(1);
    expect(sendsOf(steps[0].effects)[0].body.idempotency_key).toBe('k1');
    expect(sendsOf(steps[0].effects)[0].body.expected_seq).toBe(1);
  });

  it('is not sent while a save is still out: another event in between sends nothing, the save’s landing does', () => {
    const queued = tappedOnce().state;
    const meanwhile = step(
      queued,
      { kind: 'say', words: { kind: 'note', key: 'scoring.pad.countedOnce' } },
      NOW,
    );
    expect(sendsOf(meanwhile.effects)).toEqual([]);
    expect(meanwhile.state.sync.queue.pending[0].attempts).toBe(0);
    const landed = step(meanwhile.state, { kind: 'saved', n: 99 }, NOW);
    expect(kinds(landed.effects)).toEqual(['save', 'send']);
  });

  it('is sent by one sender at a time: nothing more goes while one is in flight', () => {
    const queued = tappedOnce().state;
    const sent = drive(queued, [{ kind: 'saved', n: 99 }]).state;
    const again = drive(sent, [{ kind: 'tick' }, { kind: 'read' }, { kind: 'saved', n: 99 }]);
    expect(again.steps.flatMap((s) => sendsOf(s.effects))).toEqual([]);
  });

  it.each([
    ['no bootstrap yet', () => ready({ bootstrap: null })],
    ['a link the door does not take', () => ready({ queue: queueOf({ dead: 'LINK_REVOKED' }) })],
    ['a finalized match', () => ready({ queue: queueOf({ dead: 'finalized' }) })],
    ['a screen that is a card', () => ready({ bootstrap: { ...SINGLES, screen: 'viewOnly' } })],
    [
      'a match not on the schedule yet',
      () => ready({ bootstrap: { ...SINGLES, screen: 'waiting' } }),
    ],
    [
      'a server that needs a newer app',
      () => ready({ bootstrap: { ...SINGLES, epochRequired: 3 } }),
    ],
    [
      'a sport this build does not score',
      () => ready({ bootstrap: { ...SINGLES, sportKey: 'tennis' } }),
    ],
    ['a ledger too large to read', () => tooLarge()],
  ])('is refused as not now with %s, and the queue stays as it was', (_name, make) => {
    const state = make();
    const result = step(state, { kind: 'tap', tap: RALLY_FIRST, key: 'k1', at: AT }, NOW);
    expect(result.outcome).toEqual({ ok: false, refusal: 'notNow' });
    expect(result.state.sync.queue).toBe(state.sync.queue);
    expect(result.effects).toEqual([]);
  });

  it('is refused as not now before the match has started: the engine takes no rally yet', () => {
    const state = ready({}, []);
    const result = step(state, { kind: 'tap', tap: RALLY_FIRST, key: 'k1', at: AT }, NOW);
    expect(result.outcome).toEqual({ ok: false, refusal: 'notNow' });
  });

  it('is refused as not now when the tap names what the match does not have (null from badmintonEventFor)', () => {
    const state = ready({ bootstrap: { ...SINGLES, sides: { ...SINGLES.sides, away: null } } });
    const result = step(
      state,
      {
        kind: 'tap',
        tap: { kind: 'sanction', side: 'second', level: 'warning', person: 'Nobody' },
        key: 'k1',
        at: AT,
      },
      NOW,
    );
    expect(result.outcome).toEqual({ ok: false, refusal: 'notNow' });
    expect(result.state.sync.queue.pending).toEqual([]);
  });

  it('a set score no game in progress has is refused as an invalid score; a legal one is taken', () => {
    const state = ready();
    const bad = step(
      state,
      { kind: 'tap', tap: { kind: 'setScore', first: 30, second: 5 }, key: 'k1', at: AT },
      NOW,
    );
    expect(bad.outcome).toEqual({ ok: false, refusal: 'invalidScore' });
    const good = step(
      state,
      { kind: 'tap', tap: { kind: 'setScore', first: 11, second: 5 }, key: 'k2', at: AT },
      NOW,
    );
    expect(good.outcome).toEqual({ ok: true });
    expect(good.state.sync.queue.pending[0].payload).toEqual({ home: 11, away: 5, partial: true });
  });

  it('a second tap with its own key joins the queue behind the first, in order', () => {
    const { state } = drive(ready(), [
      { kind: 'tap', tap: RALLY_FIRST, key: 'k1', at: AT },
      { kind: 'tap', tap: { kind: 'rally', side: 'second' }, key: 'k2', at: AT },
    ]);
    expect(
      state.sync.queue.pending.map((tap) => [tap.key, (tap.payload as { wonBy: string }).wonBy]),
    ).toEqual([
      ['k1', HOME],
      ['k2', AWAY],
    ]);
  });

  it('a rally the ledger and the queue already took to the match’s end is refused, not queued', () => {
    const specs = [start(), ...Array.from({ length: 42 }, () => rally('H'))];
    const state = ready({}, specs);
    const result = step(state, { kind: 'tap', tap: RALLY_FIRST, key: 'k1', at: AT }, NOW);
    expect(result.outcome).toEqual({ ok: false, refusal: 'notNow' });
  });
});

function tooLarge(): MatchState {
  const state = ready();
  return step(state, { kind: 'fetchFailed', failure: { kind: 'tooLarge' } }, NOW).state;
}

describe('the Start tap', () => {
  const START_FIRST = { kind: 'start', server: 'first' } as const;

  it('queues core.start and keeps the pick it carries, for the match’s first rally', () => {
    const state = ready({}, []);
    const result = step(state, { kind: 'tap', tap: START_FIRST, key: 's1', at: AT }, NOW);
    expect(result.outcome).toEqual({ ok: true });
    expect(result.state.toss).toBe('first');
    expect(result.state.sync.queue.pending[0]).toMatchObject({
      key: 's1',
      type: 'core.start',
      payload: {},
    });
  });

  it('is refused once the match has started, and the pick stands as it was', () => {
    const state = ready({ toss: 'second' });
    const result = step(state, { kind: 'tap', tap: START_FIRST, key: 's1', at: AT }, NOW);
    expect(result.outcome).toEqual({ ok: false, refusal: 'notNow' });
    expect(result.state.toss).toBe('second');
  });

  it('the pick is saved with the bootstrap in the boot cache, so a kill between Start and the first rally keeps it', () => {
    const state = ready({}, []);
    const picked = step(state, { kind: 'pickServer', side: 'second' }, NOW);
    expect(picked.state.toss).toBe('second');
    expect(savesOf(picked.effects)).toEqual([
      {
        kind: 'save',
        n: 1,
        queue: null,
        boot: { bootstrap: SINGLES, toss: 'second' },
        ledger: null,
        tap: null,
      },
    ]);
  });

  it('the first rally carries the picked side as serving, until the first send decides it', () => {
    const picked = drive(ready({ toss: 'first' }), [
      { kind: 'tap', tap: RALLY_FIRST, key: 'k1', at: AT },
    ]);
    expect(picked.state.sync.queue.pending[0].payload).toEqual({ ...RALLY_BODY, serving: HOME });
  });

  it('a pick after the match has started is nothing', () => {
    const state = ready();
    const result = step(state, { kind: 'pickServer', side: 'second' }, NOW);
    expect(result.state.toss).toBeNull();
    expect(result.effects).toEqual([]);
  });
});

describe('the payload a send is made with', () => {
  const serving = { ...queuedOf('k1', rally('H', 'H')), rulesVersion: 1 };
  /** The step that reads the ledger and, the queue judged, sends its head. */
  const firstSend = (queue: QueuedEvent[], specs: Parameters<typeof opened>[1]) =>
    step(opened(tapped(queue), specs), { kind: 'fetched', events: [] }, NOW);

  it('drops the first rally’s serving at its first send when a rally already stands, and writes that into the queued head with the attempt', () => {
    const read = firstSend([serving], [start(), rally('A')]);
    const send = sendsOf(read.effects)[0];
    expect(send.body.payload).toEqual({ wonBy: HOME });
    expect(send.sent.payload).toEqual({ wonBy: HOME });
    expect(send.sent.attempts).toBe(1);
    expect(read.state.sync.queue.pending[0].payload).toEqual({ wonBy: HOME });
    const [mark] = savesOf(read.effects);
    expect(mark.queue?.pending[0].payload).toEqual({ wonBy: HOME });
  });

  it('keeps serving when no rally stands', () => {
    const send = sendsOf(firstSend([serving], [start()]).effects)[0];
    expect(send.body.payload).toEqual({ wonBy: HOME, serving: HOME });
  });

  // Fix round 2 (I2 of the Batch C review): the server matches a resend by its key and never by its payload, so what a tap
  // was first sent with matters only while the ledger holds its copy; with none, the first attempt may never have been
  // stored and the resend is appended as new.
  const resent = { ...serving, attempts: 1 };
  /** The ledger as recorded just after the tap was made (`queuedOf`'s clock), so each event counts as made on top of it. */
  const AFTER_TAP = '2026-11-01T10:29:00.000Z';
  const sentWith = (specs: Parameters<typeof ledgerOf>[0]) =>
    sendsOf(
      step(
        opened({ ...tapped([resent]), ledger: ledgerOf(specs, AFTER_TAP) }),
        { kind: 'fetched', events: [] },
        NOW,
      ).effects,
    )[0];

  it('keeps what a tap was first sent with once it has an attempt, while the ledger holds its copy', () => {
    const copy = { ...rally('H', 'H'), link: PHONE_LINK };
    expect(sentWith([start(), copy, rally('A')]).body.payload).toEqual({
      wonBy: HOME,
      serving: HOME,
    });
  });

  it('judges a tap with an attempt as a first send when the ledger holds no copy of it', () => {
    const send = sentWith([start(), rally('A')]);
    expect(send.body.payload).toEqual({ wonBy: HOME });
    expect(send.sent.attempts).toBe(2);
  });

  it('does not take another link’s identical rally for the copy of a tap', () => {
    const lookalike = { ...rally('H', 'H'), link: BROWSER_LINK };
    expect(sentWith([start(), lookalike]).body.payload).toEqual({ wonBy: HOME });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The server's answer
// ---------------------------------------------------------------------------------------------------------------

describe('the answer to a send', () => {
  it('accepted: the tap joins the ledger and is this phone’s own, and the next is saved then sent at the new tip', () => {
    const { state, sent } = sentOnce([queuedOf('k2', rally('A'))]);
    const next = step(state, { kind: 'answered', sent, answer: ACCEPTED }, NOW);
    expect(next.state.sync.queue.ownEventIds).toEqual(['srv-1']);
    expect(next.state.sync.ledger.map((event) => event.seq)).toEqual([1, 2]);
    expect(next.state.sync.tip).toBe(2);
    expect(kinds(next.effects)).toEqual(['save', 'send']);
    expect(next.state.sent).toEqual({ key: 'k2', expectedSeq: 2 });
    expect(sendsOf(next.effects)[0].body).toMatchObject({ idempotency_key: 'k2', expected_seq: 2 });
    expect(savesOf(next.effects)[0].queue?.pending.map((tap) => [tap.key, tap.attempts])).toEqual([
      ['k2', 1],
    ]);
  });

  it('accepted twice is the same as once: nothing changes, nothing is sent again', () => {
    const { state, sent } = sentOnce();
    const once = step(state, { kind: 'answered', sent, answer: ACCEPTED }, NOW);
    expect(once.state.sent).toBeNull();
    const twice = step(once.state, { kind: 'answered', sent, answer: ACCEPTED }, NOW);
    expect(twice.effects).toEqual([]);
    expect(twice.state.sync.ledger).toBe(once.state.sync.ledger);
  });

  it('offline: waits one second, then sends the same tap again under the same key', () => {
    const { state, sent } = sentOnce();
    const down = step(state, { kind: 'answered', sent, answer: { kind: 'offline' } }, NOW);
    expect(wakeAt(down.state, NOW)).toBe(NOW + 1000);
    expect(sendsOf(down.effects)).toEqual([]);
    expect(down.state.sent).toBeNull();
    expect(sendsOf(step(down.state, { kind: 'tick' }, NOW + 999).effects)).toEqual([]);
    const again = sendsOf(step(down.state, { kind: 'tick' }, NOW + 1000).effects);
    expect(again.map((send) => [send.body.idempotency_key, send.sent.attempts])).toEqual([
      ['k1', 2],
    ]);
  });

  it('a send abandoned (its save failed, the app left) is fed back as offline so sending never sticks', () => {
    const { state } = sentOnce();
    const abandoned = step(state, { kind: 'abandoned', key: 'k1' }, NOW);
    expect(abandoned.state.sync.status).toBe('offline');
    expect(abandoned.state.sync.inFlight).toBeNull();
    expect(abandoned.state.sent).toBeNull();
    expect(abandoned.state.sync.queue.pending[0].attempts).toBe(1);
  });

  it('abandoning a tap that is no longer queued only frees the sender', () => {
    const { state, sent } = sentOnce();
    const accepted = step(state, { kind: 'answered', sent, answer: ACCEPTED }, NOW).state;
    const abandoned = step(accepted, { kind: 'abandoned', key: 'k1' }, NOW);
    expect(abandoned.state.sync.status).toBe('idle');
    expect(abandoned.state.sync.queue.pending).toEqual([]);
  });

  // Owner ruling 43 (2026-11-02): the events another scorer made are not sent over without asking. The tap goes again
  // once the scorer answers Send, judged on the ledger as it stands (`scoringMatchAsk.test.ts` holds the question).
  it('a seq conflict fetches from the tip and holds the send; the events brought in are judged before the tap goes again, once the scorer says Send', () => {
    const { state, sent } = sentOnce();
    const conflict = step(
      state,
      { kind: 'answered', sent, answer: { kind: 'seqConflict', currentSeq: 2 } },
      NOW,
    );
    expect(conflict.effects).toContainEqual({ kind: 'fetch', since: 1 });
    // Recorded after the phone's tap (made at 10:30, `queuedOf`): the other scorer's.
    const brought = ledgerOf([start(), rally('A')], '2026-11-01T10:31:00.000Z').slice(1);
    const landed = step(conflict.state, { kind: 'saved', n: 99 }, NOW).state;
    const merged = step(landed, { kind: 'fetched', events: brought }, NOW);
    expect(sendsOf(merged.effects)).toEqual([]);
    const settled = step(merged.state, { kind: 'saved', n: 99 }, NOW).state;
    const answered = step(settled, { kind: 'answerAsk', answer: 'send' }, NOW);
    expect(
      sendsOf(answered.effects).map((send) => [send.body.idempotency_key, send.body.expected_seq]),
    ).toEqual([['k1', 2]]);
  });

  it('new rules: loads them, and sends under the new version only once they are adopted into the bootstrap', () => {
    const { state, sent } = sentOnce();
    const changed = step(
      state,
      { kind: 'answered', sent, answer: { kind: 'rulesChanged', rulesVersion: 2 } },
      NOW,
    );
    expect(changed.effects).toContainEqual({ kind: 'loadRules' });
    expect(sendsOf(changed.effects)).toEqual([]);
    const landed = step(changed.state, { kind: 'saved', n: 99 }, NOW).state;
    const adopted = step(
      landed,
      { kind: 'rulesRead', rules: { cfg: { bestOf: 1 }, rulesVersion: 2, formatLine: null } },
      NOW,
    );
    expect(adopted.state.bootstrap).toMatchObject({ cfg: { bestOf: 1 }, rulesVersion: 2 });
    expect(savesOf(adopted.effects).some((save) => save.boot?.bootstrap.rulesVersion === 2)).toBe(
      true,
    );
    expect(sendsOf(adopted.effects)[0].body.rules_version).toBe(2);
  });

  it('rules older than the version held are not adopted into the bootstrap', () => {
    const state = ready({
      bootstrap: { ...SINGLES, cfg: { bestOf: 3 }, rulesVersion: 3 },
      rulesVersion: 3,
    });
    const read = step(
      state,
      { kind: 'rulesRead', rules: { cfg: { bestOf: 1 }, rulesVersion: 2, formatLine: null } },
      NOW,
    );
    expect(read.state.bootstrap).toMatchObject({ cfg: { bestOf: 3 }, rulesVersion: 3 });
    expect(read.state.sync.rulesVersion).toBe(3);
  });

  it('an app too old: Update needed, nothing sent, the unsent count in the view', () => {
    const { state, sent } = sentOnce();
    const old = step(
      state,
      { kind: 'answered', sent, answer: { kind: 'outdated', required: 3 } },
      NOW,
    );
    expect(old.state.sync.status).toBe('outdated');
    expect(sendsOf(step(old.state, { kind: 'tick' }, NOW + 60_000).effects)).toEqual([]);
  });

  it('a link the door does not take: the queue is dead, kept, and nothing is sent again', () => {
    const { state, sent } = sentOnce();
    const dead = step(
      state,
      { kind: 'answered', sent, answer: { kind: 'linkDead', code: 'LINK_REVOKED' } },
      NOW,
    );
    expect(deadOf(dead.state)).toBe('LINK_REVOKED');
    expect(dead.state.sync.queue.pending.map((tap) => tap.key)).toEqual(['k1']);
    expect(sendsOf(step(dead.state, { kind: 'tick' }, NOW + 60_000).effects)).toEqual([]);
  });

  it('a tap the engine refuses leaves the queue alone, said on the line as not counted, and the ledger is read again', () => {
    const { state, sent } = sentOnce();
    const refused = step(
      state,
      {
        kind: 'answered',
        sent,
        answer: { kind: 'refused', status: 422, code: 'RALLY_NOT_ALLOWED' },
      },
      NOW,
    );
    expect(refused.state.sync.queue.pending).toEqual([]);
    expect(refused.state.line).toEqual({ kind: 'refusal', key: 'scoring.refusal.notCounted' });
    expect(refused.effects).toContainEqual({ kind: 'fetch', since: 1 });
    expect(refused.effects).toContainEqual({
      kind: 'dropped',
      code: 'RALLY_NOT_ALLOWED',
      count: 1,
    });
  });

  it('ALREADY_DECIDED reads the bootstrap for the match’s status; a match still open refuses that tap alone', () => {
    const { state, sent } = sentOnce();
    const decided = step(
      state,
      { kind: 'answered', sent, answer: { kind: 'refused', status: 422, code: 'ALREADY_DECIDED' } },
      NOW,
    );
    expect(decided.effects).toContainEqual({ kind: 'loadBootstrap' });
    const read = step(decided.state, { kind: 'bootstrapRead', bootstrap: SINGLES }, NOW);
    expect(read.state.sync.queue.pending).toEqual([]);
    expect(read.state.line).toEqual({ kind: 'refusal', key: 'scoring.refusal.notCounted' });
  });

  it('ALREADY_DECIDED then a finalized match: the queue is dead and the tap kept, never discarded', () => {
    const { state, sent } = sentOnce();
    const decided = step(
      state,
      { kind: 'answered', sent, answer: { kind: 'refused', status: 422, code: 'ALREADY_DECIDED' } },
      NOW,
    );
    const read = step(
      decided.state,
      { kind: 'bootstrapRead', bootstrap: { ...SINGLES, status: 'finalized' } },
      NOW,
    );
    expect(deadOf(read.state)).toBe('finalized');
    expect(read.state.sync.queue.pending.map((tap) => tap.key)).toEqual(['k1']);
  });

  it('a throttle waits as long as it was told', () => {
    const { state, sent } = sentOnce();
    const limited = step(
      state,
      { kind: 'answered', sent, answer: { kind: 'rateLimited', retryAfterMs: 7000 } },
      NOW,
    );
    expect(wakeAt(limited.state, NOW)).toBe(NOW + 7000);
    expect(sendsOf(step(limited.state, { kind: 'tick' }, NOW + 6999).effects)).toEqual([]);
    expect(sendsOf(step(limited.state, { kind: 'tick' }, NOW + 7000).effects)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------------------------

describe('reading the ledger', () => {
  it('merges the events that continue it, saves the ledger, and ignores ones it already holds', () => {
    const state = ready();
    const fresh = ledgerOf([start(), rally('A')]);
    const merged = step(state, { kind: 'fetched', events: fresh }, NOW);
    expect(merged.state.sync.ledger.map((event) => event.seq)).toEqual([1, 2]);
    expect(savesOf(merged.effects)).toEqual([
      { kind: 'save', n: 1, queue: null, boot: null, ledger: merged.state.sync.ledger, tap: null },
    ]);
    const again = step(merged.state, { kind: 'fetched', events: fresh }, NOW);
    expect(again.state.sync.ledger).toBe(merged.state.sync.ledger);
    expect(again.effects).toEqual([]);
  });

  it('a ledger save is a cache: its landing is never reported, so it never holds back the next tap’s send', () => {
    const cached = step(ready(), { kind: 'fetched', events: ledgerOf([start(), rally('A')]) }, NOW);
    expect(savesOf(cached.effects).map((save) => save.queue)).toEqual([null]);
    const taken = step(cached.state, { kind: 'tap', tap: RALLY_FIRST, key: 'k1', at: AT }, NOW);
    const landed = step(taken.state, { kind: 'saved', n: 99 }, NOW);
    expect(kinds(landed.effects)).toEqual(['save', 'send']);
  });

  it('drops a queued tap the new ledger makes illegal, once, as not counted, before anything is sent', () => {
    const state = opened(tapped([queuedOf('k1', rally('H'))]));
    const decided = ledgerOf([start(), ...Array.from({ length: 42 }, () => rally('A'))]).slice(1);
    const read = step(state, { kind: 'fetched', events: decided }, NOW);
    expect(read.state.sync.queue.pending).toEqual([]);
    expect(read.state.line).toEqual({ kind: 'refusal', key: 'scoring.refusal.notCounted' });
    expect(sendsOf(read.effects)).toEqual([]);
  });

  it('a match that cannot be folded is never judged: nothing is dropped, nothing is sent, and the view says why', () => {
    const noAway = { ...SINGLES, sides: { ...SINGLES.sides, away: null } };
    const state = opened(tapped([queuedOf('k1', rally('H'))]), undefined);
    const stuck = step({ ...state, bootstrap: noAway }, { kind: 'fetched', events: [] }, NOW);
    expect(stuck.state.sync.queue.pending.map((tap) => tap.key)).toEqual(['k1']);
    expect(stuck.state.sync.hold).toBe('revalidate');
    expect(sendsOf(stuck.effects)).toEqual([]);
  });

  it('a read that did not land lets the hold go, waits five seconds, then sends on what is held', () => {
    const state = opened(tapped([queuedOf('k1', rally('H'))]));
    const failed = step(state, { kind: 'fetchFailed', failure: { kind: 'offline' } }, NOW);
    expect(wakeAt(failed.state, NOW)).toBe(NOW + 5000);
    expect(sendsOf(failed.effects)).toEqual([]);
    expect(sendsOf(step(failed.state, { kind: 'tick' }, NOW + 5000).effects)).toHaveLength(1);
  });

  it.each([
    ['a link revoked', { kind: 'linkDead', code: 'LINK_REVOKED' }, 'LINK_REVOKED'],
    ['a link invalid', { kind: 'linkDead', code: 'LINK_INVALID' }, 'LINK_INVALID'],
    ['a match gone', { kind: 'refused', status: 404, code: 'NOT_FOUND' }, 'gone'],
    ['an account to pay', { kind: 'refused', status: 402, code: 'PAYMENT_REQUIRED' }, 'payment'],
    [
      'a result carried forward',
      { kind: 'refused', status: 403, code: 'RESULT_CARRIED_FORWARD' },
      'carriedForward',
    ],
  ] as const)('%s closes the match even with nothing queued', (_name, failure, dead) => {
    const state = ready();
    const closed = step(state, { kind: 'fetchFailed', failure }, NOW);
    expect(deadOf(closed.state)).toBe(dead);
    expect(sendsOf(step(closed.state, { kind: 'read' }, NOW).effects)).toEqual([]);
  });

  it('a read the server refuses for one reason alone (a 500) closes nothing', () => {
    const state = ready();
    const failed = step(
      state,
      { kind: 'fetchFailed', failure: { kind: 'refused', status: 500, code: 'X' } },
      NOW,
    );
    expect(deadOf(failed.state)).toBeNull();
  });

  it('a dead queue with taps queued stays dead whichever read said so, every tap kept', () => {
    const state = opened(tapped([queuedOf('k1', rally('H'))]));
    const dead = step(
      state,
      { kind: 'fetchFailed', failure: { kind: 'linkDead', code: 'LINK_EXPIRED' } },
      NOW,
    );
    expect(dead.state.sync.queue.dead).toBe('LINK_EXPIRED');
    expect(dead.state.sync.queue.pending).toHaveLength(1);
    expect(savesOf(dead.effects)[0].queue?.dead).toBe('LINK_EXPIRED');
  });

  it('a ledger over the cap is a state, not a retry: nothing is read or sent after it', () => {
    const state = tooLarge();
    expect(state.sync.status).toBe('tooLarge');
    expect(step(state, { kind: 'read' }, NOW).effects).toEqual([]);
    expect(step(state, { kind: 'foreground' }, NOW).effects).toEqual([]);
  });

  it('a failed rules read is asked for again after fifteen seconds, even with nothing queued', () => {
    const state = ready();
    const failed = step(state, { kind: 'rulesFailed', failure: { kind: 'offline' } }, NOW);
    expect(failed.effects).toEqual([]);
    const held = step(
      state,
      {
        kind: 'answered',
        sent: queuedOf('x', rally('H')),
        answer: { kind: 'rulesChanged', rulesVersion: 2 },
      },
      NOW,
    );
    const failedAfterAsk = step(
      held.state,
      { kind: 'rulesFailed', failure: { kind: 'offline' } },
      NOW,
    );
    expect(wakeAt(failedAfterAsk.state, NOW)).toBe(NOW + 15_000);
    expect(step(failedAfterAsk.state, { kind: 'tick' }, NOW + 14_999).effects).toEqual([]);
    expect(step(failedAfterAsk.state, { kind: 'tick' }, NOW + 15_000).effects).toEqual([
      { kind: 'loadRules' },
    ]);
  });
});

describe('reading the bootstrap', () => {
  it('a finalized match is dead for a queue with taps, which are kept', () => {
    const state = opened(tapped([queuedOf('k1', rally('H'))]));
    const read = step(
      state,
      { kind: 'bootstrapRead', bootstrap: { ...SINGLES, status: 'finalized' } },
      NOW,
    );
    expect(deadOf(read.state)).toBe('finalized');
    expect(read.state.sync.queue.pending).toHaveLength(1);
  });

  it.each(['finalized', 'cancelled'] as const)(
    'a %s match with nothing queued is closed all the same',
    (status) => {
      const read = step(ready(), { kind: 'bootstrapRead', bootstrap: { ...SINGLES, status } }, NOW);
      expect(deadOf(read.state)).toBe(status);
    },
  );

  it('a later bootstrap that says the match is open again lifts a closure that came from a read, not the queue’s own', () => {
    const closed = step(
      ready(),
      { kind: 'bootstrapRead', bootstrap: { ...SINGLES, status: 'finalized' } },
      NOW,
    ).state;
    const reopened = step(closed, { kind: 'bootstrapRead', bootstrap: SINGLES }, NOW);
    expect(deadOf(reopened.state)).toBeNull();
  });

  it('adopts a bootstrap and saves it in the boot cache with the pick', () => {
    const read = step(
      ready({ toss: 'second' }),
      { kind: 'bootstrapRead', bootstrap: { ...SINGLES, screen: 'confirm' } },
      NOW,
    );
    expect(savesOf(read.effects)[0].boot).toEqual({
      bootstrap: { ...SINGLES, screen: 'confirm' },
      toss: 'second',
    });
  });

  it('a bootstrap older in its rules than the held keeps the held rules and their version', () => {
    const state = ready({
      bootstrap: { ...SINGLES, cfg: { bestOf: 3 }, rulesVersion: 3 },
      rulesVersion: 3,
    });
    const read = step(
      state,
      { kind: 'bootstrapRead', bootstrap: { ...SINGLES, cfg: { bestOf: 1 }, rulesVersion: 2 } },
      NOW,
    );
    expect(read.state.bootstrap).toMatchObject({ cfg: { bestOf: 3 }, rulesVersion: 3 });
  });

  it('a bootstrap with newer rules moves the version sync sends under', () => {
    const read = step(
      ready(),
      { kind: 'bootstrapRead', bootstrap: { ...SINGLES, rulesVersion: 4 } },
      NOW,
    );
    expect(read.state.sync.rulesVersion).toBe(4);
  });

  it('a first read that could not be made, with none held, is the offline loading state; a later one clears it', () => {
    const state = openMatch(held({ bootstrap: null }), NOW).state;
    const failed = step(state, { kind: 'bootstrapFailed', failure: { kind: 'offline' } }, NOW);
    expect(failed.state.bootOffline).toBe(true);
    const read = step(failed.state, { kind: 'bootstrapRead', bootstrap: SINGLES }, NOW);
    expect(read.state.bootOffline).toBe(false);
  });

  it('a failed read with a bootstrap held is not the loading state', () => {
    const failed = step(ready(), { kind: 'bootstrapFailed', failure: { kind: 'offline' } }, NOW);
    expect(failed.state.bootOffline).toBe(false);
  });
});

describe('the app leaving and returning', () => {
  it('sends nothing in the background and sends the queue on the return, after reading the ledger', () => {
    const state = opened({ ...tapped([queuedOf('k1', rally('H'))]), foreground: false });
    const read = step(state, { kind: 'fetched', events: [] }, NOW);
    expect(sendsOf(read.effects)).toEqual([]);
    const back = step(read.state, { kind: 'foreground' }, NOW);
    expect(back.effects).toContainEqual({ kind: 'fetch', since: 1 });
    expect(sendsOf(back.effects)).toHaveLength(1);
  });

  it('going to the background stops sends from then on', () => {
    const state = ready();
    const away = step(state, { kind: 'background' }, NOW);
    const { state: queued } = drive(away.state, [
      { kind: 'tap', tap: RALLY_FIRST, key: 'k1', at: AT },
      { kind: 'saved', n: 99 },
    ]);
    expect(queued.sync.inFlight).toBeNull();
    expect(queued.sync.queue.pending[0].attempts).toBe(0);
  });

  it('a ping, a poll or a rejoin reads the ledger from the tip', () => {
    expect(step(ready(), { kind: 'read' }, NOW).effects).toEqual([{ kind: 'fetch', since: 1 }]);
  });

  it('a read also asks for the bootstrap while the screen is a card, so the match can open', () => {
    const state = ready({ bootstrap: { ...SINGLES, screen: 'waiting' } });
    expect(step(state, { kind: 'read' }, NOW).effects).toEqual([
      { kind: 'fetch', since: 1 },
      { kind: 'loadBootstrap' },
    ]);
  });

  it('a background sender reads the ledger and never the bootstrap', () => {
    const state = openMatch(held({ judge: 'trust', bootstrap: null }), NOW).state;
    expect(step(state, { kind: 'read' }, NOW).effects).toEqual([{ kind: 'fetch', since: 1 }]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------------------------------------------

const UNDO = { kind: 'undo', key: 'u1', at: AT } as const;

/** A match with this phone’s own rally accepted at seq 2 (`ev-2`), over the browser’s start. */
function withOwnRally(extra: Partial<Parameters<typeof held>[0]> = {}): MatchState {
  const ledger = ledgerOf([start(), { ...rally('H'), link: PHONE_LINK }]);
  const queue = queueOf({ ownEventIds: [eventId(2)] });
  return ready({ ledger, queue, ...extra });
}

describe('Undo', () => {
  it('of this phone’s accepted event queues a void of it, as any tap, saved before it is sent', () => {
    const result = step(withOwnRally(), UNDO, NOW);
    expect(result.outcome).toEqual({ ok: true });
    expect(result.state.sync.queue.pending).toEqual([
      {
        key: 'u1',
        type: 'core.void',
        payload: { event_id: 'ev-2' },
        rulesVersion: 1,
        createdAt: AT,
        attempts: 0,
      },
    ]);
    expect(savesOf(result.effects)[0].tap).toBe('u1');
    expect(sendsOf(result.effects)).toEqual([]);
  });

  it('with nothing of this phone’s to take back says so', () => {
    const result = step(ready(), UNDO, NOW);
    expect(result.outcome).toEqual({ ok: false, refusal: 'nothingToUndo' });
    expect(result.state.sync.queue.pending).toEqual([]);
  });

  it('after another scorer has scored is refused, and the line says why for as long as it is true', () => {
    const ledger = ledgerOf([start(), { ...rally('H'), link: PHONE_LINK }, rally('A')]);
    const state = ready({ ledger, queue: queueOf({ ownEventIds: [eventId(2)] }) });
    const result = step(state, UNDO, NOW);
    expect(result.outcome).toEqual({ ok: false, refusal: 'notNow' });
    expect(result.state.sync.queue.pending).toEqual([]);
  });

  it('twice in a row takes back one event, not two: the second finds nothing of this phone’s still standing', () => {
    const { state, steps } = drive(withOwnRally(), [UNDO, { ...UNDO, key: 'u2' }]);
    expect(steps[1].outcome).toEqual({ ok: false, refusal: 'nothingToUndo' });
    expect(state.sync.queue.pending.map((tap) => tap.key)).toEqual(['u1']);
  });

  it('of a tap still only queued takes it out of the queue, sends nothing, and keeps the line’s undone tap', () => {
    const { state } = tappedOnce();
    const undone = step(state, UNDO, NOW);
    expect(undone.outcome).toEqual({ ok: true });
    expect(undone.state.sync.queue.pending).toEqual([]);
    expect(undone.state.undone).toEqual({ tap: { kind: 'rally', side: 'first' }, over: '1:' });
    expect(sendsOf(undone.effects)).toEqual([]);
    expect(savesOf(undone.effects)[0].queue?.pending).toEqual([]);
  });

  it('of a queued tap clears what the line said before it', () => {
    const said = step(
      tappedOnce().state,
      { kind: 'say', words: { kind: 'note', key: 'scoring.pad.countedOnce' } },
      NOW,
    );
    expect(step(said.state, UNDO, NOW).state.line).toBeNull();
  });

  it('of the tap the server’s copy already holds (a ping beat the answer) is the copy’s own event, voided at once', () => {
    const { state } = sentOnce();
    const copy = ledgerOf([start(), { ...rally('H'), link: PHONE_LINK }]).slice(1);
    const merged = step(state, { kind: 'fetched', events: copy }, NOW).state;
    const result = step(merged, UNDO, NOW);
    expect(result.outcome).toEqual({ ok: true });
    expect(result.state.sync.queue.pending.map((tap) => [tap.key, tap.payload])).toEqual([
      ['k1', { wonBy: HOME }],
      ['u1', { event_id: 'ev-2' }],
    ]);
  });

  it('only ever sees the queued taps the fold keeps: an illegal one at the end is never what Undo takes back', () => {
    const decided = ledgerOf([
      start(),
      ...Array.from({ length: 41 }, () => rally('H')),
      { ...rally('H'), link: PHONE_LINK },
    ]);
    // The deciding rally is this phone's own, and Undo's window (owner, 2026-11-03) opened at NOW.
    const base = ready({
      ledger: decided,
      queue: queueOf({ ownEventIds: [eventId(43)] }),
      decidedAt: NOW,
    });
    const illegal = queuedOf('k9', rally('H'));
    const state: MatchState = {
      ...base,
      sync: { ...base.sync, queue: { ...base.sync.queue, pending: [illegal] } },
    };
    const result = step(state, UNDO, NOW);
    expect(result.outcome).toEqual({ ok: true });
    expect(result.state.sync.queue.pending.map((tap) => [tap.key, tap.payload])).toEqual([
      ['k9', { wonBy: HOME }],
      ['u1', { event_id: 'ev-43' }],
    ]);
  });

  it('of the match’s start sends the scorer back to the Start screen: the pick goes with it', () => {
    const state = ready({}, []);
    const { state: started } = drive(state, [
      { kind: 'tap', tap: { kind: 'start', server: 'first' }, key: 's1', at: AT },
    ]);
    const undone = step(started, UNDO, NOW);
    expect(undone.state.sync.queue.pending).toEqual([]);
    expect(undone.state.toss).toBeNull();
  });

  it('a sanction’s void by the ending prompt is refused when no ending is waiting', () => {
    const result = step(withOwnRally(), { ...UNDO, only: 'ending' }, NOW);
    expect(result.outcome).toEqual({ ok: false, refusal: 'notNow' });
    expect(result.state.sync.queue.pending).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The queue file names its match (Task 10: Home's Continue card says "4 taps from Match 4")
// ---------------------------------------------------------------------------------------------------------------

describe('the queue file names its match', () => {
  const tapSaved = (from: MatchState) => savesOf(tappedOnce(from).steps[0].effects)[0];

  it('a queue saved while the bootstrap is held carries the match as Home calls it', () => {
    expect(tapSaved(ready({ queue: queueOf({ label: '' }) })).queue?.label).toBe('Match 4');
  });

  it('follows the organiser: the label is the held bootstrap’s at the time of the save', () => {
    const renamed = { ...SINGLES, context: { ...SINGLES.context, match: 'Match 9' } };
    expect(
      tapSaved(ready({ queue: queueOf({ label: 'Match 4' }), bootstrap: renamed })).queue?.label,
    ).toBe('Match 9');
  });

  it('a sender with no bootstrap keeps the label the file had', () => {
    const headless = opened({
      judge: 'trust',
      bootstrap: null,
      queue: queueOf({ label: 'Match 4', pending: [queuedOf('k1', rally('H'))] }),
    });
    const marked = step(headless, { kind: 'fetched', events: [] }, NOW);
    expect(sendsOf(marked.effects)).toHaveLength(1);
    const saves = savesOf(marked.effects);
    expect(saves).toHaveLength(1);
    expect(saves[0].queue?.label).toBe('Match 4');
  });

  it('a match nobody has named stays unnamed, and is not given an id for a name', () => {
    const headless = opened({
      judge: 'trust',
      bootstrap: null,
      queue: queueOf({ label: '', pending: [queuedOf('k1', rally('H'))] }),
    });
    const marked = step(headless, { kind: 'fetched', events: [] }, NOW);
    expect(savesOf(marked.effects)[0].queue?.label).toBe('');
  });

  it('a queue saved again after a refused save names it too', () => {
    const failed = step(
      tappedOnce(ready({ queue: queueOf({ label: '' }) })).state,
      { kind: 'saveFailed', key: 'k1' },
      NOW,
    );
    expect(savesOf(failed.effects)[0].queue?.label).toBe('Match 4');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// A save that did not land
// ---------------------------------------------------------------------------------------------------------------

describe('a refused save', () => {
  const failedTap = () => step(tappedOnce().state, { kind: 'saveFailed', key: 'k1' }, NOW);

  it('takes the tap back out: the screen never showed it, and the queue is saved again without it', () => {
    const failed = failedTap();
    expect(failed.state.sync.queue.pending).toEqual([]);
    const [resave] = savesOf(failed.effects);
    expect(resave.queue?.pending).toEqual([]);
    expect(resave.tap).toBeNull();
  });

  it('does not say "not recorded" until the queue without that tap is saved: the line says it could not save', () => {
    const failed = failedTap();
    expect(failed.state.line).toEqual({ kind: 'refusal', key: 'scoring.refusal.savePending' });
    const landed = step(failed.state, { kind: 'saved', n: 99 }, NOW);
    expect(landed.state.line).toEqual({ kind: 'refusal', key: 'scoring.refusal.notSaved' });
    expect(landed.state.saveOwed).toBeNull();
  });

  it('a re-save that fails too waits five seconds and tries again, however many times it takes', () => {
    const first = failedTap().state;
    const second = step(first, { kind: 'saveFailed', key: null }, NOW);
    expect(second.effects).toEqual([]);
    expect(wakeAt(second.state, NOW)).toBe(NOW + 5000);
    expect(step(second.state, { kind: 'tick' }, NOW + 4999).effects).toEqual([]);
    const due = step(second.state, { kind: 'tick' }, NOW + 5000);
    expect(savesOf(due.effects)).toHaveLength(1);
    const third = step(due.state, { kind: 'saveFailed', key: null }, NOW + 5000);
    expect(third.effects).toEqual([]);
    expect(wakeAt(third.state, NOW + 5000)).toBe(NOW + 10_000);
  });

  it('a failed save of a send’s attempt mark is saved again, and says nothing of a tap', () => {
    const { state } = sentOnce();
    const failed = step(state, { kind: 'saveFailed', key: null }, NOW);
    expect(failed.state.line).toBeNull();
    expect(savesOf(failed.effects)).toHaveLength(1);
    const landed = step(failed.state, { kind: 'saved', n: 99 }, NOW);
    expect(landed.state.line).toBeNull();
  });

  it('a tap already sent (with an attempt) is not taken back out by a save that failed after it', () => {
    const { state } = sentOnce();
    const failed = step(state, { kind: 'saveFailed', key: 'k1' }, NOW);
    expect(failed.state.sync.queue.pending.map((tap) => tap.key)).toEqual(['k1']);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// What the fold counts
// ---------------------------------------------------------------------------------------------------------------

describe('the tap in flight and the server’s copy of it', () => {
  /** A rally written by this phone's own link: what the server's copy of its tap carries. */
  const OURS = { ...rally('H'), link: PHONE_LINK };

  /** k1 sent at seq 1, and the ledger then brought in an event at seq 2 (a ping beat the answer). */
  function withCopy(payload: unknown, type = 'badminton.rally') {
    const { state } = sentOnce();
    const copy = { ...ledgerOf([start(), OURS])[1], type, payload };
    return { ...state, sync: { ...state.sync, ledger: [...state.sync.ledger, copy], tip: 2 } };
  }

  it('is hidden from the fold once the ledger holds its copy: the queue it counts leaves the tap out', () => {
    expect(foldQueue(withCopy({ wonBy: HOME }))).toEqual([]);
  });

  it('is still hidden when the server hands the payload back with its keys in another order', () => {
    const base = { ...ledgerOf([start(), OURS])[1] };
    const { state } = sentOnce();
    const queued = { ...state.sync.queue.pending[0], payload: { b: 2, a: { y: 1, x: [1, 2] } } };
    const held = {
      ...state,
      sync: {
        ...state.sync,
        queue: { ...state.sync.queue, pending: [queued] },
        ledger: [...state.sync.ledger, { ...base, payload: { a: { x: [1, 2], y: 1 }, b: 2 } }],
        tip: 2,
      },
    };
    expect(foldQueue(held)).toEqual([]);
  });

  it.each([
    ['another payload', withCopy({ wonBy: AWAY })],
    ['a payload with one field more', withCopy({ wonBy: HOME, extra: 1 })],
    ['a payload with one field fewer', withCopy({})],
    ['another type', withCopy({ wonBy: HOME }, 'badminton.sanction')],
  ])('is counted when the ledger’s event at that seq has %s', (_name, state) => {
    expect(foldQueue(state).map((tap) => tap.key)).toEqual(['k1']);
  });

  it('is counted when a list in its payload is an object in the ledger’s copy, or the other way round', () => {
    const { state } = sentOnce();
    const [head] = state.sync.queue.pending;
    const base = ledgerOf([start(), OURS])[1];
    const withLists = (queuedValue: unknown, copyValue: unknown) => ({
      ...state,
      sync: {
        ...state.sync,
        queue: { ...state.sync.queue, pending: [{ ...head, payload: { a: queuedValue } }] },
        ledger: [...state.sync.ledger, { ...base, payload: { a: copyValue } }],
        tip: 2,
      },
    });
    expect(foldQueue(withLists([], {})).map((tap) => tap.key)).toEqual(['k1']);
    expect(foldQueue(withLists({}, [])).map((tap) => tap.key)).toEqual(['k1']);
    expect(foldQueue(withLists([1], [1]))).toEqual([]);
  });

  it.each([
    ['a co-scorer’s link', BROWSER_LINK],
    ['no link at all', null],
  ])(
    'is counted when the identical event at that seq is written by %s: it is theirs, not ours',
    (_name, link) => {
      const state = withCopy({ wonBy: HOME });
      const [copy] = state.sync.ledger.slice(-1);
      const theirs = {
        ...state,
        sync: {
          ...state.sync,
          ledger: [...state.sync.ledger.slice(0, -1), { ...copy, deviceLinkId: link }],
        },
      };
      expect(foldQueue(theirs).map((tap) => tap.key)).toEqual(['k1']);
    },
  );

  it('is counted when no bootstrap says which link is ours', () => {
    const state = withCopy({ wonBy: HOME });
    expect(foldQueue({ ...state, bootstrap: null }).map((tap) => tap.key)).toEqual(['k1']);
  });

  it('is counted when no send is in flight, whatever the ledger holds', () => {
    const state = withCopy({ wonBy: HOME });
    expect(foldQueue({ ...state, sent: null }).map((tap) => tap.key)).toEqual(['k1']);
    expect(
      foldQueue({ ...state, sync: { ...state.sync, inFlight: null } }).map((tap) => tap.key),
    ).toEqual(['k1']);
  });

  it('is counted when the copy sits at another seq than the one it was sent at plus one', () => {
    const state = withCopy({ wonBy: HOME });
    const moved = {
      ...state,
      sent: state.sent === null ? null : { ...state.sent, expectedSeq: 0 },
    };
    expect(foldQueue(moved).map((tap) => tap.key)).toEqual(['k1']);
  });
});

describe('this phone’s own events', () => {
  const eventOn = (link: string | null) => ({
    ...ledgerOf([start(), rally('H')])[1],
    deviceLinkId: link,
  });
  const stateWith = (link: string | null, own: readonly string[] = ['ev-2']) => {
    const base = ready();
    return {
      ...base,
      sync: {
        ...base.sync,
        ledger: [base.sync.ledger[0], eventOn(link)],
        queue: { ...base.sync.queue, ownEventIds: own },
      },
    };
  };

  it('keeps an id whose event names this link, or no link (a stand-in the phone built from its own tap)', () => {
    expect(ownIds(stateWith(PHONE_LINK))).toEqual(['ev-2']);
    expect(ownIds(stateWith(null))).toEqual(['ev-2']);
  });

  it('drops an id whose event names another link: a queue file kept from a link no longer in use', () => {
    expect(ownIds(stateWith(BROWSER_LINK))).toEqual([]);
  });

  it('keeps an id the ledger does not hold yet', () => {
    expect(ownIds(stateWith(PHONE_LINK, ['ev-9']))).toEqual(['ev-9']);
  });

  it('with no bootstrap held, keeps them all', () => {
    expect(ownIds({ ...stateWith(BROWSER_LINK), bootstrap: null })).toEqual(['ev-2']);
  });
});

describe('what closes a match', () => {
  it('the queue’s own word wins over what a read said', () => {
    const state = ready({ queue: queueOf({ dead: 'LINK_REVOKED' }) });
    const closed = { ...state, closed: 'finalized' } as const;
    expect(deadOf(closed)).toBe('LINK_REVOKED');
  });

  it('with the queue alive, a read’s word closes it', () => {
    expect(deadOf({ ...ready(), closed: 'gone' })).toBe('gone');
  });
});

describe('the line', () => {
  it('says what it is told, and a tap that counts clears it', () => {
    const said = step(
      ready(),
      { kind: 'say', words: { kind: 'note', key: 'scoring.pad.countedOnce' } },
      NOW,
    );
    expect(said.state.line).toEqual({ kind: 'note', key: 'scoring.pad.countedOnce' });
    const tapped2 = step(said.state, { kind: 'tap', tap: RALLY_FIRST, key: 'k1', at: AT }, NOW);
    expect(tapped2.state.line).toBeNull();
  });

  it('is kept by a refused tap: nothing counted, so nothing to clear', () => {
    const said = step(
      ready(),
      { kind: 'say', words: { kind: 'note', key: 'scoring.pad.countedOnce' } },
      NOW,
    ).state;
    const refused = step(
      said,
      { kind: 'tap', tap: { kind: 'setScore', first: 30, second: 5 }, key: 'k1', at: AT },
      NOW,
    );
    expect(refused.state.line).toEqual({ kind: 'note', key: 'scoring.pad.countedOnce' });
  });
});
