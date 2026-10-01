import { useMemo, useSyncExternalStore } from 'react';
import { sameCode, savedCodeName } from '@/domain/mode/codeName';
import type { SavedCode } from '@/domain/mode/savedCode';
import { selectHeldSid, selectHeldSlot, selectHeldTokenTag } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { usePorts } from '@/hooks/usePorts';

/** The saved stream code, or null before the store has loaded and when none is saved. */
export function useSavedStream(): SavedCode | null {
  const { modeStore } = usePorts();
  const store = useSyncExternalStore(modeStore.subscribe, modeStore.getSnapshot);
  return store.status === 'ready' ? (store.saved.codes.stream ?? null) : null;
}

/**
 * Whether native's session is the saved stream code's: the same sid, slot and
 * token tag (I1, C7, N2). False with nothing saved, and for a session native
 * cannot name.
 */
export function useOwnSession(saved: SavedCode | null): boolean {
  const sid = useEngineSelector(selectHeldSid);
  const slot = useEngineSelector(selectHeldSlot);
  const tag = useEngineSelector(selectHeldTokenTag);
  const code = useMemo(() => (saved === null ? null : savedCodeName(saved)), [saved]);
  return code !== null && sameCode({ sid, slot, tokenTag: tag }, code);
}
