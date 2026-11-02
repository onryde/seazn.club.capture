import { isLinkDead } from '@/domain/scoring/queue';
import { deadOf } from '@/domain/scoring/scoringMatchState';
import type { Ports } from '@/hooks/usePorts';
import type { ScoringRunner } from '@/hooks/scoringRunner';
import { forgetScoringLink } from '@/services/scoringLinkStore';

/**
 * A link that dies under the pad with nothing queued (plan S2-1 Task 10; design §4.3): the saved link is forgotten, and
 * the saved match with it when it is this one, so Home has no card for a match that can never be opened again, and
 * the match's empty queue, ledger and boot cache go too (review fix 5). The pad stays on its bad-link card, which it
 * holds in memory. A queue with taps in it keeps the link and the code: the taps are Home's leftover, and the link is
 * how a fresh scan finds them. Only a dead LINK counts: a match that is over or cancelled keeps its link, which a new
 * one would not change.
 * Watches one focused runner; the returned function stops it.
 */
export function watchDeadLink(ports: Ports, runner: ScoringRunner): () => void {
  let done = false;
  const check = (): void => {
    const snapshot = runner.snapshot();
    if (done || snapshot.kind !== 'ready') return;
    const { state } = snapshot;
    if (!isLinkDead(deadOf(state)) || state.sync.queue.pending.length > 0) return;
    done = true;
    forgetDeadMatch(ports, runner.fixtureId).catch(() => {
      ports.logger.warn('scoring.dead-link-forget-refused', {});
    });
  };
  const unsubscribe = runner.subscribe(check);
  check();
  return unsubscribe;
}

async function forgetDeadMatch(ports: Ports, fixtureId: string): Promise<void> {
  await forgetScoringLink(ports.kv, fixtureId);
  const snapshot = ports.modeStore.getSnapshot();
  const saved = snapshot.status === 'ready' ? (snapshot.saved.codes.scoring ?? null) : null;
  if (saved?.scoring?.fixtureId === fixtureId) await ports.modeStore.forget(saved);
  // Nothing opens this match again, so its empty queue, ledger and boot cache go too.
  await ports.tapQueue.remove(fixtureId);
}
