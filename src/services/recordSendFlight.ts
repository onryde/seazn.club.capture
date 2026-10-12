import type { RecordUploadPort } from '@/services/recordUploadPort';
import type { SessionRecord } from '@/services/sessionRecord';
import type { UploadCredentialStore } from '@/services/uploadCredentialStore';

/**
 * The button's request, not the session: idle, sending, sent with the server's reference, or failed. Like What viewers
 * see's states (`useViewerCheck`), it is a UI request state, never a projection of native's (AGENTS §2).
 */
export type SendState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sending' }
  | { readonly kind: 'sent'; readonly ref: string }
  | { readonly kind: 'failed' };

export type RecordSendView = {
  readonly state: SendState;
  /** A credential is in hand (R4): null until the first read answers, so no reason shows before it is known. */
  readonly available: boolean | null;
};

/**
 * R3 of the D3 findings design (owner, 2026-10-11): Send record to Seazn's one request, held in the ports, built once
 * like `createScanFlight`. The row that draws it is remounted by a rotation (Settings follows the phone, and its two
 * layouts are two trees) and by a way out and back, so the request is kept here: a row mounted again mid-send reads
 * Sending… and cannot start a second upload, and one mounted after reads the ref, which is never logged and so could
 * not be found again (Important 3 of the Batch 6 review). Shaped for useSyncExternalStore.
 */
export type RecordSendFlight = {
  getSnapshot(): RecordSendView;
  subscribe(onChange: () => void): () => void;
  /** Reads the credential again: at the row's mount and at every return to the foreground (it can expire in a pocket). */
  refresh(): void;
  /** What Share record shares, the JS ring whole (R9, the controller's), on the operator's tap only. One at a time. */
  send(): void;
};

type Deps = {
  readonly credentials: UploadCredentialStore;
  readonly upload: RecordUploadPort;
  readonly record: SessionRecord;
};

const IDLE: SendState = { kind: 'idle' };
const SENDING: SendState = { kind: 'sending' };
const FAILED: SendState = { kind: 'failed' };
/** The credential ran out between the read and the tap: nothing was sent. */
const GONE = 'no-credential';

/**
 * R1-1 of the Batch 6 re-review: an answer belongs to the code it was sent under. The flight outlives the row, so
 * when the code in hand is another, or none (gone past its 24 h, or expired), the answer goes and the button reads
 * Send record to Seazn again: a ref read out under the next code would point its organiser at nothing. The same code
 * inside its 24 h keeps its ref, which is the replaced phone's path.
 */
export function createRecordSendFlight(deps: Deps): RecordSendFlight {
  let view: RecordSendView = { state: IDLE, available: null };
  /** The code URL last read, by a refresh or a send, and the one the shown answer was sent under. */
  let inHand: string | null = null;
  let answeredFor: string | null = null;
  const listeners = new Set<() => void>();
  const update = (next: Partial<RecordSendView>) => {
    view = { ...view, ...next };
    for (const listener of listeners) listener();
  };
  const seen = (codeUrl: string | null) => {
    inHand = codeUrl;
  };
  return {
    getSnapshot: () => view,
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    refresh: () => {
      void deps.credentials.current().then((credential) => {
        seen(credential?.codeUrl ?? null);
        const answered = view.state.kind === 'sent' || view.state.kind === 'failed';
        const stale = answered && answeredFor !== inHand;
        update({ available: credential !== null, ...(stale ? { state: IDLE } : {}) });
      });
    },
    send: () => {
      if (view.state.kind === 'sending') return;
      update({ state: SENDING });
      void sendOnce(deps, seen).then(({ next, codeUrl }) => {
        if (next === GONE) return update({ state: IDLE, available: false });
        answeredFor = codeUrl;
        // A refresh while it was in flight found another code, or none: the answer is not this code's.
        return update({ state: codeUrl === inHand ? next : IDLE });
      });
    },
  };
}

type Answer = { readonly next: SendState | typeof GONE; readonly codeUrl: string | null };

/**
 * One send, answered as the button's next state with the code it was sent under. Never rejects, so the flight never
 * stays on Sending… (N13).
 */
async function sendOnce(
  { credentials, upload, record }: Deps,
  seen: (codeUrl: string | null) => void,
): Promise<Answer> {
  let codeUrl: string | null = null;
  try {
    const credential = await credentials.current();
    seen(credential?.codeUrl ?? null);
    if (credential === null) return { next: GONE, codeUrl };
    codeUrl = credential.codeUrl;
    const outcome = await upload.send(record.lines(), credential);
    const next: SendState =
      outcome.result === 'sent' && outcome.ref !== null
        ? { kind: 'sent', ref: outcome.ref }
        : FAILED;
    return { next, codeUrl };
  } catch {
    return { next: FAILED, codeUrl };
  }
}
