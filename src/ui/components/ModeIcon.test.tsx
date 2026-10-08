import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type * as ModeIconModule from '@/ui/components/ModeIcon';
import { MODES } from '@/ui/modeCopy';

// react-native-svg's real source does not load under react-native-web in jsdom (see Glyph.test.tsx), so its
// elements become the SVG elements they stand for, and the size the icon is drawn at can be read.
vi.mock('react-native-svg', async () => {
  const { createElement } = await import('react');
  const element = (tag: string) => (props: object) => createElement(tag, props);
  return { default: element('svg'), Path: element('path'), Rect: element('rect') };
});

// setup-ui.ts replaces ModeIcon with null for every other suite; this one is of the drawing itself.
const actual: typeof ModeIconModule = await vi.importActual('@/ui/components/ModeIcon');
const { ModeIcon } = actual;

describe('ModeIcon is drawn 28 square, which the tile fit adds up (homeFit.test.ts, fix round 1)', () => {
  let drawn = 0;

  it.each(MODES)('%s: 28 wide and 28 high, lit and dim', (mode) => {
    for (const dim of [false, true]) {
      const { container } = render(<ModeIcon mode={mode} dim={dim} />);
      const svg = container.querySelector('svg');
      expect(svg).not.toBeNull();
      expect([svg?.getAttribute('width'), svg?.getAttribute('height')]).toEqual(['28', '28']);
      drawn += 1;
    }
  });

  it('drew every mode, lit and dim (anti-vacuity)', () => {
    expect(MODES).toHaveLength(3);
    expect(drawn).toBe(MODES.length * 2);
  });
});
