import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePorts } from '@/hooks/usePorts';
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

export type RecordSend = {
  readonly state: SendState;
  /** A credential is in hand (R4): false with no code saved and none kept in the last 24 h. */
  readonly available: boolean;
  send(): void;
};

const IDLE: SendState = { kind: 'idle' };
const SENDING: SendState = { kind: 'sending' };
const FAILED: SendState = { kind: 'failed' };
/** The credential ran out between the read and the tap: nothing was sent. */
const GONE = 'no-credential';

/**
 * R3 of the D3 findings design (owner, 2026-10-11): Send record to Seazn, on the operator's tap only. What it sends is
 * what Share record shares, the JS ring whole (R9, the controller's). One request at a time: a tap while one is in
 * flight does nothing. The credential is read at mount and at every return to the foreground (it can expire in a
 * pocket), and again at the tap. An answer that lands after the row has gone sets state React drops (19.2), as
 * Share record's does (`useSessionRecord`); the ports never change (AGENTS §8), so no read is stale.
 */
export function useRecordSend(): RecordSend {
  const { uploadCredential, recordUpload, record } = usePorts();
  const [available, setAvailable] = useCredentialInHand();
  const [state, setState] = useState<SendState>(IDLE);
  const inFlight = useRef(false);
  const send = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState(SENDING);
    void sendOnce(uploadCredential, recordUpload, record).then((answer) => {
      inFlight.current = false;
      if (answer === GONE) setAvailable(false);
      setState(answer === GONE ? IDLE : answer);
    });
  }, [uploadCredential, recordUpload, record, setAvailable]);
  return useMemo(() => ({ state, available, send }), [state, available, send]);
}

/** One send, answered as the button's next state. Never rejects, so the in-flight mark is always cleared (N13). */
async function sendOnce(
  credentials: UploadCredentialStore,
  upload: RecordUploadPort,
  record: SessionRecord,
): Promise<SendState | typeof GONE> {
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

/** Whether a usable credential is in hand: read at mount and at every return to the foreground. */
function useCredentialInHand(): readonly [boolean, (inHand: boolean) => void] {
  const { uploadCredential, foreground } = usePorts();
  const [inHand, setInHand] = useState(false);
  useEffect(() => {
    const read = () => {
      void uploadCredential.current().then((credential) => setInHand(credential !== null));
    };
    read();
    return foreground.subscribe(read);
  }, [uploadCredential, foreground]);
  return [inHand, setInHand];
}
