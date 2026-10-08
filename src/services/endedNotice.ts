import type { EndedCard } from '@/domain/session/endedCard';

/**
 * Spec §5's "Stream ended" card, handed from the viewfinder to Home. In memory
 * only: a restart builds a new one, which holds nothing. `show` stores a copy,
 * so two broadcasts that ended the same way are two snapshots, and a store that
 * compares by identity (`useSyncExternalStore`) hears the second.
 */
export type EndedNotice = {
  show(card: EndedCard): void;
  clear(): void;
  getSnapshot(): EndedCard | null;
  subscribe(listener: () => void): () => void;
};

export function createEndedNotice(): EndedNotice {
  let card: EndedCard | null = null;
  const listeners = new Set<() => void>();
  const set = (next: EndedCard | null) => {
    // Nothing to clear is nothing to tell (and OK, then OK again, is one change).
    if (next === null && card === null) return;
    card = next;
    for (const listener of listeners) listener();
  };
  return {
    show: (next) => set({ ...next }),
    clear: () => set(null),
    getSnapshot: () => card,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
