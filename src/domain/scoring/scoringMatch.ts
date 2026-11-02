import { type SyncState, openSync } from '@/domain/scoring/sync';
import { abandon, onAnswered } from '@/domain/scoring/scoringMatchAnswers';
import { pump } from '@/domain/scoring/scoringMatchPump';
import {
  bootstrapDueAt,
  onBootstrapRead,
  onFailed,
  onFetched,
  onRulesRead,
  wanting,
} from '@/domain/scoring/scoringMatchReads';
import { landedSave, onSaveFailed, saveOf, savedOf } from '@/domain/scoring/scoringMatchSaves';
import {
  ENGINE_EPOCH,
  LOAD_BOOTSTRAP,
  deadOf,
  handled,
  part,
  type Handled,
  type MatchEffect,
  type MatchEvent,
  type MatchHeld,
  type MatchState,
  type MatchStep,
  type Planned,
} from '@/domain/scoring/scoringMatchState';
import { onPick, onTap, onUndo, withoutOrphanVoids } from '@/domain/scoring/scoringMatchTaps';

/**
 * One scoring match on the phone, as ONE pure reducer (plan S2-1 Task 9): every change to what the phone holds (a tap, an
 * Undo, a server's answer, a fetch, the rules, the bootstrap, the app going to the background, a save that did not
 * land) goes through `step` on the latest state, and comes out as the next state and the effects to run, in order.
 * Nothing here touches a clock, a file or the network: `now` is the caller's, and an effect is only a word for what the
 * hook then does (`scoringRunner.ts`).
 *
 * Not a second state machine of the capture session (AGENTS §2): the authority is the server's ledger, and the match is
 * a fold of it through @seazn/engine, as the web's pad does. What this adds to `sync.ts` (which judges answers) is the
 * orchestration around it: which fold judges a tap, what an Undo takes back, when `revalidate` runs, the payload a send
 * is made with, and what a save that failed means. It is split by what each part is about: the state, the taps, the
 * answers, the reads, the saves and the pump.
 */

/**
 * A match opened from what was kept. The tip is the LEDGER's last seq, never `bootstrap.lastSeq` (a bootstrap is a
 * moment, the ledger is what folds). With taps queued nothing is sent until the ledger has been read and the queue
 * judged on it (hold `ledger`, a revalidation owed): the phone may have been closed while another scorer finished the
 * game. The ledger and the bootstrap are read at once, unless the queue is already dead.
 */
export function openMatch(held: MatchHeld, now: number): MatchStep {
  const opened = openSync({
    queue: held.queue,
    ledger: held.ledger,
    rulesVersion: held.bootstrap?.rulesVersion ?? held.rulesVersion,
    engineEpoch: ENGINE_EPOCH,
  });
  const owing = held.queue.pending.length > 0 && held.queue.dead === null;
  const sync: SyncState = owing ? { ...opened, hold: 'ledger', revalidateOwed: true } : opened;
  const state: MatchState = {
    sync,
    bootstrap: held.bootstrap,
    toss: held.toss,
    judge: held.judge,
    foreground: held.foreground,
    closed: null,
    bootOffline: false,
    sent: null,
    undone: null,
    line: null,
    saveOwed: null,
    saving: 0,
    saveSeq: 0,
    bootstrapAskedAt: null,
    bootstrapOwed: false,
  };
  if (held.queue.dead !== null) return { state, effects: [], outcome: null };
  const asks = held.judge === 'fold';
  return {
    state: asks ? { ...state, bootstrapAskedAt: now } : state,
    effects: [{ kind: 'fetch', since: sync.tip }, ...(asks ? [LOAD_BOOTSTRAP] : [])],
    outcome: null,
  };
}

/**
 * The earliest time after `now` at which the state wants a step, or null: a send's backoff, a rules read asked again, a
 * save tried again. The runner arms ONE timer at it after every step, so a wait that comes after another is armed when
 * the first has passed, never left without a timer. Times are the caller's clock. Nothing is waited for in the
 * background (the return steps the match), and a dead queue sends nothing.
 */
export function wakeAt(state: MatchState, now: number): number | null {
  if (!state.foreground) return null;
  const { sync } = state;
  const sends = sync.queue.pending.length > 0 && deadOf(state) === null;
  const times = [
    sends ? sync.notBefore : null,
    sync.rulesRetryAt,
    state.saveOwed?.retryAt ?? null,
    bootstrapDueAt(state),
  ];
  const ahead = times.filter((at): at is number => at !== null && at > now);
  return ahead.length === 0 ? null : Math.min(...ahead);
}

export function step(state: MatchState, event: MatchEvent, now: number): MatchStep {
  const result = handle(state, event, now);
  const settled = result.pump ? pump(result.state, now) : part(result.state);
  const final = withoutOrphanVoids(settled.state);
  const save = saveOf(state, final);
  const planned = [...(save === null ? [] : [save]), ...result.effects, ...settled.effects];
  const { effects, last } = numbered(planned, final.saveSeq);
  const owed = effects.filter((effect) => effect.kind === 'save' && effect.queue !== null).length;
  return {
    state: { ...final, saving: final.saving + owed, saveSeq: last },
    effects,
    outcome: result.outcome,
  };
}

/** Each save, in the order made, gets the next number after `seq`. */
function numbered(
  planned: readonly Planned[],
  seq: number,
): { effects: MatchEffect[]; last: number } {
  let last = seq;
  const effects = planned.map((effect): MatchEffect => {
    if (effect.kind !== 'save') return effect;
    last += 1;
    return { ...effect, n: last };
  });
  return { effects, last };
}

function handle(state: MatchState, event: MatchEvent, now: number): Handled {
  switch (event.kind) {
    case 'tap':
      return onTap(state, event);
    case 'undo':
      return onUndo(state, event);
    case 'pickServer':
      return onPick(state, event.side);
    case 'answered':
      return onAnswered(state, event.sent, event.answer, now);
    case 'abandoned':
      return handled(abandon(state, event.key, now));
    case 'fetched':
      return handled(onFetched(state, event.events, now));
    case 'rulesRead':
      return handled(onRulesRead(state, event.rules));
    case 'bootstrapRead':
      return handled(onBootstrapRead(state, event.bootstrap));
    case 'fetchFailed':
    case 'rulesFailed':
    case 'bootstrapFailed':
      return handled(onFailed(state, event.kind, event.failure, now));
    case 'read':
    case 'foreground':
      return handled(
        wanting(event.kind === 'foreground' ? { ...state, foreground: true } : state, now),
      );
    case 'background':
      return handled(part({ ...state, foreground: false }));
    case 'tick':
      return handled(part(state));
    case 'saved':
      return handled(part(savedOf(landedSave(state), event.n)));
    case 'saveFailed':
      return handled(onSaveFailed(landedSave(state), event.key, now));
    case 'say':
      return handled(part({ ...state, line: event.words }));
  }
}
