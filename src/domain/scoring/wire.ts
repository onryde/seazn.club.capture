import { isRecord } from '@/domain/credentials/wire';
import type { MatchContext } from '@/domain/scoring/matchContext';

/**
 * The scoring wire, parsed once, here (AGENTS §4; plan S2-1 Task 3): the web's v1 envelope as the bootstrap endpoint
 * (onryde/seazn.club#1102) and the scouted event routes answer it, `{ok:true, data, requestId}` or
 * `{ok:false, error:{code, message, ...extras}, requestId}`. A wire shape stops in this file: the rest of the app sees
 * the camelCase types below. Each parser answers `null` for a body that is not its shape, never a half-read one: a
 * ledger with a hole or a match with a made-up side is worse than none.
 */

export type BootstrapScreen = 'viewOnly' | 'divisionNotStarted' | 'waiting' | 'confirm' | 'pad';

export type BootstrapMember = { readonly personId: string; readonly fullName: string };
export type BootstrapSlot = { readonly personId: string; readonly pairOrder: number | null };

export type BootstrapSide = {
  readonly entrantId: string;
  readonly name: string;
  readonly kind: string;
  readonly members: readonly BootstrapMember[];
  readonly lineup: readonly BootstrapSlot[];
};

/** Where a match sits, as the organiser typed it: `MatchContext` before its sides, which a seat may not have yet. */
export type BootstrapContext = Omit<MatchContext, 'sides'>;

export type Bootstrap = {
  readonly fixtureId: string;
  readonly linkId: string;
  readonly sportKey: string;
  readonly moduleVersion: string;
  readonly cfg: unknown;
  readonly rulesVersion: number;
  /** The server's effective floor for this sport's fold epoch: a phone below it is Update needed. */
  readonly epochRequired: number;
  readonly screen: BootstrapScreen;
  readonly viewOnlyReason: string | null;
  readonly context: BootstrapContext;
  /** A seat with no entrant (a bye, a match waiting on a result) is null, never a made-up side. */
  readonly sides: { readonly home: BootstrapSide | null; readonly away: BootstrapSide | null };
  readonly lastSeq: number;
  readonly status: string;
};

export type LedgerEvent = {
  readonly id: string;
  readonly seq: number;
  readonly type: string;
  readonly payload: unknown;
  readonly recordedAt: string;
  /** The event this one voids (the wire's `voids_event_id`), or null. */
  readonly voids: string | null;
  readonly deviceLinkId: string | null;
};

export type Rules = {
  readonly cfg: unknown;
  readonly rulesVersion: number;
  /** The rules line the public pages print, or null when there is none to say. */
  readonly formatLine: string | null;
};

/** What the server hands a scorer to hear other scorers by: both url and apikey, or no grant at all (poll). */
export type RealtimeGrant = {
  readonly token: string;
  readonly channel: string;
  readonly url: string;
  readonly apikey: string;
};

/** The body of `POST /api/v1/fixtures/{id}/events`, as the server reads it. */
export type AppendBody = {
  readonly expected_seq: number;
  readonly type: string;
  readonly payload: unknown;
  readonly idempotency_key: string;
  readonly engine_epoch: number;
  readonly rules_version: number;
};

export type LinkDeadCode = 'LINK_INVALID' | 'LINK_REVOKED' | 'LINK_EXPIRED';

export type AppendAnswer =
  | {
      readonly kind: 'accepted';
      readonly seq: number;
      readonly eventId: string;
      readonly rulesVersion: number;
    }
  | { readonly kind: 'seqConflict'; readonly currentSeq: number | null }
  | { readonly kind: 'rulesChanged'; readonly rulesVersion: number }
  | { readonly kind: 'outdated'; readonly required: number }
  | { readonly kind: 'linkDead'; readonly code: LinkDeadCode }
  | { readonly kind: 'rateLimited'; readonly retryAfterMs: number }
  | { readonly kind: 'refused'; readonly status: number; readonly code: string }
  | { readonly kind: 'offline' };

/** Every answer but a success: what a read (bootstrap, events, rules) can come to besides its data. */
export type Failure = Exclude<AppendAnswer, { kind: 'accepted' }>;

/** The contract's default wait (`parseRetryAfter`, D5) when a 429 names none. */
export const DEFAULT_RETRY_AFTER_MS = 5000;

const OFFLINE: Failure = { kind: 'offline' };

const SCREENS: ReadonlyMap<string, BootstrapScreen> = new Map([
  ['view_only', 'viewOnly'],
  ['division_not_started', 'divisionNotStarted'],
  ['waiting', 'waiting'],
  ['confirm', 'confirm'],
  ['pad', 'pad'],
]);

const LINK_DEAD_CODES: readonly LinkDeadCode[] = ['LINK_INVALID', 'LINK_REVOKED', 'LINK_EXPIRED'];

// ---------------------------------------------------------------------------------------------------------------
// Readers: each answers the value or `undefined`, so a parser says "garbled" with one comparison.
// ---------------------------------------------------------------------------------------------------------------

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const whole = (value: unknown, min: number): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= min ? value : undefined;

/** A text the server may leave out: a string, or null or absent as null. Anything else is garbled (`undefined`). */
const textOrNull = (value: unknown): string | null | undefined => {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : undefined;
};

/** Every item read, or `undefined` when the value is no list or one item is garbled. */
function listOf<T>(value: unknown, read: (item: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map(read);
  return items.some((item) => item === undefined) ? undefined : (items as T[]);
}

/** The `data` object of a success envelope. */
function dataOf(body: unknown): Record<string, unknown> | null {
  const data = successData(body);
  return isRecord(data) ? data : null;
}

function successData(body: unknown): unknown {
  return isRecord(body) && body.ok === true ? body.data : undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------------------------------------------

function readMember(raw: unknown): BootstrapMember | undefined {
  if (!isRecord(raw)) return undefined;
  const personId = text(raw.person_id);
  const fullName = typeof raw.full_name === 'string' ? raw.full_name : undefined;
  return personId === undefined || fullName === undefined ? undefined : { personId, fullName };
}

function readSlot(raw: unknown): BootstrapSlot | undefined {
  if (!isRecord(raw)) return undefined;
  const personId = text(raw.person_id);
  const order = raw.pair_order === null ? null : whole(raw.pair_order, 0);
  return personId === undefined || order === undefined ? undefined : { personId, pairOrder: order };
}

function readSide(raw: unknown): BootstrapSide | undefined {
  if (!isRecord(raw)) return undefined;
  const entrantId = text(raw.entrant_id);
  const name = typeof raw.name === 'string' ? raw.name : undefined;
  const kind = typeof raw.kind === 'string' ? raw.kind : undefined;
  const members = listOf(raw.members, readMember);
  const lineup = listOf(raw.lineup, readSlot);
  if (entrantId === undefined || name === undefined || kind === undefined) return undefined;
  return members === undefined || lineup === undefined
    ? undefined
    : { entrantId, name, kind, members, lineup };
}

/** A seat with no entrant is null on the wire and stays null; a seat that is anything else unreadable is garbled. */
function readSeat(raw: unknown): BootstrapSide | null | undefined {
  return raw === null ? null : readSide(raw);
}

function readSides(raw: unknown): Bootstrap['sides'] | undefined {
  if (!isRecord(raw)) return undefined;
  const home = readSeat(raw.home);
  const away = readSeat(raw.away);
  return home === undefined || away === undefined ? undefined : { home, away };
}

function readNames(raw: unknown): BootstrapContext | undefined {
  if (!isRecord(raw)) return undefined;
  const competition = typeof raw.competition === 'string' ? raw.competition : undefined;
  const division = textOrNull(raw.division);
  const round = textOrNull(raw.round_label);
  const match = textOrNull(raw.ref);
  if (competition === undefined || division === undefined) return undefined;
  return round === undefined || match === undefined
    ? undefined
    : { competition, division, round, match };
}

function readState(raw: unknown): { lastSeq: number; status: string } | undefined {
  if (!isRecord(raw)) return undefined;
  const lastSeq = whole(raw.last_seq, 0);
  const status = text(raw.status);
  return lastSeq === undefined || status === undefined ? undefined : { lastSeq, status };
}

type Identity = Pick<
  Bootstrap,
  'fixtureId' | 'linkId' | 'sportKey' | 'moduleVersion' | 'rulesVersion' | 'epochRequired'
>;

function readIdentity(data: Record<string, unknown>): Identity | undefined {
  const fixtureId = text(data.fixture_id);
  const linkId = text(data.link_id);
  const sportKey = text(data.sport_key);
  const moduleVersion = typeof data.module_version === 'string' ? data.module_version : undefined;
  const rulesVersion = whole(data.rules_version, 0);
  const epochRequired = whole(data.engine_epoch_required, 0);
  if (fixtureId === undefined || linkId === undefined || sportKey === undefined) return undefined;
  if (moduleVersion === undefined || rulesVersion === undefined) return undefined;
  if (epochRequired === undefined) return undefined;
  return { fixtureId, linkId, sportKey, moduleVersion, rulesVersion, epochRequired };
}

type View = Pick<
  Bootstrap,
  'screen' | 'viewOnlyReason' | 'context' | 'sides' | 'lastSeq' | 'status'
>;

function readView(data: Record<string, unknown>): View | undefined {
  const screen = typeof data.screen === 'string' ? SCREENS.get(data.screen) : undefined;
  const viewOnlyReason = textOrNull(data.view_only_reason);
  const context = readNames(data.names);
  const sides = readSides(data.sides);
  const state = readState(data.state);
  if (screen === undefined || viewOnlyReason === undefined) return undefined;
  if (context === undefined || sides === undefined || state === undefined) return undefined;
  return { screen, viewOnlyReason, context, sides, ...state };
}

/** `GET /api/v1/device-link`: what a scoring link is. Null for anything that is not the endpoint's answer. */
export function parseBootstrap(body: unknown): Bootstrap | null {
  const data = dataOf(body);
  if (data === null || data.cfg === undefined) return null;
  const identity = readIdentity(data);
  const view = readView(data);
  return identity === undefined || view === undefined
    ? null
    : { ...identity, cfg: data.cfg, ...view };
}

/**
 * The pad's match context for a bootstrap: the names as typed and the sides' names, top first. Null while a seat has
 * no entrant, so a side is never made up for it.
 */
export function matchContextOf({ context, sides }: Bootstrap): MatchContext | null {
  if (sides.home === null || sides.away === null) return null;
  return { ...context, sides: [sides.home.name, sides.away.name] };
}

// ---------------------------------------------------------------------------------------------------------------
// The ledger, the rules, the realtime grant
// ---------------------------------------------------------------------------------------------------------------

function readEvent(raw: unknown): LedgerEvent | undefined {
  if (!isRecord(raw)) return undefined;
  const id = text(raw.id);
  const seq = whole(raw.seq, 1);
  const type = text(raw.type);
  const recordedAt = text(raw.recorded_at);
  const voids = textOrNull(raw.voids_event_id);
  const deviceLinkId = textOrNull(raw.device_link_id);
  if (id === undefined || seq === undefined || type === undefined || recordedAt === undefined)
    return undefined;
  if (voids === undefined || deviceLinkId === undefined) return undefined;
  return { id, seq, type, payload: raw.payload, recordedAt, voids, deviceLinkId };
}

/**
 * `GET …/events?since_seq=`: the ledger from the seq asked, in order. An empty list is a ledger with nothing new, not
 * a failure. A list that is not strictly ascending in seq is garbled: it would fold into something that never was.
 */
export function parseEvents(body: unknown): readonly LedgerEvent[] | null {
  const events = listOf(successData(body), readEvent);
  if (events === undefined) return null;
  return events.every((event, i) => i === 0 || event.seq > events[i - 1].seq) ? events : null;
}

/** `GET /api/v1/fixtures/{id}/rules`: the rules a match plays by now. */
export function parseRules(body: unknown): Rules | null {
  const data = dataOf(body);
  if (data === null || data.cfg === undefined) return null;
  const rulesVersion = whole(data.rules_version, 0);
  const formatLine = textOrNull(data.format_line);
  if (rulesVersion === undefined || formatLine === undefined) return null;
  return { cfg: data.cfg, rulesVersion, formatLine };
}

/** `GET /api/v1/public/fixtures/{id}/realtime-token`: a grant needs all four; the route answers null for url/apikey when unset. */
export function parseRealtimeGrant(body: unknown): RealtimeGrant | null {
  const data = dataOf(body);
  if (data === null) return null;
  const token = text(data.token);
  const channel = text(data.channel);
  const url = text(data.url);
  const apikey = text(data.apikey);
  if (token === undefined || channel === undefined) return null;
  return url === undefined || apikey === undefined ? null : { token, channel, url, apikey };
}

// ---------------------------------------------------------------------------------------------------------------
// The append answer
// ---------------------------------------------------------------------------------------------------------------

/** The v1 error envelope, `{ok:false, error:{code, ...extras}}`; anything else is not the server's word. */
function errorOf(body: unknown): { code: string; extras: Record<string, unknown> } | null {
  if (!isRecord(body) || body.ok !== false || !isRecord(body.error)) return null;
  const code = text(body.error.code);
  return code === undefined ? null : { code, extras: body.error };
}

function readAccepted(body: unknown): AppendAnswer | null {
  const data = dataOf(body);
  if (data === null) return null;
  const seq = whole(data.seq, 1);
  const eventId = text(data.event_id);
  const rulesVersion = whole(data.rules_version, 0);
  if (seq === undefined || eventId === undefined || rulesVersion === undefined) return null;
  return { kind: 'accepted', seq, eventId, rulesVersion };
}

/**
 * What a non-success status says. Only a body in the v1 envelope is the server's word: a portal's page, a proxy's 403
 * or a bare JSON is `offline`, so the tap stays queued and goes again with the same key rather than being dropped on a
 * stranger's say-so. A known word whose figure cannot be read is `offline` for the same reason.
 *
 * `retryAfterMs` is the `Retry-After` header, read by the port (`parseRetryAfter`), which owns the headers.
 */
export function parseFailure(
  status: number,
  body: unknown,
  retryAfterMs: number = DEFAULT_RETRY_AFTER_MS,
): Failure {
  const error = errorOf(body);
  if (error === null || status < 400 || status >= 500) return OFFLINE;
  return answerFor(status, error, retryAfterMs);
}

function answerFor(
  status: number,
  { code, extras }: { code: string; extras: Record<string, unknown> },
  retryAfterMs: number,
): Failure {
  if (status === 429) return { kind: 'rateLimited', retryAfterMs };
  if (status === 401 && LINK_DEAD_CODES.some((word) => word === code)) {
    return { kind: 'linkDead', code: code as LinkDeadCode };
  }
  if (status === 409 && code === 'SEQ_CONFLICT') {
    return { kind: 'seqConflict', currentSeq: whole(extras.current_seq, 0) ?? null };
  }
  if (status === 409 && code === 'FIXTURE_RULES_CHANGED') {
    const rulesVersion = whole(extras.rules_version, 0);
    return rulesVersion === undefined ? OFFLINE : { kind: 'rulesChanged', rulesVersion };
  }
  if (status === 426 && code === 'ENGINE_OUTDATED') {
    const required = whole(extras.required, 1);
    return required === undefined ? OFFLINE : { kind: 'outdated', required };
  }
  return { kind: 'refused', status, code };
}

/** What the server said to an appended tap: 201 is accepted (a replay of a key too, the same event id), else {@link parseFailure}. */
export function parseAppendAnswer(
  status: number,
  body: unknown,
  retryAfterMs: number = DEFAULT_RETRY_AFTER_MS,
): AppendAnswer {
  if (status !== 201) return parseFailure(status, body, retryAfterMs);
  return readAccepted(body) ?? OFFLINE;
}
