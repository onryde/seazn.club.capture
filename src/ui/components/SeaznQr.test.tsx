import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { seaznQrPlan } from '@/domain/qr/seaznQr';
import type * as SeaznQrModule from '@/ui/components/SeaznQr';
import logo from '@/ui/assets/seazn-qr-logo.png';
import { colour } from '@/ui/theme/tokens';

// react-native-svg's real source does not load under react-native-web in jsdom (Flow `typeof` imports), so its
// elements become the SVG elements they stand for, as in Glyph.test.tsx. The native-only accessibility props become
// the DOM's own (testID, accessibilityLabel) or are dropped (accessible), so what is drawn can be read.
vi.mock('react-native-svg', async () => {
  const { createElement } = await import('react');
  const element =
    (tag: string) =>
    ({ testID, accessibilityLabel, accessible: _accessible, ...props }: Record<string, unknown>) =>
      createElement(tag, {
        ...props,
        'data-testid': testID,
        'aria-label': accessibilityLabel,
      });
  return {
    default: element('svg'),
    Path: element('path'),
    Rect: element('rect'),
    Image: element('image'),
  };
});

// setup-ui.ts replaces SeaznQr with a marker for every other suite; this one is of the drawing itself.
const actual: typeof SeaznQrModule = await vi.importActual('@/ui/components/SeaznQr');
const { SeaznQr } = actual;

/** Made up: the contract's shape on each host (the same two the plan's decode uses). */
const SECRET = 'dl_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE';
const URLS = [
  `https://stg.seazn.club/score/${SECRET}`,
  `https://seazn.club/score/${SECRET}`,
] as const;
const SIZE = 171; // 3 dp a module on the 57-unit symbol
const LABEL = 'Scoring link';
let checked = 0;

describe('SeaznQr paints a plan (F10: the real drawing, not setup-ui’s marker)', () => {
  it.each(URLS)('%s: one svg, the plan’s viewBox and label, one path that IS plan.path', (url) => {
    const plan = seaznQrPlan(url);
    const { container } = render(<SeaznQr plan={plan} size={SIZE} label={LABEL} />);

    const svgs = container.querySelectorAll('svg');
    expect(svgs).toHaveLength(1);
    const svg = svgs[0];
    expect(svg.getAttribute('width')).toBe(String(SIZE));
    expect(svg.getAttribute('height')).toBe(String(SIZE));
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${plan.total} ${plan.total}`);
    expect(plan.total).toBe(57);
    expect(svg.getAttribute('aria-label')).toBe(LABEL);

    // the string the phone paints is the plan's, the one the plan's tests rasterised and decoded
    const paths = container.querySelectorAll('path');
    expect(paths).toHaveLength(1);
    expect(plan.path.length).toBeGreaterThan(1000);
    expect(paths[0].getAttribute('d')).toBe(plan.path);
    expect(paths[0].getAttribute('fill')).toBe(colour.ground);

    const rects = container.querySelectorAll('rect');
    expect(rects).toHaveLength(1);
    expect(rects[0].getAttribute('fill')).toBe(colour.qrGround);
    expect(rects[0].getAttribute('width')).toBe(String(plan.total));
    expect(rects[0].getAttribute('height')).toBe(String(plan.total));
    expect(colour.qrGround).toMatch(/^#f{6}$/i); // white: a QR is read off a white quiet zone

    const images = container.querySelectorAll('image');
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute('href')).toBe(String(logo));
    expect(String(logo)).toContain('seazn-qr-logo');
    expect(images[0].getAttribute('x')).toBe(String(plan.logo.x));
    expect(images[0].getAttribute('y')).toBe(String(plan.logo.y));
    expect(images[0].getAttribute('width')).toBe(String(plan.logo.size));
    expect(images[0].getAttribute('height')).toBe(String(plan.logo.size));

    // F8: crisp edges come from the whole-module size; crispEdges would only switch antialiasing off
    const all = [...container.querySelectorAll('*')];
    expect(all).toHaveLength(4);
    for (const element of all) {
      expect(element.hasAttribute('shape-rendering')).toBe(false);
      expect(element.hasAttribute('shapeRendering')).toBe(false);
    }
    checked += 1;
  });

  it('a re-render with the other URL’s plan paints the other path: nothing is kept past its plan', () => {
    const [first, second] = URLS.map((url) => seaznQrPlan(url));
    expect(first.path).not.toBe(second.path);
    const view = render(<SeaznQr plan={first} size={SIZE} label={LABEL} />);
    expect(view.container.querySelector('path')?.getAttribute('d')).toBe(first.path);
    view.rerender(<SeaznQr plan={second} size={SIZE} label={LABEL} />);
    expect(view.container.querySelectorAll('path')).toHaveLength(1);
    expect(view.container.querySelector('path')?.getAttribute('d')).toBe(second.path);
  });

  // anti-vacuity: this runs after the table above, in file order
  it('swept 2 plans', () => {
    expect(URLS).toHaveLength(2);
    expect(checked).toBe(2);
  });
});
