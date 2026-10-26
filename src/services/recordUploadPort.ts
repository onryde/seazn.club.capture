import { isStreamCodeText } from '@/domain/credentials/streamCode';
import type { UploadCredential } from '@/domain/credentials/uploadCredential';
import { codeUrl } from '@/services/fetchCodePort';
import type { Logger } from '@/services/logger';
import {
  fitLine,
  isRecordTime,
  RECORD_LEVELS,
  RECORD_MAX_BYTES,
  RECORD_MAX_LINES,
  RECORD_PATH,
  RECORD_REF,
} from '@/services/recordContract';
import { scrubEvent, scrubFields, type HeldSecrets, type LogFields } from '@/services/scrub';
import { parseRecordLine } from '@/services/sessionRecord';

/**
 * The web's record contract (`contracts/capture-record.v1.json`, vendored at f0feab16c; `recordContract.ts` holds its
 * rules): the code's Bearer and an NDJSON body; a 201 is read for its `ref` alone, and never its `kept` or `dropped`
 * (RD, the owner's ruling of 2026-10-12). A refusal is read by its status, never its body. A bad line is never refused:
 * the server drops it and keeps the rest (owner ruling RL, 2026-10-12).
 */
type RecordUploadHeaders = {
  readonly Authorization: string;
  readonly 'Content-Type': 'application/x-ndjson';
};
type RecordUploadAnswer = { readonly ref: string };

/**
 * What one send came to. Fix round 1 of Batch 11 (the controller's ruling 8): each refusal another try cannot change
 * has its own word (`unauthorised` 401, `not-found` 404, `too-large` 413 or over the limit here, `invalid` 422, a body
 * the server cannot read as lines, which this port never sends, `unreadable` a 201 off the contract, `refused-local` a
 * record this port will not send); `rate-limited` (429) and `failed` (the network, the 15 s bound, a 5xx, any other
 * status) are the ones another try can change.
 */
export type RecordSendResult =
  | 'sent'
  | 'refused-local'
  | 'unauthorised'
  | 'not-found'
  | 'too-large'
  | 'invalid'
  | 'unreadable'
  | 'rate-limited'
  | 'failed';

export type RecordSendOutcome = {
  readonly result: RecordSendResult;
  /** The server's short reference, for the operator to read to the organiser. Never logged. */
  readonly ref: string | null;
  readonly status: number | null;
  readonly bytes: number;
};

/**
 * R3 of the D3 findings design (owner, 2026-10-11): one request with an answer, on the operator's tap. It never
 * touches the engine bridge (spec §7), so it is not one of AGENTS §2's calls. It never rejects.
 */
export interface RecordUploadPort {
  send(lines: readonly string[], credential: UploadCredential): Promise<RecordSendOutcome>;
}

export type PostFetch = (
  url: string,
  init: { method: 'POST'; headers: RecordUploadHeaders; body: string; signal: AbortSignal },
) => Promise<{ status: number; json(): Promise<unknown> }>;

/** The whole exchange, the answer's body included, so the button is never left on Sending… */
export const RECORD_TIMEOUT_MS = 15_000;

const STATUS: Readonly<Record<number, RecordSendResult>> = {
  401: 'unauthorised',
  404: 'not-found',
  413: 'too-large',
  422: 'invalid',
  429: 'rate-limited',
};

/**
 * Fail closed (spec §7): every line must be a record line the scrub would leave exactly as it is, with the token held
 * as a secret, and the token must not appear anywhere in it: not in the text sent (a key written twice can hide it
 * from a reader), and not in the text a reader decodes (an escaped key can hide it from the text). One line that
 * names the token, is not a record line, or would change under the scrub sends nothing.
 */
export function linesAreSafe(lines: readonly string[], token: string): boolean {
  const held: HeldSecrets = { secrets: [token], streamIds: [] };
  return lines.every((line) => !line.includes(token) && decodedIsSafe(line, token, held));
}

/** The line as a reader decodes it: a record line, naming no token, that the scrub would leave exactly as written. */
function decodedIsSafe(line: string, token: string, held: HeldSecrets): boolean {
  const data = recordObject(line);
  if (data === null || JSON.stringify(data).includes(token)) return false;
  const entry = parseRecordLine(line);
  if (scrubEvent(entry.event, held) !== entry.event) return false;
  // `scrubFields` reads every value as unknown and masks an object, an array or a non-finite number (scrub.ts,
  // `scrubValue`), so a value that is no LogValue never equals its scrub, and the line fails here.
  const fields = entry.fields as LogFields;
  const scrubbed = scrubFields(fields, held, true);
  return Object.keys(fields).every((key) => scrubbed[key] === fields[key]);
}

/**
 * A record line decoded, or null for anything that is not one: a JSON object with a text `kind`, the contract's `at`,
 * and no `level` but one of the contract's (Minor 11 of the Batch 6 review: the scrub reads neither slot).
 */
function recordObject(line: string): Record<string, unknown> | null {
  // NDJSON (fix round 1 of Batch 11, finding 3 of its review): a raw line break between tokens is JSON, and two lines.
  if (/[\r\n]/.test(line)) return null;
  let data: unknown;
  try {
    data = JSON.parse(line);
  } catch {
    return null;
  }
  // An array or a scalar has no text `kind`, so that check turns every non-object away too.
  if (typeof data !== 'object' || data === null) return null;
  const { at, kind, level } = data as Record<string, unknown>;
  const timed = isRecordTime(at);
  const levelled = level === undefined || (typeof level === 'string' && RECORD_LEVELS.has(level));
  return typeof kind === 'string' && timed && levelled ? (data as Record<string, unknown>) : null;
}

/**
 * Important 2 of the Batch 6 review: the Bearer goes only where native would send it. Native holds a pairing's code
 * URL to "https://<the build's Seazn host>/api/v1/capture/codes/<code>" (`PairRequest.problems()`); this is that
 * rule with JavaScript's own parts: the host from `seaznHosts`, the URL as `codeUrl` builds it, the code as the QR's
 * parser reads it. An empty host trusts nothing.
 */
export function isSeaznCodeUrl(url: string, host: string): boolean {
  if (host === '') return false;
  const origin = `https://${host}`;
  const code = url.slice(codeUrl(origin, '').length);
  return isStreamCodeText(code) && url === codeUrl(origin, code);
}

export function createRecordUploadPort({
  fetch,
  logger,
  host,
}: {
  fetch: PostFetch;
  logger: Logger;
  /** The build's Seazn host (`seaznHosts(env)[0]`); the only one the token is sent to. */
  host: string;
}): RecordUploadPort {
  // The line names the result, the status and the size: never the ref, the token or an error's words.
  const said = (
    result: RecordSendResult,
    status: number | null,
    bytes: number,
    ref: string | null = null,
  ): RecordSendOutcome => {
    logger.info('record.send', { result, status, bytes });
    return { result, ref, status, bytes };
  };
  return {
    send: async (all, credential) => {
      // The flight hands it at most this many, the pairing's pinned lines first (N38); a longer list keeps its newest.
      const lines = all.slice(-RECORD_MAX_LINES);
      if (lines.length === 0) return said('failed', null, 0);
      if (!isSeaznCodeUrl(credential.codeUrl, host)) return said('refused-local', null, 0);
      if (!linesAreSafe(lines, credential.token)) return said('refused-local', null, 0);
      // Q4: checked as written, then sent with what the contract does not list dropped.
      const body = `${lines.map(fitLine).join('\n')}\n`;
      let bytes = 0;
      try {
        bytes = new TextEncoder().encode(body).length;
        if (bytes > RECORD_MAX_BYTES) return said('too-large', null, bytes);
        const { status, ref } = await exchange(fetch, credential, body);
        if (status !== 201) return said(STATUS[status] ?? 'failed', status, bytes);
        return ref === null ? said('unreadable', status, bytes) : said('sent', status, bytes, ref);
      } catch {
        return said('failed', null, bytes);
      }
    },
  };
}

/** One POST and its answer's body, within [RECORD_TIMEOUT_MS]; past it, the request is aborted and this rejects. */
async function exchange(
  fetch: PostFetch,
  credential: UploadCredential,
  body: string,
): Promise<{ status: number; ref: string | null }> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), RECORD_TIMEOUT_MS);
  const timedOut = new Promise<never>((_, reject) => {
    abort.signal.addEventListener('abort', () => reject(new Error('record upload timed out')));
  });
  try {
    return await Promise.race([post(fetch, credential, body, abort.signal), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

async function post(
  fetch: PostFetch,
  credential: UploadCredential,
  body: string,
  signal: AbortSignal,
): Promise<{ status: number; ref: string | null }> {
  const answer = await fetch(`${credential.codeUrl}${RECORD_PATH}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credential.token}`,
      'Content-Type': 'application/x-ndjson',
    },
    body,
    signal,
  });
  // Only a 201 carries a reference: any other answer's body is never read.
  if (answer.status !== 201) return { status: answer.status, ref: null };
  const read = readAnswer(await answer.json().catch(() => null));
  return { status: answer.status, ref: read === null ? null : read.ref };
}

/** The anti-corruption read of a 201's body (AGENTS §4): the contract's `ref`, or nothing. */
function readAnswer(data: unknown): RecordUploadAnswer | null {
  if (typeof data !== 'object' || data === null) return null;
  const { ref } = data as Record<string, unknown>;
  return typeof ref === 'string' && RECORD_REF.test(ref) ? { ref } : null;
}
