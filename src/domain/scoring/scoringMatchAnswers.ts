import { refusalLine } from '@/domain/scoring/padLine';
import type { QueuedEvent } from '@/domain/scoring/queue';
import type { SportTypes } from '@/domain/scoring/scoringSport';
import { NO_LONGER_LEGAL, type SyncEffect, type SyncState, onAnswer } from '@/domain/scoring/sync';
import { CODE_WORD, type AppendAnswer } from '@/domain/scoring/wire';
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

/** The word the record gets for a refusal that is not the server's own upper-snake code: free text may hold a secret. */
const OTHER = 'OTHER';
const wordOf = (code: string): string => (CODE_WORD.test(code) ? code : OTHER);

/**
 * Maps sync's effects to the hook's. `persist` is the save the diff makes; `send` is the pump's alone (`NOT_YET`);
 * `retryIn` is read off the state (`wakeAt`), not carried out as an effect of its own. Each `refused` is a tap that left
 * the queue without counting: the pad says it once, whatever the number, so the number goes to the record as one
 * `dropped` per word.
 */
function effectsOf(effects: readonly SyncEffect[]): { effects: MatchEffect[]; refused: boolean } {
  const out: MatchEffect[] = [];
  const dropped = new Map<string, number>();
  for (const effect of effects) {
    if (effect.kind === 'fetchSince') out.push({ kind: 'fetch', since: effect.seq });
    else if (effect.kind === 'reloadRules') out.push({ kind: 'loadRules' });
    else if (effect.kind === 'reloadBootstrap') out.push(LOAD_BOOTSTRAP);
    else if (effect.kind === 'refused') {
      const code = wordOf(effect.code);
      dropped.set(code, (dropped.get(code) ?? 0) + 1);
    }
  }
  dropped.forEach((count, code) => out.push({ kind: 'dropped', code, count }));
  return { effects: out, refused: dropped.size > 0 };
}

/** The state after sync moved, and what it asked for; a tap that left the queue refused is said, once, on the line. */
export function withSync<S extends SportTypes>(
  state: MatchState<S>,
  step: { state: SyncState; effects: readonly SyncEffect[] },
): Part<S> {
  const mapped = effectsOf(step.effects);
  const line = mapped.refused ? refusalLine('scoring.refusal.notCounted') : state.line;
  return part({ ...state, sync: step.state, line }, mapped.effects);
}

export function onAnswered<S extends SportTypes>(
  state: MatchState<S>,
  sent: QueuedEvent,
  answer: AppendAnswer,
  now: number,
): Handled<S> {
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
 * queue. The fold judges it (another scorer may have voided the tap already). If the fold takes it, it is kept; if the
 * fold judges and does not, it is dropped and said (`droppedUndo`); if there is no fold to judge with, it waits for one
 * (`awaitingFold`). The background sender judges nothing and keeps it, and the server judges it.
 */
function resolveUndo<S extends SportTypes>(
  moved: Part<S>,
  tapKey: string,
  eventId: string,
): Part<S> {
  const { pending } = moved.state.sync.queue;
  const waiting = pending.find((tap) => tap.voidsKey === tapKey);
  if (waiting === undefined) return moved;
  const plain = resolved(waiting, eventId);
  const next = withPending(
    moved.state,
    pending.map((tap) => (tap === waiting ? plain : tap)),
  );
  if (next.judge === 'trust') return part(next, moved.effects);
  const fold = foldOfState(next);
  if (fold === null || fold.kind !== 'folded') return part(awaitingFold(next), moved.effects);
  return fold.legalQueued.includes(plain.key)
    ? part(next, moved.effects)
    : droppedUndo(moved, plain);
}

/**
 * The fold cannot judge now (no bootstrap held, or a match that cannot be folded): that is no refusal from the match, so
 * the Undo is not dropped. It stays in the queue and is judged with the rest of it, as `revalidating` judges a tap, on
 * the first step the fold can: nothing is sent until then (the hold), and a hold already standing is kept. Leaving the
 * match hands the queue to the background sender, which trusts and sends it.
 */
function awaitingFold<S extends SportTypes>(state: MatchState<S>): MatchState<S> {
  const { sync } = state;
  return { ...state, sync: { ...sync, hold: sync.hold ?? 'revalidate', revalidateOwed: true } };
}

/** The fold judged the Undo and the match does not take it: gone from the queue, and said as `revalidate` says a tap. */
function droppedUndo<S extends SportTypes>(moved: Part<S>, plain: QueuedEvent): Part<S> {
  const { pending } = moved.state.sync.queue;
  const kept = withPending(
    moved.state,
    pending.filter((tap) => tap.key !== plain.key),
  );
  const refused: SyncEffect = { kind: 'refused', key: plain.key, code: NO_LONGER_LEGAL };
  const said = withSync(kept, { state: kept.sync, effects: [refused] });
  return part(said.state, [...moved.effects, ...said.effects]);
}

/** A send that never went: its tap stays, its attempt counted, and the sender waits as it does for no network. */
export function abandon<S extends SportTypes>(
  state: MatchState<S>,
  key: string,
  now: number,
): Part<S> {
  const tap = state.sync.queue.pending.find((queued) => queued.key === key);
  const landed = state.sent?.key === key ? { ...state, sent: null } : state;
  if (tap === undefined) return part(landed);
  return withSync(landed, onAnswer(landed.sync, tap, { kind: 'offline' }, now));
}
