const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * N2: which issue of a code a session was armed with, without the token. The
 * token is a secret (D8) and never leaves the arm, so the engine reports this
 * tag in its place: FNV-1a 32-bit over the token's UTF-16 code units (an ASCII
 * token's bytes), as eight hex digits. It only tells two issues apart; it is
 * no check of anything, and 32 bits of a long random token give none of it
 * away.
 */
export function tokenTag(token: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
