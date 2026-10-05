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
