import { parseCaptureQrText } from '@/domain/credentials/parseCaptureQr';
import { tokenTag } from '@/domain/credentials/tokenTag';
import type { SavedCode } from '@/domain/mode/savedCode';

/**
 * What names a stream code's session (I1, C7, N2): its match (`sid`), its
 * camera position (`slot`) and its issue (`tokenTag`, never the token). Null
 * where it is not known: before an arm, or a code the phone cannot read.
 */
export type CodeName = {
  readonly sid: string | null;
  readonly slot: number | null;
  readonly tokenTag: string | null;
};

export const NO_NAME: CodeName = { sid: null, slot: null, tokenTag: null };

/** The same code: all three named on both sides and equal. A null never matches. */
export function sameCode(held: CodeName, code: CodeName): boolean {
  return (
    held.sid !== null &&
    held.sid === code.sid &&
    held.slot !== null &&
    held.slot === code.slot &&
    held.tokenTag !== null &&
    held.tokenTag === code.tokenTag
  );
}

/**
 * A saved stream code's name: the sid of the descriptor it was saved with (as
 * the engine reports its armed descriptor's), its slot, and its token's tag,
 * from the raw parsed again. The token itself goes no further than this call.
 */
export function savedCodeName(saved: SavedCode): CodeName {
  const code = parseCaptureQrText(saved.raw);
  return {
    sid: saved.descriptor?.sid ?? null,
    slot: saved.slot,
    tokenTag: code.ok ? tokenTag(code.value.token) : null,
  };
}
