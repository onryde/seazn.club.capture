import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Advance widths read from the font files the app ships (node_modules/@expo-google-fonts), so a fit
 * test measures text from the font and never from the strings it is judging. Node only (the `domain`
 * project). A TrueType reader just big enough for this: `head.unitsPerEm`, `hhea.numberOfHMetrics`,
 * `hmtx` and a `cmap` of format 4 or 12.
 */
export type FontFile = 'geist-mono-400' | 'geist-500' | 'barlow-condensed-600';

const PATH: Readonly<Record<FontFile, string>> = {
  'geist-mono-400': '@expo-google-fonts/geist-mono/400Regular/GeistMono_400Regular.ttf',
  'geist-500': '@expo-google-fonts/geist/500Medium/Geist_500Medium.ttf',
  'barlow-condensed-600':
    '@expo-google-fonts/barlow-condensed/600SemiBold/BarlowCondensed_600SemiBold.ttf',
};

export type Font = {
  /** The advance of one code point, in ems (advanceWidth / unitsPerEm); the .notdef advance if unmapped. */
  advance(codePoint: number): number;
  /** Whether the font maps the code point at all. */
  has(codePoint: number): boolean;
  /** The width of a string at a font size, in dp, summing advances (no kerning: monospace has none, and
   * a proportional label is measured without it, which can only over-state a width slightly). */
  width(text: string, fontSize: number): number;
};

const cache = new Map<FontFile, Font>();

export function loadFont(file: FontFile): Font {
  const hit = cache.get(file);
  if (hit !== undefined) return hit;
  const font = parse(readFileSync(join(process.cwd(), 'node_modules', PATH[file])));
  cache.set(file, font);
  return font;
}

function parse(buffer: Buffer): Font {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const tables = new Map<string, number>();
  const count = view.getUint16(4);
  for (let at = 0; at < count; at += 1) {
    const record = 12 + at * 16;
    tables.set(buffer.toString('latin1', record, record + 4), view.getUint32(record + 8));
  }
  const table = (tag: string): number => {
    const offset = tables.get(tag);
    if (offset === undefined) throw new Error(`font has no ${tag} table`);
    return offset;
  };
  const unitsPerEm = view.getUint16(table('head') + 18);
  const hMetrics = view.getUint16(table('hhea') + 34);
  const hmtx = table('hmtx');
  const advanceOfGlyph = (glyph: number): number =>
    view.getUint16(hmtx + 4 * Math.min(glyph, hMetrics - 1)) / unitsPerEm;
  const glyphOf = cmapReader(view, table('cmap'));
  const advance = (codePoint: number): number => advanceOfGlyph(glyphOf(codePoint));
  return {
    advance,
    has: (codePoint) => glyphOf(codePoint) !== 0,
    width: (text, fontSize) =>
      Array.from(text).reduce((sum, char) => sum + advance(char.codePointAt(0) ?? 0), 0) * fontSize,
  };
}

/** A code point to a glyph id, from the first Unicode subtable of format 12 or 4 (0 = missing). */
function cmapReader(view: DataView, cmap: number): (codePoint: number) => number {
  const subtables = view.getUint16(cmap + 2);
  let format4 = -1;
  let format12 = -1;
  for (let at = 0; at < subtables; at += 1) {
    const offset = cmap + view.getUint32(cmap + 4 + at * 8 + 4);
    const format = view.getUint16(offset);
    if (format === 12) format12 = offset;
    if (format === 4 && format4 === -1) format4 = offset;
  }
  if (format12 !== -1) return (codePoint) => format12Glyph(view, format12, codePoint);
  if (format4 !== -1) return (codePoint) => format4Glyph(view, format4, codePoint);
  throw new Error('font has no format 4 or 12 cmap');
}

function format12Glyph(view: DataView, offset: number, codePoint: number): number {
  const groups = view.getUint32(offset + 12);
  for (let at = 0; at < groups; at += 1) {
    const group = offset + 16 + at * 12;
    const start = view.getUint32(group);
    if (codePoint >= start && codePoint <= view.getUint32(group + 4)) {
      return view.getUint32(group + 8) + (codePoint - start);
    }
  }
  return 0;
}

function format4Glyph(view: DataView, offset: number, codePoint: number): number {
  if (codePoint > 0xffff) return 0;
  const segments = view.getUint16(offset + 6) / 2;
  const ends = offset + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const ranges = deltas + segments * 2;
  for (let at = 0; at < segments; at += 1) {
    if (codePoint > view.getUint16(ends + at * 2)) continue;
    const start = view.getUint16(starts + at * 2);
    if (codePoint < start) return 0;
    const range = view.getUint16(ranges + at * 2);
    if (range === 0) return (codePoint + view.getInt16(deltas + at * 2)) & 0xffff;
    const glyph = view.getUint16(ranges + at * 2 + range + (codePoint - start) * 2);
    return glyph === 0 ? 0 : (glyph + view.getInt16(deltas + at * 2)) & 0xffff;
  }
  return 0;
}
