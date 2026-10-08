import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import {
  SEAZN_QR_ERROR_CORRECTION,
  SEAZN_QR_ICON_FRACTION,
  SEAZN_QR_ICON_PAD_MODULES,
  SEAZN_QR_QUIET_MODULES,
  seaznQrPlan,
  type SeaznQrPlan,
} from '@/domain/qr/seaznQr';

// ISO/IEC 18004: byte-mode capacity at error correction H, versions 1 to 10.
const H_BYTES = [7, 14, 24, 34, 44, 58, 64, 84, 98, 119];
const versionFor = (bytes: number) => H_BYTES.findIndex((capacity) => capacity >= bytes) + 1;

/** Made up: the contract's shape on each host. */
const SECRET = 'dl_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE';
const URLS = [
  `https://stg.seazn.club/score/${SECRET}`,
  `https://seazn.club/score/${SECRET}`,
] as const;

const Q = SEAZN_QR_QUIET_MODULES;
const RUN = /M(\d+) (\d+)h(\d+)v1h-(\d+)z/g;

/**
 * The modules the PAINTED string covers, read back from `plan.path` alone: each `M x y h w v1 h-w z` is one run of
 * `w` modules in row `y - Q` from column `x - Q`. Throws unless the string is made of those runs and nothing else,
 * so a path the parser cannot read is a failure and not an empty set.
 */
function paintedModules(plan: SeaznQrPlan): Set<string> {
  const runs = [...plan.path.matchAll(RUN)];
  if (runs.map((run) => run[0]).join('') !== plan.path)
    throw new Error('the painted path holds more than runs');
  const covered = new Set<string>();
  for (const [, x, y, width, back] of runs) {
    if (width !== back) throw new Error('a run that does not close on itself');
    for (let column = 0; column < Number(width); column++)
      covered.add(`${Number(y) - Q},${Number(x) - Q + column}`);
  }
  return covered;
}

/** Rasterise the painted path to RGBA at [scale] px per module, the logo's knock-out filled by [fill]. */
function raster(plan: SeaznQrPlan, scale: number, fill: (row: number, column: number) => boolean) {
  const covered = paintedModules(plan);
  const side = plan.total * scale;
  const pixels = new Uint8ClampedArray(side * side * 4).fill(255);
  let black = 0;
  for (let row = 0; row < plan.modules; row++) {
    for (let column = 0; column < plan.modules; column++) {
      const isBlack = plan.knocked(row, column)
        ? fill(row, column)
        : covered.has(`${row},${column}`);
      if (!isBlack) continue;
      black += 1;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const at = (((row + Q) * scale + y) * side + (column + Q) * scale + x) * 4;
          pixels[at] = pixels[at + 1] = pixels[at + 2] = 0;
        }
      }
    }
  }
  return { pixels, side, black };
}

describe('the Seazn QR (owner rule: every QR carries the logo, at error correction H)', () => {
  it.each(URLS)('%s is at the version error correction H needs, not the one M would', (url) => {
    const plan = seaznQrPlan(url);
    expect(SEAZN_QR_ERROR_CORRECTION).toBe('H');
    expect(plan.version).toBe(versionFor(new TextEncoder().encode(url).length));
    expect(plan.version).toBe(8); // 71 and 75 bytes
    expect(plan.modules).toBe(4 * plan.version + 17);
    expect(plan.total).toBe(plan.modules + 2 * SEAZN_QR_QUIET_MODULES);
    expect(plan.total).toBe(57); // 49 + 2 × 4: the number Task 8's whole-module size (3 × 57 = 171) divides
  });

  it('the logo square is centred, odd, holds the icon and its pad, and covers well under H’s 30%', () => {
    const plan = seaznQrPlan(URLS[0]);
    const n = plan.modules;
    const icon = n * SEAZN_QR_ICON_FRACTION;
    let knocked = 0;
    let edge = 0;
    for (let row = 0; row < n; row++)
      for (let column = 0; column < n; column++) if (plan.knocked(row, column)) knocked += 1;
    for (let column = 0; column < n; column++)
      if (plan.knocked(Math.floor(n / 2), column)) edge += 1;
    expect(edge % 2).toBe(1);
    expect(edge).toBeGreaterThanOrEqual(Math.ceil(icon + 2 * SEAZN_QR_ICON_PAD_MODULES));
    expect(edge * edge).toBe(knocked);
    expect(knocked / (n * n)).toBeLessThan(0.3);
    expect(plan.logo.size).toBeCloseTo(icon, 5);
    expect(plan.logo.x + plan.logo.size / 2).toBeCloseTo(plan.total / 2, 5);

    // and the knocked-out square is where the icon is drawn: symmetric in the symbol, the icon plus its pad inside it
    const rows = [...Array(n).keys()].filter((row) => plan.knocked(row, Math.floor(n / 2)));
    const columns = [...Array(n).keys()].filter((column) =>
      plan.knocked(Math.floor(n / 2), column),
    );
    for (const span of [rows, columns]) {
      expect(span).toHaveLength(edge);
      expect(span[0] + span[span.length - 1]).toBe(n - 1);
      const iconStart = plan.logo.x - SEAZN_QR_QUIET_MODULES; // the icon's first module, in symbol units
      expect(iconStart - span[0]).toBeGreaterThanOrEqual(SEAZN_QR_ICON_PAD_MODULES);
      expect(span[span.length - 1] + 1 - (iconStart + plan.logo.size)).toBeGreaterThanOrEqual(
        SEAZN_QR_ICON_PAD_MODULES,
      );
    }
  });

  // F9: the string the component paints IS the closures it was built from, module for module.
  it.each(URLS)(
    '%s: the painted path covers exactly the closures’ dark modules, and none under the logo',
    (url) => {
      const plan = seaznQrPlan(url);
      const covered = paintedModules(plan);
      const expected = new Set<string>();
      let underLogo = 0;
      for (let row = 0; row < plan.modules; row++) {
        for (let column = 0; column < plan.modules; column++) {
          if (plan.dark(row, column)) expected.add(`${row},${column}`);
          if (plan.knocked(row, column) && covered.has(`${row},${column}`)) underLogo += 1;
        }
      }
      expect(expected.size).toBeGreaterThan(plan.modules * 10); // anti-vacuity: a real symbol has hundreds of dark modules
      expect([...covered].sort()).toEqual([...expected].sort());
      expect(underLogo).toBe(0);
    },
  );

  const FILLS = [
    ['white', () => false],
    ['black', () => true],
    ['a checkerboard', (row: number, column: number) => (row + column) % 2 === 0],
  ] as const;
  const CASES = URLS.flatMap((url) => FILLS.map(([why, fill]) => [url, why, fill] as const));
  let decoded = 0;

  it.each(CASES)('%s decodes, from the painted path, with the logo area %s', (url, _why, fill) => {
    const plan = seaznQrPlan(url);
    const { pixels, side, black } = raster(plan, 4, fill);
    expect(black).toBeGreaterThan(0);
    expect(jsQR(pixels, side, side)?.data).toBe(url);
    decoded += 1;
  });

  // anti-vacuity: the table has 6 rows AND all 6 ran to a successful decode (this test runs after them, in file order)
  it('swept 6 decodes', () => {
    expect(CASES).toHaveLength(6);
    expect(decoded).toBe(6);
  });

  // The decoder is no yes-machine: with the painted modules removed, nothing decodes.
  it('a symbol with no painted path decodes to nothing', () => {
    const plan = { ...seaznQrPlan(URLS[0]), path: '' };
    const { pixels, side } = raster(plan, 4, () => false);
    expect(jsQR(pixels, side, side)).toBeNull();
  });
});
