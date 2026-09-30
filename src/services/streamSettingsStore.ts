import type { KeyValueStore } from '@/services/KeyValueStore';
import type { Logger } from '@/services/logger';

export type ControlSide = 'left' | 'right';
export type StreamSettings = { readonly overlay: boolean; readonly side: ControlSide };

export const DEFAULT_STREAM_SETTINGS: StreamSettings = { overlay: true, side: 'right' };
export const SETTINGS_KEY = 'settings.stream';

export type SaveResult = 'saved' | 'refused';

/**
 * Spec §4's two stream settings, behind the key-value port (D23). A change
 * applies at once; a refused save is logged and the choice holds for the
 * session. Shaped for useSyncExternalStore. `load()` never rejects and reads
 * once, however often it is called.
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
  let touched = false;
  const listeners = new Set<() => void>();
  const publish = (next: StreamSettings) => {
    settings = next;
    for (const listener of listeners) listener();
  };
  const save = serialSaves(kv, logger, () => settings);
  return {
    load: () =>
      (loading ??= read(kv, logger).then((saved) => {
        // A choice made while the first read was slow is newer than it.
        if (!touched) publish(saved);
      })),
    getSnapshot: () => settings,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (change) => {
      touched = true;
      publish({ ...settings, ...change });
      return save();
    },
  };
}

/**
 * One write at a time, as the mode store's (I2): SecureStore does not promise
 * to finish two writes in the order they were asked, and the older one landing
 * last would bring back a choice the operator had undone. Each write saves the
 * settings as they are when it runs, so the last choice is the one kept, and a
 * refused write never blocks the next. The key-value timeout bounds each one.
 */
function serialSaves(
  kv: KeyValueStore,
  logger: Logger,
  current: () => StreamSettings,
): () => Promise<SaveResult> {
  let tail: Promise<SaveResult> = Promise.resolve('saved');
  return () => {
    tail = tail
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
