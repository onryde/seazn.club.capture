import { describe, expect, it } from 'vitest';
import { step } from '@/domain/scoring/scoringMatch';
import { stallOf } from '@/domain/scoring/scoringMatchStall';
import type { MatchState } from '@/domain/scoring/scoringMatchState';
import type { AppendAnswer } from '@/domain/scoring/wire';
import { SINGLES, queuedOf, rally } from '../../../test/badmintonLedger';
import { NOW, ready, tapped } from '../../../test/scoringMatchFixtures';

// When the phone cannot get a tap to the server and the pad would otherwise say "Sending" for good (device, 2026-11-02:
// the server refused every send FIXTURE_RULES_CHANGED and the pad showed "Sending 8 taps" with nothing in the record).
// `stallOf` is the one reading of that, for the record's `scoring.stalled` line and for the pad's "can't send" state.
// Literal counts: the third refusal pauses the sender 15 s, the sixth is the second pause.

const changed: AppendAnswer = { kind: 'rulesChanged', rulesVersion: 7 };
const conflict: AppendAnswer = { kind: 'seqConflict', currentSeq: 9 };

/** A match with one queued rally, refused `count` times in a row with `answer`, each refusal's reads answered as a server would. */
function refusedTimes(count: number, answer: AppendAnswer): MatchState {
  let state = ready(tapped([queuedOf('k1', rally('H'))]));
  state = step(state, { kind: 'saved', n: 99 }, NOW).state;
  let at = NOW;
  for (let i = 0; i < count; i += 1) {
    const head = state.sync.queue.pending[0];
    state = step(state, { kind: 'answered', sent: head, answer }, at).state;
    // The reads the refusal asked for come back with nothing the phone can agree with.
    state = step(state, { kind: 'fetched', events: [] }, at).state;
    state = step(
      state,
      { kind: 'rulesRead', rules: { cfg: SINGLES.cfg, rulesVersion: 3, formatLine: null } },
      at,
    ).state;
    at += 16_000;
    state = step(state, { kind: 'tick' }, at).state;
  }
  return state;
}

describe('stallOf: the server answers and never takes the tap', () => {
  it('is not a stall before the sixth refusal in a row', () => {
    expect(stallOf(refusedTimes(5, changed))).toBeNull();
  });

  it('is, from the sixth: by what it kept saying', () => {
    expect(stallOf(refusedTimes(6, changed))).toEqual({
      kind: 'refused',
      by: 'rules',
      count: 6,
    });
    expect(stallOf(refusedTimes(6, conflict))).toEqual({
      kind: 'refused',
      by: 'conflict',
      count: 6,
    });
  });

  it('is over with nothing queued: there is nothing the phone cannot send', () => {
    const stalled = refusedTimes(6, changed);
    const emptied = {
      ...stalled,
      sync: { ...stalled.sync, queue: { ...stalled.sync.queue, pending: [] } },
    };
    expect(stallOf(emptied)).toBeNull();
  });

  it('is over for a link the door does not take: that is its own card', () => {
    const stalled = refusedTimes(6, changed);
    const dead = {
      ...stalled,
      sync: { ...stalled.sync, queue: { ...stalled.sync.queue, dead: 'LINK_REVOKED' as const } },
    };
    expect(stallOf(dead)).toBeNull();
  });

  it('is over for an app too old: the Update needed card says that', () => {
    const stalled = refusedTimes(6, changed);
    const old = {
      ...stalled,
      bootstrap: { ...SINGLES, epochRequired: stalled.sync.engineEpoch + 1 },
    };
    expect(stallOf(old)).toBeNull();
  });

  it('is over for a ledger over the read’s cap: the card says that', () => {
    const stalled = refusedTimes(6, changed);
    expect(stallOf({ ...stalled, sync: { ...stalled.sync, status: 'tooLarge' } })).toBeNull();
  });

  it('is nothing in the background: nothing is sent there, and the return starts it again', () => {
    const stalled = refusedTimes(6, changed);
    expect(stallOf(step(stalled, { kind: 'background' }, NOW).state)).toBeNull();
  });
});

describe('stallOf: a queue that cannot be judged', () => {
  const unfoldable = { ...SINGLES, cfg: { bestOf: 'many' } };
  const queue = [queuedOf('k1', rally('H'))];

  it('a match the engine cannot fold, with taps queued, holds the revalidation for good: said', () => {
    const state = ready({ ...tapped(queue), bootstrap: unfoldable });
    expect(state.sync.hold).toBe('revalidate');
    expect(stallOf(state)).toEqual({ kind: 'fold' });
  });

  it('is not a stall when nothing holds the queue for the judge: the sender sends without it', () => {
    const state = ready({ ...tapped(queue), bootstrap: unfoldable });
    expect(stallOf({ ...state, sync: { ...state.sync, hold: null } })).toBeNull();
  });

  // Review, 2026-11-02: the hold is `revalidate` (the queue waits to be judged) and the match cannot be judged because it
  // is not here yet, not because it cannot be folded: the guard on `bootstrap` is what says so, so it is pinned alone.
  it('is not a stall while the bootstrap is still to come: the card says loading, the read is out', () => {
    // The ledger is read (`ready`) and the bootstrap is not: the queue waits for the judge, and the judge has no match.
    const state = ready({ ...tapped(queue), bootstrap: null });
    expect(state.sync.hold).toBe('revalidate');
    expect(state.sync.queue.pending).toHaveLength(1);
    expect(state.foreground).toBe(true);
    expect(state.bootstrap).toBeNull();
    expect(stallOf(state)).toBeNull();
  });

  it('a foldable match is judged and sent: no stall', () => {
    const state = ready(tapped(queue));
    expect(state.sync.hold).toBeNull();
    expect(stallOf(state)).toBeNull();
  });

  it('with nothing queued the held revalidation is not a stall', () => {
    expect(stallOf(ready({ bootstrap: unfoldable }))).toBeNull();
  });
});
