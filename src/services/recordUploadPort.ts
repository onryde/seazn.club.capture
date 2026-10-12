import type { UploadCredential } from '@/domain/credentials/uploadCredential';
import type { Logger } from '@/services/logger';
import { scrubEvent, scrubFields, type HeldSecrets, type LogFields } from '@/services/scrub';
import { parseRecordLine, type RecordedEntry } from '@/services/sessionRecord';

/**
 * Provisional (the D3 fixes plan's ruling P4, the controller's): the path and these two shapes are the D3 web brief's
 * §1 as asked, not a vendored contract. The web has not published its record contract yet, and its brief leaves the
 * path to the web. When the contract exists, `pnpm contracts:vendor` and the pin test replace all three, and nothing
 * else in the app changes. Until then the button is off (`FEATURES.recordSend`), so nothing calls this path.
 */
export const PENDING_RECORD_PATH = '/record';
type RecordUploadHeaders = {
  readonly Authorization: string;
  readonly 'Content-Type': 'application/x-ndjson';
};
type RecordUploadAnswer = { readonly ref: string };

export type RecordSendResult =
  'sent' | 'refused-local' | 'unauthorised' | 'too-large' | 'rate-limited' | 'failed';

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

/** The web brief's §1 limits: at most 1,000 lines and 1 MB. */
export const RECORD_MAX_LINES = 1000;
export const RECORD_MAX_BYTES = 1_000_000;
/** The whole exchange, the answer's body included, so the button is never left on Sending… */
export const RECORD_TIMEOUT_MS = 15_000;
/** A short human reference (the brief's "R-7K2Q"); anything else is not one. */
const REF = /^[A-Za-z0-9-]{1,16}$/;

const STATUS: Readonly<Record<number, RecordSendResult>> = {
  401: 'unauthorised',
  413: 'too-large',
  429: 'rate-limited',
};

/**
 * Fail closed (spec §7): every line must be a record line the scrub would leave exactly as it is, with the token held
 * as a secret, and the token must not appear anywhere in it. One line that names the token, is not a record line, or
 * would change under the scrub sends nothing.
 */
export function linesAreSafe(lines: readonly string[], token: string): boolean {
  const held: HeldSecrets = { secrets: [token], streamIds: [] };
  return lines.every((line) => !line.includes(token) && scrubLeaves(line, held));
}

/** Whether the scrub, holding [held] with a session in hand, would leave this line exactly as written. */
function scrubLeaves(line: string, held: HeldSecrets): boolean {
  const entry = entryOf(line);
  if (entry === null || scrubEvent(entry.event, held) !== entry.event) return false;
  // `scrubFields` reads every value as unknown and masks an object, an array or a non-finite number (scrub.ts,
  // `scrubValue`), so a value that is no LogValue never equals its scrub, and the line fails here.
  const fields = entry.fields as LogFields;
  const scrubbed = scrubFields(fields, held, true);
  return Object.keys(fields).every((key) => scrubbed[key] === fields[key]);
}

/** A record line's parts, or null for anything that is not a JSON object with a text `kind`. */
function entryOf(line: string): RecordedEntry | null {
  let data: unknown;
  try {
    data = JSON.parse(line);
  } catch {
    return null;
  }
  // An array or a scalar has no text `kind`, so this one check turns every non-object away too.
  if (typeof data !== 'object' || data === null) return null;
  return typeof (data as Record<string, unknown>).kind === 'string' ? parseRecordLine(line) : null;
}

export function createRecordUploadPort({
  fetch,
  logger,
}: {
  fetch: PostFetch;
  logger: Logger;
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
      const lines = all.slice(-RECORD_MAX_LINES);
      if (lines.length === 0) return said('failed', null, 0);
      if (!linesAreSafe(lines, credential.token)) return said('refused-local', null, 0);
      const body = `${lines.join('\n')}\n`;
      let bytes = 0;
      try {
        bytes = new TextEncoder().encode(body).length;
        if (bytes > RECORD_MAX_BYTES) return said('too-large', null, bytes);
        const { status, ref } = await exchange(fetch, credential, body);
        if (status !== 201) return said(STATUS[status] ?? 'failed', status, bytes);
        return ref === null ? said('failed', status, bytes) : said('sent', status, bytes, ref);
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
  const answer = await fetch(`${credential.codeUrl}${PENDING_RECORD_PATH}`, {
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

/** The anti-corruption read of a 201's body (AGENTS §4): a short reference, or nothing. */
function readAnswer(data: unknown): RecordUploadAnswer | null {
  if (typeof data !== 'object' || data === null) return null;
  const { ref } = data as Record<string, unknown>;
  return typeof ref === 'string' && REF.test(ref) ? { ref } : null;
}
