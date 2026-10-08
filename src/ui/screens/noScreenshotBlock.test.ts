import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * D9, the owner's rule: the Remote scoring code has no screenshot block. The app adds no screen-capture lock of any
 * kind: no package, no window flag, no call. The other half of the rule is the operator's (Task 11): nobody
 * screenshots a code.
 *
 * The needles are built from parts, or this file would name them and fail itself.
 */
const NEEDLES = [
  ['expo', 'screen', 'capture'].join('-'),
  ['FLAG', 'SECURE'].join('_'),
  ['prevent', 'ScreenCapture'].join(''),
  ['set', 'Secure'].join(''),
] as const;

/** The needles a text names. One matcher for the files and for the positive control. */
const named = (text: string): string[] => NEEDLES.filter((needle) => text.includes(needle));

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TREES = ['src', 'app', 'modules'] as const;
const EXTENSIONS = ['.ts', '.tsx', '.kt', '.java', '.xml'] as const;
const SKIPPED = new Set(['build', 'node_modules']);
/**
 * The scan must have read a real tree: the number of files it found, rounded down to the nearest 50 (measured once, at
 * 575 on the day this was written; the Kotlin core alone is dozens of files, so a scan that finds none is a failure).
 */
const SCANNED_AT_LEAST = 550;

/** Every source file under the trees, less build output and installed packages. */
function sources(): string[] {
  const found: string[] = [];
  for (const tree of TREES) {
    for (const entry of readdirSync(`${ROOT}${tree}`, { recursive: true })) {
      const path = String(entry);
      if (path.split(/[\\/]/).some((segment) => SKIPPED.has(segment))) continue;
      if (EXTENSIONS.some((extension) => path.endsWith(extension))) found.push(`${tree}/${path}`);
    }
  }
  return found;
}

describe('no screenshot block (D9)', () => {
  it('no source file names a screen-capture lock', () => {
    const files = sources();
    const offenders = files.filter(
      (file) => named(readFileSync(`${ROOT}${file}`, 'utf8')).length > 0,
    );
    expect(offenders).toEqual([]);
    // Anti-vacuity: the scan read a real tree.
    expect(files.length).toBeGreaterThanOrEqual(SCANNED_AT_LEAST);
  });

  it('package.json depends on no screen-capture package', () => {
    const manifest = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const keys = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ];
    expect(keys.length).toBeGreaterThan(20); // anti-vacuity: a real manifest
    expect(keys.filter((key) => named(key).length > 0)).toEqual([]);
  });

  it('the matcher is not dead: it finds each needle, and a window flag built the same way', () => {
    for (const needle of NEEDLES) expect(named(`before ${needle} after`)).toEqual([needle]);
    expect(NEEDLES).toHaveLength(4);
    // A string built the same way as the needle, in the case the window flag is written.
    const flag = ['Flag', 'Secure'].join('_').toUpperCase();
    expect(named(`window.setFlags(${flag})`)).toEqual([['FLAG', 'SECURE'].join('_')]);
    expect(named('window.setFlags(FLAG_KEEP_SCREEN_ON)')).toEqual([]);
  });
});
