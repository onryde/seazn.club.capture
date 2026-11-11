import {
  closedBy,
  onBootstrapStatus,
  onLedger,
  onReadFailed,
  onRules,
} from '@/domain/scoring/sync';
import type { Bootstrap, LedgerEvent, ReadFailure, Rules } from '@/domain/scoring/wire';
import type { SportTypes } from '@/domain/scoring/scoringSport';
import { withSync } from '@/domain/scoring/scoringMatchAnswers';
import { noteForeign } from '@/domain/scoring/scoringMatchAsk';
import {
  BOOTSTRAP_PACE_MS,
  CARD_SCREENS,
  LOAD_BOOTSTRAP,
  closedByStatus,
  deadOf,
  foldOfState,
  part,
  type MatchEffect,
  type MatchState,
  type Part,
} from '@/domain/scoring/scoringMatchState';

/**
 * What the phone reads (plan S2-1 Task 9): the ledger, the rules and the bootstrap, when each is asked for again, and
 * what a read that landed or failed does. The bootstrap is paced: 15 s between reads once it is held.
 */

/**
 * A ping, a poll, a return to the foreground: the ledger again. The bootstrap goes with it at once while the screen is
 * not the pad (a card, or none held yet), and, paced, when the match is decided: the ledger cannot say it was finalized.
 * A return to the foreground (`people`) asks it paced for a match in play too, so a lineup saved on the web meanwhile
 * reaches the people lists (S2-6 ruling 181); a ping never does, since Realtime nudges those and the sheets ask on open.
 */
export function wanting<S extends SportTypes>(
  state: MatchState<S>,
  now: number,
  people = false,
): Part<S> {
  if (state.sync.status === 'tooLarge' || deadOf(state) !== null) return part(state);
  const fetch: MatchEffect = { kind: 'fetch', since: state.sync.tip };
  if (state.judge !== 'fold') return part(state, [fetch]);
  if (showsNoPad(state)) return asking(state, now, [fetch]);
  if (!isDecided(state)) {
    return people && paced(state, now) ? asking(state, now, [fetch]) : part(state, [fetch]);
  }
  return paced(state, now)
    ? asking(state, now, [fetch])
    : part({ ...state, bootstrapOwed: true }, [fetch]);
}

/**
 * A sheet listing the match's people opened: the bootstrap again if the last read is 15 s back, nothing else. Only the
 * foreground folding runner reads it, and a dead or too large match has nothing it could change.
 */
export function askedForPeople<S extends SportTypes>(state: MatchState<S>, now: number): Part<S> {
  if (state.judge !== 'fold' || state.sync.status === 'tooLarge' || deadOf(state) !== null) {
    return part(state);
  }
  return paced(state, now) ? asking(state, now) : part(state);
}

/** No bootstrap is held, or the server's screen is a card in place of the pad. */
const showsNoPad = (state: MatchState): boolean =>
  state.bootstrap === null || CARD_SCREENS.has(state.bootstrap.screen);

/** The sport says the match is decided: the one rule, for the pad's bootstrap pacing and for Home's Finished card. */
export function isDecided<S extends SportTypes>(state: MatchState<S>): boolean {
  const fold = foldOfState(state);
  return fold !== null && fold.kind === 'folded' && state.sport.decided(fold.display);
}

/** Whether the last read of the bootstrap is far enough back for another. */
const paced = (state: MatchState, now: number): boolean =>
  state.bootstrapAskedAt === null || now - state.bootstrapAskedAt >= BOOTSTRAP_PACE_MS;

/** The bootstrap is asked for now: the time is kept, and what was owed is paid. */
export function asking<S extends SportTypes>(
  state: MatchState<S>,
  now: number,
  others: readonly MatchEffect[] = [],
): Part<S> {
  return part({ ...state, bootstrapAskedAt: now, bootstrapOwed: false }, [
    ...others,
    LOAD_BOOTSTRAP,
  ]);
}

/**
 * When the bootstrap is next to be read on its own: 15 s after it was last asked for, while a read is owed, a card
 * shows or none is held yet. Only the foreground folding runner reads it; the background sender judges nothing.
 */
export function bootstrapDueAt(state: MatchState): number | null {
  const asked = state.bootstrapAskedAt;
  if (asked === null || state.judge !== 'fold') return null;
  if (state.sync.status === 'tooLarge' || deadOf(state) !== null) return null;
  const wanted = state.bootstrapOwed || showsNoPad(state);
  return wanted ? asked + BOOTSTRAP_PACE_MS : null;
}

/** Events the ledger already holds are nothing new (a fetch that lost the race with another); the rest merge. */
export function onFetched<S extends SportTypes>(
  state: MatchState<S>,
  events: readonly LedgerEvent[],
  now: number,
): Part<S> {
  const fresh = events.filter((event) => event.seq > state.sync.tip);
  void now;
  const merged = withSync(state, onLedger(state.sync, fresh));
  // A batch sync refused (it left a hole) merged nothing: there is nothing yet to ask about.
  if (merged.state.sync.ledger === state.sync.ledger) return merged;
  return part(noteForeign(merged.state, fresh), merged.effects);
}

/** The rules a read brought: the phone folds under them only when they are the version it holds now. */
export function onRulesRead<S extends SportTypes>(state: MatchState<S>, rules: Rules): Part<S> {
  const sync = onRules(state.sync, rules);
  const { bootstrap } = state;
  const adopted =
    bootstrap !== null && rules.rulesVersion === sync.rulesVersion
      ? { ...bootstrap, cfg: rules.cfg, rulesVersion: rules.rulesVersion }
      : bootstrap;
  return part({ ...state, sync, bootstrap: adopted });
}

/**
 * A bootstrap read: its status goes through sync (a closed match, a tap held on ALREADY_DECIDED), its rules count only
 * if they are no older than those held, and it clears what an earlier failed read said of the link. One read before the
 * seq of the one held (`lastSeq`) is a late answer and changes nothing: a stale "in play" must not reopen a finalized match.
 */
export function onBootstrapRead<S extends SportTypes>(
  state: MatchState<S>,
  read: Bootstrap,
): Part<S> {
  const held = state.bootstrap;
  if (held !== null && read.lastSeq < held.lastSeq) return part(state);
  const status = onBootstrapStatus(state.sync, read.status);
  const newer = held === null || read.rulesVersion >= held.rulesVersion;
  const bootstrap: Bootstrap = newer
    ? read
    : { ...read, cfg: held.cfg, rulesVersion: held.rulesVersion };
  const sync =
    read.rulesVersion > status.state.rulesVersion
      ? onRules(status.state, { rulesVersion: read.rulesVersion })
      : status.state;
  const next: MatchState<S> = {
    ...state,
    bootstrap,
    closed: closedByStatus(read.status),
    bootOffline: false,
  };
  return withSync(next, { state: sync, effects: status.effects });
}

/** A read that did not come to its data: sync's word on it, and what it says of the link even with nothing queued. */
export function onFailed<S extends SportTypes>(
  state: MatchState<S>,
  kind: 'fetchFailed' | 'rulesFailed' | 'bootstrapFailed',
  failure: ReadFailure,
  now: number,
): Part<S> {
  const closed = closedBy(failure) ?? state.closed;
  const trouble =
    kind === 'bootstrapFailed' && state.bootstrap === null && closedBy(failure) === null;
  const next: MatchState<S> = { ...state, closed, bootOffline: trouble || state.bootOffline };
  return withSync(next, onReadFailed(state.sync, failure, now));
}
