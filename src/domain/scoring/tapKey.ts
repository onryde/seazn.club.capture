/**
 * A tap's idempotency key: a v4 UUID (plan S2-1 Global Constraints), from sixteen random bytes the caller supplies. A key
 * is made once at tap time and never changed, so a resend after a lost answer is answered with the original outcome
 * (design §7.3). Pure: the source of randomness is the hook's.
 */
export function uuidV4(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new Error('a UUID is made of sixteen bytes');
  const b = Uint8Array.from(bytes);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
