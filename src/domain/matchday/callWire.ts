import { isRecord } from '@/domain/credentials/wire';
import { ok } from '@/domain/Result';
import { matchRow } from '@/domain/matchday/dayWire';
import type { Row } from '@/domain/matchday/matchDay';
import {
  all,
  countingNumber,
  field,
  instant,
  invalid,
  listOf,
  nullable,
  objectOf,
  oneOf,
  scalar,
  successData,
  text,
  toInstant,
  uuid,
  word,
  type Item,
  type Read,
  type Source,
} from '@/domain/matchday/wire';

/**
 * Calling a match to a court with a Match Day code (capture-matchday-call.v1; S4 Match Day design §7a, owner 2026-11-13),
 * one file for the one contract: a free court's candidates (the root), the call's preview, the call and its Undo, the
 * request's body and the refusals only these routes answer. The phone works nothing out: the order, the blocks and the
 * warnings are the server's. Nothing here is a credential, and a row that carried a scoring link would lose it here.
 */

/** Where a candidate is now: this court's own next match, another court's (or called onto one), or on no court. */
export type CandidateSource = 'thisCourt' | 'otherCourt' | 'noCourt';

/** A hard stop: a player of the match is in a match playing, or called, elsewhere. */
export type Blocked = { readonly personName: string; readonly courtName: string | null };

export type Candidate = {
  /** The match as the day lists it: the round chip, the names and the slots read as the list's rows. */
  readonly match: Row;
  readonly source: CandidateSource;
  /** `otherCourt`: the court it waits on, or is called onto. */
  readonly fromCourtName: string | null;
  readonly plannedAt: Date | null;
  readonly waitingMinutes: number;
  readonly behindMinutes: number;
  /** Dimmed and no control: picking it would be refused `player_busy`. */
  readonly blocked: Blocked | null;
};

export type Candidates = {
  readonly courtId: string;
  readonly courtName: string;
  /** Best first, as the web desk ranks them; empty when nothing can start here. */
  readonly candidates: readonly Candidate[];
};

/** One line of the preview: what the call would do to the day. */
export type Warning =
  | { readonly kind: 'pushesLater'; readonly count: number }
  | {
      readonly kind: 'restGap';
      readonly personName: string;
      readonly minutes: number;
      readonly minRest: number;
    }
  | { readonly kind: 'pastDayEnd'; readonly courtName: string; readonly until: Date }
  | {
      readonly kind: 'crossesClosure';
      readonly courtName: string;
      readonly from: Date;
      readonly until: Date;
    }
  | {
      readonly kind: 'courtClosed';
      readonly courtName: string;
      readonly until: Date | null;
      readonly since: Date | null;
    };

export type Shift = {
  readonly fixtureId: string;
  readonly label: string;
  readonly roundLabel: string;
  readonly plannedAt: Date;
  readonly estimatedAt: Date;
};

/** The preview (`$defs.preview`): nothing was written. No warning is a quiet call. */
export type CallPreview = {
  readonly shifts: readonly Shift[];
  readonly warnings: readonly Warning[];
};

/** The call's 200 (`$defs.call`). */
export type Called = {
  readonly fixtureId: string;
  readonly courtId: string;
  readonly calledAt: Date;
};

/** The Undo's 200 (`$defs.undo`): where the match went back to, if anywhere. */
export type Uncalled = {
  readonly fixtureId: string;
  readonly courtId: string | null;
  readonly scheduledAt: Date | null;
};

/** The request's body (`$defs.request`): `preview` is always written. */
export type CallRequest = { readonly court_id: string; readonly preview: boolean };

const SOURCE: ReadonlyMap<string, CandidateSource> = new Map([
  ['this_court', 'thisCourt'],
  ['other_court', 'otherCourt'],
  ['no_court', 'noCourt'],
]);

/** The contract's `integer`, `minimum: 0`. */
const wholeNumber: Item<number> = scalar(
  (raw) => (Number.isSafeInteger(raw) && (raw as number) >= 0 ? (raw as number) : undefined),
  'expected a whole number',
);

const PLAYER_BUSY = 'player_busy';

const blocked = objectOf<Blocked>((source, at) => {
  const kind = field(
    scalar((raw) => (raw === PLAYER_BUSY ? raw : undefined), `expected ${PLAYER_BUSY}`),
  );
  const read = all({
    kind: kind(source, 'kind', at),
    personName: field(text)(source, 'person_name', at),
    courtName: field(nullable(text))(source, 'court_name', at),
  });
  return read.ok
    ? ok({ personName: read.value.personName, courtName: read.value.courtName })
    : read;
});

const candidate = objectOf<Candidate>((source, at) =>
  all({
    match: field(matchRow)(source, 'match', at),
    source: field(oneOf(SOURCE))(source, 'source', at),
    fromCourtName: field(nullable(text))(source, 'from_court_name', at),
    plannedAt: field(nullable(instant))(source, 'planned_at', at),
    waitingMinutes: field(wholeNumber)(source, 'waiting_minutes', at),
    behindMinutes: field(wholeNumber)(source, 'behind_minutes', at),
    blocked: field(nullable(blocked))(source, 'blocked', at),
  }),
);

/** The candidates a GET answers, or the first field refused. */
export function parseCandidates(body: unknown): Read<Candidates> {
  const data = successData(body);
  if (!data.ok) return data;
  return all({
    courtId: field(uuid)(data.value, 'court_id', ''),
    courtName: field(text)(data.value, 'court_name', ''),
    candidates: field(listOf(candidate))(data.value, 'candidates', ''),
  });
}

const warning: Item<Warning> = (raw, at) => {
  if (!isRecord(raw)) return invalid(at, 'expected an object');
  switch (raw.kind) {
    case 'pushes_later':
      return mapped(all({ count: field(countingNumber)(raw, 'count', at) }), ({ count }) => ({
        kind: 'pushesLater',
        count,
      }));
    case 'rest_gap':
      return mapped(
        all({
          personName: field(text)(raw, 'person_name', at),
          minutes: field(wholeNumber)(raw, 'minutes', at),
          minRest: field(countingNumber)(raw, 'min_rest', at),
        }),
        (one) => ({ kind: 'restGap', ...one }),
      );
    case 'past_day_end':
      return mapped(
        all({
          courtName: field(text)(raw, 'court_name', at),
          until: field(instant)(raw, 'until', at),
        }),
        (one) => ({ kind: 'pastDayEnd', ...one }),
      );
    case 'crosses_closure':
      return mapped(
        all({
          courtName: field(text)(raw, 'court_name', at),
          from: field(instant)(raw, 'from', at),
          until: field(instant)(raw, 'until', at),
        }),
        (one) => ({ kind: 'crossesClosure', ...one }),
      );
    case 'court_closed':
      return mapped(
        all({
          courtName: field(text)(raw, 'court_name', at),
          until: field(nullable(instant))(raw, 'until', at),
          since: field(nullable(instant))(raw, 'since', at),
        }),
        (one) => ({ kind: 'courtClosed', ...one }),
      );
    default:
      return invalid(`${at}.kind`, 'expected a known warning');
  }
};

function mapped<A, B>(read: Read<A>, change: (value: A) => B): Read<B> {
  return read.ok ? ok(change(read.value)) : read;
}

const shift = objectOf<Shift>((source, at) =>
  all({
    fixtureId: field(uuid)(source, 'fixture_id', at),
    label: field(text)(source, 'label', at),
    roundLabel: field(word)(source, 'round_label', at),
    plannedAt: field(instant)(source, 'planned_at', at),
    estimatedAt: field(instant)(source, 'estimated_at', at),
  }),
);

/** The preview a POST with `preview: true` answers. */
export function parseCallPreview(body: unknown): Read<CallPreview> {
  const data = successData(body);
  if (!data.ok) return data;
  return all({
    shifts: field(listOf(shift))(data.value, 'shifts', ''),
    warnings: field(listOf(warning))(data.value, 'warnings', ''),
  });
}

/** The call's 200. */
export function parseCalled(body: unknown): Read<Called> {
  const data = successData(body);
  if (!data.ok) return data;
  return all({
    fixtureId: field(uuid)(data.value, 'fixture_id', ''),
    courtId: field(uuid)(data.value, 'court_id', ''),
    calledAt: field(instant)(data.value, 'called_at', ''),
  });
}

/** The Undo's 200. */
export function parseUncalled(body: unknown): Read<Uncalled> {
  const data = successData(body);
  if (!data.ok) return data;
  return all({
    fixtureId: field(uuid)(data.value, 'fixture_id', ''),
    courtId: field(nullable(uuid))(data.value, 'court_id', ''),
    scheduledAt: field(nullable(instant))(data.value, 'scheduled_at', ''),
  });
}

/** The call's body: the preview and the call are one route, told apart by `preview`, always written. */
export function callRequest(courtId: string, preview: boolean): CallRequest {
  return { court_id: courtId, preview };
}

/** The words that end a code or keep it from these routes, as every md_ route answers them (`$defs.refusal`). */
export const CALL_WORDS = [
  'MD_UNKNOWN',
  'MD_WITHDRAWN',
  'MD_ENDED',
  'MD_NOT_OPEN',
  'MD_OUT_OF_SCOPE',
  'MD_NO_CALL',
] as const;
export type CallWord = (typeof CALL_WORDS)[number];

/** Why the desk's own call refused (`MD_CALL_REFUSED`'s `reason`). */
export type CallReason =
  | 'notCandidateCourt'
  | 'playerBusy'
  | 'courtBusy'
  | 'started'
  | 'notReady'
  | 'notCalled'
  | 'frozen'
  /** Undo only: the call was made on the web desk, and a code may undo only a call a code made. */
  | 'notCodeCall'
  /** A reason a later web sends that this phone has no word for: still the desk's refusal, said in the general words. */
  | 'unknown';

const REASON: ReadonlyMap<string, CallReason> = new Map([
  ['not_candidate_court', 'notCandidateCourt'],
  ['player_busy', 'playerBusy'],
  ['court_busy', 'courtBusy'],
  ['started', 'started'],
  ['not_ready', 'notReady'],
  ['not_called', 'notCalled'],
  ['frozen', 'frozen'],
  ['not_code_call', 'notCodeCall'],
]);

/**
 * A call route's refusal as the phone reads it: a word with MD_NOT_OPEN's opening instant, or the desk's refusal with
 * its reason and the names it gave (a player, a court), each null when it named none.
 */
export type CallRefused =
  | { readonly code: CallWord; readonly opensAt?: Date }
  | {
      readonly code: 'MD_CALL_REFUSED';
      readonly reason: CallReason;
      readonly personName: string | null;
      readonly courtName: string | null;
    };

/**
 * The refusal of the three call routes, the v1 envelope's `error` on a 4xx: one of the six md_ words or `MD_CALL_REFUSED`
 * with its `reason` (one this phone has no word for reads as `unknown`, a refusal and not offline). Anything else is
 * null: another route's word (MD_STALE), a reason that is no string, the envelope's own
 * answers (404, 429, 422), a portal's page. The port reads those by status.
 */
export function parseCallRefusal(status: number, body: unknown): CallRefused | null {
  if (status < 400 || status > 499) return null;
  if (!isRecord(body) || body.ok !== false || !isRecord(body.error)) return null;
  const error = body.error;
  if (error.code === 'MD_CALL_REFUSED') return refusedByDesk(error);
  const word = CALL_WORDS.find((known) => known === error.code);
  if (word === undefined) return null;
  if (error.opens_at === undefined) return { code: word };
  const at = toInstant(error.opens_at);
  if (at === undefined) return null;
  return word === 'MD_NOT_OPEN' ? { code: word, opensAt: at } : { code: word };
}

function refusedByDesk(error: Source): CallRefused | null {
  if (typeof error.reason !== 'string') return null;
  const reason = REASON.get(error.reason) ?? 'unknown';
  const person = nameOf(error.person_name, false);
  const court = nameOf(error.court_name, true);
  if (person === undefined || court === undefined) return null;
  return { code: 'MD_CALL_REFUSED', reason, personName: person, courtName: court };
}

/** A name the refusal may carry: absent is null, a string is itself, null is null where the contract allows it. */
function nameOf(raw: unknown, mayBeNull: boolean): string | null | undefined {
  if (raw === undefined) return null;
  if (raw === null) return mayBeNull ? null : undefined;
  return typeof raw === 'string' ? raw : undefined;
}
