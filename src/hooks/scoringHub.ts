import { startLive } from '@/hooks/scoringLive';
import { createScoringRunner, type ScoringRunner } from '@/hooks/scoringRunner';
import type { Ports } from '@/hooks/usePorts';
import { forgetScoringLink } from '@/services/scoringLinkStore';

/**
 * Who runs which match (plan S2-1 Task 9), one hub per `Ports` (one per launch, one per test). A match has at most ONE
 * runner at a time, so one sender and one fold:
 * - `focus`: the pad is on screen. A focused runner folds and judges the match, and has the live owner (`startLive`),
 *   the match's only Realtime subscription. Several screens may focus one match; the last to release stops it.
 * - headless: the background sender for a match nobody is looking at (ruling 29). It sends the queue's taps in order
 *   and lets the server judge each; it never folds, never reads the bootstrap, never subscribes to Realtime (a second
 *   subscription would close the first). It lets itself go once its queue is empty or dead, or has no link.
 * Going to a match stops its headless sender first; leaving one with taps still queued starts a sender again.
 */
export type FocusHandle = {
  readonly runner: ScoringRunner;
  /** The pad has left. The match goes headless if taps are still queued. A second call does nothing. */
  readonly release: () => void;
};

export type ScoringHub = {
  focus(fixtureId: string): FocusHandle;
  /** Starts a headless sender for every match with live taps queued that has no runner yet. Safe to call again. */
  resume(): Promise<void>;
  /** Dismiss: stops this match's sender, then deletes its queue, ledger and boot cache and forgets its link. */
  dismiss(fixtureId: string): Promise<void>;
};

type Focused = { readonly runner: ScoringRunner; refs: number; stopLive: () => void };

const hubs = new WeakMap<Ports, ScoringHub>();

export function scoringHubOf(ports: Ports): ScoringHub {
  const found = hubs.get(ports);
  if (found !== undefined) return found;
  const made = createScoringHub(ports);
  hubs.set(ports, made);
  return made;
}

/** A match worth a sender: it opened, and taps are queued on a link that still takes them. */
function hasWork(runner: ScoringRunner): boolean {
  const snapshot = runner.snapshot();
  if (snapshot.kind !== 'ready') return false;
  const { queue } = snapshot.state.sync;
  return queue.pending.length > 0 && queue.dead === null;
}

function createScoringHub(ports: Ports): ScoringHub {
  const focused = new Map<string, Focused>();
  const headless = new Map<string, ScoringRunner>();
  /** The latest stop of a match's runner (done or not): whoever starts another for the match waits for its saves first. */
  const stopping = new Map<string, Promise<void>>();

  const stopRunner = (id: string, runner: ScoringRunner): Promise<void> => {
    const done = runner.stop();
    stopping.set(id, done);
    return done;
  };

  const startHeadless = async (id: string): Promise<void> => {
    await stopping.get(id);
    if (focused.has(id) || headless.has(id)) return;
    const runner: ScoringRunner = createScoringRunner(ports, {
      fixtureId: id,
      mode: 'headless',
      onIdle: () => {
        if (headless.get(id) === runner) headless.delete(id);
        void stopRunner(id, runner);
      },
    });
    headless.set(id, runner);
    await runner.start();
    if (hasWork(runner) || headless.get(id) !== runner) return;
    headless.delete(id);
    await stopRunner(id, runner);
  };

  const resume = async (): Promise<void> => {
    for (const entry of await ports.tapQueue.list()) {
      if (entry.kind !== 'queue') continue;
      const { fixtureId, pending, dead } = entry.queue;
      if (pending.length === 0 || dead !== null) continue;
      await startHeadless(fixtureId);
    }
  };

  /** The match goes from a headless sender (if it had one) to a focused runner with its live owner. */
  const begin = async (id: string, entry: Focused): Promise<void> => {
    const sender = headless.get(id);
    if (sender !== undefined) {
      headless.delete(id);
      await stopRunner(id, sender);
    }
    await stopping.get(id);
    await entry.runner.start();
    if (focused.get(id) === entry) entry.stopLive = startLive(ports, entry.runner);
  };

  const handleOf = (id: string, entry: Focused): FocusHandle => {
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      entry.refs -= 1;
      if (entry.refs > 0) return;
      if (focused.get(id) === entry) focused.delete(id);
      entry.stopLive();
      void stopRunner(id, entry.runner).then(resume);
    };
    return { runner: entry.runner, release };
  };

  const focus = (id: string): FocusHandle => {
    const held = focused.get(id);
    if (held !== undefined) {
      held.refs += 1;
      return handleOf(id, held);
    }
    const runner = createScoringRunner(ports, { fixtureId: id, mode: 'focused' });
    const entry: Focused = { runner, refs: 1, stopLive: () => undefined };
    focused.set(id, entry);
    void begin(id, entry);
    return handleOf(id, entry);
  };

  const dismiss = async (id: string): Promise<void> => {
    const held = focused.get(id);
    if (held !== undefined) {
      focused.delete(id);
      held.stopLive();
      await stopRunner(id, held.runner);
    }
    const sender = headless.get(id);
    if (sender !== undefined) {
      headless.delete(id);
      await stopRunner(id, sender);
    }
    await stopping.get(id);
    await ports.tapQueue.remove(id);
    await forgetScoringLink(ports.kv, id);
  };

  return { focus, resume, dismiss };
}
