import { describe, expect, it } from 'vitest';
import { tileTitleRole } from '@/ui/theme/tileTitle';
import { layout, space } from '@/ui/theme/tokens';

// N31, fix round 1 (the controller's ruling, 2026-10-12): a tile's title steps down one size where its room beside the
// icon is narrower than the widest word of any title. The rule reads the title row's laid-out width; the room is that
// less the 28 icon and the 8 gap. homeFit.test.ts measures the titles at each size; this is the rule's arithmetic.
describe('tileTitleRole', () => {
  /** The title row's width that leaves the title this much room. */
  const headFor = (room: number) => room + layout.modeIcon + space.sm;

  it('is `title` before the row is measured', () => {
    expect(tileTitleRole(null)).toBe('title');
  });

  it('is `title` at exactly the room the widest word needs, and `action` a hundredth below it', () => {
    expect(tileTitleRole(headFor(layout.tileTitleRoom))).toBe('title');
    expect(tileTitleRole(headFor(layout.tileTitleRoom - 0.01))).toBe('action');
  });

  // Home's laid-out width sideways → the title row: a third of it less the 16 pads, the two 8 gaps, the 4 edge and the
  // 12 padding a side. Upright, the row is the window less 2 × 16, the edge and 2 × 16.
  it.each([
    ['592 sideways (a 640 dp phone behind its navigation bar)', 153.33, 'action'],
    ['640 sideways', 169.33, 'title'],
    ['728 sideways (the owner’s phone behind its insets)', 198.67, 'title'],
    ['360 upright', 292, 'title'],
  ] as const)('%s: a %f dp row sets the title at `%s`', (_, head, role) => {
    expect(tileTitleRole(head)).toBe(role);
  });

  it('a second measurement replaces the first: wider again is `title` again', () => {
    expect([153.33, 169.33, 153.33].map(tileTitleRole)).toEqual(['action', 'title', 'action']);
  });
});
