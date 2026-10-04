import { createMemoryKeyValueStore, type KeyValueStore } from '@/services/KeyValueStore';
import { createModeStore } from '@/services/modeStore';

/** Reads always work; a write to a key `refuses` names throws, as a locked Keystore does. */
export function refusingStore(seed: Record<string, string>, refuses: (key: string) => boolean) {
  const memory = createMemoryKeyValueStore(seed);
  const refuse = () => Promise.reject(new Error('keystore locked'));
  const kv: KeyValueStore = {
    get: memory.get,
    set: (key, value) => (refuses(key) ? refuse() : memory.set(key, value)),
    delete: (key) => (refuses(key) ? refuse() : memory.delete(key)),
  };
  return createModeStore(kv);
}
