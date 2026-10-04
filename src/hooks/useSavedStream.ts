import { useMemo, useSyncExternalStore } from 'react';
import { sameCode, savedCodeName } from '@/domain/mode/codeName';
import type { SavedCode } from '@/domain/mode/savedCode';
import { selectHeldCode, selectHeldSlot, selectHeldTokenTag } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { usePorts } from '@/hooks/usePorts';

/** The saved stream code, or null before the store has loaded and when none is saved. */
export function useSavedStream(): SavedCode | null {
  const { modeStore } = usePorts();
  const store = useSyncExternalStore(modeStore.subscribe, modeStore.getSnapshot);
  return store.status === 'ready' ? (store.saved.codes.stream ?? null) : null;
}

/**
 * Whether native's pairing is the saved stream code's: the same code, slot and
 * token tag (amendment, Identity rules). False with nothing saved, and for a
 * pairing native cannot name.
 */
export function useOwnPairing(saved: SavedCode | null): boolean {
  const held = useEngineSelector(selectHeldCode);
  const slot = useEngineSelector(selectHeldSlot);
  const tag = useEngineSelector(selectHeldTokenTag);
  const code = useMemo(() => (saved === null ? null : savedCodeName(saved)), [saved]);
  return code !== null && sameCode({ code: held, slot, tokenTag: tag }, code);
}
