import { describe, expect, it } from 'vitest';
import { screenLayout, type ScreenLayout } from '@/domain/mode/homeLayout';

/**
 * Spec §6, §7: the window decides portrait or landscape. Written out: wider
 * than tall is landscape, a square window is portrait, and the 0 × 0 a bare
 * jsdom reports is portrait too (D10), so a test that never sizes the window
 * reads the portrait layout.
 */
const ROWS: readonly (readonly [number, number, ScreenLayout])[] = [
  [390, 844, 'portrait'],
  [844, 390, 'landscape'],
  [640, 360, 'landscape'],
  [500, 500, 'portrait'],
  [0, 0, 'portrait'],
];

describe('screenLayout (spec §6, §7)', () => {
  it('checks five rows (PV12: zero is a failure)', () => {
    expect(ROWS).toHaveLength(5);
  });

  it.each(ROWS)('a %i × %i window is %s', (width, height, layout) => {
    expect(screenLayout(width, height)).toBe(layout);
  });
});
