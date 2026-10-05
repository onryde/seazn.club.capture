import { type Result, err, ok } from '@/domain/Result';
import type { StreamCode } from '@/domain/credentials/streamCode';
import {
  CODE_STATES,
  parseWaitingFields,
  type CodeError,
  type WaitingFields,
} from '@/domain/credentials/waitingFields';
import { httpsHost, isRecord } from '@/domain/credentials/wire';
import type { CodePort } from '@/services/codePort';
import {
  MAX_BODY_BYTES,
  parseRetryAfter,
  utf8Length,
  withDeadline,
  type FetchLike,
  type FetchResponse,
} from '@/services/httpAsk';
import type { Logger } from '@/services/logger';

/** Bounds a captive portal or a dead cell: after this, "no connection". */
export const CODE_TIMEOUT_MS = 8000;

type Deps = {
  /** The build's origin. Its host is the only one the answer's URLs may name (ruling 6). */
  origin: string;
  fetch: FetchLike;
  logger: Logger;
  timeoutMs?: number;
  now?: () => number;
};

type Refusal = { readonly error: CodeError; readonly status: number; readonly problem?: string };
type Read = { readonly fields: WaitingFields; readonly droppedOverlay: boolean };
/** An answer not yet logged: only the one that wins the deadline race ever is. */
type Verdict = Result<Read, Refusal>;

const OFFLINE: CodeError = { kind: 'offline' };
const INVALID: CodeError = { kind: 'invalid' };
const ENDED: CodeError = { kind: 'ended' };

/**
 * X1 (carries D5, D7, D18): a status that names the code ended, not a stream
 * code or invalid is the server's word only with its refusal JSON naming it
 * (`$defs.refusal`, which the server always sends); `null` takes any refusal's
 * `code`, as Bodies does for a 410 (a route that never sends one). Anything
 * else under these statuses — a portal's page, an empty body, another word —
 * is no answer: a captive portal at a ground must never say the code ended.
 */
const REFUSALS: ReadonlyMap<number, { readonly word: string | null; readonly error: CodeError }> =
  new Map([
    [401, { word: 'code_ended', error: ENDED }],
    [404, { word: 'not_a_stream_code', error: { kind: 'not-found' } }],
    [410, { word: null, error: ENDED }],
    [422, { word: 'invalid', error: INVALID }],
  ]);

/** D3: the phone API's code path, on the build's origin. Beats and start come in the answer. */
export function codeUrl(origin: string, code: string): string {
  return `${origin}/api/v1/capture/codes/${encodeURIComponent(code)}`;
}

const refusal = (error: CodeError, status: number, problem?: string): Verdict =>
  err({ error, status, ...(problem ? { problem } : {}) });

export function createFetchCodePort(deps: Deps): CodePort {
  const ms = deps.timeoutMs ?? CODE_TIMEOUT_MS;
  const host = httpsHost(deps.origin) ?? '';
  return {
    check: async (code) => {
      const verdict = await withDeadline(
        (signal) => ask(deps, code, host, signal),
        ms,
        () => refusal(OFFLINE, 0, 'timeout'),
        () => refusal(OFFLINE, 0, 'unexpected'),
      );
      return settle(verdict, deps.logger);
    },
    codeUrl: (code) => codeUrl(deps.origin, code),
  };
}

/** The scan's ask: `?slot=` always, never `?phone=` (G0-d: the phone id is native's). */
async function ask(
  deps: Deps,
  code: StreamCode,
  host: string,
  signal?: AbortSignal,
): Promise<Verdict> {
  const url = `${codeUrl(deps.origin, code.code)}?slot=${code.slot}`;
  const headers = {
    Authorization: `Bearer ${code.token}`,
    'Cache-Control': 'no-store',
    Accept: 'application/json',
  };
  let response: FetchResponse;
  try {
    response = await deps.fetch(url, { method: 'GET', headers, redirect: 'error', signal });
  } catch {
    return refusal(OFFLINE, 0, 'network');
  }
  // Final review M7: React Native's fetch (whatwg-fetch 3.6.20) ignores
  // `redirect` and follows one; native never does. An answer from anywhere
  // but the URL asked is a portal's or an edge's, so no answer.
  if (response.url !== undefined && response.url !== '' && response.url !== url) {
    return refusal(OFFLINE, response.status, 'redirected');
  }
  return read(response, code.code, host, deps);
}

/** The Home outcome table (amendment §2), held to the server's own refusals (X1). */
async function read(
  response: FetchResponse,
  asked: string,
  host: string,
  deps: Deps,
): Promise<Verdict> {
  const { status } = response;
  if (status === 200) {
    const data = await body(response);
    return data === TOO_LARGE
      ? refusal(OFFLINE, status, 'too-large')
      : readFields(data, asked, host);
  }
  if (status === 429) {
    const retryAfterS = parseRetryAfter(
      response.headers.get('Retry-After'),
      deps.now?.() ?? Date.now(),
    );
    return refusal({ kind: 'rate-limited', retryAfterS }, status);
  }
  const named = REFUSALS.get(status);
  if (named === undefined) return refusal(OFFLINE, status);
  const data = await body(response);
  if (data === TOO_LARGE) return refusal(OFFLINE, status, 'too-large');
  const word = isRecord(data) && typeof data.code === 'string' ? data.code : null;
  if (word === null || (named.word !== null && word !== named.word)) {
    return refusal(OFFLINE, status, 'not-refusal');
  }
  return refusal(named.error, status);
}

/** A 200 whose body is no JSON object is not the server's (a portal's page): no answer, never invalid. */
function readFields(data: unknown, asked: string, host: string): Verdict {
  if (!isRecord(data)) return refusal(OFFLINE, 200, 'not-json');
  if (!CODE_STATES.some((state) => state === data.state)) {
    return refusal(INVALID, 200, 'unparseable');
  }
  const fields = parseWaitingFields(data, host);
  if (fields === null) return refusal(INVALID, 200, 'unparseable');
  if (fields.code !== asked) return refusal(INVALID, 200, 'code-mismatch');
  const droppedOverlay = typeof data.overlayUrl === 'string' && fields.overlayUrl === null;
  return ok({ fields, droppedOverlay });
}

/** A refusal or a dropped overlay is said in the record, never silent (recurring failure class 3). */
function settle(verdict: Verdict, logger: Logger): Result<WaitingFields, CodeError> {
  if (verdict.ok) {
    if (verdict.value.droppedOverlay)
      logger.warn('code.overlay-dropped', { problem: 'foreign-host' });
    return ok(verdict.value.fields);
  }
  const { error, status, problem } = verdict.error;
  logger.warn('code.error', { kind: error.kind, status, ...(problem ? { problem } : {}) });
  return err(error);
}

const TOO_LARGE = Symbol('too-large');

/**
 * The body as JSON, or null when it is none. Final review M7: over native's
 * 64 KiB it is `TOO_LARGE`, never a body cut short (`HttpAdapter`).
 */
async function body(response: FetchResponse): Promise<unknown> {
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
