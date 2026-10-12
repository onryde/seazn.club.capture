import { parseStreamCodeText } from '@/domain/credentials/streamCode';
import {
  decodeCredential,
  encodeCredential,
  nextCredential,
  usableCredential,
  type CredentialStep,
  type SavedForUpload,
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

/**
 * Follows the saved stream code (R4): renewed at every save of the code, its 24 h started when the code goes, deleted
 * after them. A refused write is recorded by its action alone: never its error, which a platform may word with the
 * value it refused.
 */
export function createUploadCredentialStore(deps: Deps): UploadCredentialStore {
  const { kv, modeStore, clock, logger } = deps;
  const queue = createQueue(logger);
  if (!deps.enabled) {
    // A build with the switch on may have left one behind.
    queue.run(() => kv.delete(UPLOAD_CREDENTIAL_KEY));
    return { current: async () => null };
  }
  const follow = () => {
    const saved = savedForUpload(modeStore.getSnapshot());
    if (saved === undefined) return;
    queue.run(async () =>
      apply(kv, nextCredential(await readStored(kv), saved, clock().getTime())),
    );
  };
  modeStore.subscribe(follow);
  follow();
  return {
    current: async () => {
      await queue.idle();
      const stored = await readStored(kv);
      const usable = usableCredential(stored, clock().getTime());
      if (stored !== null && usable === null) queue.run(() => kv.delete(UPLOAD_CREDENTIAL_KEY));
      return usable;
    },
  };
}

/** The saved stream code's URL and token; null with none saved; undefined before the store has loaded. */
function savedForUpload(snapshot: ModeStoreSnapshot): SavedForUpload | null | undefined {
  if (snapshot.status !== 'ready') return undefined;
  const code = snapshot.saved.codes.stream;
  if (code === undefined || code.stream === null) return null;
  const parsed = parseStreamCodeText(code.raw);
  return parsed.ok ? { codeUrl: code.stream.codeUrl, token: parsed.value.token } : null;
}

async function readStored(kv: KeyValueStore): Promise<UploadCredential | null> {
  try {
    const text = await kv.get(UPLOAD_CREDENTIAL_KEY);
    return text === null ? null : decodeCredential(text);
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
