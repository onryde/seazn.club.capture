import type {
  Approval,
  ApprovalKind,
  Court,
  CourtState,
  MatchDay,
  Row,
  RowStatus,
  ScopeKind,
} from '@/domain/matchday/matchDay';
import {
  all,
  calendarDay,
  countingNumber,
  field,
  flag,
  instant,
  listOf,
  nullable,
  objectOf,
  oneOf,
  optional,
  successData,
  text,
  uuid,
  word,
  type Read,
  type Source,
} from '@/domain/matchday/wire';

/**
 * `GET /api/v1/match-day-code`, the day read (capture-matchday-day.v1; S4 Match Day design §5, §9.3), parsed once,
 * here: the body in the v1 envelope in, a {@link MatchDay} out, or the first field refused. The read carries no token
 * and no scoring link; a row that carried one would lose it here, since only the contract's fields are read.
 */

const ROW_STATUS: ReadonlyMap<string, RowStatus> = new Map([
  ['upcoming', 'upcoming'],
  ['in_play', 'inPlay'],
  ['finished', 'finished'],
]);

const COURT_STATE: ReadonlyMap<string, CourtState> = new Map([
  ['playing', 'playing'],
  ['called', 'called'],
  ['free', 'free'],
  ['in_use_elsewhere', 'inUseElsewhere'],
]);

const SCOPE_KIND: ReadonlyMap<string, ScopeKind> = new Map([
  ['competition', 'competition'],
  ['venue', 'venue'],
  ['courts', 'courts'],
]);

const APPROVAL_KIND: ReadonlyMap<string, ApprovalKind> = new Map([
  ['swiss', 'swiss'],
  ['draw', 'draw'],
]);

const WAITING: ReadonlyMap<string, 'stageComplete'> = new Map([
  ['stage_complete', 'stageComplete'],
]);

const row = objectOf<Row>((source, at) =>
  all({
    fixtureId: field(uuid)(source, 'fixture_id', at),
    sportKey: field(word)(source, 'sport_key', at),
    divisionName: field(text)(source, 'division_name', at),
    roundLabel: field(nullable(word))(source, 'round_label', at),
    roundTag: optional(word)(source, 'round_tag', at),
    home: field(nullable(text))(source, 'home', at),
    away: field(nullable(text))(source, 'away', at),
    homeSlot: optional(text)(source, 'home_slot', at),
    awaySlot: optional(text)(source, 'away_slot', at),
    status: field(oneOf(ROW_STATUS))(source, 'status', at),
    scheduledAt: field(nullable(instant))(source, 'scheduled_at', at),
    summary: field(nullable(text))(source, 'summary', at),
  }),
);

const rows = field(listOf(row));

const court = objectOf<Court>((source, at) =>
  all({
    courtId: field(uuid)(source, 'court_id', at),
    courtName: field(text)(source, 'court_name', at),
    venueName: field(text)(source, 'venue_name', at),
    state: field(oneOf(COURT_STATE))(source, 'state', at),
    now: field(nullable(row))(source, 'now', at),
    next: rows(source, 'next', at),
    finished: rows(source, 'finished', at),
  }),
);

const approval = objectOf<Approval>((source, at) =>
  all({
    kind: field(oneOf(APPROVAL_KIND))(source, 'kind', at),
    stageId: field(uuid)(source, 'stage_id', at),
    divisionName: field(text)(source, 'division_name', at),
    label: field(text)(source, 'label', at),
    round: field(nullable(countingNumber))(source, 'round', at),
    waiting: optional(oneOf(WAITING))(source, 'waiting', at),
  }),
);

const competition = objectOf<MatchDay['competition']>((source, at) =>
  all({ id: field(uuid)(source, 'id', at), name: field(text)(source, 'name', at) }),
);

const scope = objectOf<MatchDay['scope']>((source, at) =>
  all({
    kind: field(oneOf(SCOPE_KIND))(source, 'kind', at),
    label: field(text)(source, 'label', at),
  }),
);

function readDay(source: Source): Read<MatchDay> {
  return all({
    competition: field(competition)(source, 'competition', ''),
    scope: field(scope)(source, 'scope', ''),
    day: field(calendarDay)(source, 'day', ''),
    tz: field(word)(source, 'tz', ''),
    opensAt: field(instant)(source, 'opens_at', ''),
    expiresAt: field(instant)(source, 'expires_at', ''),
    canApprove: field(flag)(source, 'can_approve', ''),
    courts: field(listOf(court))(source, 'courts', ''),
    noCourt: rows(source, 'no_court', ''),
    online: rows(source, 'online', ''),
    approvals: field(listOf(approval))(source, 'approvals', ''),
  });
}

/** The day a Match Day code lists, or why its answer was refused. */
export function parseDay(body: unknown): Read<MatchDay> {
  const data = successData(body);
  return data.ok ? readDay(data.value) : data;
}

/**
 * The day's copy as the phone stored it (`parseDay`'s camelCase output as JSON, its Dates as Dates or ISO text), read
 * back through the same full check (final review M3): every row, court and approval, so a copy that parses but is wrong
 * inside its lists is no day. The copy is turned back into the wire's spelling field by field, by name: a field the
 * phone never writes is dropped (so read as missing), and a status or state that is not one of the phone's words is no
 * word. Null for anything that does not read.
 */
export function readStoredDay(stored: unknown): MatchDay | null {
  const wire = wireOf(stored, '');
  const read = isSource(wire) ? readDay(wire) : null;
  return read !== null && read.ok ? read.value : null;
}

/** The wire's name of every field `MatchDay` holds, at any depth. */
const WIRE_NAME: ReadonlyMap<string, string> = new Map([
  ...['competition', 'scope', 'day', 'tz', 'courts', 'online', 'approvals'].map(same),
  ['opensAt', 'opens_at'],
  ['expiresAt', 'expires_at'],
  ['canApprove', 'can_approve'],
  ['noCourt', 'no_court'],
  ['courtId', 'court_id'],
  ['courtName', 'court_name'],
  ['venueName', 'venue_name'],
  ...['state', 'now', 'next', 'finished', 'home', 'away', 'status', 'summary'].map(same),
  ['fixtureId', 'fixture_id'],
  ['sportKey', 'sport_key'],
  ['divisionName', 'division_name'],
  ['roundLabel', 'round_label'],
  ['roundTag', 'round_tag'],
  ['homeSlot', 'home_slot'],
  ['awaySlot', 'away_slot'],
  ['scheduledAt', 'scheduled_at'],
  ...['kind', 'label', 'round', 'waiting', 'id', 'name'].map(same),
  ['stageId', 'stage_id'],
]);

function same(name: string): readonly [string, string] {
  return [name, name];
}

/**
 * The phone's word for a status, a state or a waiting, back in the wire's spelling. A word that is not the phone's
 * becomes the empty text, which no list of words holds, so even an optional field refuses it (never reads as absent).
 */
const WIRE_WORD: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map([
  ['status', backwards(ROW_STATUS)],
  ['state', backwards(COURT_STATE)],
  ['waiting', backwards(WAITING)],
]);

function backwards(words: ReadonlyMap<string, string>): ReadonlyMap<string, string> {
  return new Map([...words].map(([wire, phone]) => [phone, wire]));
}

function isSource(value: unknown): value is Source {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function wireOf(value: unknown, key: string): unknown {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (Array.isArray(value)) return value.map((item) => wireOf(item, ''));
  const words = WIRE_WORD.get(key);
  if (words !== undefined && typeof value === 'string') return words.get(value) ?? '';
  if (!isSource(value)) return value;
  const out: Source = {};
  for (const [name, item] of Object.entries(value)) {
    const wireName = WIRE_NAME.get(name);
    if (wireName !== undefined) out[wireName] = wireOf(item, name);
  }
  return out;
}
