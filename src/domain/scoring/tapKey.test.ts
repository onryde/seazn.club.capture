import { describe, expect, it } from 'vitest';
import { uuidV4 } from '@/domain/scoring/tapKey';

// A tap's idempotency key (plan S2-1 Global Constraints): a v4 UUID, made at tap time. The bytes are the caller's.
describe('uuidV4', () => {
  it('writes sixteen zero bytes as the v4 shape, version and variant set', () => {
    expect(uuidV4(new Uint8Array(16))).toBe('00000000-0000-4000-8000-000000000000');
  });

  it('writes sixteen 0xff bytes with the version and variant bits forced', () => {
    expect(uuidV4(new Uint8Array(16).fill(0xff))).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  });

  it('writes each byte as two lowercase hex digits in order', () => {
    const bytes = Uint8Array.from([
      0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0x10, 0x32, 0x54, 0x76, 0x98, 0xba, 0xdc,
      0xfe,
    ]);
    expect(uuidV4(bytes)).toBe('01234567-89ab-4def-9032-547698badcfe');
  });

  it('refuses bytes that are not sixteen, rather than making a key of the wrong shape', () => {
    expect(() => uuidV4(new Uint8Array(15))).toThrow();
    expect(() => uuidV4(new Uint8Array(17))).toThrow();
  });
});
