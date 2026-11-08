import type { BootCache } from '@/domain/scoring/queue';
import type { SaveEffect } from '@/domain/scoring/scoringMatchState';
import type { RunnerPorts } from '@/hooks/scoringRunner';
import { queueSaveProblemOf } from '@/services/tapQueueStore';

/**
 * The saves of one runner (plan S2-1 Task 9 review, item 13): one after the other, in the order the reducer asked for
 * them, so a send that waits for the saves before it (`pending`) waits for all of them. A save of the queue is told to
 * the reducer once it has landed or failed (`landed`); the two caches never fail a tap. A queue save that fails says
 * why in the record, one word (`problem`: secret, readback, name or file), never the error's message. Whether the boot
 * cache was written is told too (`bootOk`): it holds the scorer's pick and pending picks (S2-4 Batch 2 fix round 1).
 */
export type Saver = {
  /** Queues one save behind the last. */
  readonly save: (effect: SaveEffect) => void;
  /** Resolves, with whether the last save landed, once every save made so far is done. */
  readonly pending: () => Promise<boolean>;
  /** Taps whose queue save has not landed or failed yet: while any is out, the screen shows nothing new. */
  readonly unsettled: () => number;
};

type Deps = {
  readonly ports: Pick<RunnerPorts, 'tapQueue' | 'logger'>;
  readonly fixtureId: string;
  /**
   * A save is done: `ok` says whether the queue (if it was in the save) was written, `bootOk` whether the boot cache (if
   * it was in the save) was.
   */
  readonly landed: (effect: SaveEffect, ok: boolean, bootOk: boolean) => void;
};

export function createSaver(deps: Deps): Saver {
  let last: Promise<boolean> = Promise.resolve(true);
  let unsettled = 0;

  const save = (effect: SaveEffect): void => {
    const owesTap = effect.tap !== null && effect.queue !== null;
    if (owesTap) unsettled += 1;
    last = last.then(() => persist(deps, effect)).then((written) => done(effect, written, owesTap));
  };

  const done = (effect: SaveEffect, written: Written, owesTap: boolean): boolean => {
    if (owesTap) unsettled -= 1;
    deps.landed(effect, written.queue, written.boot);
    return written.queue;
  };

  return { save, pending: () => last, unsettled: () => unsettled };
}

/** Whether the queue and the boot cache were written: each true when it was not in the save. */
type Written = { readonly queue: boolean; readonly boot: boolean };

/** The boot cache, the ledger cache, then the queue. */
async function persist(deps: Deps, effect: SaveEffect): Promise<Written> {
  const { tapQueue, logger } = deps.ports;
  const boot = effect.boot;
  const bootOk =
    boot === null || (await cached(deps, () => tapQueue.saveBoot(deps.fixtureId, boot)));
  if (effect.ledger !== null) {
    const ledger = effect.ledger;
    await cached(deps, () => tapQueue.saveLedger(deps.fixtureId, ledger));
  }
  if (effect.queue === null) return { queue: true, boot: bootOk };
  try {
    await tapQueue.save(effect.queue);
    return { queue: true, boot: bootOk };
  } catch (error) {
    logger.warn('scoring.queue.saveFailed', { problem: queueSaveProblemOf(error) });
    return { queue: false, boot: bootOk };
  }
}

/** A cache that cannot be written never fails a tap: said in the record, not thrown. Whether it was written. */
async function cached(deps: Deps, write: () => Promise<void>): Promise<boolean> {
  try {
    await write();
    return true;
  } catch {
    deps.ports.logger.warn('scoring.cache.saveFailed', {});
    return false;
  }
}
