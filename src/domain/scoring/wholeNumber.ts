/** Up to three ASCII digits, padded by spaces at most: what a score field may hold. */
const WHOLE = /^\s*([0-9]{1,3})\s*$/;

/**
 * A score typed into a field, as a whole number, or null when it is not one: empty, a sign, a decimal, an exponent, a
 * digit from another script, or more than three digits. The pad's own rules then judge the number (a game to 21 has
 * no 999); this only reads it.
 */
export function parseWholeNumber(text: string): number | null {
  const match = WHOLE.exec(text);
  return match?.[1] === undefined ? null : Number(match[1]);
}
