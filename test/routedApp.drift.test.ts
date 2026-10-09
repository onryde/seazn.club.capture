import { readFileSync } from 'node:fs';
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
