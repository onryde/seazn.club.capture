import { parseStreamCodeText } from '@/domain/credentials/streamCode';
import { tokenTag } from '@/domain/credentials/tokenTag';
import type { SavedCode } from '@/domain/mode/savedCode';

/**
 * What names a stream code (amendment, Identity rules in JS): its code, its
 * camera position (`slot`, C7) and its issue (`tokenTag`, N2, never the
 * token). Null where it is not known: no pairing, or a code the phone cannot read.
 */
export type CodeName = {
  readonly code: string | null;
  readonly slot: number | null;
  readonly tokenTag: string | null;
};

export const NO_NAME: CodeName = { code: null, slot: null, tokenTag: null };

/** The same code: all three named on both sides and equal. A null never matches. */
export function sameCode(held: CodeName, code: CodeName): boolean {
  return (
    held.code !== null &&
    held.code === code.code &&
    held.slot !== null &&
    held.slot === code.slot &&
    held.tokenTag !== null &&
    held.tokenTag === code.tokenTag
  );
}

/** A saved code's name, read from its QR. The token goes no further than this call. */
export function savedCodeName(saved: SavedCode): CodeName {
  const code = parseStreamCodeText(saved.raw);
  if (!code.ok) return NO_NAME;
  return { code: code.value.code, slot: code.value.slot, tokenTag: tokenTag(code.value.token) };
}
