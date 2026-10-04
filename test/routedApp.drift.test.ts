import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `routedApp` composes the app as `app/_layout.tsx`'s Shell does, by hand, and
 * no test renders the layout itself (Expo Router). The shell's own hooks are
 * a seam: one mounted in the layout and not here (or the reverse) is tested
 * nowhere, or shipped untested. Task 30 added `useEngineSync` to both.
 */
const SHELL_HOOKS = ['useReopenGate(', 'useEngineFollow()', 'useEngineSync()', 'useProtectCode()'];

const root = join(__dirname, '..');
/** The body of the named function, up to the next top-level `function`. */
function body(file: string, name: string): string {
  const text = readFileSync(join(root, file), 'utf8');
  const start = text.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${file} has no function ${name}`);
  const end = text.indexOf('\nfunction ', start + 1);
  return text.slice(start, end === -1 ? undefined : end);
}

describe('the test shell matches the app shell', () => {
  const shell = body('app/_layout.tsx', 'Shell');
  const routed = body('test/routedApp.tsx', 'RoutedApp');

  it('checks four shell hooks (PV12: zero is a failure)', () => {
    expect(SHELL_HOOKS).toHaveLength(4);
  });

  it.each(SHELL_HOOKS)('mounts %s in both', (hook) => {
    expect({ layout: shell.includes(hook), routed: routed.includes(hook) }).toEqual({
      layout: true,
      routed: true,
    });
  });
});
