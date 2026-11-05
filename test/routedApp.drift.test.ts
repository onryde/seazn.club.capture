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
const SHELL_HOOKS = [
  'useReopenGate(',
  'useEngineFollow()',
  'useEngineSync()',
  'useProtectCode()',
  'useScoringBackground()',
];

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

/** A file's code with its comments gone, by the compiler's printer (as `bodyOf`): a hook in a comment is not mounted. */
function codeOf(source: string): string {
  const file = ts.createSourceFile(
    'screen.tsx',
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TSX,
  );
  return ts.createPrinter({ removeComments: true }).printFile(file);
}
const code = (file: string) => codeOf(readFileSync(join(root, file), 'utf8'));

/** `import { A, B } from '@/ui/screens/File'` in a file's code: the screen files it draws through, by name. */
const SCREEN_IMPORT = /import\s*\{([^}]*)\}\s*from\s*['"]@\/ui\/screens\/([A-Za-z]+)['"]/g;
function screensImported(source: string): Map<string, string> {
  const named = new Map<string, string>();
  for (const match of source.matchAll(SCREEN_IMPORT)) {
    for (const name of (match[1] ?? '').split(',')) {
      if (name.trim() !== '')
        named.set(name.trim().replace(/^type\s+/, ''), `src/ui/screens/${match[2]}.tsx`);
    }
  }
  return named;
}

/**
 * Every file a sport draws through, from the screens `scoringScreens.ts` names: the screen, and the screens it imports,
 * followed. The states every sport shares (`ScoringStateScreen`) are the generic ones, pinned on their own.
 */
const GENERIC_SCREENS = ['src/ui/screens/ScoringStateScreen.tsx'];
function sportScreenFiles(): readonly string[] {
  const table = code('src/ui/screens/scoringScreens.ts');
  const imported = screensImported(table);
  const entries = [...table.matchAll(/new Map[^[]*\[([\s\S]*?)\]\);/g)].flatMap((map) =>
    [...(map[1] ?? '').matchAll(/\[[^,\]]+,\s*([A-Za-z]+)\s*\]/g)].map((entry) => entry[1] ?? ''),
  );
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file) || GENERIC_SCREENS.includes(file)) return;
    seen.add(file);
    for (const next of screensImported(code(file)).values()) visit(next);
  };
  for (const name of entries) {
    const file = imported.get(name);
    if (file === undefined) throw new Error(`scoringScreens.ts names ${name} with no import`);
    visit(file);
  }
  return [...seen];
}

describe('the test shell matches the app shell', () => {
  const shell = body('app/_layout.tsx', 'Shell');
  const routed = body('test/routedApp.tsx', 'RoutedApp');

  it('checks five shell hooks (PV12: zero is a failure)', () => {
    expect(SHELL_HOOKS).toHaveLength(5);
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
    expect(SHELL_HOOKS.map((hook) => shell.includes(hook))).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
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
 * route" on the phone), and each Settings route renders its own screen: the app's Settings from Home's gear (no
 * Diagnostics, Back to Home), Live Stream's own (the default of `SettingsScreen`).
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

  it('reads five paths from the port (anti-vacuity)', () => {
    expect(paths).toEqual(['/', '/stream', '/stream/settings', '/settings', '/scoring']);
  });

  it('finds a file for each', () => {
    expect(paths.map(routeFile)).toEqual([
      'app/index.tsx',
      'app/stream/index.tsx',
      'app/stream/settings.tsx',
      'app/settings.tsx',
      'app/scoring/index.tsx',
    ]);
  });

  /**
   * Remote Scoring (plan S2-1 Tasks 10 and 11): `routedApp` renders the route's screens by hand, so the route's own jobs
   * are read here. It shows the saved match, drawn by its sport's own screen, else it goes Home. It holds nothing on:
   * whether the screen stays on is the screens' (owner ruling 9, applied 2026-11-02), pinned below.
   */
  it('shows the saved match, else goes Home through the port, and does not hold the screen on itself', () => {
    const route = body('app/scoring/index.tsx', 'ScoringRoute');
    expect(route).toMatch(
      /if \(fixtureId === null\)\s*navigation\.go\(["']home["']\);[\s\S]*return <ScoringMatchScreen fixtureId=\{fixtureId\} ?\/>;/,
    );
    const source = code('app/scoring/index.tsx');
    expect(source).not.toContain('useScreenAwake');
    // A <Redirect> moves the router behind the port's back, which then believes it is still on /scoring.
    expect(source).not.toContain('Redirect');
  });

  /**
   * The screen is held on by a sport's pad and by the wait before it, and by nothing else: the states that need a person to
   * act let it sleep. A sport's pad mounts one `KeepScreenOn`, behind `holdsScreen(card)` so the cards that end the scorer's
   * part (view only, a dead link) let it go (the controller's ruling, 2026-11-02). Which files are a sport's is read from
   * the route's table (`scoringScreens.ts`), so a second sport's pad is held to it without this test being edited.
   */
  it('reads the sport screens from the route’s table (anti-vacuity)', () => {
    expect(sportScreenFiles()).toEqual([
      'src/ui/screens/BadmintonMatchScreen.tsx',
      'src/ui/screens/BadmintonPadScreen.tsx',
      'src/ui/screens/TableTennisMatchScreen.tsx',
      'src/ui/screens/TableTennisPadScreen.tsx',
      'src/ui/screens/ChessMatchScreen.tsx',
      'src/ui/screens/ChessPadScreen.tsx',
      // The tie-break sheet's steps (S2-3b): a sport's screen file that is no pad, so it must not mount KeepScreenOn.
      'src/ui/screens/ChessTiebreakView.tsx',
    ]);
  });

  /**
   * A pad is a sport screen that draws a `PadView` (it imports `padView`, whose `card` is what `holdsScreen` reads); the
   * file that only picks between a pad and the shared states does not. Each pad mounts exactly one `KeepScreenOn`, behind
   * `holdsScreen(view.card)`: a pad that holds the screen under a terminal card, or reads another card than its own, fails.
   * No file is filtered out for already mounting it, and none is named.
   */
  const PADVIEW_IMPORT = /from\s*['"]@\/domain\/scoring\/padView['"]/;
  const isPad = (file: string) => PADVIEW_IMPORT.test(code(file));

  it('finds the pads among the sport screens, and a picker that is none (anti-vacuity)', () => {
    const files = sportScreenFiles();
    expect(files.filter(isPad).length).toBeGreaterThan(0);
    expect(files.filter((file) => !isPad(file)).length).toBeGreaterThan(0);
  });

  it('mounts KeepScreenOn once in every pad, behind holdsScreen(view.card)', () => {
    const pads = sportScreenFiles().filter(isPad);
    expect(pads.length).toBeGreaterThan(0);
    for (const file of pads) {
      const source = code(file);
      expect(source.match(/<KeepScreenOn\b/g), file).toHaveLength(1);
      expect(
        source.match(/\{holdsScreen\(view\.card\) \? <KeepScreenOn \/> : null\}/g),
        file,
      ).toHaveLength(1);
    }
  });

  it('mounts it nowhere else in a sport’s screens: the picker between a pad and the states holds nothing', () => {
    for (const file of sportScreenFiles().filter((one) => !isPad(one)))
      expect(code(file), file).not.toContain('KeepScreenOn');
  });

  it('mounts KeepScreenOn in the state screen only while loading', () => {
    const states = code('src/ui/screens/ScoringStateScreen.tsx');
    expect(states).toMatch(/\{state\.kind === ['"]loading['"] \? <KeepScreenOn \/> : null\}/);
    expect(states.match(/KeepScreenOn \/>/g)).toHaveLength(1);
  });

  /**
   * The mirror in `routedApp` is the route file's function, hook for hook and return for return, run over the router
   * double through the navigation port. A hook in one and not the other fails here.
   */
  it('has the routed mirror run what the route file runs', () => {
    const asMirror = body('app/scoring/index.tsx', 'ScoringRoute')
      .trim()
      .replace('function ScoringRoute(', 'function ScoringRouted(');
    expect(body('test/routedApp.tsx', 'ScoringRouted').trim()).toBe(asMirror);
  });

  it('renders the app’s Settings from Home’s gear as its own screen, and Live Stream’s as the default', () => {
    expect(body('app/settings.tsx', 'AppSettingsRoute')).toMatch(/return <AppSettingsScreen ?\/>;/);
    expect(body('app/stream/settings.tsx', 'StreamSettingsRoute')).toMatch(
      /return <SettingsScreen ?\/>;/,
    );
  });
});
