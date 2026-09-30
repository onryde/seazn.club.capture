import type { Recognition } from '@/domain/mode/Mode';

/**
 * Anything longer is not a code a desk printed. It is refused before any
 * parsing, so a hostile QR cannot make the phone chew on megabytes of JSON.
 */
export const MAX_RAW_LENGTH = 4096;

const FOREIGN: Recognition = { outcome: 'foreign' };

/**
 * `https://<host><path>`. The host group excludes `@` and `:`, so userinfo
 * tricks (`https://seazn.club@evil.io/…`) and ports never match. Regex rather
 * than `URL`: React Native's URL polyfill has historically lacked `hostname`
 * and `pathname`, and this runs on Hermes.
 */
const HTTPS_LINK = /^https:\/\/([^/?#:@\s]+)(\/[^?#\s]*)?(?:[?#]\S*)?$/i;
const SCORE_PATH = /^\/score\/([^/?#\s]+)\/?$/;

/**
 * UI routing only, never a trust decision (spec §2). Recognising a stream code
 * says which panel to show; nothing is trusted until S1's descriptor fetch
 * confirms it with the server.
 */
export function recognise(raw: string, now: Date, hosts: readonly string[]): Recognition {
  if (raw.length === 0 || raw.length > MAX_RAW_LENGTH) return FOREIGN;
  const text = raw.trim();
  if (text.startsWith('{')) return recogniseStream(raw, text, now);
  return recogniseLink(raw, text, hosts);
}

function recogniseLink(raw: string, text: string, hosts: readonly string[]): Recognition {
  const match = HTTPS_LINK.exec(text);
  if (match === null) return FOREIGN;
  const host = (match[1] ?? '').toLowerCase();
  if (!hosts.includes(host)) return FOREIGN;
  const token = SCORE_PATH.exec(match[2] ?? '')?.[1];
  if (token === undefined) return { outcome: 'seaznPage' };
  return { outcome: 'code', code: { mode: 'scoring', raw, token } };
}

function recogniseStream(raw: string, text: string, now: Date): Recognition {
  const data = parseJson(text);
  if (!isRecord(data) || !isNonEmptyString(data.sid)) return FOREIGN;
  if (isInteger(data.v) && data.v > 1) return { outcome: 'newerVersion', mode: 'stream' };
  if (data.v !== 1 || !isStreamV1(data)) return FOREIGN;
  const expiresAt = new Date(data.exp * 1000);
  // An integer `exp` can still overflow the Date range; never hand on an Invalid Date.
  if (Number.isNaN(expiresAt.getTime())) return FOREIGN;
  if (expiresAt.getTime() <= now.getTime()) {
    return { outcome: 'expired', mode: 'stream', at: expiresAt };
  }
  return { outcome: 'code', code: { mode: 'stream', raw, slot: data.slot, expiresAt } };
}

type StreamV1Shape = { readonly slot: number; readonly exp: number };

/** Shape only. Credential validation is S1's parser, not this. */
function isStreamV1(
  data: Record<string, unknown>,
): data is Record<string, unknown> & StreamV1Shape {
  const cred = data.cred;
  return (
    isInteger(data.slot) &&
    data.slot >= 0 &&
    isInteger(data.exp) &&
    data.exp >= 1 &&
    (data.preferred === 'srt' || data.preferred === 'rtmps') &&
    isRecord(cred) &&
    isRecord(cred.srt) &&
    isRecord(cred.rtmps)
  );
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
