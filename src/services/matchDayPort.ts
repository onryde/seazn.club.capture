import type { ApprovalKind, MatchDay, MatchDayRefusal } from '@/domain/matchday/matchDay';
import type { OpenAnswer } from '@/domain/matchday/openWire';
import type { SavedDayCode } from '@/domain/mode/dayCode';

/**
 * What a Match Day call came to. `refusal` is one of the md_ routes' nine words, with MD_NOT_OPEN's opening instant
 * when the server gave one. `offline` is no answer the phone can act on: no network, a timeout, a portal's page, a
 * 5xx, a 429 (try again at the next poll), a 200 that does not parse, a link on a host that is not this build's.
 * `gone` is the v1 envelope's 404 NOT_FOUND: the match is no more, and the list is read again (S4 design §6).
 */
export type PortAnswer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: MatchDayRefusal; readonly opensAt?: Date }
  | { readonly ok: false; readonly offline: true }
  | { readonly ok: false; readonly gone: true };

/**
 * The web's Match Day code API (S4 design §9; MD-1), plain fetch (AGENTS §8). Every call carries the code's `md_`
 * token as a bearer to the build's own origin only, never in a URL, a log line or an error, and never rejects.
 * `review` and `approve` (§7) have no contract on the phone yet: they answer `offline` until the approval contract is
 * vendored, which gives `review` its value type.
 */
export interface MatchDayPort {
  /** `GET /api/v1/match-day-code`: the day the code lists. */
  day(code: SavedDayCode): Promise<PortAnswer<MatchDay>>;
  /** `POST /api/v1/match-day-code/fixtures/{id}/scoring-link`: the match's own scoring link, or why not. */
  open(code: SavedDayCode, fixtureId: string): Promise<PortAnswer<OpenAnswer>>;
  /** `GET /api/v1/match-day-code/approvals/{kind}/{stageId}`: the proposal, read-only. */
  review(code: SavedDayCode, kind: ApprovalKind, stageId: string): Promise<PortAnswer<never>>;
  /** `POST /api/v1/match-day-code/approvals/{kind}/{stageId}` with `{hash, round}`; `round` is required for Swiss. */
  approve(
    code: SavedDayCode,
    kind: ApprovalKind,
    stageId: string,
    hash: string,
    round: number | null,
  ): Promise<PortAnswer<{ readonly ok: true }>>;
}
