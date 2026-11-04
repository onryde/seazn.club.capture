import { describe, expect, it } from 'vitest';
import { step } from '@/domain/scoring/scoringMatch';
import { finishOf } from '@/domain/scoring/scoringFinish';
import { deadOf, type MatchState } from '@/domain/scoring/scoringMatchState';
import type { LedgerEvent } from '@/domain/scoring/wire';
import { viewOf } from '@/domain/scoring/scoringMatchView';
import {
  GAME_ONE_21_15,
  SINGLES,
  ledgerOf,
  queuedOf,
  rallies,
  rally,
} from '../../../test/badmintonLedger';
import {
  NOW,
  kinds,
  opened,
  queueOf,
  savesOf,
  sendsOf,
  sentOnce,
} from '../../../test/scoringMatchFixtures';

// Fix round 1 of Task 8d (controller, 2026-11-04). A queue that closes on a result that stands (a 403
// RESULT_CARRIED_FORWARD, or a finalized status read with taps queued) leaves the pad and Home scoring from the
// ledger alone, and nothing reads the ledger once the queue is dead. So the close reads it once more: a co-scorer's
// events, or ones this phone missed offline, show after that one read, and nothing is read after it.
//
// The match: game one 21-15 (37 events with the start), game two at 20-0 to the first side (tip 57). The phone holds
// two rallies for the second side (k1, k2: legal on the ledger as it is), k1 sent when the answer comes.

const SPECS = [...GAME_ONE_21_15, ...rallies('H'.repeat(20))];
const TIP = 57;
const FINALIZED = { ...SINGLES, status: 'finalized' };
const CARRIED = { kind: 'refused', status: 403, code: 'RESULT_CARRIED_FORWARD' } as const;

const holding = () =>
  opened(
    { queue: queueOf({ pending: [queuedOf('k1', rally('A')), queuedOf('k2', rally('A'))] }) },
    SPECS,
  );

/** k1 sent, its answer a 403 RESULT_CARRIED_FORWARD: the queue closes. */
function closedOnCarried() {
  const read = step(holding(), { kind: 'fetched', events: [] }, NOW);
  const saved = step(read.state, { kind: 'saved', n: 99 }, NOW);
  const sent = sendsOf(read.effects)[0].sent;
  return step(saved.state, { kind: 'answered', sent, answer: CARRIED }, NOW);
}

/** The ledger as the server holds it by then: the events after the tip, as a co-scorer's phone sent them. */
const serverWith = (...won: Parameters<typeof rally>[0][]): readonly LedgerEvent[] =>
  ledgerOf([...SPECS, ...won.map((side) => rally(side))]);
const meanwhile = (...won: Parameters<typeof rally>[0][]) => serverWith(...won).slice(TIP);

type Stepped = ReturnType<typeof step>;

const fetchesOf = (effects: Stepped['effects']) =>
  effects.flatMap((effect) => (effect.kind === 'fetch' ? [effect] : []));

/**
 * The runner's part for reads: every `fetch` a step asks for is answered from the server's ledger, and what those
 * answers ask for in turn, up to ten reads (a loop would use them all). Nothing else is done for the match.
 */
function serve(from: Stepped, server: readonly LedgerEvent[]) {
  let state = from.state;
  let asked = fetchesOf(from.effects);
  let reads = 0;
  while (asked.length > 0 && reads < 10) {
    const [ask, ...rest] = asked;
    const next = step(
      state,
      { kind: 'fetched', events: server.filter((e) => e.seq > ask.since) },
      NOW,
    );
    state = next.state;
    asked = [...rest, ...fetchesOf(next.effects)];
    reads += 1;
  }
  return { state, reads };
}

const valuesOf = (state: MatchState) => {
  const view = viewOf(state);
  if (view.kind !== 'pad') throw new Error(`expected the pad, got ${view.kind}`);
  return view.view.halves.map((half) => half.value);
};

describe('closing on a result that stands reads the ledger once more', () => {
  it('a 403 RESULT_CARRIED_FORWARD closes the queue, keeps both taps, and asks for the ledger from the tip', () => {
    const closed = closedOnCarried();
    expect(deadOf(closed.state)).toBe('carriedForward');
    expect(closed.state.sync.queue.pending.map((tap) => tap.key)).toEqual(['k1', 'k2']);
    expect(fetchesOf(closed.effects)).toEqual([{ kind: 'fetch', since: TIP }]);
    expect(savesOf(closed.effects)).toHaveLength(1);
    expect(sendsOf(closed.effects)).toEqual([]);
  });

  it('the pad shows a co-scorer’s rally that landed meanwhile once the one read is served, and not before', () => {
    const closed = closedOnCarried();
    expect(valuesOf(closed.state)).toEqual(['20', '0']);
    const served = serve(closed, serverWith('A'));
    expect(served.reads).toBe(1);
    expect(valuesOf(served.state)).toEqual(['20', '1']);
  });

  it('Home’s Finished score has the games that read brought: a deciding rally the phone missed offline', () => {
    const closed = closedOnCarried();
    expect(finishOf(closed.state)).toEqual({ score: '21–15' });
    const served = serve(closed, serverWith('H'));
    expect(served.reads).toBe(1);
    expect(finishOf(served.state)).toEqual({ score: '21–15, 21–0' });
  });

  it('a server that has nothing new is read once too, and the score is the ledger’s as it was', () => {
    const served = serve(closedOnCarried(), serverWith());
    expect(served.reads).toBe(1);
    expect(valuesOf(served.state)).toEqual(['20', '0']);
  });

  it('what the read brings never drops a tap: the queue is dead, its taps stay as they were, even those now illegal', () => {
    const closed = closedOnCarried();
    const read = step(closed.state, { kind: 'fetched', events: meanwhile('H') }, NOW);
    expect(read.state.sync.queue.pending.map((tap) => tap.key)).toEqual(['k1', 'k2']);
    expect(read.state.sync.queue.dead).toBe('carriedForward');
    expect(read.state.line).toBeNull();
    expect(sendsOf(read.effects)).toEqual([]);
    expect(fetchesOf(read.effects)).toEqual([]);
  });

  // The read is one: its answer asks for nothing, and nothing the screen does asks again.
  it.each([
    ['an empty answer', { kind: 'fetched', events: [] }],
    ['new events', { kind: 'fetched', events: meanwhile('A') }],
  ] as const)(
    'after %s, no read follows: not a pass, not the foreground, not time',
    (_name, event) => {
      const read = step(closedOnCarried().state, event, NOW);
      expect(fetchesOf(read.effects)).toEqual([]);
      for (const later of [{ kind: 'read' }, { kind: 'foreground' }, { kind: 'tick' }] as const) {
        for (const at of [NOW, NOW + 60_000, NOW + 3_600_000]) {
          expect(fetchesOf(step(read.state, later, at).effects)).toEqual([]);
        }
      }
    },
  );

  it('a post-close read that did not land is not tried again: offline, or refused the same way', () => {
    const closed = closedOnCarried();
    const failures = [{ kind: 'offline' }, CARRIED] as const;
    for (const failure of failures) {
      const failed = step(closed.state, { kind: 'fetchFailed', failure }, NOW);
      expect(fetchesOf(failed.effects)).toEqual([]);
      expect(deadOf(failed.state)).toBe('carriedForward');
      expect(failed.state.sync.queue.pending).toHaveLength(2);
      for (const at of [NOW + 5_000, NOW + 60_000, NOW + 3_600_000]) {
        expect(fetchesOf(step(failed.state, { kind: 'tick' }, at).effects)).toEqual([]);
      }
    }
  });

  it('a second answer for the same tap (a repeat) reads nothing more', () => {
    const closed = closedOnCarried();
    const again = step(
      closed.state,
      { kind: 'answered', sent: queuedOf('k1', rally('A')), answer: CARRIED },
      NOW,
    );
    expect(fetchesOf(again.effects)).toEqual([]);
  });
});

describe('the other close that stands, a finalized status read with taps queued', () => {
  const finalized = { ...SINGLES, status: 'finalized' };

  it('asks for the ledger from the tip once, and the read shows the games the phone had missed', () => {
    const read = step(holding(), { kind: 'bootstrapRead', bootstrap: finalized }, NOW);
    expect(deadOf(read.state)).toBe('finalized');
    expect(fetchesOf(read.effects)).toEqual([{ kind: 'fetch', since: TIP }]);
    const served = serve(read, serverWith('H'));
    expect(served.reads).toBe(1);
    expect(finishOf(served.state)).toEqual({ score: '21–15, 21–0' });
    expect(served.state.sync.queue.pending.map((tap) => tap.key)).toEqual(['k1', 'k2']);
  });

  it('the same status read again reads nothing more: it is the same close', () => {
    const first = step(holding(), { kind: 'bootstrapRead', bootstrap: finalized }, NOW);
    const again = step(first.state, { kind: 'bootstrapRead', bootstrap: finalized }, NOW);
    expect(fetchesOf(again.effects)).toEqual([]);
  });

  it('a finalized status with nothing queued is not a close of the queue: nothing is asked for', () => {
    const empty = opened({}, SPECS);
    const read = step(empty, { kind: 'bootstrapRead', bootstrap: finalized }, NOW);
    expect(read.state.sync.queue.dead).toBeNull();
    expect(fetchesOf(read.effects)).toEqual([]);
  });

  it('a cancelled status has no result to show: no read', () => {
    const cancelled = { ...SINGLES, status: 'cancelled' };
    const read = step(holding(), { kind: 'bootstrapRead', bootstrap: cancelled }, NOW);
    expect(deadOf(read.state)).toBe('cancelled');
    expect(fetchesOf(read.effects)).toEqual([]);
  });
});

describe('the closes that say no result stands read nothing', () => {
  it.each([
    ['a link revoked', { kind: 'linkDead', code: 'LINK_REVOKED' }],
    ['a match gone', { kind: 'refused', status: 404, code: 'NOT_FOUND' }],
    ['an account to pay', { kind: 'refused', status: 402, code: 'PAYMENT_REQUIRED' }],
    ['a forbidden write', { kind: 'refused', status: 403, code: 'FORBIDDEN' }],
  ] as const)('%s', (_name, answer) => {
    const read = step(holding(), { kind: 'fetched', events: [] }, NOW);
    const sent = sendsOf(read.effects)[0].sent;
    const saved = step(read.state, { kind: 'saved', n: 99 }, NOW);
    const closed = step(saved.state, { kind: 'answered', sent, answer }, NOW);
    expect(fetchesOf(closed.effects)).toEqual([]);
  });
});

// Final review M1 (2026-11-04). A dead queue is never looked at again: its taps are leftovers, and judging them on a
// ledger or rules that moved after the close would drop the ones those make illegal, and save them out of the file.
describe('a dead queue is not judged or read for rules again', () => {
  // The finalized close, where no tap was ever sent: the carried-forward close leaves a sent head, which revalidation
  // never drops (`isUnresolved`), so only this one shows the drop.
  it('a rules answer that lands after the close drops nothing: the leftovers stay, even those the ledger made illegal', () => {
    const closed = step(holding(), { kind: 'bootstrapRead', bootstrap: FINALIZED }, NOW);
    const served = serve(closed, serverWith('H'));
    expect(served.state.sync.queue.pending.map((tap) => tap.key)).toEqual(['k1', 'k2']);
    const rules = { cfg: SINGLES.cfg, rulesVersion: 1, formatLine: null };
    const read = step(served.state, { kind: 'rulesRead', rules }, NOW);
    expect(deadOf(read.state)).toBe('finalized');
    expect(read.state.sync.queue.pending.map((tap) => tap.key)).toEqual(['k1', 'k2']);
    expect(read.state.line).toBeNull();
    expect(savesOf(read.effects).filter((save) => save.queue !== null)).toEqual([]);
    expect(sendsOf(read.effects)).toEqual([]);
  });

  it('a rules read that failed before the close is not asked for again once it is due', () => {
    const { state, sent } = sentOnce();
    const asked = step(
      state,
      { kind: 'answered', sent, answer: { kind: 'rulesChanged', rulesVersion: 2 } },
      NOW,
    );
    const failed = step(asked.state, { kind: 'rulesFailed', failure: { kind: 'offline' } }, NOW);
    const closed = step(failed.state, { kind: 'bootstrapRead', bootstrap: FINALIZED }, NOW);
    expect(deadOf(closed.state)).toBe('finalized');
    expect(closed.state.sync.queue.pending.map((tap) => tap.key)).toEqual(['k1']);
    for (const at of [NOW + 15_000, NOW + 60_000]) {
      expect(kinds(step(closed.state, { kind: 'tick' }, at).effects)).not.toContain('loadRules');
    }
  });
});
