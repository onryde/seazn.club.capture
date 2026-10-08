import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const png = readFileSync(new URL('./seazn-qr-logo.png', import.meta.url));

describe('the Seazn QR logo (owner rule: every QR carries the logo)', () => {
  it("is the web repo's file, byte for byte", () => {
    // sha256 of seazn.club apps/web/public/icons/icon-192.png (SEAZN_QR_LOGO_PATH in apps/web/src/lib/seazn-qr.ts),
    // read 2026-10-08 (192 × 192)
    expect(createHash('sha256').update(png).digest('hex')).toBe(
      'f757f37875068e3f6620ce4638797e2baa4ce6ac96030d755ca2ed6f828237d2',
    );
  });

  it('is 192 × 192: square, so the knocked-out square never distorts it', () => {
    // a PNG starts with its 8-byte signature, then the IHDR chunk: width at byte 16, height at byte 20
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    expect([width, height]).toEqual([192, 192]);
  });
});
