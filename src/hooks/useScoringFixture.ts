import { useState, useSyncExternalStore } from 'react';
import { usePorts } from '@/hooks/usePorts';
import { useOpenMatch } from '@/hooks/useScoringOrigin';
import type { ModeStore } from '@/services/modeStore';

/** Under Match Day (the active mode) the match is the one Match Day opened; under any other it is the saved scan's. */
const savedMatch = (store: ModeStore, openedByMatchDay: string | null): string | null => {
  const snapshot = store.getSnapshot();
  if (snapshot.status !== 'ready') return null;
  if (snapshot.saved.active === 'matchday') return openedByMatchDay;
  return snapshot.saved.codes.scoring?.scoring?.fixtureId ?? null;
};

/**
 * The match the Remote Scoring route shows (plan S2-1 Task 10): the saved scoring code's, or null when none is saved;
 * with Match Day the active mode (MD-2 Task 5; S4 design §6), the match Match Day opened, `matchday.open`, and never a
 * scoring code saved before it (a scan's match is not the one on screen). A
 * match seen is held while the screen lives: a link that dies with nothing queued forgets the code under the pad
 * (design §4.3), and the route must stay on the pad's bad-link card, not redirect Home before it has been read. A
 * screen mounted later starts from the store, so it finds nothing and goes Home.
 */
export function useScoringFixture(): string | null {
  const { modeStore } = usePorts();
  const open = useOpenMatch()?.fixtureId ?? null;
  const saved = useSyncExternalStore(modeStore.subscribe, () => savedMatch(modeStore, open));
  const [held, setHeld] = useState(saved);
  if (saved !== null && saved !== held) setHeld(saved);
  return saved ?? held;
}
