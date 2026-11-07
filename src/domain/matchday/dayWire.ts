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

const row = objectOf<Row>((source, at) =>
  all({
    fixtureId: field(uuid)(source, 'fixture_id', at),
    sportKey: field(word)(source, 'sport_key', at),
    divisionName: field(text)(source, 'division_name', at),
    roundLabel: field(nullable(word))(source, 'round_label', at),
    home: field(nullable(text))(source, 'home', at),
    away: field(nullable(text))(source, 'away', at),
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
