import type { BootCache } from '@/domain/scoring/queue';
import type { SaveEffect } from '@/domain/scoring/scoringMatchState';
import type { RunnerPorts } from '@/hooks/scoringRunner';

/**
 * The saves of one runner (plan S2-1 Task 9 review, item 13): one after the other, in the order the reducer asked for
 * them, so a send that waits for the saves before it (`pending`) waits for all of them. A save of the queue is told to
 * the reducer once it has landed or failed (`landed`); the two caches never fail a tap.
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
  /** A save is done: `ok` says whether the queue (if it was in the save) was written. */
  readonly landed: (effect: SaveEffect, ok: boolean) => void;
};

export function createSaver(deps: Deps): Saver {
  let last: Promise<boolean> = Promise.resolve(true);
  let unsettled = 0;

  const save = (effect: SaveEffect): void => {
    const owesTap = effect.tap !== null && effect.queue !== null;
    if (owesTap) unsettled += 1;
    last = last.then(() => persist(deps, effect)).then((ok) => done(effect, ok, owesTap));
  };

  const done = (effect: SaveEffect, ok: boolean, owesTap: boolean): boolean => {
    if (owesTap) unsettled -= 1;
    deps.landed(effect, ok);
    return ok;
  };

  return { save, pending: () => last, unsettled: () => unsettled };
}

/** The boot cache, the ledger cache, then the queue: whether the queue was written (true when it was not in the save). */
async function persist(deps: Deps, effect: SaveEffect): Promise<boolean> {
  const { tapQueue, logger } = deps.ports;
  if (effect.boot !== null)
    await cached(deps, () => tapQueue.saveBoot(deps.fixtureId, effect.boot as BootCache));
  if (effect.ledger !== null) {
    const ledger = effect.ledger;
    await cached(deps, () => tapQueue.saveLedger(deps.fixtureId, ledger));
  }
  if (effect.queue === null) return true;
  try {
    await tapQueue.save(effect.queue);
    return true;
  } catch {
    logger.warn('scoring.queue.saveFailed', {});
    return false;
  }
}

/** A cache that cannot be written costs the next reopen a network read, never a tap: said, not thrown. */
async function cached(deps: Deps, write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch {
    deps.ports.logger.warn('scoring.cache.saveFailed', {});
  }
}
