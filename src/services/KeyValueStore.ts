/**
 * Small secrets and settings on the device. The phone implementation is
 * `expo-secure-store` (Keystore / Keychain), wired in the root layout; tests
 * use the in-memory one below.
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export type MemoryKeyValueStore = KeyValueStore & { readonly entries: ReadonlyMap<string, string> };

export function createMemoryKeyValueStore(
  initial: Record<string, string> = {},
): MemoryKeyValueStore {
  const entries = new Map(Object.entries(initial));
  return {
    entries,
    get: async (key) => entries.get(key) ?? null,
    set: async (key, value) => {
      entries.set(key, value);
    },
    delete: async (key) => {
      entries.delete(key);
    },
  };
}
