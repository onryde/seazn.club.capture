import type { MatchEvent } from '@/domain/scoring/scoringMatchState';
import type { ReadFailure } from '@/domain/scoring/wire';
import type { RunnerPorts } from '@/hooks/scoringRunner';
import type { ScoringLink } from '@/services/scoringPort';

/**
 * The reads of one runner (plan S2-1 Task 9 review, items 8 and 13): the ledger, the rules and the bootstrap, each one in
 * flight at a time with one more after it when it was asked for again meanwhile, and each answer (or failure, or a
 * port call that threw) handed to the reducer as an event.
 */
export type Reads = {
  readonly fetchLedger: () => void;
  readonly loadRules: () => void;
  readonly loadBootstrap: () => void;
  /** A port call, its answer or null if it threw: the contract is that none rejects, and one that does is a failed call. */
  readonly answered: <T>(call: () => Promise<T>) => Promise<T | null>;
};

type Deps = {
  readonly ports: Pick<RunnerPorts, 'scoring' | 'logger'>;
  readonly fixtureId: string;
  readonly link: () => ScoringLink | null;
  /** The ledger's tip, from which the next read goes. */
  readonly tip: () => number;
  readonly stopped: () => boolean;
  readonly dispatch: (event: MatchEvent) => unknown;
};

const OFFLINE: ReadFailure = { kind: 'offline' };

export function createReads(deps: Deps): Reads {
  const answered = async <T>(call: () => Promise<T>): Promise<T | null> => {
    try {
      return await call();
    } catch {
      deps.ports.logger.warn('scoring.call.threw', {});
      return null;
    }
  };
  const { scoring } = deps.ports;
  const once =
    <T>(call: (link: ScoringLink) => Promise<T>, then: (read: T | null) => void) =>
    async (): Promise<void> => {
      const held = deps.link();
      if (held !== null) then(await answered(() => call(held)));
    };

  const readLedger = once(
    (link) => scoring.events(link, deps.fixtureId, deps.tip()),
    (read) => {
      if (read === null) deps.dispatch({ kind: 'fetchFailed', failure: OFFLINE });
      else if ('kind' in read) deps.dispatch({ kind: 'fetchFailed', failure: read });
      else deps.dispatch({ kind: 'fetched', events: read });
    },
  );
  const readRules = once(
    (link) => scoring.rules(link, deps.fixtureId),
    (read) => {
      if (read === null) deps.dispatch({ kind: 'rulesFailed', failure: OFFLINE });
      else if ('cfg' in read) deps.dispatch({ kind: 'rulesRead', rules: read });
      else deps.dispatch({ kind: 'rulesFailed', failure: read });
    },
  );
  const readBootstrap = once(
    (link) => scoring.bootstrap(link),
    (read) => {
      if (read === null) deps.dispatch({ kind: 'bootstrapFailed', failure: OFFLINE });
      else if (read.kind === 'ok')
        deps.dispatch({ kind: 'bootstrapRead', bootstrap: read.bootstrap });
      else deps.dispatch({ kind: 'bootstrapFailed', failure: read });
    },
  );

  return {
    fetchLedger: coalesced(readLedger, deps.stopped),
    loadRules: coalesced(readRules, deps.stopped),
    loadBootstrap: coalesced(readBootstrap, deps.stopped),
    answered,
  };
}

/**
 * A read that is asked for again while it is out is one more read after it, not one each. `read` does one read and
 * hands the answer to the reducer; it comes back before the next starts. A stopped runner starts no more.
 */
function coalesced(read: () => Promise<void>, stopped: () => boolean): () => void {
  let out = false;
  let again = false;
  return () => {
    if (out) {
      again = true;
      return;
    }
    out = true;
    void (async () => {
      try {
        do {
          again = false;
          await read();
        } while (again && !stopped());
      } finally {
        out = false;
      }
    })();
  };
}
