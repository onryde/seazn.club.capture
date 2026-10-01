import type { FakeCaptureEngine } from '@/engine/FakeCaptureEngine';
import { savedCodeName } from '@/domain/mode/codeName';
import type { SavedCode } from '@/domain/mode/savedCode';

/**
 * Native already holding this saved code's session, as a reopen finds it: its
 * descriptor, slot and token tag (I1, C7, N2). The scene sets the state.
 */
export function holdCode(engine: FakeCaptureEngine, saved: SavedCode): void {
  const { slot, tokenTag } = savedCodeName(saved);
  engine.setDescriptor(saved.descriptor);
  engine.setSlot(slot);
  engine.setTokenTag(tokenTag);
}
