import { type Result, err, ok } from '@/domain/Result';
import { parseDescriptor, parseEndReason } from '@/domain/credentials/parseDescriptor';
import type { DescriptorError, SessionDescriptor } from '@/domain/credentials/SessionDescriptor';
import { isRecord } from '@/domain/credentials/wire';
import type { DescriptorPort } from '@/services/descriptorPort';
import type { Logger } from '@/services/logger';
import { isSeaznUrl } from '@/services/seaznHosts';

/** The slice of `fetch` this port uses, so tests stub it without a DOM. */
export type FetchResponse = {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  json(): Promise<unknown>;
};
export type FetchLike = (
  url: string,
  init: { method: 'GET'; headers: Readonly<Record<string, string>>; signal?: AbortSignal },
) => Promise<FetchResponse>;

/** Bounds a captive portal or a dead cell: after this, "no connection" (spec §1). */
export const DESCRIPTOR_TIMEOUT_MS = 8000;

type Answer = Result<SessionDescriptor, DescriptorError>;
/** A refused answer, with what the record says about it. */
type Refusal = {
  readonly error: DescriptorError;
  readonly status: number;
  readonly problem?: string;
};
/** An answer not yet logged: only the one that wins the deadline race ever is. */
type Verdict = Result<SessionDescriptor, Refusal>;
type Deps = {
  origin: string;
  /** The Seazn hosts the descriptor's own URLs must sit on (ruling 6). */
  hosts: readonly string[];
  fetch: FetchLike;
  logger: Logger;
  timeoutMs?: number;
  now?: () => number;
};

const HTTP_DATE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;
const DEFAULT_RETRY_S = 5;
const OFFLINE: DescriptorError = { kind: 'offline' };
const INVALID: DescriptorError = { kind: 'invalid' };

/** Provisional (D2): the web side owns the path; phase 5 reconciles it. */
export function descriptorUrl(origin: string, sid: string): string {
  return `${origin}/api/capture/sessions/${encodeURIComponent(sid)}/descriptor`;
}

/** Seconds or an HTTP-date, clamped to 1–120; anything else is 5 (D5). */
export function parseRetryAfter(value: string | null, nowMs: number): number {
  const text = value?.trim() ?? '';
  if (/^\d+$/.test(text)) return clamp(Number(text));
  if (HTTP_DATE.test(text)) return clamp(Math.ceil((Date.parse(text) - nowMs) / 1000));
  return DEFAULT_RETRY_S;
}

/** A date-shaped string that is no date parses to NaN: that is the default, never a retry at once. */
const clamp = (seconds: number) =>
  Number.isNaN(seconds) ? DEFAULT_RETRY_S : Math.min(120, Math.max(1, seconds));

const refusal = (error: DescriptorError, status: number, problem?: string): Verdict =>
  err({ error, status, ...(problem ? { problem } : {}) });

export function createFetchDescriptorPort(deps: Deps): DescriptorPort {
  const ms = deps.timeoutMs ?? DESCRIPTOR_TIMEOUT_MS;
  return {
    fetch: async (sid, token) => {
      const verdict = await withDeadline((signal) => ask(deps, sid, token, signal), ms);
      return settle(verdict.ok ? onSeaznHosts(verdict.value, deps) : verdict, deps.logger);
    },
  };
}

/**
 * Races the whole exchange — headers and body — against the clock, so a
 * portal that answers 200 and then trickles nothing is still bounded. The
 * loser is dropped unlogged: a fetch rejecting on the abort is not a second
 * error. Anything the exchange throws is no connection, so this never rejects.
 */
function withDeadline(
  work: (signal?: AbortSignal) => Promise<Verdict>,
  ms: number,
): Promise<Verdict> {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Verdict>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve(refusal(OFFLINE, 0, 'timeout'));
    }, ms);
  });
  const answered = work(controller?.signal).catch(() => refusal(OFFLINE, 0, 'unexpected'));
  return Promise.race([answered, late]).finally(() => clearTimeout(timer));
}

async function ask(deps: Deps, sid: string, token: string, signal?: AbortSignal): Promise<Verdict> {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Cache-Control': 'no-store',
    Accept: 'application/json',
  };
  let response: FetchResponse;
  try {
    response = await deps.fetch(descriptorUrl(deps.origin, sid), {
      method: 'GET',
      headers,
      signal,
    });
  } catch {
    return refusal(OFFLINE, 0, 'network');
  }
  return read(response, sid, deps);
}

/** D3's status mapping. */
async function read(response: FetchResponse, sid: string, deps: Deps): Promise<Verdict> {
  const { status } = response;
  switch (status) {
    case 200:
      return readDescriptor(await body(response), sid);
    case 401:
      return refusal(INVALID, status);
    case 404:
      return refusal({ kind: 'not-found' }, status);
    case 410:
      return refusal({ kind: 'ended', endReason: endReasonOf(await body(response)) }, status);
    case 429: {
      const now = deps.now?.() ?? Date.now();
      const retryAfterS = parseRetryAfter(response.headers.get('Retry-After'), now);
      return refusal({ kind: 'rate-limited', retryAfterS }, status);
    }
    default:
      return refusal(OFFLINE, status);
  }
}

/** The only sid guard (D3): a descriptor for another session is never bound to this code. */
function readDescriptor(data: unknown, sid: string): Verdict {
  const parsed = parseDescriptor(data);
  if (!parsed.ok) return refusal(INVALID, 200, 'unparseable');
  if (parsed.value.sid !== sid) return refusal(INVALID, 200, 'sid-mismatch');
  const { state, endReason } = parsed.value;
  if (state === 'completed' || state === 'failed') {
    return refusal({ kind: 'ended', endReason: endReason ?? 'unknown' }, 200, 'over');
  }
  return ok(parsed.value);
}

/**
 * Ruling 6. The heartbeat carries the Bearer token, so a heartbeat off the
 * Seazn hosts refuses the whole answer. An overlay off them is no overlay, as
 * `/relay` is (AGENTS §7): the WebView never loads a page nobody vouched for.
 */
function onSeaznHosts(descriptor: SessionDescriptor, deps: Deps): Verdict {
  if (!isSeaznUrl(descriptor.heartbeatUrl, deps.hosts)) {
    return refusal(INVALID, 200, 'foreign-heartbeat');
  }
  const { overlayUrl } = descriptor;
  if (overlayUrl === null || isSeaznUrl(overlayUrl, deps.hosts)) return ok(descriptor);
  deps.logger.warn('descriptor.overlay-dropped', { problem: 'foreign-host' });
  return ok({ ...descriptor, overlayUrl: null });
}

const body = (response: FetchResponse): Promise<unknown> => response.json().catch(() => null);

const endReasonOf = (data: unknown) => parseEndReason(isRecord(data) ? data.endReason : undefined);

/** Spec §5: a descriptor error is never silent, and is logged once. The token is never a field. */
function settle(verdict: Verdict, logger: Logger): Answer {
  if (verdict.ok) return verdict;
  const { error, status, problem } = verdict.error;
  logger.warn('descriptor.error', { kind: error.kind, status, ...(problem ? { problem } : {}) });
  return err(error);
}
