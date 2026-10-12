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

export function createRecordSendFlight(deps: Deps): RecordSendFlight {
  let view: RecordSendView = { state: IDLE, available: null };
  const listeners = new Set<() => void>();
  const update = (next: Partial<RecordSendView>) => {
    view = { ...view, ...next };
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => view,
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    refresh: () => {
      void deps.credentials
        .current()
        .then((credential) => update({ available: credential !== null }));
    },
    send: () => {
      if (view.state.kind === 'sending') return;
      update({ state: SENDING });
      void sendOnce(deps).then((answer) =>
        update(answer === GONE ? { state: IDLE, available: false } : { state: answer }),
      );
    },
  };
}

/** One send, answered as the button's next state. Never rejects, so the flight never stays on Sending… (N13). */
async function sendOnce({ credentials, upload, record }: Deps): Promise<SendState | typeof GONE> {
  try {
    const credential = await credentials.current();
    if (credential === null) return GONE;
    const outcome = await upload.send(record.lines(), credential);
    return outcome.result === 'sent' && outcome.ref !== null
      ? { kind: 'sent', ref: outcome.ref }
      : FAILED;
  } catch {
    return FAILED;
  }
}
