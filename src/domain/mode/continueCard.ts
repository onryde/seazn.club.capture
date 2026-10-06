import { sameCode, savedCodeName, type CodeName } from '@/domain/mode/codeName';
import type { EngineStatus } from '@/domain/mode/reopen';
import type { SavedCode } from '@/domain/mode/savedCode';

export type ContinueCopy =
  | { readonly kind: 'pairing' }
  | { readonly kind: 'paired'; readonly label: string }
  | { readonly kind: 'saved'; readonly slot: number | null; readonly validTill: string | null };

/**
 * Amendment §2's Home: a paired code says so and what it waits for; any other
 * saved code says its slot, and its expiry when it has one (CD39: `exp` is
 * optional, A1). The card is shown only for a saved, unexpired code (useHome).
 * A held broadcast never reaches Home (AGENTS §6, Task 24's route rule), so
 * there is no live row.
 */
export function continueCard(input: {
  /** The engine is still Pairing: `engine` reads it as paired, as the reopen rules need. */
  pairing: boolean;
  saved: SavedCode;
  engine: EngineStatus;
  held: CodeName;
  heldLabel: string | null;
  validTill: string | null;
}): ContinueCopy {
  const { saved, engine, held } = input;
  if (engine === 'paired' && sameCode(held, savedCodeName(saved))) {
    // Review C5 I-4: never "Paired" before native has paired; a pair can still fail.
    if (input.pairing) return { kind: 'pairing' };
    // A pairing that names no label of its own: the saved waiting fields name it.
    return { kind: 'paired', label: input.heldLabel || saved.stream?.waiting.label || '' };
  }
  return { kind: 'saved', slot: saved.slot, validTill: input.validTill };
}
