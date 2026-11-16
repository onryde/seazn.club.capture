import type { SavedCode } from '@/domain/mode/savedCode';
import type { ModeStore } from '@/services/modeStore';

/** The saved Live Stream code, or null before the store is read or with none (Home's Forget and Exit's Leave read it). */
export function savedStream(store: ModeStore): SavedCode | null {
  const snapshot = store.getSnapshot();
  return snapshot.status === 'ready' ? (snapshot.saved.codes.stream ?? null) : null;
}
