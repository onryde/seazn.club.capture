import { isRecord } from '@/domain/credentials/wire';
import { MATCHDAY_REFUSALS, type MatchDayRefusal } from '@/domain/matchday/matchDay';
import { toInstant } from '@/domain/matchday/wire';

/** A refusal as the phone reads it: its word, and, for MD_NOT_OPEN, when the day opens if the server said. */
export type MatchDayRefused = { readonly code: MatchDayRefusal; readonly opensAt?: Date };

/**
 * Every md_ route's refusal, one shape (`$defs.refusal` of each Match Day contract): the v1 envelope
 * `{ok: false, error: {code, message, opens_at?}, requestId}` on a 4xx, the code one of the nine words. Anything else
 * is null: the envelope's own answers (404 NOT_FOUND, 429 RATE_LIMITED, 500), a portal's page, a proxy's JSON. The
 * port reads those by status. `message` is the web's developer string, never shown, so it is not required here.
 * `opens_at` rides MD_NOT_OPEN; when present it must be a UTC instant, or the refusal is not the contract's. It is
 * handed on with MD_NOT_OPEN alone ("MD_NOT_OPEN only", the contract says), for "Match Day opens Sat 8 Nov".
 */
export function parseRefusal(status: number, body: unknown): MatchDayRefused | null {
  if (status < 400 || status > 499) return null;
  if (!isRecord(body) || body.ok !== false || !isRecord(body.error)) return null;
  const { code, opens_at: opensAt } = body.error;
  const refusal = MATCHDAY_REFUSALS.find((known) => known === code);
  if (refusal === undefined) return null;
  if (opensAt === undefined) return { code: refusal };
  const at = toInstant(opensAt);
  if (at === undefined) return null;
  return refusal === 'MD_NOT_OPEN' ? { code: refusal, opensAt: at } : { code: refusal };
}
