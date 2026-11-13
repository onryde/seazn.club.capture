import type { ApprovalReview, Approved } from '@/domain/matchday/approvalWire';
import type {
  Called,
  CallPreview,
  CallRefused,
  Candidates,
  Uncalled,
} from '@/domain/matchday/callWire';
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
 * What a call route (capture-matchday-call.v1) came to: the same four outcomes as {@link PortAnswer}, with the refusal
 * of its own, which names the six md_ words it shares and `MD_CALL_REFUSED` with the desk's reason (`callWire.ts`).
 * `gone` is the envelope's 404 NOT_FOUND: the court or the match is no more, and the list is read again.
 */
export type CallAnswer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refused: CallRefused }
  | { readonly ok: false; readonly offline: true }
  | { readonly ok: false; readonly gone: true };

/**
 * The web's Match Day code API (S4 design §9; MD-1), plain fetch (AGENTS §8). Every call carries the code's `md_`
 * token as a bearer to the build's own origin only, never in a URL, a log line or an error, and never rejects.
 * `review` and `approve` (§7) answer capture-matchday-approval.v1 (`approvalWire.ts`).
 */
export interface MatchDayPort {
  /** `GET /api/v1/match-day-code`: the day the code lists. */
  day(code: SavedDayCode): Promise<PortAnswer<MatchDay>>;
  /** `POST /api/v1/match-day-code/fixtures/{id}/scoring-link`: the match's own scoring link, or why not. */
  open(code: SavedDayCode, fixtureId: string): Promise<PortAnswer<OpenAnswer>>;
  /** `GET /api/v1/match-day-code/approvals/{kind}/{stageId}`: the proposal, read-only, with the hash to hand back. */
  review(
    code: SavedDayCode,
    kind: ApprovalKind,
    stageId: string,
  ): Promise<PortAnswer<ApprovalReview>>;
  /**
   * `POST /api/v1/match-day-code/approvals/{kind}/{stageId}` with `{hash, round}`, both the review's: `round` is
   * required for Swiss (without it the server answers 422, which is offline here) and null for a draw.
   */
  approve(
    code: SavedDayCode,
    kind: ApprovalKind,
    stageId: string,
    hash: string,
    round: number | null,
  ): Promise<PortAnswer<Approved>>;
  /**
   * `GET /api/v1/match-day-code/courts/{courtId}/candidates` (§7a): the matches that could start on the court now, as
   * the desk offers them, limited to the code's scope. Needs no power.
   */
  candidates(code: SavedDayCode, courtId: string): Promise<CallAnswer<Candidates>>;
  /** `POST .../fixtures/{id}/call` with `{court_id, preview: true}`: what the call would do, nothing written. */
  previewCall(
    code: SavedDayCode,
    fixtureId: string,
    courtId: string,
  ): Promise<CallAnswer<CallPreview>>;
  /** The same route with `preview: false`: the call. One request, never repeated by the port. */
  call(code: SavedDayCode, fixtureId: string, courtId: string): Promise<CallAnswer<Called>>;
  /** `DELETE .../fixtures/{id}/call`: takes the call back, with no body; refused once the match has started. */
  undoCall(code: SavedDayCode, fixtureId: string): Promise<CallAnswer<Uncalled>>;
}
