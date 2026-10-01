import type { KeyValueStore } from '@/services/KeyValueStore';
import type { Logger } from '@/services/logger';

export type ControlSide = 'left' | 'right';
export type StreamSettings = { readonly overlay: boolean; readonly side: ControlSide };

export const DEFAULT_STREAM_SETTINGS: StreamSettings = { overlay: true, side: 'right' };
export const SETTINGS_KEY = 'settings.stream';

export type SaveResult = 'saved' | 'refused';

/**
 * Spec §4's two stream settings, behind the key-value port (D23). A change
 * applies at once and is saved once the saved record has been read, on top of
 * it; a refused save is logged and the choice holds for the session. Shaped
 * for useSyncExternalStore. `load()` never rejects and reads once, however
 * often it is called, a change's own read included.
 */
export type StreamSettingsStore = {
  load(): Promise<void>;
  getSnapshot(): StreamSettings;
  subscribe(listener: () => void): () => void;
  set(change: Partial<StreamSettings>): Promise<SaveResult>;
};

export function createStreamSettingsStore(kv: KeyValueStore, logger: Logger): StreamSettingsStore {
  let settings = DEFAULT_STREAM_SETTINGS;
  let loading: Promise<void> | null = null;
  /** The operator's changes, laid over the saved record once it is read (m1). */
  let changes: Partial<StreamSettings> | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: StreamSettings) => {
    settings = next;
    for (const listener of listeners) listener();
  };
  const load = () =>
    (loading ??= read(kv, logger).then((saved) => {
      // A choice made while the first read was slow is newer than it; the
      // fields it did not touch keep what was saved.
      publish(changes === null ? saved : { ...saved, ...changes });
    }));
  const save = serialSaves(kv, logger, () => settings, load);
  return {
    load,
    getSnapshot: () => settings,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (change) => {
      changes = { ...changes, ...change };
      publish({ ...settings, ...change });
      return save();
    },
  };
}

/**
 * One write at a time, as the mode store's (I2): SecureStore does not promise
 * to finish two writes in the order they were asked, and the older one landing
 * last would bring back a choice the operator had undone. No write runs before
 * the saved record is read (`loaded` never rejects), so a change can never
 * persist the defaults over a field it did not touch; after a refused read it
 * saves over the defaults, and the read's refusal is logged. Each write saves
 * the settings as they are when it runs, so the last choice is the one kept,
 * and a refused write never blocks the next. The key-value timeout bounds each.
 */
function serialSaves(
  kv: KeyValueStore,
  logger: Logger,
  current: () => StreamSettings,
  loaded: () => Promise<void>,
): () => Promise<SaveResult> {
  let tail: Promise<SaveResult> = Promise.resolve('saved');
  return () => {
    tail = tail
      .then(loaded)
      .then(() => kv.set(SETTINGS_KEY, encode(current())))
      .then(
        (): SaveResult => 'saved',
        (): SaveResult => {
          logger.warn('settings.write-refused');
          return 'refused';
        },
      );
    return tail;
  };
}

function encode({ overlay, side }: StreamSettings): string {
  return JSON.stringify({ v: 1, overlay, side });
}

async function read(kv: KeyValueStore, logger: Logger): Promise<StreamSettings> {
  let text: string | null;
  try {
    text = await kv.get(SETTINGS_KEY);
  } catch {
    logger.warn('settings.read-refused');
    return DEFAULT_STREAM_SETTINGS;
  }
  if (text === null) return DEFAULT_STREAM_SETTINGS;
  const decoded = decode(text);
  if (decoded === null) logger.warn('settings.unreadable');
  return decoded ?? DEFAULT_STREAM_SETTINGS;
}

function decode(text: string): StreamSettings | null {
  try {
    const data: unknown = JSON.parse(text);
    if (typeof data !== 'object' || data === null) return null;
    const { v, overlay, side } = data as Record<string, unknown>;
    if (v !== 1 || typeof overlay !== 'boolean' || (side !== 'left' && side !== 'right'))
      return null;
    return { overlay, side };
  } catch {
    return null;
  }
}
