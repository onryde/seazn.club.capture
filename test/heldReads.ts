import type { KeyValueStore } from '@/services/KeyValueStore';

/** A store whose reads wait until `release()`; writes go straight through (review M12). */
export function heldReads(inner: KeyValueStore): { store: KeyValueStore; release: () => void } {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { store: { ...inner, get: async (key) => gate.then(() => inner.get(key)) }, release };
}
