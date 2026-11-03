import { useState, useSyncExternalStore } from 'react';
import { usePorts } from '@/hooks/usePorts';
import type { ModeStore } from '@/services/modeStore';

const savedMatch = (store: ModeStore): string | null => {
  const snapshot = store.getSnapshot();
  return snapshot.status === 'ready'
    ? (snapshot.saved.codes.scoring?.scoring?.fixtureId ?? null)
    : null;
};

/**
 * The match the Remote Scoring route shows (plan S2-1 Task 10): the saved scoring code's, or null when none is saved. A
 * match seen is held while the screen lives: a link that dies with nothing queued forgets the code under the pad
 * (design §4.3), and the route must stay on the pad's bad-link card, not redirect Home before it has been read. A
 * screen mounted later starts from the store, so it finds nothing and goes Home.
 */
export function useScoringFixture(): string | null {
  const { modeStore } = usePorts();
  const saved = useSyncExternalStore(modeStore.subscribe, () => savedMatch(modeStore));
  const [held, setHeld] = useState(saved);
  if (saved !== null && saved !== held) setHeld(saved);
  return saved ?? held;
}
