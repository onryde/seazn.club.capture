import { watchDeadLink } from '@/hooks/scoringDeadLink';
import { startLive } from '@/hooks/scoringLive';
import { createScoringRunner, type ScoringRunner } from '@/hooks/scoringRunner';
import type { Ports } from '@/hooks/usePorts';
import { forgetScoringLink } from '@/services/scoringLinkStore';

/**
 * Who runs which match (plan S2-1 Task 9), one hub per `Ports` (one per launch, one per test). A match has at most ONE
 * runner at a time, so one sender and one fold:
 * - `focus`: the pad is on screen. A focused runner folds and judges the match, and has the live owner (`startLive`),
 *   the match's only Realtime subscription, and a watch on its link (`watchDeadLink`: a link that dies with nothing
 *   queued is forgotten, design §4.3). Several screens may focus one match; the last to release stops it.
 * - headless: the background sender for a match nobody is looking at (ruling 29). It sends the queue's taps in order
 *   and lets the server judge each; it never folds, never reads the bootstrap, never subscribes to Realtime (a second
 *   subscription would close the first). It lets itself go once its queue is empty or dead, or has no link.
 * Going to a match stops its headless sender first; leaving one with taps still queued starts a sender again. A runner
 * is stopped only once its saves and the call it has out have come back, so two runners never send one match at once.
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
  /** Dismiss: stops this match's runner, forgets its link, then deletes its queue, ledger and boot cache. */
  dismiss(fixtureId: string): Promise<void>;
};

type Focused = {
  readonly runner: ScoringRunner;
  refs: number;
  stopLive: () => void;
  stopWatch: () => void;
};

const hubs = new WeakMap<Ports, ScoringHub>();

export function scoringHubOf(ports: Ports): ScoringHub {
  const found = hubs.get(ports);
  if (found !== undefined) return found;
  const made = createScoringHub(ports);
  hubs.set(ports, made);
  return made;
}

/** The fixture id of the saved scoring match ('' for none); undefined while the store has not loaded. */
function savedMatchOf(ports: Ports): string | undefined {
  const snapshot = ports.modeStore.getSnapshot();
  if (snapshot.status !== 'ready') return undefined;
  return snapshot.saved.codes.scoring?.scoring?.fixtureId ?? '';
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
  /** Matches being dismissed: no sender is started for one, whoever lists its queue meanwhile. */
  const dismissing = new Set<string>();

  const stopRunner = (id: string, runner: ScoringRunner): Promise<void> => {
    const done = runner.stop();
    stopping.set(id, done);
    return done;
  };

  /**
   * A sender that has sent everything leaves nothing of its match behind but the saved match's: its link, queue, ledger
   * and boot cache go (the hub's Dismiss, without the runner), since a match nobody can open any more would otherwise
   * keep its token for good. The saved match keeps them, for Continue. Taps still queued (a queue that went dead while
   * sending) are Home's leftover and stay, with the link. A match a screen took up meanwhile is that screen's. A store
   * that has not loaded cannot say what is saved, so nothing is cleaned. A refusal is recorded, never raised.
   * Sender and tidy follow each other through `stopping`, so no other sender can be running for the match here.
   */
  const tidy = async (id: string, runner: ScoringRunner): Promise<void> => {
    const snapshot = runner.snapshot();
    if (snapshot.kind !== 'ready' || snapshot.state.sync.queue.pending.length > 0) return;
    if (focused.has(id)) return;
    try {
      const saved = savedMatchOf(ports);
      if (saved === undefined || saved === id) return;
      await forgetScoringLink(ports.kv, id);
      await ports.tapQueue.remove(id);
    } catch {
      ports.logger.warn('scoring.tidy-refused', {});
    }
  };

  const startHeadless = async (id: string): Promise<void> => {
    await stopping.get(id);
    if (dismissing.has(id) || focused.has(id) || headless.has(id)) return;
    const runner: ScoringRunner = createScoringRunner(ports, {
      fixtureId: id,
      mode: 'headless',
      onIdle: () => {
        if (headless.get(id) === runner) headless.delete(id);
        void stopRunner(id, runner).then(() => tidy(id, runner));
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
      entry.stopWatch();
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
    const entry: Focused = {
      runner,
      refs: 1,
      stopLive: () => undefined,
      stopWatch: watchDeadLink(ports, runner),
    };
    focused.set(id, entry);
    void begin(id, entry);
    return handleOf(id, entry);
  };

  const dismiss = async (id: string): Promise<void> => {
    dismissing.add(id);
    try {
      await dismissed(id);
    } finally {
      dismissing.delete(id);
    }
  };

  /** Stops the runner, then forgets the link BEFORE the files go: a stop half way never leaves a queue a link could send. */
  const dismissed = async (id: string): Promise<void> => {
    const held = focused.get(id);
    if (held !== undefined) {
      focused.delete(id);
      held.stopLive();
      held.stopWatch();
      await stopRunner(id, held.runner);
    }
    const sender = headless.get(id);
    if (sender !== undefined) {
      headless.delete(id);
      await stopRunner(id, sender);
    }
    await stopping.get(id);
    await forgetScoringLink(ports.kv, id);
    await ports.tapQueue.remove(id);
  };

  return { focus, resume, dismiss };
}
