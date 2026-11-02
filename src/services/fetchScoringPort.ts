import {
  parseAppendAnswer,
  parseBootstrap,
  parseEvents,
  parseFailure,
  parseRealtimeGrant,
  parseRules,
  type AppendAnswer,
  type Failure,
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

/** Bounds a captive portal or a dead cell: after this, offline, and the tap goes again with its key. */
export const SCORING_TIMEOUT_MS = 8000;

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
  timeoutMs?: number;
  now?: () => number;
};

type Op = 'bootstrap' | 'events' | 'rules' | 'append' | 'realtimeToken';
type Request = {
  readonly op: Op;
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly body?: string;
};
/** What the server said. `body` is the JSON it sent, or null when that was none. */
type Reply = { readonly status: number; readonly body: unknown; readonly retryAfterMs: number };
/** No answer at all, and why: a closed word, never an error's own text. */
type Lost = { readonly problem: string };

const OFFLINE: Failure = { kind: 'offline' };
const TOO_LARGE = Symbol('too-large');
const API = '/api/v1';
/** The server's own codes are upper snake case; anything else is not worth a line and might be a secret. */
const CODE_WORD = /^[A-Z][A-Z0-9_]{1,63}$/;

export function createFetchScoringPort(deps: Deps): ScoringPort {
  const get = (op: Op, path: string): Request => ({ op, method: 'GET', path });
  const fixture = (id: string) => `${API}/fixtures/${encodeURIComponent(id)}`;
  return {
    bootstrap: async (link) => {
      const reply = await send(deps, link, get('bootstrap', `${API}/device-link`));
      return read(deps, 'bootstrap', reply, (body) => {
        const bootstrap = parseBootstrap(body);
        return bootstrap === null ? null : { kind: 'ok' as const, bootstrap };
      });
    },
    events: async (link, fixtureId, sinceSeq) => {
      const path = `${fixture(fixtureId)}/events?since_seq=${sinceSeq}`;
      const reply = await send(deps, link, get('events', path));
      return read(deps, 'events', reply, (body) => parseEvents(body, sinceSeq));
    },
    rules: async (link, fixtureId) => {
      const path = `${fixture(fixtureId)}/rules`;
      return read(deps, 'rules', await send(deps, link, get('rules', path)), parseRules);
    },
    append: async (link, fixtureId, body) => {
      const request: Request = {
        op: 'append',
        method: 'POST',
        path: `${fixture(fixtureId)}/events`,
        body: JSON.stringify(body),
      };
      return answerOf(deps, await send(deps, link, request));
    },
    realtimeToken: async (link, fixtureId) => {
      const path = `${API}/public/fixtures/${encodeURIComponent(fixtureId)}/realtime-token`;
      const reply = await send(deps, link, get('realtimeToken', path));
      const grant = read(deps, 'realtimeToken', reply, parseRealtimeGrant);
      return 'kind' in grant ? null : grant;
    },
  };
}

/** One request, bounded: its reply, or why there is none. Never rejects. */
async function send(deps: Deps, link: ScoringLink, request: Request): Promise<Reply | Lost> {
  if (!isBuildOrigin(link.origin, deps.host)) return { problem: 'foreign-host' };
  return withDeadline<Reply | Lost>(
    (signal) => exchange(deps, link, request, signal),
    deps.timeoutMs ?? SCORING_TIMEOUT_MS,
    () => ({ problem: 'timeout' }),
    () => ({ problem: 'unexpected' }),
  );
}

/** The origin exactly as the build's host makes it: no other scheme, port, path, userinfo or suffix. */
const isBuildOrigin = (origin: string, host: string): boolean =>
  host !== '' && origin === `https://${host}`;

async function exchange(
  deps: Deps,
  link: ScoringLink,
  request: Request,
  signal?: AbortSignal,
): Promise<Reply | Lost> {
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
  const body = await bodyOf(response);
  if (body === TOO_LARGE) return { problem: 'too-large' };
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

/** The body as JSON, null when it is none, or {@link TOO_LARGE} over native's cap: never a body cut short. */
async function bodyOf(response: FetchResponse): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return null;
  }
  if (utf8Length(text) > MAX_BODY_BYTES) return TOO_LARGE;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** A read's answer: its data on a 200 that parses; every other thing is a failure, said in the record. */
function read<T>(
  deps: Deps,
  op: Op,
  reply: Reply | Lost,
  parse: (body: unknown) => T | null,
): T | Failure {
  if ('problem' in reply) return said(deps, op, OFFLINE, 0, reply.problem);
  if (reply.status === 200) {
    return parse(reply.body) ?? said(deps, op, OFFLINE, reply.status, 'unparseable');
  }
  const failure = parseFailure(reply.status, reply.body, reply.retryAfterMs);
  return said(deps, op, failure, reply.status);
}

/** An append's answer: accepted, or a failure said in the record. */
function answerOf(deps: Deps, reply: Reply | Lost): AppendAnswer {
  if ('problem' in reply) return said(deps, 'append', OFFLINE, 0, reply.problem);
  const answer = parseAppendAnswer(reply.status, reply.body, reply.retryAfterMs);
  if (answer.kind === 'accepted') return answer;
  const problem = answer.kind === 'offline' ? 'unreadable' : undefined;
  return said(deps, 'append', answer, reply.status, problem);
}

/**
 * Recurring failure class 3: a failure is said, never silent. The line names the call, what it came to, the status and,
 * for a refusal, the server's own code: never the URL, the token, a message or any body.
 */
function said(deps: Deps, op: Op, failure: Failure, status: number, problem?: string): Failure {
  deps.logger.warn('scoring.answer', {
    op,
    kind: failure.kind,
    status,
    ...(failure.kind === 'refused' && CODE_WORD.test(failure.code) ? { word: failure.code } : {}),
    ...(problem === undefined ? {} : { problem }),
  });
  return failure;
}
