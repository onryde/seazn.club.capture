import type { ApprovalKind } from '@/domain/matchday/matchDay';
import {
  all,
  countingNumber,
  field,
  flag,
  listOf,
  nullable,
  objectOf,
  oneOf,
  scalar,
  successData,
  text,
  uuid,
  word,
  type Read,
  type Source,
} from '@/domain/matchday/wire';

/**
 * `GET|POST /api/v1/match-day-code/approvals/{kind}/{stageId}` (capture-matchday-approval.v1; S4 Match Day design §7,
 * §9.5), one file for the one shape: the review a code with "can approve draws" reads, the approve's body, and the
 * approve's 200. The phone works nothing out: the rows are the server's, in its order, and the hash goes back to it
 * unchanged. Its refusals are every md_ route's (`refusalWire.ts`). Nothing here is a credential.
 */

/** One pairing (Swiss) or one knockout slot (a draw), as the server computed it. */
export type ApprovalRow = {
  /** The row's place as the web's board codes it: "R4 1", "QF 2", "F". */
  readonly label: string;
  readonly home: string;
  /** A bye, or a knockout seat fed from elsewhere: null, never a made-up name. */
  readonly away: string | null;
};

/** The proposal, read-only: "To change a slot, use the web desk". */
export type ApprovalReview = {
  readonly kind: ApprovalKind;
  readonly stageId: string;
  readonly divisionName: string;
  /** Swiss: the round awaiting pairing, which the approve hands back; a draw: null. */
  readonly round: number | null;
  readonly rows: readonly ApprovalRow[];
  /** What the approve hands back, unchanged; a hash that is no longer the server's is refused MD_STALE. */
  readonly hash: string;
  /** A draw with a tie only the web desk can resolve: shown, never approved (an approve is refused MD_TIES). */
  readonly ties: boolean;
};

/** The approve's body (`$defs.request`): the review's hash, and its round, null for a draw. */
export type ApproveRequest = { readonly hash: string; readonly round: number | null };

/** The approve's 200 (`$defs.ok`): this request approved it. */
export type Approved = { readonly ok: true };

/** This contract's own list of kinds, read by its own parser. */
const KIND: ReadonlyMap<string, ApprovalKind> = new Map([
  ['swiss', 'swiss'],
  ['draw', 'draw'],
]);

/**
 * The contract's `minLength: 1, maxLength: 128`, counted in UTF-16 units as the server's own check of the approve's
 * body counts them (zod's `max`), so a hash read here is one the approve can hand back.
 */
const HASH_MAX = 128;
const hash = scalar(
  (raw) => (typeof raw === 'string' && raw !== '' && raw.length <= HASH_MAX ? raw : undefined),
  `expected a string of 1 to ${HASH_MAX} characters`,
);

const approved = scalar((raw) => (raw === true ? true : undefined), 'expected true');

const row = objectOf<ApprovalRow>((source, at) =>
  all({
    label: field(word)(source, 'label', at),
    home: field(text)(source, 'home', at),
    away: field(nullable(text))(source, 'away', at),
  }),
);

function readReview(source: Source): Read<ApprovalReview> {
  return all({
    kind: field(oneOf(KIND))(source, 'kind', ''),
    stageId: field(uuid)(source, 'stage_id', ''),
    divisionName: field(text)(source, 'division_name', ''),
    round: field(nullable(countingNumber))(source, 'round', ''),
    rows: field(listOf(row))(source, 'rows', ''),
    hash: field(hash)(source, 'hash', ''),
    ties: field(flag)(source, 'ties', ''),
  });
}

/** The review a GET answers, or the first field refused. */
export function parseApproval(body: unknown): Read<ApprovalReview> {
  const data = successData(body);
  return data.ok ? readReview(data.value) : data;
}

/** The approve's 200, or why it is not one. */
export function parseApproved(body: unknown): Read<Approved> {
  const data = successData(body);
  return data.ok ? all<Approved>({ ok: field(approved)(data.value, 'ok', '') }) : data;
}

/** The approve's body: `round` is always written, the review's round for a Swiss and null for a draw. */
export function approveRequest(hashOf: string, roundOf: number | null): ApproveRequest {
  return { hash: hashOf, round: roundOf };
}
