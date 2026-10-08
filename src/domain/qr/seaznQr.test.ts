import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import {
  SEAZN_QR_ERROR_CORRECTION,
  SEAZN_QR_ICON_FRACTION,
  SEAZN_QR_ICON_PAD_MODULES,
  SEAZN_QR_MIN_VERSION,
  SEAZN_QR_QUIET_MODULES,
  seaznQrPlan,
  type SeaznQrPlan,
} from '@/domain/qr/seaznQr';

/**
 * The web's declared geometry, typed here as literals and NEVER imported from the code under test (a test that reads
 * its expectation from the constant it tests passes under any value of it). Source: apps/web/src/lib/seazn-qr.ts
 * lines 10-13 at 7e75fd4a7 (SEAZN_QR_ERROR_CORRECTION "H", _QUIET_MODULES 4, _ICON_FRACTION 0.22, _ICON_PAD_MODULES 1).
 */
const WEB_QUIET_MODULES = 4;
const WEB_ICON_FRACTION = 0.22;
const WEB_ICON_PAD_MODULES = 1;

// ISO/IEC 18004: byte-mode capacity at error correction H, versions 1 to 10.
const H_BYTES = [7, 14, 24, 34, 44, 58, 64, 84, 98, 119];
const versionFor = (bytes: number) => H_BYTES.findIndex((capacity) => capacity >= bytes) + 1;

/** Made up: the contract's shape on each host. */
const SECRET = 'dl_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE';
const URLS = [
  `https://stg.seazn.club/score/${SECRET}`,
  `https://seazn.club/score/${SECRET}`,
] as const;

/** [bytes] ASCII bytes of the made-up secret, repeated: a payload of exactly that many bytes. */
const textOf = (bytes: number) => SECRET.repeat(Math.ceil(bytes / SECRET.length)).slice(0, bytes);
/** The knock-out square's edge: the knocked-out modules along the symbol's middle row. */
const edgeOf = (plan: SeaznQrPlan) => {
  let edge = 0;
  for (let column = 0; column < plan.modules; column++)
    if (plan.knocked(Math.floor(plan.modules / 2), column)) edge += 1;
  return edge;
};

const Q = WEB_QUIET_MODULES;
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
    expect(plan.total).toBe(plan.modules + 2 * WEB_QUIET_MODULES);
    expect(plan.total).toBe(57); // 49 + 2 × 4: the number Task 8's whole-module size (3 × 57 = 171) divides
  });

  it('the exported geometry is the web’s, constant for constant', () => {
    expect(SEAZN_QR_ERROR_CORRECTION).toBe('H');
    expect(SEAZN_QR_QUIET_MODULES).toBe(WEB_QUIET_MODULES);
    expect(SEAZN_QR_ICON_FRACTION).toBe(WEB_ICON_FRACTION);
    expect(SEAZN_QR_ICON_PAD_MODULES).toBe(WEB_ICON_PAD_MODULES);
  });

  it.each(URLS)(
    '%s: the logo square is centred, odd, 13 modules at version 8, holds the icon and its pad, and covers well under H’s 30%',
    (url) => {
      const plan = seaznQrPlan(url);
      const n = plan.modules;
      expect(n).toBe(49); // version 8
      const icon = n * WEB_ICON_FRACTION; // 10.78 modules
      let knocked = 0;
      let edge = 0;
      for (let row = 0; row < n; row++)
        for (let column = 0; column < n; column++) if (plan.knocked(row, column)) knocked += 1;
      for (let column = 0; column < n; column++)
        if (plan.knocked(Math.floor(n / 2), column)) edge += 1;
      // the smallest odd square holding 10.78 + 2 × 1 = 12.78 modules is 13
      expect(edge).toBe(13);
      expect(edge % 2).toBe(1);
      expect(edge).toBeGreaterThanOrEqual(Math.ceil(icon + 2 * WEB_ICON_PAD_MODULES));
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
        const iconStart = plan.logo.x - WEB_QUIET_MODULES; // the icon's first module, in symbol units
        expect(iconStart - span[0]).toBeGreaterThanOrEqual(WEB_ICON_PAD_MODULES);
        expect(span[span.length - 1] + 1 - (iconStart + plan.logo.size)).toBeGreaterThanOrEqual(
          WEB_ICON_PAD_MODULES,
        );
      }
    },
  );

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

  // The versions a scoring URL never reaches. The knock-out square is the smallest ODD number of modules holding
  // the icon (0.22 n) plus a 1-module pad each side (the web's rule); worked by hand, n = 4 v + 17:
  //   v3 n 29: 6.38 + 2 = 8.38 -> 9     v4 n 33: 7.26 + 2 = 9.26 -> 10 is even -> 11
  //   v5 n 37: 8.14 + 2 = 10.14 -> 11   v6 n 41: 9.02 + 2 = 11.02 -> 12 is even -> 13
  //   v7 n 45: 9.90 + 2 = 11.90 -> 12 is even -> 13        v8 n 49: 10.78 + 2 = 12.78 -> 13
  //   v9 n 53: 11.66 + 2 = 13.66 -> 14 is even -> 15       v10 n 57: 12.54 + 2 = 14.54 -> 15
  // so the bump to odd fires at v4, v6, v7 and v9, and nowhere at the production URLs' v8.
  const EDGE_AT = { 3: 9, 4: 11, 5: 11, 6: 13, 7: 13, 8: 13, 9: 15, 10: 15 } as const;
  const SWEEP_FILLS = [
    ...FILLS,
    ['an inverted checkerboard', (row: number, column: number) => (row + column) % 2 === 1],
  ] as const;
  // each version at its smallest and its largest payload (ISO/IEC 18004 byte capacity at H)
  const SWEEP = ([3, 4, 5, 6, 7, 8, 9, 10] as const).flatMap((version) => [
    [version, H_BYTES[version - 2] + 1, EDGE_AT[version]] as const,
    [version, H_BYTES[version - 1], EDGE_AT[version]] as const,
  ]);
  let swept = 0;

  it.each(SWEEP)(
    'version %i at %i bytes: the knock-out is %i modules wide, odd, and the symbol decodes under every fill',
    (version, bytes, edge) => {
      const text = textOf(bytes);
      expect(versionFor(bytes)).toBe(version);
      const plan = seaznQrPlan(text);
      expect(plan.version).toBe(version);
      expect(edgeOf(plan)).toBe(edge);
      expect(edgeOf(plan) % 2).toBe(1);
      for (const [, fill] of SWEEP_FILLS) {
        const { pixels, side } = raster(plan, 4, fill);
        expect(jsQR(pixels, side, side)?.data).toBe(text);
        swept += 1;
      }
    },
  );

  // anti-vacuity: 8 versions × 2 payloads = 16 rows, each decoded under 4 fills
  it('swept 16 payloads and 64 decodes', () => {
    expect(SWEEP).toHaveLength(16);
    expect(swept).toBe(64);
  });

  // The minimum version. Swept with jsqr 1.4.0 over 60 made-up payloads a version at the four fills (a white, a black,
  // a checkerboard and its inverse under the logo, 240 decodes a version): v1 failed 69 and v2 failed 145 of them, v3
  // to v6 failed none. A 7- or 9-module knock-out is too much of a 21- or 25-module symbol, so a short text is drawn
  // at version 3, never at 1 or 2. No scoring URL is that short (they are version 8); this guard is for any other caller.
  const MIN_VERSION = 3;
  const SHORT = [
    ['an empty string', ''],
    ['one byte', 'a'],
    ['the whole of version 1 (7 bytes)', textOf(7)],
    ['the whole of version 2 (14 bytes)', textOf(14)],
  ] as const;
  let shortDecoded = 0;

  it.each(SHORT)(
    '%s is drawn at the minimum version, not at 1 or 2, and decodes under every fill',
    (_why, text) => {
      expect(SEAZN_QR_MIN_VERSION).toBe(MIN_VERSION);
      const plan = seaznQrPlan(text);
      expect(plan.version).toBe(MIN_VERSION);
      expect(plan.modules).toBe(29);
      expect(edgeOf(plan)).toBe(EDGE_AT[MIN_VERSION]);
      for (const [, fill] of SWEEP_FILLS) {
        const { pixels, side } = raster(plan, 4, fill);
        expect(jsQR(pixels, side, side)?.data).toBe(text);
        shortDecoded += 1;
      }
    },
  );

  it('swept 4 short payloads and 16 decodes', () => {
    expect(SHORT).toHaveLength(4);
    expect(shortDecoded).toBe(16);
  });
});
