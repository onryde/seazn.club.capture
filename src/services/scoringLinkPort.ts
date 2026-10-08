import { httpsHost } from '@/domain/credentials/wire';

/**
 * Spec §10 and R-F3: this match's Remote scoring link. One bounded request whose answer is a link or one of six
 * words. It carries no session state and is never read by the engine. The second of the two calls that answer
 * (the first is the photo port; AGENTS §2, recorded).
 */

/** The words native answers with besides `ok` (plan decision D3), a closed set. */
export const SCORING_WORDS = [
  'code_ended',
  'replaced',
  'match_finished',
  'not_entitled',
  'rate_limited',
  'unavailable',
] as const;
export type ScoringWord = (typeof SCORING_WORDS)[number];

export type ScoringLinkOutcome =
  | { readonly kind: 'ok'; readonly url: string }
  | { readonly kind: 'refused'; readonly word: ScoringWord; readonly retryAfterS: number | null };

/** One ask per tap (spec §10). The URL is a scoring credential: it lives in the promise's value and nowhere else. */
export interface ScoringLinkPort {
  /** Never rejects and never takes longer than the deadline. */
  request(): Promise<ScoringLinkOutcome>;
}

/** capture-scoring-link.v1 `$defs.ok.url`. */
export const SCORING_URL = /^https:\/\/[^/]+\/score\/dl_[A-Za-z0-9_-]{43}$/;

/**
 * The controller's ruling (R-F3): JS gives up at 12 s. Native's own bound is the existing request backstop, 16 s
 * (twice its 8 s request timeout), so JS always gives up first and a late native answer finds nobody waiting.
 */
export const SCORING_DEADLINE_MS = 12_000;

const UNAVAILABLE: ScoringLinkOutcome = { kind: 'refused', word: 'unavailable', retryAfterS: null };

/** The link's secret: the `dl_` segment, which the record is told to mask before the link can be logged. */
export const scoringSecret = (url: string): string => url.slice(url.lastIndexOf('/') + 1);

const isWord = (value: unknown): value is ScoringWord =>
  SCORING_WORDS.some((word) => word === value);

/**
 * What native resolved, as an outcome. Native has already judged the server's answer; this holds the same rules
 * again, because a link is never drawn on trust (Review Focus 5): the shape is the contract's and the host is the
 * build's own, read by the one host rule (`httpsHost`, which drops userinfo and a port and compares exactly),
 * never a second regex. An empty `host` trusts nothing: no url that passes the shape has an empty host.
 */
export function readAnswer(value: unknown, host: string): ScoringLinkOutcome {
  if (typeof value !== 'object' || value === null) return UNAVAILABLE;
  const { outcome, url, retryAfterS } = value as Record<string, unknown>;
  if (outcome === 'ok') {
    const good = typeof url === 'string' && SCORING_URL.test(url) && httpsHost(url) === host;
    return good ? { kind: 'ok', url } : UNAVAILABLE;
  }
  if (!isWord(outcome)) return UNAVAILABLE;
  const retry =
    typeof retryAfterS === 'number' && Number.isFinite(retryAfterS) && retryAfterS >= 0
      ? retryAfterS
      : null;
  return { kind: 'refused', word: outcome, retryAfterS: outcome === 'rate_limited' ? retry : null };
}

export function createScoringLinkPort(
  call: (() => Promise<unknown>) | null,
  deps: { protect: (secret: string) => void; host: string; deadlineMs?: number },
): ScoringLinkPort {
  if (call === null) return { request: () => Promise.resolve(UNAVAILABLE) };
  const deadlineMs = deps.deadlineMs ?? SCORING_DEADLINE_MS;
  return {
    request: () =>
      new Promise<ScoringLinkOutcome>((resolve) => {
        let settled = false;
        const settle = (outcome: ScoringLinkOutcome) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(outcome);
        };
        const timer = setTimeout(() => settle(UNAVAILABLE), deadlineMs);
        const heard = (value: unknown) => {
          const outcome = readAnswer(value, deps.host);
          // Before the caller can have it, and even when it is too late to use: the secret reached JS memory, so the
          // record masks it from here on. The caller of a late answer gets nothing (settle ignores it).
          if (outcome.kind === 'ok') {
            try {
              deps.protect(scoringSecret(outcome.url));
            } catch {
              // A link the record could not be told to mask is never handed out.
              settle(UNAVAILABLE);
              return;
            }
          }
          settle(outcome);
        };
        try {
          call().then(heard, () => settle(UNAVAILABLE));
        } catch {
          settle(UNAVAILABLE);
        }
      }),
  };
}
