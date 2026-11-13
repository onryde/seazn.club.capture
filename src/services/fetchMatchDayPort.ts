import { isRecord } from '@/domain/credentials/wire';
import { approveRequest, parseApproval, parseApproved } from '@/domain/matchday/approvalWire';
import type { ApprovalKind } from '@/domain/matchday/matchDay';
import {
  callRequest,
  parseCalled,
  parseCallPreview,
  parseCallRefusal,
  parseCandidates,
  parseUncalled,
} from '@/domain/matchday/callWire';
import { parseDay } from '@/domain/matchday/dayWire';
import { openRefused, parseOpen, type OpenAnswer } from '@/domain/matchday/openWire';
import { parseRefusal } from '@/domain/matchday/refusalWire';
import type { Read } from '@/domain/matchday/wire';
import type { SavedDayCode } from '@/domain/mode/dayCode';
import { recognise } from '@/domain/mode/recognise';
import type { ScoringFetch } from '@/services/fetchScoringPort';
import { MAX_BODY_BYTES, utf8Length, withDeadline, type FetchResponse } from '@/services/httpAsk';
import type { Logger } from '@/services/logger';
import type { CallAnswer, MatchDayPort, PortAnswer } from '@/services/matchDayPort';
import { isBuildOrigin } from '@/services/seaznHosts';
import type { LogFields } from '@/services/scrub';

/** Bounds a captive portal or a dead cell, as the scoring calls are: after this, offline. */
export const MATCHDAY_TIMEOUT_MS = 8000;
/** A whole competition's day is the one big answer (S4 design §5); an open's answer is a link, and keeps 64 KiB. */
export const MATCHDAY_DAY_MAX_BYTES = 1024 * 1024;

type Deps = {
  fetch: ScoringFetch;
  logger: Logger;
  /** The build's Seazn host (`seaznHosts(env)[0]`): the only one a code's token, or a link it opens, may name. */
  host: string;
  /** Shortens every call; it never lengthens one. */
  timeoutMs?: number;
  now?: () => number;
};

type Op = 'day' | 'open' | 'review' | 'approve' | 'candidates' | 'preview' | 'call' | 'undo';
type Reply = { readonly status: number; readonly body: unknown };
/** No answer at all, and why: a closed word, never an error's own text. */
type Lost = { readonly problem: string };

const OFFLINE = { ok: false, offline: true } as const;
const GONE = { ok: false, gone: true } as const;
const TOO_LARGE = Symbol('too-large');
const ROOT = '/api/v1/match-day-code';

/**
 * The Match Day code's calls (S4 design §9; MD-1), plain fetch (AGENTS §8). Each answer has one parser
 * (`src/domain/matchday/`); what the server sent is read there and never kept or logged here.
 */
export function createFetchMatchDayPort(deps: Deps): MatchDayPort {
  const say = reporter(deps.logger);
  return {
    day: async (code) => {
      const reply = await send(deps, code, 'GET', ROOT, MATCHDAY_DAY_MAX_BYTES);
      return answerOf(say, 'day', reply, parseDay, nineWords);
    },
    open: async (code, fixtureId) => {
      const path = () => `${ROOT}/fixtures/${encodeURIComponent(fixtureId)}/scoring-link`;
      const reply = await send(deps, code, 'POST', path, MAX_BODY_BYTES);
      if (!('problem' in reply)) {
        const refused = openRefused(reply.status, reply.body);
        if (refused !== null) return outOfScope(say, reply.status, refused);
      }
      const answer = answerOf(say, 'open', reply, parseOpen, nineWords);
      return answer.ok ? linkOnBuildHost(deps, say, answer.value) : answer;
    },
    review: async (code, kind, stageId) => {
      const reply = await send(deps, code, 'GET', approvalPath(kind, stageId), MAX_BODY_BYTES);
      return answerOf(say, 'review', reply, parseApproval, nineWords);
    },
    approve: async (code, kind, stageId, hash, round) => {
      const body = JSON.stringify(approveRequest(hash, round));
      const path = approvalPath(kind, stageId);
      const reply = await send(deps, code, 'POST', path, MAX_BODY_BYTES, body);
      return answerOf(say, 'approve', reply, parseApproved, nineWords);
    },
    ...callCalls(deps, say),
  };
}

type CallCalls = Pick<MatchDayPort, 'candidates' | 'previewCall' | 'call' | 'undoCall'>;

/**
 * The three call routes (capture-matchday-call.v1; S4 design §7a). The call is ONE request: nothing here retries it, so a
 * second hold is a second request only because the screen made one.
 */
function callCalls(deps: Deps, say: Reporter): CallCalls {
  const callPath = (fixtureId: string) => () =>
    `${ROOT}/fixtures/${encodeURIComponent(fixtureId)}/call`;
  const post = async (code: SavedDayCode, fixtureId: string, courtId: string, preview: boolean) =>
    send(
      deps,
      code,
      'POST',
      callPath(fixtureId),
      MAX_BODY_BYTES,
      JSON.stringify(callRequest(courtId, preview)),
    );
  return {
    candidates: async (code, courtId) => {
      const path = () => `${ROOT}/courts/${encodeURIComponent(courtId)}/candidates`;
      const reply = await send(deps, code, 'GET', path, MAX_BODY_BYTES);
      return answerOf(say, 'candidates', reply, parseCandidates, callWords);
    },
    previewCall: async (code, fixtureId, courtId) =>
      answerOf(
        say,
        'preview',
        await post(code, fixtureId, courtId, true),
        parseCallPreview,
        callWords,
      ),
    call: async (code, fixtureId, courtId) =>
      answerOf(say, 'call', await post(code, fixtureId, courtId, false), parseCalled, callWords),
    undoCall: async (code, fixtureId) => {
      const reply = await send(deps, code, 'DELETE', callPath(fixtureId), MAX_BODY_BYTES);
      return answerOf(say, 'undo', reply, parseUncalled, callWords);
    },
  };
}

/** `approvals/{kind}/{stageId}`: the kind is one of two words, and the stage id one path segment whatever it holds. */
const approvalPath = (kind: ApprovalKind, stageId: string) => () =>
  `${ROOT}/approvals/${kind}/${encodeURIComponent(stageId)}`;

/**
 * One request, bounded: its reply, or why there is none. Never rejects. The token is handed to the logger first,
 * before anything can fail, so no line this port or anything else writes can carry it (F15); then it goes to the
 * build's own origin, or nowhere.
 */
async function send(
  deps: Deps,
  code: SavedDayCode,
  method: 'GET' | 'POST' | 'DELETE',
  path: string | (() => string),
  cap: number,
  body?: string,
): Promise<Reply | Lost> {
  deps.logger.protectLink(code.token);
  if (!isBuildOrigin(code.origin, deps.host)) return { problem: 'foreign-host' };
  const deadline = Math.min(deps.timeoutMs ?? MATCHDAY_TIMEOUT_MS, MATCHDAY_TIMEOUT_MS);
  // The path is built inside the bounded work (async), so a thunk that throws (a lone surrogate in an id) is `unexpected`.
  return withDeadline<Reply | Lost>(
    async (signal) =>
      exchange(
        deps,
        code,
        { method, path: typeof path === 'string' ? path : path(), cap, body },
        signal,
      ),
    deadline,
    () => ({ problem: 'timeout' }),
    () => ({ problem: 'unexpected' }),
  );
}

type Request = {
  readonly method: 'GET' | 'POST' | 'DELETE';
  readonly path: string;
  readonly cap: number;
  /** JSON, sent as such; none for a GET and for the open ("with no body"). */
  readonly body: string | undefined;
};

async function exchange(
  deps: Deps,
  code: SavedDayCode,
  request: Request,
  signal?: AbortSignal,
): Promise<Reply | Lost> {
  const url = `${code.origin}${request.path}`;
  let response: FetchResponse;
  try {
    response = await deps.fetch(url, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${code.token}`,
        'Cache-Control': 'no-store',
        Accept: 'application/json',
        ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(request.body === undefined ? {} : { body: request.body }),
      redirect: 'error',
      signal,
    });
  } catch {
    return { problem: 'network' };
  }
  // React Native's fetch (whatwg-fetch 3.6.20) ignores `redirect` and follows one: an answer from anywhere but the
  // URL asked is a portal's or an edge's, so no answer.
  if (response.url !== undefined && response.url !== '' && response.url !== url) {
    return { problem: 'redirected' };
  }
  const body = await bodyOf(response, request.cap);
  return body === TOO_LARGE ? { problem: 'too-large' } : { status: response.status, body };
}

/** The body as JSON, null when it is none, or {@link TOO_LARGE} over the cap: never a body cut short. */
async function bodyOf(response: FetchResponse, cap: number): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return null;
  }
  if (utf8Length(text) > cap) return TOO_LARGE;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * A reply as the phone acts on it: the 200 parsed, a refusal in the route's own words (`refuse`), the envelope's own 404
 * NOT_FOUND gone, and everything else offline: a 429 is tried again at the next poll (MD-1's B2 ruling), and a 404 that
 * is not the envelope's is a portal's or an edge's page. Every failure is said in the record.
 */
function answerOf<T, F extends Failure>(
  say: Reporter,
  op: Op,
  reply: Reply | Lost,
  parse: (body: unknown) => Read<T>,
  refuse: (status: number, body: unknown) => F | null,
): { readonly ok: true; readonly value: T } | F | typeof OFFLINE | typeof GONE {
  if ('problem' in reply) return say.failed(op, OFFLINE, 0, reply.problem);
  if (reply.status === 200) {
    const parsed = parse(reply.body);
    if (!parsed.ok) return say.failed(op, OFFLINE, 200, 'unparseable');
    say.succeeded(op);
    return { ok: true, value: parsed.value };
  }
  const refused = refuse(reply.status, reply.body);
  if (refused !== null) return say.failed(op, refused, reply.status);
  if (reply.status === 404 && isNotFound(reply.body)) return say.failed(op, GONE, 404);
  return say.failed(op, OFFLINE, reply.status, reply.status === 429 ? 'rate-limited' : undefined);
}

type NineWords = Extract<PortAnswer<never>, { refusal: unknown }>;

/** The day, the open and the approvals' refusals: one of the nine words, with MD_NOT_OPEN's opening instant. */
function nineWords(status: number, body: unknown): NineWords | null {
  const refused = parseRefusal(status, body);
  if (refused === null) return null;
  const opens = refused.opensAt === undefined ? {} : { opensAt: refused.opensAt };
  return { ok: false, refusal: refused.code, ...opens };
}

type CallRefusal = Extract<CallAnswer<never>, { refused: unknown }>;

/** The call routes' refusals (`callWire.ts`): their six md_ words and the desk's own, with its reason. */
function callWords(status: number, body: unknown): CallRefusal | null {
  const refused = parseCallRefusal(status, body);
  return refused === null ? null : { ok: false, refused };
}

/** The v1 envelope's own 404: `{ok: false, error: {code: 'NOT_FOUND'}}`. */
const isNotFound = (body: unknown): boolean =>
  isRecord(body) && body.ok === false && isRecord(body.error) && body.error.code === 'NOT_FOUND';

/** The open's own refusal (MD_OUT_OF_SCOPE) is an answer, and still said, as the refusal it is. */
function outOfScope(say: Reporter, status: number, value: OpenAnswer): PortAnswer<OpenAnswer> {
  say.failed('open', { ok: false, refusal: 'MD_OUT_OF_SCOPE' }, status);
  return { ok: true, value };
}

/**
 * Ruling 3 of the MD-2 Task 3 dispatch: a link is handed on only if a scan of the same link would be, by the
 * recogniser's rule (`https://`, the build's own host, no userinfo, no port, `/score/…`); the contract's pattern alone
 * lets a userinfo or a port through. Its secret is protected first, whatever the host, and no line names the link.
 */
function linkOnBuildHost(deps: Deps, say: Reporter, answer: OpenAnswer): PortAnswer<OpenAnswer> {
  if (answer.kind !== 'link') return { ok: true, value: answer };
  deps.logger.protectLink(answer.url.slice(answer.url.lastIndexOf('/') + 1));
  const now = new Date(deps.now?.() ?? Date.now());
  const scanned = recognise(answer.url, now, [deps.host]);
  if (scanned.outcome !== 'code' || scanned.code.mode !== 'scoring') {
    return say.failed('open', OFFLINE, 200, 'foreign-link');
  }
  return { ok: true, value: answer };
}

type Failure = Exclude<PortAnswer<never> | CallAnswer<never>, { ok: true }>;
/** `said` is the repeat count the record already holds for the run, so its end does not say it twice. */
type Run = { readonly fields: LogFields; repeats: number; said: number };

/** The repeat counts a live run says: the second, then each power of ten from 10 (2, 10, 100, ...). */
const isMilestone = (repeats: number): boolean => repeats === 2 || /^10+$/.test(String(repeats));

type Reporter = {
  /** Says a failure and returns it. The same failure as the call's last is counted, not said again. */
  failed<F extends Failure>(op: Op, failure: F, status: number, problem?: string): F;
  /** A success ends the call's run of failures. */
  succeeded(op: Op): void;
};

const kindOf = (failure: Failure): string =>
  'refusal' in failure || 'refused' in failure ? 'refused' : 'gone' in failure ? 'gone' : 'offline';

/** A refusal's word, and the desk's reason when it gave one: closed words, never a message or a name. */
function wordsOf(failure: Failure): LogFields {
  if ('refusal' in failure) return { word: failure.refusal };
  if (!('refused' in failure)) return {};
  const { refused } = failure;
  return 'reason' in refused
    ? { word: refused.code, reason: refused.reason }
    : { word: refused.code };
}

/**
 * Recurring failure class 3: a failure is said, never silent. The line names the call, what it came to, the status
 * and, for a refusal, its word: never the URL, the token, a link, a message or any body. The list polls every 15 s
 * (S4 design §5), so a run of the same failure is said once and counted, as the scoring port's are: the count at 2,
 * 10, 100, ... repeats, and once more when the run ends if it has grown since.
 */
function reporter(logger: Logger): Reporter {
  const runs = new Map<Op, Run>();
  const repeat = (run: Run): void => {
    run.said = run.repeats;
    logger.warn('matchday.answer.repeat', { ...run.fields, count: run.repeats });
  };
  const close = (op: Op): void => {
    const run = runs.get(op);
    if (run !== undefined && run.repeats > run.said) repeat(run);
  };
  return {
    failed: (op, failure, status, problem) => {
      const fields: LogFields = {
        op,
        kind: kindOf(failure),
        status,
        ...wordsOf(failure),
        ...(problem === undefined ? {} : { problem }),
      };
      const run = runs.get(op);
      if (run !== undefined && JSON.stringify(run.fields) === JSON.stringify(fields)) {
        run.repeats += 1;
        if (isMilestone(run.repeats)) repeat(run);
        return failure;
      }
      close(op);
      runs.set(op, { fields, repeats: 0, said: 0 });
      logger.warn('matchday.answer', fields);
      return failure;
    },
    succeeded: (op) => {
      close(op);
      runs.delete(op);
    },
  };
}
