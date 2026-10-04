import { type Result, err, ok } from '@/domain/Result';
import { descriptorOnHost } from '@/domain/credentials/descriptorOnHost';
import { parseDescriptor, parseEndReason } from '@/domain/credentials/parseDescriptor';
import type { DescriptorError, SessionDescriptor } from '@/domain/credentials/SessionDescriptor';
import { httpsHost, isRecord } from '@/domain/credentials/wire';
import type { DescriptorPort } from '@/services/descriptorPort';
import {
  parseRetryAfter,
  withDeadline,
  type FetchLike,
  type FetchResponse,
} from '@/services/httpAsk';
import type { Logger } from '@/services/logger';

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
  /**
   * Where the descriptor lives. Its host is the only one the descriptor's own
   * URLs may name (ruling 6); an origin with no https host trusts nothing.
   */
  origin: string;
  fetch: FetchLike;
  logger: Logger;
  timeoutMs?: number;
  now?: () => number;
};

const OFFLINE: DescriptorError = { kind: 'offline' };
const INVALID: DescriptorError = { kind: 'invalid' };

/** Provisional (D2): the web side owns the path; phase 5 reconciles it. */
export function descriptorUrl(origin: string, sid: string): string {
  return `${origin}/api/capture/sessions/${encodeURIComponent(sid)}/descriptor`;
}

const refusal = (error: DescriptorError, status: number, problem?: string): Verdict =>
  err({ error, status, ...(problem ? { problem } : {}) });

export function createFetchDescriptorPort(deps: Deps): DescriptorPort {
  const ms = deps.timeoutMs ?? DESCRIPTOR_TIMEOUT_MS;
  const host = httpsHost(deps.origin) ?? '';
  return {
    fetch: async (sid, token) => {
      const verdict = await withDeadline(
        (signal) => ask(deps, sid, token, signal),
        ms,
        () => refusal(OFFLINE, 0, 'timeout'),
        () => refusal(OFFLINE, 0, 'unexpected'),
      );
      return settle(verdict.ok ? onHost(verdict.value, host, deps.logger) : verdict, deps.logger);
    },
  };
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

/** Ruling 6, via `descriptorOnHost`; a dropped overlay is said in the record, never silent. */
function onHost(descriptor: SessionDescriptor, host: string, logger: Logger): Verdict {
  const checked = descriptorOnHost(descriptor, host);
  if (!checked.ok) return refusal(INVALID, 200, checked.error);
  if (descriptor.overlayUrl !== null && checked.value.overlayUrl === null) {
    logger.warn('descriptor.overlay-dropped', { problem: 'foreign-host' });
  }
  return ok(checked.value);
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
