import { refusalLine } from '@/domain/scoring/padLine';
import type { QueuedEvent } from '@/domain/scoring/queue';
import { type SyncEffect, type SyncState, onAnswer } from '@/domain/scoring/sync';
import type { AppendAnswer } from '@/domain/scoring/wire';
import {
  LOAD_BOOTSTRAP,
  NOT_YET,
  foldOfState,
  handled,
  part,
  resolved,
  withPending,
  type Handled,
  type MatchEffect,
  type MatchState,
  type Part,
} from '@/domain/scoring/scoringMatchState';

/**
 * The server's answer to a send (plan S2-1 Task 9): sync judges it, and what the match adds is here: the effects of the
 * step, and the Undo that waited for its tap's answer, made a plain void of the id the answer names.
 */

/**
 * Maps sync's effects to the hook's. `persist` is the save the diff makes; `send` is the pump's alone (`NOT_YET`);
 * `retryIn` is read off the state (`wakeAt`), not carried out as an effect of its own.
 */
function effectsOf(effects: readonly SyncEffect[]): { effects: MatchEffect[]; refused: boolean } {
  const out: MatchEffect[] = [];
  let refused = false;
  for (const effect of effects) {
    if (effect.kind === 'fetchSince') out.push({ kind: 'fetch', since: effect.seq });
    else if (effect.kind === 'reloadRules') out.push({ kind: 'loadRules' });
    else if (effect.kind === 'reloadBootstrap') out.push(LOAD_BOOTSTRAP);
    else if (effect.kind === 'refused') refused = true;
  }
  return { effects: out, refused };
}

/** The state after sync moved, and what it asked for; a tap that left the queue refused is said, once, on the line. */
export function withSync(
  state: MatchState,
  step: { state: SyncState; effects: readonly SyncEffect[] },
): Part {
  const mapped = effectsOf(step.effects);
  const line = mapped.refused ? refusalLine('scoring.refusal.notCounted') : state.line;
  return part({ ...state, sync: step.state, line }, mapped.effects);
}

export function onAnswered(
  state: MatchState,
  sent: QueuedEvent,
  answer: AppendAnswer,
  now: number,
): Handled {
  const accepted = answer.kind === 'accepted';
  const stepped = onAnswer(state.sync, sent, answer, accepted ? NOT_YET : now);
  const landed = state.sent?.key === sent.key ? { ...state, sent: null } : state;
  const moved = withSync(landed, stepped);
  const waits = moved.state.sync.queue.pending.some((tap) => tap.voidsKey === sent.key);
  if (!accepted || !waits) return handled(moved);
  return handled(resolveUndo(moved, sent.key, answer.eventId), { pump: false });
}

/**
 * The tap an Undo waited for was accepted: the Undo becomes a plain void of the id the answer names, in its place in the
 * queue. The fold must take it (another scorer may have voided the tap already: then it is dropped); the background
 * sender judges nothing and keeps it, and the server judges it.
 */
function resolveUndo(moved: Part, tapKey: string, eventId: string): Part {
  const { pending } = moved.state.sync.queue;
  const waiting = pending.find((tap) => tap.voidsKey === tapKey);
  if (waiting === undefined) return moved;
  const plain = resolved(waiting, eventId);
  const next = withPending(
    moved.state,
    pending.map((tap) => (tap === waiting ? plain : tap)),
  );
  const fold = foldOfState(next);
  const legal =
    next.judge === 'trust' ||
    (fold !== null && fold.kind === 'folded' && fold.legalQueued.includes(plain.key));
  const kept = legal
    ? next
    : withPending(
        moved.state,
        pending.filter((tap) => tap !== waiting),
      );
  return part(kept, moved.effects);
}

/** A send that never went: its tap stays, its attempt counted, and the sender waits as it does for no network. */
export function abandon(state: MatchState, key: string, now: number): Part {
  const tap = state.sync.queue.pending.find((queued) => queued.key === key);
  const landed = state.sent?.key === key ? { ...state, sent: null } : state;
  if (tap === undefined) return part(landed);
  return withSync(landed, onAnswer(landed.sync, tap, { kind: 'offline' }, now));
}
