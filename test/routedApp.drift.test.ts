import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * `routedApp` composes the app as `app/_layout.tsx`'s Shell does, by hand, and
 * no test renders the layout itself (Expo Router). The shell's own hooks are
 * a seam: one mounted in the layout and not here (or the reverse) is tested
 * nowhere, or shipped untested. Task 30 added `useEngineSync` to both.
 */
const SHELL_HOOKS = ['useReopenGate(', 'useEngineFollow()', 'useEngineSync()', 'useProtectCode()'];

const root = join(__dirname, '..');

/**
 * The body of the named function, up to the next top-level `function`, with
 * its comments gone (review C5 m-6): a hook commented out is not mounted. The
 * compiler's own printer drops them, so a `//` inside a string is left alone.
 */
function bodyOf(source: string, name: string): string {
  const file = ts.createSourceFile(
    'shell.tsx',
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TSX,
  );
  const text = ts.createPrinter({ removeComments: true }).printFile(file);
  const start = text.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`no function ${name}`);
  const end = text.indexOf('\nfunction ', start + 1);
  return text.slice(start, end === -1 ? undefined : end);
}
const body = (file: string, name: string) => bodyOf(readFileSync(join(root, file), 'utf8'), name);

describe('the test shell matches the app shell', () => {
  const shell = body('app/_layout.tsx', 'Shell');
  const routed = body('test/routedApp.tsx', 'RoutedApp');

  it('checks four shell hooks (PV12: zero is a failure)', () => {
    expect(SHELL_HOOKS).toHaveLength(4);
  });

  it('does not count a hook that is only in a comment', () => {
    const source = [
      'function Shell() {',
      '  // useEngineSync();',
      '  /* useProtectCode(); */',
      "  const url = 'https://x//useEngineFollow()';",
      '  useReopenGate(ports);',
      '}',
      'function Other() {',
      '  useEngineSync();',
      '}',
    ].join('\n');
    const shell = bodyOf(source, 'Shell');
    expect(SHELL_HOOKS.map((hook) => shell.includes(hook))).toEqual([true, true, false, false]);
  });

  it.each(SHELL_HOOKS)('mounts %s in both', (hook) => {
    expect({ layout: shell.includes(hook), routed: routed.includes(hook) }).toEqual({
      layout: true,
      routed: true,
    });
  });
});

/**
 * Live Stream's layout (`app/stream/_layout.tsx`) is rendered by no test either: `RoutedApp` mounts the stream screens
 * without it. Its keep-awake and its `TouchWake` (the idle dim's touch, D2 §4.5) are pinned here, or unwrapping the
 * stack would ship a dim that no touch wakes, with every test green (B5 review m1).
 */
const WRAPS_STACK = /<TouchWake>[\s\S]*<Stack\b[\s\S]*<\/TouchWake>/;

describe('the stream layout keeps the screen on and hears every touch', () => {
  const layout = body('app/stream/_layout.tsx', 'StreamLayout');

  it('mounts useKeepAwake()', () => {
    expect(layout.includes('useKeepAwake()')).toBe(true);
  });

  it('wraps its Stack in TouchWake', () => {
    expect(WRAPS_STACK.test(layout)).toBe(true);
  });

  // The beside samples are a whole TouchWake, opened and closed, next to the Stack: a self-closing one would fail at the
  // first token, so a looser rule (`<TouchWake>` alone, or any TouchWake pair) would still pass here (B5 re-review N1).
  // One sits before the Stack and one after it, so a rule that drops either end of the wrap fails one of them (B6
  // review M7: `<Stack ... </TouchWake>` alone passed the first).
  it('does not count a TouchWake beside the Stack, before or after it, or one only in a comment', () => {
    const beside = bodyOf(
      [
        'function StreamLayout() {',
        '  return (<>',
        '    <TouchWake>{null}</TouchWake>',
        '    <Stack />',
        '  </>);',
        '}',
      ].join('\n'),
      'StreamLayout',
    );
    const after = bodyOf(
      [
        'function StreamLayout() {',
        '  return (<>',
        '    <Stack />',
        '    <TouchWake>{null}</TouchWake>',
        '  </>);',
        '}',
      ].join('\n'),
      'StreamLayout',
    );
    const commented = bodyOf(
      [
        'function StreamLayout() {',
        '  // return <TouchWake><Stack /></TouchWake>;',
        '  return <Stack />;',
        '}',
      ].join('\n'),
      'StreamLayout',
    );
    expect([
      WRAPS_STACK.test(beside),
      WRAPS_STACK.test(after),
      WRAPS_STACK.test(commented),
    ]).toEqual([false, false, false]);
  });
});

/**
 * The dim is Live Stream's alone (spec §6, question 4; final review m1): a paired phone that goes Home must not dim
 * there, where keep-awake is off. The test above pins that the stream layout mounts it; this pins that nothing else
 * does. In the shipped files of `app/` and `src/` (from `git ls-files`, so a mode layout S2 or S4 adds is covered the
 * day it is committed; tests mount the dim on purpose and are left out), `<TouchWake` is written only by the stream
 * layout, and `useIdleDim(` only by TouchWake, which calls it, and by its own file, which declares it.
 */
function shippedFilesWith(pattern: RegExp): string[] {
  return execFileSync('git', ['ls-files', '--', 'app', 'src'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((file) => /\.tsx?$/.test(file) && !/\.test(-d)?\.tsx?$/.test(file))
    .filter((file) => pattern.test(readFileSync(join(root, file), 'utf8')));
}

describe('the idle dim is mounted by Live Stream only', () => {
  it('reads the shipped tree, not a hand list (anti-vacuity: the layouts and TouchWake are in it)', () => {
    const layouts = shippedFilesWith(/\bexport default function \w*Layout\b/);
    expect(layouts).toEqual(expect.arrayContaining(['app/_layout.tsx', 'app/stream/_layout.tsx']));
    expect(shippedFilesWith(/\bexport function TouchWake\b/)).toEqual([
      'src/ui/components/TouchWake.tsx',
    ]);
  });

  it('draws <TouchWake> in the stream layout and nowhere else', () => {
    expect(shippedFilesWith(/<TouchWake\b/)).toEqual(['app/stream/_layout.tsx']);
  });

  it('calls useIdleDim() from TouchWake and nowhere else', () => {
    expect(shippedFilesWith(/\buseIdleDim\(/)).toEqual([
      'src/hooks/useIdleDim.ts',
      'src/ui/components/TouchWake.tsx',
    ]);
  });
});

/**
 * M3 of the Batch 5 review: `routedApp` maps each route to its screen by hand, so the route files Expo Router reads
 * are rendered by no test. Every path the navigation port moves to has its file (a renamed file is "Unmatched
 * route" on the phone), and each Settings route renders its own variant: Home's `from="home"` (no Diagnostics, Back
 * to Home), Live Stream's the default.
 */
const PATHS_OF = /const PATH\b[^=]*=\s*\{([^}]*)\}/;

function routeFile(path: string): string {
  const base = path === '/' ? 'app/index' : `app${path}`;
  const candidates = [`${base}.tsx`, `${base}/index.tsx`];
  return (
    candidates.find((file) => existsSync(join(root, file))) ?? `missing: ${candidates.join(' or ')}`
  );
}

describe('every path the navigation moves to has its route file, and each Settings route its variant', () => {
  const navigation = readFileSync(
    join(root, 'src/services/native/expoRouterNavigation.ts'),
    'utf8',
  );
  const paths = [...(PATHS_OF.exec(navigation)?.[1] ?? '').matchAll(/'(\/[^']*)'/g)].map(
    (match) => match[1] ?? '',
  );

  it('reads four paths from the port (anti-vacuity)', () => {
    expect(paths).toEqual(['/', '/stream', '/stream/settings', '/stream-settings']);
  });

  it('finds a file for each', () => {
    expect(paths.map(routeFile)).toEqual([
      'app/index.tsx',
      'app/stream/index.tsx',
      'app/stream/settings.tsx',
      'app/stream-settings.tsx',
    ]);
  });

  it('renders Stream Settings from Home as the Home variant, and Live Stream’s as the default', () => {
    expect(body('app/stream-settings.tsx', 'HomeStreamSettingsRoute')).toMatch(
      /return <SettingsScreen from="home" ?\/>;/,
    );
    expect(body('app/stream/settings.tsx', 'StreamSettingsRoute')).toMatch(
      /return <SettingsScreen ?\/>;/,
    );
  });
});
