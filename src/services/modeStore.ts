import type { Mode } from '@/domain/mode/Mode';
import type { SavedState } from '@/domain/mode/reopen';
import {
  decodeMode,
  decodeSavedCode,
  encodeSavedCode,
  type SavedCode,
} from '@/domain/mode/savedCode';
import type { KeyValueStore } from '@/services/KeyValueStore';

const MODES: readonly Mode[] = ['stream', 'scoring', 'dashboard'];

export const STORE_KEYS = {
  active: 'mode.active',
  lang: 'lang',
  code: (mode: Mode) => `code.${mode}`,
} as const;

export type ExpiryNotice = { readonly mode: Mode; readonly expiredAt: Date };

export type ModeStoreSnapshot =
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready';
      readonly saved: SavedState;
      readonly dropped: boolean;
      readonly notice: ExpiryNotice | null;
    };

export type ModeStore = {
  load(): Promise<void>;
  getSnapshot(): ModeStoreSnapshot;
  subscribe(listener: () => void): () => void;
  open(code: SavedCode): Promise<void>;
  setActive(mode: Mode | null): Promise<void>;
  forget(mode: Mode): Promise<void>;
  expire(modes: readonly Mode[], notice: ExpiryNotice | null): Promise<void>;
  dismissNotices(): void;
};

type Ready = Extract<ModeStoreSnapshot, { status: 'ready' }>;
const EMPTY: Ready = {
  status: 'ready',
  saved: { active: null, codes: {} },
  dropped: false,
  notice: null,
};

/**
 * Storage that throws on read lands where an unreadable record does: nothing
 * saved, and Home says so (ruling R12). Nothing is deleted — a read that failed
 * once may succeed next launch, and a good code should survive that.
 */
const UNREADABLE: Ready = { ...EMPTY, dropped: true };

/**
 * Which code each mode holds and which mode is active (spec §4). Shaped for
 * useSyncExternalStore: the snapshot object only changes when state does.
 * `load()` never rejects; callers wait for a `ready` snapshot before any other call.
 *
 * Writes run one at a time, in call order, and each reads the state it acts on
 * when it runs, not when it was asked for (I2).
 */
export function createModeStore(kv: KeyValueStore): ModeStore {
  let snapshot: ModeStoreSnapshot = { status: 'loading' };
  const listeners = new Set<() => void>();
  const current = (): Ready => (snapshot.status === 'ready' ? snapshot : EMPTY);
  const publish = (next: Ready) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const withSaved = (saved: SavedState): Ready => ({ ...current(), saved });
  const serial = serialWrites();

  return {
    load: async () => publish(await readAll(kv).catch(() => UNREADABLE)),
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    open: (code) =>
      serial(async () => {
        await kv.set(STORE_KEYS.code(code.mode), encodeSavedCode(code));
        await kv.set(STORE_KEYS.active, code.mode);
        const codes = { ...current().saved.codes, [code.mode]: code };
        publish(withSaved({ active: code.mode, codes }));
      }),
    setActive: (mode) =>
      serial(async () => {
        await (mode === null ? kv.delete(STORE_KEYS.active) : kv.set(STORE_KEYS.active, mode));
        publish(withSaved({ ...current().saved, active: mode }));
      }),
    forget: (mode) =>
      serial(async () => {
        await removeCodes(kv, [mode], current().saved.active === mode);
        publish(withSaved(without(current().saved, [mode])));
      }),
    // R21: publish first. An expired code is unusable whether or not the phone
    // lets it be deleted, so the notice is true either way; a refused delete
    // still rejects, and the next load expires the same code again.
    expire: async (modes, notice) => {
      if (modes.length === 0 && notice === null) return;
      // The codes as the caller judged them, read now; the write runs later.
      const judged = current().saved.codes;
      return serial(async () => {
        const { gone, named } = stillExpired(current().saved, judged, modes, notice);
        if (gone.length === 0 && named === null) return;
        const clearsActive = gone.some((mode) => mode === current().saved.active);
        publish({ ...withSaved(without(current().saved, gone)), notice: named });
        await removeCodes(kv, gone, clearsActive);
      });
    },
    dismissNotices: () => {
      const ready = current();
      if (ready.notice !== null || ready.dropped) {
        publish({ ...ready, notice: null, dropped: false });
      }
    },
  };
}

/**
 * One write at a time, in call order. SecureStore does not promise to finish
 * two writes in the order they were asked, and a check on return from the
 * scanner can land between the two writes of an open. A refused write rejects
 * its own caller and never blocks the next.
 */
function serialWrites(): (write: () => Promise<void>) => Promise<void> {
  let tail: Promise<void> = Promise.resolve();
  return (write) => {
    const run = tail.then(write);
    tail = run.catch(() => undefined);
    return run;
  };
}

/**
 * Of the modes judged expired, those still holding the code that was judged.
 * A code opened since is a fresh one and is kept, and the notice that named
 * the old one is dropped with it: it would be about a code no longer saved.
 */
function stillExpired(
  saved: SavedState,
  judged: SavedState['codes'],
  modes: readonly Mode[],
  notice: ExpiryNotice | null,
): { gone: readonly Mode[]; named: ExpiryNotice | null } {
  const still = (mode: Mode) => saved.codes[mode] === judged[mode];
  const named = notice !== null && still(notice.mode) ? notice : null;
  return { gone: modes.filter(still), named };
}

async function readAll(kv: KeyValueStore): Promise<Ready> {
  const codes: Partial<Record<Mode, SavedCode>> = {};
  let dropped = false;
  for (const mode of MODES) {
    const text = await kv.get(STORE_KEYS.code(mode));
    if (text === null) continue;
    const code = decodeSavedCode(text);
    if (code === null || code.mode !== mode) {
      // Clean slate: unreadable means deleted, never migrated (spec §4).
      await kv.delete(STORE_KEYS.code(mode));
      dropped = true;
    } else {
      codes[mode] = code;
    }
  }
  const active = decodeMode(await kv.get(STORE_KEYS.active));
  const saved = { active: active !== null && codes[active] !== undefined ? active : null, codes };
  return { status: 'ready', saved, dropped, notice: null };
}

async function removeCodes(kv: KeyValueStore, modes: readonly Mode[], clearActive: boolean) {
  for (const mode of modes) await kv.delete(STORE_KEYS.code(mode));
  if (clearActive) await kv.delete(STORE_KEYS.active);
}

function without(saved: SavedState, modes: readonly Mode[]): SavedState {
  const codes = { ...saved.codes };
  for (const mode of modes) delete codes[mode];
  const active = saved.active !== null && modes.includes(saved.active) ? null : saved.active;
  return { active, codes };
}
