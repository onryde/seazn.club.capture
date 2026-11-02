import { isBuildOrigin } from '@/services/seaznHosts';
import {
  parseAppendAnswer,
  parseBootstrap,
  parseEvents,
  parseFailure,
  parseRealtimeGrant,
  parseRules,
  type AppendAnswer,
  type Failure,
  type ReadFailure,
} from '@/domain/scoring/wire';
import {
  MAX_BODY_BYTES,
  parseRetryAfter,
  utf8Length,
  withDeadline,
  type FetchResponse,
} from '@/services/httpAsk';
import type { Logger } from '@/services/logger';
import type { ScoringLink, ScoringPort } from '@/services/scoringPort';
import type { LogFields } from '@/services/scrub';

/** Bounds a captive portal or a dead cell: after this, offline, and the tap goes again with its key. */
export const SCORING_TIMEOUT_MS = 8000;
/** The ledger of a long match is the one big answer, and takes longer than a score does. */
export const EVENTS_TIMEOUT_MS = 15000;
/**
 * The size cap of the two answers that grow with the match (the ledger and the bootstrap), where every other answer
 * keeps `MAX_BODY_BYTES` (64 KiB). A 400-event ledger is about 150 KB. Over it is `tooLarge`, which is no network
 * trouble and is not retried as if it were.
 */
export const SCORING_MAX_BODY_BYTES = 1024 * 1024;

/** `FetchLike` with a body and a POST: the scoring calls are the first that write. */
export type ScoringFetch = (
  url: string,
  init: {
    method: 'GET' | 'POST';
    headers: Readonly<Record<string, string>>;
    body?: string;
    /** React Native's fetch ignores it; the answer's URL is checked instead. */
    redirect: 'error';
    signal?: AbortSignal;
  },
) => Promise<FetchResponse>;

type Deps = {
  fetch: ScoringFetch;
  logger: Logger;
  /** The build's Seazn host (`seaznHosts(env)[0]`): the only one a link's token is sent to. Empty trusts nothing. */
  host: string;
  /** Shortens every call, events too; it never lengthens one (`Math.min` with the call's own bound). */
  timeoutMs?: number;
  now?: () => number;
};

type Op = 'bootstrap' | 'events' | 'rules' | 'append' | 'realtimeToken';
type Request = {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly body?: string;
};
/** What the server said. `body` is the JSON it sent, or null when that was none. */
type Reply = { readonly status: number; readonly body: unknown; readonly retryAfterMs: number };
/** No answer at all, and why: a closed word, never an error's own text. */
type Lost = { readonly problem: string };
/** Builds the request inside the call's own guard: an id that cannot be encoded, a body that cannot be written. */
type Build = () => Request;

const OFFLINE: Failure = { kind: 'offline' };
const TOO_LARGE: ReadFailure = { kind: 'tooLarge' };
const TOO_LARGE_BODY = Symbol('too-large');
const API = '/api/v1';
/** The server's own codes are upper snake case; anything else is not worth a line and might be a secret. */
const CODE_WORD = /^[A-Z][A-Z0-9_]{1,63}$/;

/** The answers that grow with the match have the larger cap. */
const CAP: Readonly<Record<Op, number>> = {
  bootstrap: SCORING_MAX_BODY_BYTES,
  events: SCORING_MAX_BODY_BYTES,
  rules: MAX_BODY_BYTES,
  append: MAX_BODY_BYTES,
  realtimeToken: MAX_BODY_BYTES,
};

export function createFetchScoringPort(deps: Deps): ScoringPort {
  const say = reporter(deps.logger);
  const ask = (link: ScoringLink, op: Op, build: Build) => send(deps, link, op, build);
  const get =
    (path: () => string): Build =>
    () => ({ method: 'GET', path: path() });
  const fixture = (id: string) => `${API}/fixtures/${encodeURIComponent(id)}`;
  return {
    bootstrap: async (link) => {
      const reply = await ask(
        link,
        'bootstrap',
        get(() => `${API}/device-link`),
      );
      return read(say, 'bootstrap', reply, (body) => {
        const bootstrap = parseBootstrap(body);
        return bootstrap === null ? null : { kind: 'ok' as const, bootstrap };
      });
    },
    events: async (link, fixtureId, sinceSeq) => {
      const path = () => `${fixture(fixtureId)}/events?since_seq=${sinceSeq}`;
      const reply = await ask(link, 'events', get(path));
      return read(say, 'events', reply, (body) => parseEvents(body, sinceSeq));
    },
    rules: async (link, fixtureId) => {
      const reply = await ask(
        link,
        'rules',
        get(() => `${fixture(fixtureId)}/rules`),
      );
      return read(say, 'rules', reply, parseRules);
    },
    append: async (link, fixtureId, body) => {
      const build: Build = () => ({
        method: 'POST',
        path: `${fixture(fixtureId)}/events`,
        body: JSON.stringify(body),
      });
      return answerOf(say, await ask(link, 'append', build));
    },
    realtimeToken: async (link, fixtureId) => {
      const path = () => `${API}/public/fixtures/${encodeURIComponent(fixtureId)}/realtime-token`;
      const reply = await ask(link, 'realtimeToken', get(path));
      const grant = read(say, 'realtimeToken', reply, parseRealtimeGrant);
      return 'kind' in grant ? null : grant;
    },
  };
}

/**
 * One request, bounded: its reply, or why there is none. Never rejects. The link's token is handed to the logger
 * first, before anything can fail, so no line this port or anything else writes can carry it (F15).
 */
async function send(deps: Deps, link: ScoringLink, op: Op, build: Build): Promise<Reply | Lost> {
  deps.logger.protectLink(link.token);
  if (!isBuildOrigin(link.origin, deps.host)) return { problem: 'foreign-host' };
  const own = op === 'events' ? EVENTS_TIMEOUT_MS : SCORING_TIMEOUT_MS;
  const deadline = Math.min(deps.timeoutMs ?? own, own);
  return withDeadline<Reply | Lost>(
    (signal) => exchange(deps, link, op, build, signal),
    deadline,
    () => ({ problem: 'timeout' }),
    () => ({ problem: 'unexpected' }),
  );
}

async function exchange(
  deps: Deps,
  link: ScoringLink,
  op: Op,
  build: Build,
  signal?: AbortSignal,
): Promise<Reply | Lost> {
  const request = build();
  const url = `${link.origin}${request.path}`;
  let response: FetchResponse;
  try {
    response = await deps.fetch(url, {
      method: request.method,
      headers: headersFor(link, request),
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
  const body = await bodyOf(response, CAP[op]);
  if (body === TOO_LARGE_BODY) return { problem: 'too-large' };
  const retryAfter = parseRetryAfter(
    response.headers.get('Retry-After'),
    deps.now?.() ?? Date.now(),
  );
  return { status: response.status, body, retryAfterMs: retryAfter * 1000 };
}

function headersFor(link: ScoringLink, request: Request): Record<string, string> {
  return {
    Authorization: `Bearer ${link.token}`,
    'Cache-Control': 'no-store',
    Accept: 'application/json',
    ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
  };
}

/** The body as JSON, null when it is none, or {@link TOO_LARGE_BODY} over the cap: never a body cut short. */
async function bodyOf(response: FetchResponse, cap: number): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return null;
  }
  if (utf8Length(text) > cap) return TOO_LARGE_BODY;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** A read's answer: its data on a 200 that parses; every other thing is a failure, said in the record. */
function read<T>(
  say: Reporter,
  op: Op,
  reply: Reply | Lost,
  parse: (body: unknown) => T | null,
): T | ReadFailure {
  if ('problem' in reply) {
    const failure = reply.problem === 'too-large' ? TOO_LARGE : OFFLINE;
    return say.failed(op, failure, 0, reply.problem);
  }
  if (reply.status === 200) {
    const parsed = parse(reply.body);
    if (parsed === null) return say.failed(op, OFFLINE, reply.status, 'unparseable');
    say.succeeded(op);
    return parsed;
  }
  const failure = parseFailure(reply.status, reply.body, reply.retryAfterMs);
  return say.failed(op, failure, reply.status);
}

/** An append's answer: accepted, or a failure said in the record. A body over its cap is no answer: offline. */
function answerOf(say: Reporter, reply: Reply | Lost): AppendAnswer {
  if ('problem' in reply) return say.failed('append', OFFLINE, 0, reply.problem);
  const answer = parseAppendAnswer(reply.status, reply.body, reply.retryAfterMs);
  if (answer.kind === 'accepted') {
    say.succeeded('append');
    return answer;
  }
  const problem = answer.kind === 'offline' ? 'unreadable' : undefined;
  return say.failed('append', answer, reply.status, problem);
}

type Run = { readonly fields: LogFields; repeats: number };

type Reporter = {
  /** Says a failure and returns it. The same failure as the call's last is counted, not said again. */
  failed<F extends ReadFailure>(op: Op, failure: F, status: number, problem?: string): F;
  /** A success ends the call's run of failures. */
  succeeded(op: Op): void;
};

/**
 * Recurring failure class 3: a failure is said, never silent. The line names the call, what it came to, the status
 * and, for a refusal, the server's own code: never the URL, the token, a message or any body.
 *
 * A phone offline polls every 15 s for hours: one line per change, not per poll. The first failure of a run is said;
 * the same failure again is only counted; when the run ends (another failure of that call, or a success) the count
 * is said once, as `scoring.answer.repeat`.
 */
function reporter(logger: Logger): Reporter {
  const runs = new Map<Op, Run>();
  const close = (op: Op): void => {
    const run = runs.get(op);
    if (run !== undefined && run.repeats > 0) {
      logger.warn('scoring.answer.repeat', { ...run.fields, count: run.repeats });
    }
  };
  return {
    failed: (op, failure, status, problem) => {
      const fields: LogFields = {
        op,
        kind: failure.kind,
        status,
        ...(failure.kind === 'refused' && CODE_WORD.test(failure.code)
          ? { word: failure.code }
          : {}),
        ...(problem === undefined ? {} : { problem }),
      };
      const run = runs.get(op);
      if (run !== undefined && JSON.stringify(run.fields) === JSON.stringify(fields)) {
        run.repeats += 1;
        return failure;
      }
      close(op);
      runs.set(op, { fields, repeats: 0 });
      logger.warn('scoring.answer', fields);
      return failure;
    },
    succeeded: (op) => {
      close(op);
      runs.delete(op);
    },
  };
}
