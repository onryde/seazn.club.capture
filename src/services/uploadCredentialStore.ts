import { parseStreamCodeText } from '@/domain/credentials/streamCode';
import {
  decodeCredential,
  encodeCredential,
  nextCredential,
  UNREADABLE,
  usableCredential,
  type CredentialStep,
  type SavedForUpload,
  type StoredCredential,
  type UploadCredential,
} from '@/domain/credentials/uploadCredential';
import type { KeyValueStore } from '@/services/KeyValueStore';
import type { Logger } from '@/services/logger';
import type { ModeStore, ModeStoreSnapshot } from '@/services/modeStore';

export const UPLOAD_CREDENTIAL_KEY = 'upload-credential.v1';

/**
 * R4 of the D3 findings design (owner, 2026-10-11): the credential Send record to Seazn may use now. It is kept in
 * secure storage behind the key-value port, and never in a record line, a snapshot or a log line.
 */
export interface UploadCredentialStore {
  /** The usable credential, or null (none, expired, unreadable, or the switch off). Never rejects. */
  current(): Promise<UploadCredential | null>;
}

type Deps = {
  readonly kv: KeyValueStore;
  readonly modeStore: ModeStore;
  readonly clock: () => Date;
  readonly logger: Logger;
  /** P10: `FEATURES.recordSend`, passed in by the composition root. Off, no token is ever stored. */
  readonly enabled: boolean;
};

/** Work on the one key, one piece at a time, so a burst of store publishes never interleaves a set and a delete. */
type Queue = { run(work: () => Promise<void>): void; idle(): Promise<void> };

const REFUSED = { action: 'upload-credential' } as const;
const KEEP: CredentialStep = { kind: 'keep' };
const DELETE: CredentialStep = { kind: 'delete' };

/**
 * Follows the saved stream code (R4; the D3 fixes plan's ruling P12, the controller's): written at its save, replaced
 * by the next code's, its 24 h started when the code goes, deleted after them. A refused write is recorded by its action
 * alone: never its error, which a platform may word with the value it refused.
 *
 * `current()` decides again from what is stored and the code saved now, so a write the keystore refused is never
 * trusted: a refused drop still answers the 24 h it should have stamped, and the write is tried again (Minor 4 of the
 * Batch 6 review). The 24 h are the first ones decided for the drop, never restarted by a later ask (R1-2 of the
 * re-review).
 */
export function createUploadCredentialStore(deps: Deps): UploadCredentialStore {
  const { kv, modeStore, clock, logger } = deps;
  const queue = createQueue(logger);
  if (!deps.enabled) {
    // A build with the switch on may have left one behind.
    queue.run(() => kv.delete(UPLOAD_CREDENTIAL_KEY));
    return { current: async () => null };
  }
  const firstStamp = createFirstStamp();
  const follow = () => {
    const saved = savedForUpload(modeStore.getSnapshot());
    if (saved === undefined) return;
    queue.run(async () =>
      apply(kv, firstStamp(nextCredential(await readStored(kv), saved, clock().getTime()), saved)),
    );
  };
  modeStore.subscribe(follow);
  follow();
  return {
    current: async () => {
      await queue.idle();
      const stored = await readStored(kv);
      const nowMs = clock().getTime();
      const saved = savedForUpload(modeStore.getSnapshot());
      const step = firstStamp(stepNow(stored, saved, nowMs), saved);
      if (step.kind !== 'keep') queue.run(() => apply(kv, step));
      const held = step.kind === 'write' ? step.credential : stored;
      return usableCredential(held === UNREADABLE ? null : held, nowMs);
    },
  };
}

/**
 * R1-2 of the Batch 6 re-review: the first expiry decided for a drop, answered again until a code is saved. While the
 * keystore refuses the write, the stored credential keeps no expiry, and each ask would otherwise decide "now plus
 * 24 h" afresh and slide the window forward without bound. A stamp is decided only with no code saved, for what is
 * stored, and what is stored changes only by a save's write; so a stamp kept since the last save is this drop's.
 */
function createFirstStamp(): (
  step: CredentialStep,
  saved: SavedForUpload | null | undefined,
) => CredentialStep {
  let first: UploadCredential | null = null;
  return (step, saved) => {
    if (saved !== null && saved !== undefined) first = null;
    if (step.kind !== 'write' || step.credential.expiresAtMs === null) return step;
    if (first === null) first = step.credential;
    return { kind: 'write', credential: first };
  };
}

/** Before the saved codes are read, whether a code is saved is unknown: only a credential past its 24 h is deleted. */
function stepNow(
  stored: StoredCredential,
  saved: SavedForUpload | null | undefined,
  nowMs: number,
): CredentialStep {
  if (saved !== undefined) return nextCredential(stored, saved, nowMs);
  if (stored === null || stored === UNREADABLE) return KEEP;
  return usableCredential(stored, nowMs) === null ? DELETE : KEEP;
}

/** The saved stream code's URL and token; null with none saved; undefined before the store has loaded. */
function savedForUpload(snapshot: ModeStoreSnapshot): SavedForUpload | null | undefined {
  if (snapshot.status !== 'ready') return undefined;
  const code = snapshot.saved.codes.stream;
  if (code === undefined || code.stream === null) return null;
  const parsed = parseStreamCodeText(code.raw);
  return parsed.ok ? { codeUrl: code.stream.codeUrl, token: parsed.value.token } : null;
}

/** What the key holds. A read that fails is nothing: the next one decides again, and a failed read deletes nothing. */
async function readStored(kv: KeyValueStore): Promise<StoredCredential> {
  try {
    const text = await kv.get(UPLOAD_CREDENTIAL_KEY);
    return text === null ? null : (decodeCredential(text) ?? UNREADABLE);
  } catch {
    return null;
  }
}

async function apply(kv: KeyValueStore, step: CredentialStep): Promise<void> {
  if (step.kind === 'write') await kv.set(UPLOAD_CREDENTIAL_KEY, encodeCredential(step.credential));
  if (step.kind === 'delete') await kv.delete(UPLOAD_CREDENTIAL_KEY);
}

function createQueue(logger: Logger): Queue {
  let tail: Promise<void> = Promise.resolve();
  return {
    run: (work) => {
      tail = tail.then(work).catch(() => logger.warn('store.write-refused', REFUSED));
    },
    idle: () => tail,
  };
}
