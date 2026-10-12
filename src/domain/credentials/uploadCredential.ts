/**
 * R4 of the D3 findings design (owner, 2026-10-11): what Send record to Seazn authenticates with. It is the last
 * stream code's token, kept while its code is saved and for 24 h after the app learns the code is dropped, for uploads
 * only. A code is dropped by Home's Forget, the notification's Forget (`forgotten`), Replaced, Taken, a Stop, or its
 * expiry. Pure.
 *
 * It follows the saved stream code: written at its save, replaced by the next code's, its 24 h started when the code
 * goes (the D3 fixes plan's ruling P12, the controller's, which reconciles spec §7's "renewed at every pair": every
 * pair follows a save or comes from a saved code, and the token is the QR's own).
 */
export type UploadCredential = {
  /** The code's URL (`SavedStream.codeUrl`); the upload goes under it. */
  readonly codeUrl: string;
  /** The code's Bearer. A secret: never log it, and never put it in a record line, a snapshot or an error. */
  readonly token: string;
  /** Null while the code is saved; when the app learned of the drop, plus [KEEP_AFTER_DROP_MS], once it is dropped. */
  readonly expiresAtMs: number | null;
};

export const KEEP_AFTER_DROP_MS = 24 * 60 * 60 * 1000;

export type CredentialStep =
  | { readonly kind: 'keep' }
  | { readonly kind: 'write'; readonly credential: UploadCredential }
  | { readonly kind: 'delete' };

/** The saved stream code's part of a credential. */
export type SavedForUpload = { readonly codeUrl: string; readonly token: string };

/** The key holds text that is no credential: a foreign or future shape, which may still carry a token. */
export const UNREADABLE = 'unreadable';

/** What the key holds: nothing, a credential, or text that is none. */
export type StoredCredential = UploadCredential | null | typeof UNREADABLE;

const KEEP: CredentialStep = { kind: 'keep' };
const DELETE: CredentialStep = { kind: 'delete' };

/** One decision from what is stored, the code saved now (or null), and the clock. */
export function nextCredential(
  stored: StoredCredential,
  saved: SavedForUpload | null,
  nowMs: number,
): CredentialStep {
  if (saved !== null) {
    const fresh: UploadCredential = {
      codeUrl: saved.codeUrl,
      token: saved.token,
      expiresAtMs: null,
    };
    const same =
      stored !== null &&
      stored !== UNREADABLE &&
      stored.codeUrl === fresh.codeUrl &&
      stored.token === fresh.token &&
      stored.expiresAtMs === null;
    return same ? KEEP : { kind: 'write', credential: fresh };
  }
  if (stored === null) return KEEP;
  if (stored === UNREADABLE) return DELETE;
  if (stored.expiresAtMs === null) {
    return { kind: 'write', credential: { ...stored, expiresAtMs: nowMs + KEEP_AFTER_DROP_MS } };
  }
  return isOver(stored.expiresAtMs, nowMs) ? DELETE : KEEP;
}

/** The credential an upload may use at [nowMs], or null. */
export function usableCredential(
  stored: UploadCredential | null,
  nowMs: number,
): UploadCredential | null {
  if (stored === null) return null;
  return stored.expiresAtMs !== null && isOver(stored.expiresAtMs, nowMs) ? null : stored;
}

/**
 * The 24 h are over, or the expiry is further off than 24 h can be: the clock was set back after the drop, and
 * trusting it would stretch the 24 h (Minor 4 of the Batch 6 review).
 */
function isOver(expiresAtMs: number, nowMs: number): boolean {
  return nowMs >= expiresAtMs || expiresAtMs - nowMs > KEEP_AFTER_DROP_MS;
}

const VERSION = 1;

export function encodeCredential(credential: UploadCredential): string {
  return JSON.stringify({ v: VERSION, ...credential });
}

/** The anti-corruption read of what the store holds (AGENTS §4): anything not exactly this shape is no credential. */
export function decodeCredential(text: string): UploadCredential | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const { v, codeUrl, token, expiresAtMs } = data as Record<string, unknown>;
  if (v !== VERSION || typeof codeUrl !== 'string' || typeof token !== 'string') return null;
  if (expiresAtMs !== null && typeof expiresAtMs !== 'number') return null;
  return { codeUrl, token, expiresAtMs };
}
