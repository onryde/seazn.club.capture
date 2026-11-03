import { watchDeadLink } from '@/hooks/scoringDeadLink';
import { startLive } from '@/hooks/scoringLive';
import { createScoringRunner, type ScoringRunner, type UndoStart } from '@/hooks/scoringRunner';
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
  /**
   * A Dismiss for a match the scorer has simply gone from (scanning another match; owner ruling 46, 2026-11-03): the same,
   * except that the ids of this phone's own taps are kept for a day, so a rescan of the match finds History and Undo as
   * they were. Dismiss is the operator saying the match is done, and keeps nothing.
   */
  leave(fixtureId: string): Promise<void>;
  /**
   * The stop of this match's runner that has not finished saving, or null when none is out: the pad has left and its last
   * ledger and boot-cache writes may not have landed, so what a reader of the match's files saw may be one step behind
   * (Home's Finished card reads again once this settles). Never rejects.
   */
  settled(fixtureId: string): Promise<void> | null;
  /**
   * A scan is writing this match's link and code: no clean-up forgets the match until the returned release is called,
   * however many scans hold it. A second call of one release does nothing.
   */
  claim(fixtureId: string): () => void;
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

  /** The stops that have finished: `settled` answers null for the latest stop of a match once it is in here. */
  const stopsDone = new WeakSet<Promise<void>>();

  /**
   * Where each match's Undo window started: the phone's clock when its own tap decided it (owner, 2026-11-03). In memory
   * only, per launch, so a restart finds none; kept here and not by a runner or a screen because the focused runner is
   * stopped when the pad goes and a new one built on its return, and Home and back within the 30 s keeps the window.
   * It goes with the match: a leave (scanning another) or a Dismiss (which Close and Forget are) takes it, so a rescan
   * never dates a decision from the ledger it reads again.
   */
  const undoStarts = new Map<string, number>();
  const undoStartOf = (id: string): UndoStart => ({
    read: () => undoStarts.get(id) ?? null,
    write: (at) => {
      if (at === null) undoStarts.delete(id);
      else undoStarts.set(id, at);
    },
  });

  const stopRunner = (id: string, runner: ScoringRunner): Promise<void> => {
    const done = runner.stop();
    stopping.set(id, done);
    const mark = (): void => {
      stopsDone.add(done);
    };
    done.then(mark, mark);
    return done;
  };

  const settled = (id: string): Promise<void> | null => {
    const latest = stopping.get(id);
    return latest === undefined || stopsDone.has(latest) ? null : latest;
  };

  /** Matches a scan is writing: its link lands before the code that names it, and no clean-up may take it in between. */
  const claims = new Map<string, number>();

  const claim = (id: string): (() => void) => {
    claims.set(id, (claims.get(id) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (claims.get(id) ?? 1) - 1;
      if (left > 0) claims.set(id, left);
      else claims.delete(id);
    };
  };

  /**
   * Nothing wants this match: no screen holds it, no scan is writing it and it is not the saved one. A store that has
   * not loaded cannot say what is saved, so it is never unwanted; a later sweep decides.
   */
  const unwanted = (id: string): boolean => {
    const saved = savedMatchOf(ports);
    return saved !== undefined && saved !== id && !focused.has(id) && !claims.has(id);
  };

  /**
   * An unwanted match goes with its link, queue, ledger and boot cache (Dismiss without the runner), keeping the ids of
   * this phone's own taps for a day (`leave`, owner ruling 46): the scorer has gone from it, not finished with it. A
   * refusal is recorded.
   */
  const sweep = async (id: string): Promise<void> => {
    try {
      if (!unwanted(id)) return;
      undoStarts.delete(id);
      await forgetScoringLink(ports.kv, id);
      await ports.tapQueue.leave(id, ports.clock().getTime());
    } catch {
      ports.logger.warn('scoring.tidy-refused', {});
    }
  };

  /**
   * A sender that has sent everything leaves nothing of its match behind but the saved match's, since a match nobody
   * can open any more would otherwise keep its token for good. Taps still queued (a queue that went dead while sending)
   * are Home's leftover and stay, with the link. Sender and tidy follow each other through `stopping`, so no other
   * sender can be running for the match here. `resume` sweeps what this missed (a store that had not loaded).
   */
  const tidy = async (id: string, runner: ScoringRunner): Promise<void> => {
    const snapshot = runner.snapshot();
    if (snapshot.kind !== 'ready' || snapshot.state.sync.queue.pending.length > 0) return;
    await sweep(id);
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

  /** The ids kept for a left match are for a day: what is older goes, at a launch and on every return. A refusal is recorded. */
  const expireKept = async (): Promise<void> => {
    try {
      await ports.tapQueue.expireKept(ports.clock().getTime());
    } catch {
      ports.logger.warn('scoring.tidy-refused', {});
    }
  };

  const resume = async (): Promise<void> => {
    await expireKept();
    for (const entry of await ports.tapQueue.list()) {
      if (entry.kind !== 'queue') continue;
      const { fixtureId, pending, dead } = entry.queue;
      // Nothing queued: the match is a leftover of an older sender or an earlier launch, and is swept if unwanted.
      if (pending.length === 0) await sweep(fixtureId);
      // Held for the reconnect question (owner ruling 43): nothing for a sender to do, the next screen asks.
      else if (dead === null && entry.queue.askedAbout === undefined)
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
    const runner = createScoringRunner(ports, {
      fixtureId: id,
      mode: 'focused',
      undoStart: undoStartOf(id),
    });
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

  const dismiss = (id: string): Promise<void> => ending(id, false);

  const leave = (id: string): Promise<void> => ending(id, true);

  const ending = async (id: string, keepOwn: boolean): Promise<void> => {
    dismissing.add(id);
    try {
      await dismissed(id, keepOwn);
    } finally {
      dismissing.delete(id);
    }
  };

  /**
   * Stops the runner, then forgets the link BEFORE the files go: a stop half way never leaves a queue a link could send.
   * `keepOwn`: the files go but for the ids of this phone's own taps (`leave`).
   */
  const dismissed = async (id: string, keepOwn: boolean): Promise<void> => {
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
    undoStarts.delete(id);
    await forgetScoringLink(ports.kv, id);
    if (keepOwn) await ports.tapQueue.leave(id, ports.clock().getTime());
    else await ports.tapQueue.remove(id);
  };

  return { focus, resume, dismiss, leave, claim, settled };
}
