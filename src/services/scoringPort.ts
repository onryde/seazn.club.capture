import type {
  AppendAnswer,
  AppendBody,
  Bootstrap,
  Failure,
  LedgerEvent,
  RealtimeGrant,
  Rules,
} from '@/domain/scoring/wire';

export type { RealtimeGrant };

/**
 * Where a scoring link goes and what it carries (plan S2-1 Task 4). The origin is the build's Seazn origin, saved with
 * the link; the token is the link's `dl_` secret, which lives in the secure store and never in a queue file, a log
 * line or the record.
 */
export type ScoringLink = { readonly origin: string; readonly token: string };

/**
 * The scoring calls (design §6.1, §7): plain `fetch` behind a port, so the pad is built on a laptop with the fake. No
 * call rejects: every failure is a {@link Failure}, and `offline` is the one that keeps a tap queued.
 *
 * Not one of AGENTS §2's calls: scoring is JavaScript's and touches no capture session.
 */
export interface ScoringPort {
  /** What a link is: the match, its sides, its rules and which screen the scorer meets. */
  bootstrap(link: ScoringLink): Promise<{ kind: 'ok'; bootstrap: Bootstrap } | Failure>;
  /** The ledger after `sinceSeq`, in order; an empty list is a ledger with nothing new. */
  events(
    link: ScoringLink,
    fixtureId: string,
    sinceSeq: number,
  ): Promise<readonly LedgerEvent[] | Failure>;
  /** The rules the match plays by now (after a `rulesChanged`, or when an answer carries a newer version). */
  rules(link: ScoringLink, fixtureId: string): Promise<Rules | Failure>;
  /** One tap, with its idempotency key: sending it again is always safe (design §7.3). */
  append(link: ScoringLink, fixtureId: string, body: AppendBody): Promise<AppendAnswer>;
  /** A grant to hear other scorers by, or null: no grant (the server has none to give, or it failed) means poll. */
  realtimeToken(link: ScoringLink, fixtureId: string): Promise<RealtimeGrant | null>;
}
