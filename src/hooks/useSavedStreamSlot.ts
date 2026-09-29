import { useSyncExternalStore } from 'react';
import { usePorts } from '@/hooks/usePorts';

/** The slot printed on the scanned stream code, or null before the store has loaded. */
export function useSavedStreamSlot(): number | null {
  const { modeStore } = usePorts();
  const snapshot = useSyncExternalStore(modeStore.subscribe, modeStore.getSnapshot);
  return snapshot.status === 'ready' ? (snapshot.saved.codes.stream?.slot ?? null) : null;
}
