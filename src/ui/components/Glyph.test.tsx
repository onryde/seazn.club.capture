import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type * as GlyphModule from '@/ui/components/Glyph';
import { colour } from '@/ui/theme/tokens';

// react-native-svg's real source does not load under react-native-web in jsdom (Flow `typeof`
// imports), which is why ModeIcon is stubbed too. Its four elements become the SVG elements they
// stand for, so what Glyph draws, and in what colour, can be read.
vi.mock('react-native-svg', async () => {
  const { createElement } = await import('react');
  const element = (tag: string) => (props: object) => createElement(tag, props);
  return {
    default: element('svg'),
    Path: element('path'),
    Circle: element('circle'),
    Rect: element('rect'),
  };
});

// setup-ui.ts replaces Glyph with a marker for every other suite; this one is of the drawing itself.
const actual: typeof GlyphModule = await vi.importActual('@/ui/components/Glyph');
const { Glyph, GLYPH_NAMES } = actual;

/** What each glyph draws, as the canvas has it (version 23): its path data, then its circles and rect. */
const DRAWN = [
  ['camera', ['M3 8h3l2-3h8l2 3h3v11H3z'], ['12,13,3.5'], 0],
  ['mic', ['M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8'], [], 1],
  [
    'network',
    ['M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0'],
    ['12,19.5,1'],
    0,
  ],
  [
    'settings',
    ['M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0'],
    ['16,6,2', '10,12,2', '18,18,2'],
    0,
  ],
  ['home', ['M3 11l9-7 9 7M5 10v10h14V10M10 20v-5h4v5'], [], 0],
  // the shutter is the plan's drawing (D9), not the canvas's
  ['shutter', [], ['12,12,9', '12,12,4'], 0],
  // the plan's drawing (D9 of PR B's convention), not the canvas's
  [
    'qr',
    ['M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM19 14h2M14 19h2M18 18h3v3h-3z'],
    [],
    0,
  ],
  // the owner's Settings board (2026-10-08), measured: a chevron-left in the others' stroke
  ['back', ['M15 5l-7 7 7 7'], [], 0],
  // the board's heartbeat: flat, a short rise, a long fall past the line, back to it and flat; 20 x 16 units
  // is 15 x 12 dp at the 18 dp the board draws it at (measured 15.3 x 12.5)
  ['pulse', ['M2 12h5l2.5-8 4 16 2.5-8h6'], [], 0],
] as const;
/** The camera's not-ready slash (spec §3). */
const SLASH = 'M3 3l18 18';
let drawn = 0;

const paths = (root: Element) => [...root.querySelectorAll('path')].map((p) => p.getAttribute('d'));
const circles = (root: Element) =>
  [...root.querySelectorAll('circle')].map((c) =>
    ['cx', 'cy', 'r'].map((name) => c.getAttribute(name)).join(','),
  );

describe('Glyph draws the canvas’s line icons (spec §3)', () => {
  it.each(DRAWN)('%s: its path, its circles and its rect, plain', (name, d, rings, rects) => {
    const view = render(<Glyph name={name} tone="ink" />);
    expect(paths(view.container)).toEqual(d);
    expect(circles(view.container)).toEqual(rings);
    expect(view.container.querySelectorAll('rect')).toHaveLength(rects);
    drawn += 1;
  });

  it('drew all nine glyphs (anti-vacuity)', () => {
    expect(DRAWN).toHaveLength(9);
    expect(drawn).toBe(9);
  });

  // Every glyph the module declares is drawn above, and the table above holds no glyph the module does not declare:
  // a tenth glyph added to the module without a row here fails this, instead of being drawn by nothing that checks it.
  it('declares exactly the glyphs this suite draws', () => {
    expect(GLYPH_NAMES).toHaveLength(9);
    expect([...GLYPH_NAMES].sort()).toEqual(DRAWN.map(([name]) => name as string).sort());
  });

  // It used to fall through to the pulse for any name it did not know, so a mistyped name drew a heartbeat.
  it('refuses a name it has no drawing for, by name, and draws nothing', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() => render(<Glyph name={'nope' as never} tone="ink" />)).toThrow(/Glyph.*nope/);
    } finally {
      errors.mockRestore();
    }
  });

  it('draws the mic’s capsule as the canvas has it: 9, 3, 6 wide, 11 tall, corners of 3', () => {
    const view = render(<Glyph name="mic" tone="ink" />);
    const rect = view.container.querySelector('rect') as Element;
    expect(['x', 'y', 'width', 'height', 'rx'].map((name) => rect.getAttribute(name))).toEqual([
      '9',
      '3',
      '6',
      '11',
      '3',
    ]);
  });

  it('is a 24-unit line drawing at 22 dp, stroke 1.8, no fill (the canvas)', () => {
    const view = render(<Glyph name="home" tone="ink" />);
    const svg = view.container.querySelector('svg') as Element;
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect([svg.getAttribute('width'), svg.getAttribute('height')]).toEqual(['22', '22']);
    expect(svg.getAttribute('fill')).toBe('none');
    expect(svg.getAttribute('stroke-width')).toBe('1.8');
  });

  it.each([
    ['ink', colour.ink],
    ['ink2', colour.ink2],
    ['lime', colour.lime],
  ] as const)('strokes in the %s tone’s colour', (tone, stroke) => {
    const view = render(<Glyph name="camera" tone={tone} />);
    expect(view.container.querySelector('svg')?.getAttribute('stroke')).toBe(stroke);
  });

  it('draws the three tones in three colours (anti-vacuity)', () => {
    expect(new Set([colour.ink, colour.ink2, colour.lime]).size).toBe(3);
  });

  // The board's Diagnostics heading draws its pulse at 18 dp (a 15 dp-wide line, the path's 20 units at 0.75 dp),
  // where the chips and the icon row draw 22.
  it('draws at the size it is asked, 18 for the pulse, over the same 24-unit box', () => {
    const view = render(<Glyph name="pulse" tone="lime" size={18} />);
    const svg = view.container.querySelector('svg') as Element;
    expect([svg.getAttribute('width'), svg.getAttribute('height')]).toEqual(['18', '18']);
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('stroke')).toBe(colour.lime);
  });

  it('is still 22 dp when no size is asked (the chips and the icon row)', () => {
    const view = render(<Glyph name="pulse" tone="lime" />);
    const svg = view.container.querySelector('svg') as Element;
    expect([svg.getAttribute('width'), svg.getAttribute('height')]).toEqual(['22', '22']);
  });

  it('slashes the camera when asked, and draws the same camera under the slash', () => {
    const plain = render(<Glyph name="camera" tone="ink" />);
    const plainPaths = paths(plain.container);
    plain.unmount();
    const slashed = render(<Glyph name="camera" slashed tone="ink" />);
    expect(paths(slashed.container)).toEqual([...plainPaths, SLASH]);
    expect(plainPaths).not.toContain(SLASH);
  });

  it.each(DRAWN.filter(([name]) => name !== 'camera'))(
    '%s has no slashed form: asked for one, it draws as it does plain',
    (name, d) => {
      const view = render(<Glyph name={name} slashed tone="ink" />);
      expect(paths(view.container)).toEqual(d);
    },
  );
});
