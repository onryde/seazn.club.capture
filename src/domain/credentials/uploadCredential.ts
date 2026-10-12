/**
 * R4 of the D3 findings design (owner, 2026-10-11): what Send record to Seazn authenticates with. It is the last
 * stream code's token, kept while its code is saved and for 24 h after the code is dropped, for uploads only. A code
 * is dropped by Home's Forget, the notification's Forget (`forgotten`), Replaced, Taken, a Stop, or its expiry. Pure.
 *
 * Spec §7 names it `{codeRef, token, expiresAt}` and renews it "at every pair". It is held here as the code's URL and
 * an epoch-ms expiry, and renewed at every save of the code. A pair always follows a save, and Continue re-pairs a
 * code that is still saved, whose credential already matches.
 */
export type UploadCredential = {
  /** The code's URL (`SavedStream.codeUrl`); the upload goes under it. */
  readonly codeUrl: string;
  /** The code's Bearer. A secret: never log it, and never put it in a record line, a snapshot or an error. */
  readonly token: string;
  /** Null while the code is saved; the drop time plus [KEEP_AFTER_DROP_MS] once it is dropped. */
  readonly expiresAtMs: number | null;
};

export const KEEP_AFTER_DROP_MS = 24 * 60 * 60 * 1000;

export type CredentialStep =
  | { readonly kind: 'keep' }
  | { readonly kind: 'write'; readonly credential: UploadCredential }
  | { readonly kind: 'delete' };

/** The saved stream code's part of a credential. */
export type SavedForUpload = { readonly codeUrl: string; readonly token: string };

const KEEP: CredentialStep = { kind: 'keep' };

/** One decision from what is stored, the code saved now (or null), and the clock. */
export function nextCredential(
  stored: UploadCredential | null,
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
      stored.codeUrl === fresh.codeUrl &&
      stored.token === fresh.token &&
      stored.expiresAtMs === null;
    return same ? KEEP : { kind: 'write', credential: fresh };
  }
  if (stored === null) return KEEP;
  if (stored.expiresAtMs === null) {
    return { kind: 'write', credential: { ...stored, expiresAtMs: nowMs + KEEP_AFTER_DROP_MS } };
  }
  return nowMs >= stored.expiresAtMs ? { kind: 'delete' } : KEEP;
}

/** The credential an upload may use at [nowMs], or null. */
export function usableCredential(
  stored: UploadCredential | null,
  nowMs: number,
): UploadCredential | null {
  if (stored === null) return null;
  return stored.expiresAtMs !== null && nowMs >= stored.expiresAtMs ? null : stored;
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
