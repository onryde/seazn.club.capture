import tsParser from '@typescript-eslint/parser';
import boundaries from 'eslint-plugin-boundaries';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

/**
 * What the ui layer may never import by value, because each loads native code
 * that cannot render on react-native-web (spec §9). Shared by the ui rule and
 * its test override below, so a new ban reaches both. Type imports stay
 * allowed: a type carries no native code.
 */
const UI_NATIVE_IMPORTS = [
  'react-native-safe-area-context',
  'expo',
  'expo-*',
  '@/scanner/*',
  '@/hooks/nativePorts',
  // Behind the surfaces port (D16), never drawn by a screen directly (m6).
  // `expo-*` already matches expo-video; it is named so the ban outlives a
  // narrower glob.
  'expo-video',
  // No longer installed (D2 §4.1). The ban stays: the scorebug is never drawn on the phone (AGENTS §7).
  'react-native-webview',
];

/**
 * AGENTS §4: `any` is banned; the escape hatch is `unknown` plus a parse
 * function at the boundary. @typescript-eslint/eslint-plugin is not installed
 * (only the parser is), so this is the core rule on the parser's own
 * `TSAnyKeyword` node — every `any` annotation, cast and type argument — with
 * no new dependency. Shared because a later `no-restricted-syntax` replaces an
 * earlier one for the files it matches: every block that sets the rule repeats it.
 */
const NO_ANY = {
  selector: 'TSAnyKeyword',
  message: '`any` is banned (AGENTS §4): use `unknown` and parse it at the boundary.',
};

/**
 * The colour names React Native accepts, less `transparent` (the absence of a
 * colour, which stays allowed): `normalizeKeyword` in
 * @react-native/normalize-colors 0.86.3, the CSS named colours plus RN's own
 * `burntsienna`.
 */
const NAMED_COLOURS = `
  aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet
  brown burlywood burntsienna cadetblue chartreuse chocolate coral cornflowerblue cornsilk
  crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta
  darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue
  darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey
  dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray
  green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush
  lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen
  lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey
  lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue
  mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise
  mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive
  olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred
  papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue
  saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray
  slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white
  whitesmoke yellow yellowgreen
`
  .trim()
  .split(/\s+/);

/**
 * Where a name is a colour: a style value or prop whose name holds "color"
 * (`color`, `backgroundColor`, `tintColor`, `placeholderTextColor`, `colors`, …)
 * or is an SVG `fill` / `stroke`. Scoped, because `'red'` or `'lime'` elsewhere
 * can be a word, not a colour (n4).
 */
const COLOUR_PROP = '/colou?r|^(fill|stroke)$/i';
const NAMED_COLOUR = `Literal[value=/^(${NAMED_COLOURS.join('|')})$/i]`;

/**
 * AGENTS §5: styles reference tokens only; a colour literal in a component is
 * a review blocker. Hex (#rgb, #rgba, #rrggbb, #rrggbbaa) and the colour
 * functions (rgb/rgba, hsl/hsla, hwb, lab, lch, oklab, oklch), in a string, a
 * JSX attribute or the head of a template; and a named colour in a style value
 * or colour prop (n4).
 */
const COLOUR_MESSAGE = 'A colour literal outside src/ui/theme (AGENTS §5): use a theme token.';
const COLOUR_FUNCTION = '((rgb|hsl)a?|hwb|lab|lch|oklab|oklch)\\(';
const NO_COLOUR_LITERALS = [
  {
    selector: 'Literal[value=/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i]',
    message: COLOUR_MESSAGE,
  },
  { selector: `Literal[value=/^${COLOUR_FUNCTION}/i]`, message: COLOUR_MESSAGE },
  {
    selector: `TemplateElement[value.raw=/^(#[0-9a-f]{3,8}\\b|${COLOUR_FUNCTION})/i]`,
    message: COLOUR_MESSAGE,
  },
  { selector: `Property[key.name=${COLOUR_PROP}] ${NAMED_COLOUR}`, message: COLOUR_MESSAGE },
  { selector: `Property[key.value=${COLOUR_PROP}] ${NAMED_COLOUR}`, message: COLOUR_MESSAGE },
  { selector: `JSXAttribute[name.name=${COLOUR_PROP}] ${NAMED_COLOUR}`, message: COLOUR_MESSAGE },
];

/**
 * Pad per sport (owner, 2026-11-02: "pad per sport must, instead of creating a single pad and adjusting and adding
 * lots of conditions"). The match runtime and the kit are the same for every sport: a sport is its own module behind
 * `ScoringSport` (src/domain/scoring/scoringSport.ts), listed by its key in `sports.ts`, with its own screen. So a
 * generic scoring file may not name a sport's module, by value or by type: badminton's files (`badminton*`, and the
 * hooks and services named `*Badminton*`) and its sheets (`usePadSheets`: Sanction and Set score), and table tennis's
 * (`tableTennis*`, and the hooks, services and screens named `*TableTennis*`: these import patterns match without regard
 * to case, so one spelling holds both; `SPORT_OWN_FILES` below needs both), and chess's (`chess*`, and the services,
 * hooks and screens named `*Chess*`, by the same rule), and cricket's (`cricket*` and `*Cricket*`, S2-4), and football's (`football*`, and the hooks,
 * services and screens named `*Football*`, by the same rule). Tests are free to.
 */
const SPORT_MODULES = {
  group: [
    '**/*badminton*',
    '**/*tableTennis*',
    '**/*chess*',
    '**/*cricket*',
    '**/*football*',
    '**/usePadSheets',
  ],
  message:
    'A generic scoring file names no sport (owner, 2026-11-02: pad per sport): ask the match’s sport (`ScoringSport`).',
};

/**
 * Every scoring file, by where it lives, so a file added tomorrow is held without anyone remembering to list it (the
 * Batch D review): the match runtime and its model, the hooks that drive them, the home's cards, the route and the
 * screens every sport shares. The kit (`src/ui/components`) is held below, with the ui rule. What is NOT generic is the
 * sport's own, listed in `SPORT_OWN_FILES`.
 */
const SPORT_GENERIC_FILES = [
  'src/domain/scoring/**/*.{ts,tsx}',
  'src/domain/mode/scoringHome.ts',
  'src/hooks/*coring*.{ts,tsx}',
  'src/hooks/usePad*.{ts,tsx}',
  'src/hooks/padScreenModel.ts',
  // The ports and stores the match runtime reads and writes through: the server's, the link's, the queue's. A name does
  // not hold them (`tapQueueStore` has no "scoring" in it), so they are listed.
  'src/services/scoringPort.ts',
  'src/services/fetchScoringPort.ts',
  'src/services/tapQueueStore.ts',
  'src/services/scoringLinkStore.ts',
  'src/services/scoringLinkPort.ts',
  // The pad's words every sport shares (`padText`), as its hook (`usePadText`) already is.
  'src/i18n/padText.ts',
  // The route and the screens that pick a sport's screen or draw the states every sport shares (plan S2-1 Task 11); the
  // table they read (`scoringScreens.ts`) is the one place that names the sports' screens, as `sports.ts` names the sports.
  'app/scoring/**/*.{ts,tsx}',
];

/**
 * A sport's own files, free to name its modules: whatever is named for it (`badminton*`, `*Badminton*`: globs are case
 * sensitive here, so both), its sheets (`usePadSheets`: Sanction and Set score are badminton's), and the table that
 * lists the sports by key. (The table of their screens, `src/ui/screens/scoringScreens.ts`, is no generic file either: the
 * globs above match `Scoring*` with a capital, which it has not.)
 */
const SPORT_OWN_FILES = [
  '**/*badminton*',
  '**/*Badminton*',
  '**/*tableTennis*',
  '**/*TableTennis*',
  '**/*chess*',
  '**/*Chess*',
  '**/*cricket*',
  '**/*Cricket*',
  '**/*football*',
  '**/*Football*',
  'src/hooks/usePadSheets.ts',
  'src/domain/scoring/sports.ts',
];

/** The screens every sport shares: the sport picker and the states. Held to the ui import rule as well (see below). */
const SPORT_GENERIC_SCREENS = ['src/ui/screens/Scoring*.{ts,tsx}'];

/** The ui import rule, for a given list of services the files may not import, and any further groups. */
function uiRestrictedImports(services, message, ...more) {
  return [
    'error',
    {
      patterns: [
        { group: [...UI_NATIVE_IMPORTS, services], allowTypeImports: true, message },
        ...more,
      ],
    },
  ];
}

/**
 * The layering rule IS the architecture. See AGENTS.md §3.
 *
 * `domain/` must stay pure TypeScript so its tests run in milliseconds with no
 * React Native preset. That purity is enforced here, not by convention: the
 * domain policy below grants two external-module allowances, `qrcode-generator`
 * (a pure JS encoder) and `@seazn/engine` at its phone subpaths (pure TS over
 * zod), and no other, so any import of react, react-native or expo from
 * src/domain fails the build.
 */
export default [
  {
    ignores: ['node_modules/**', '.expo/**', 'dist/**', 'android/**', 'ios/**'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { boundaries, 'react-hooks': reactHooks },
    settings: {
      'boundaries/elements': [
        { type: 'domain', pattern: 'src/domain/**' },
        { type: 'ui', pattern: 'src/ui/**' },
        { type: 'hooks', pattern: 'src/hooks/**' },
        { type: 'services', pattern: 'src/services/**' },
        { type: 'i18n', pattern: 'src/i18n/**' },
        { type: 'engine', pattern: 'modules/capture-engine/**' },
        { type: 'scanner', pattern: 'modules/code-scanner/**' },
        { type: 'contracts', pattern: 'contracts/**' },
        { type: 'app', pattern: 'app/**' },
      ],
      'boundaries/include': ['src/**', 'modules/**', 'contracts/**', 'app/**'],
      // Without this, `@/domain/...` reads as an external package rather than
      // resolving to the local element, and every cross-layer import is denied.
      'import/resolver': {
        typescript: { project: './tsconfig.json' },
      },
    },
    rules: {
      // AGENTS §11: no console anywhere — one levelled logger feeds the session
      // record, scrubbed. A console line is unscrubbed and lost at the ground.
      'no-console': 'error',
      // A hook behind `&&` or an early return changes the order React calls
      // them in: found on the phone as HoldAction's (2026-10-05). The rule
      // alone, not the plugin's compiler-era recommended set.
      'react-hooks/rules-of-hooks': 'error',
      'no-restricted-syntax': ['error', NO_ANY],
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          // Required so external packages are checked, not just local elements.
          checkAllOrigins: true,
          policies: [
            {
              // Two external allowances, `qrcode-generator` and `@seazn/engine`'s phone subpaths
              // below, and no other: this is the domain purity rule.
              from: { element: { type: 'domain' } },
              allow: [
                { to: { element: { type: 'domain' } } },
                { to: { element: { type: 'contracts' } } },
                // The first external package domain may name: a pure JS encoder with no react or
                // react-native in it (the Seazn QR's modules, src/domain/qr). Named by source, so
                // `react` and the rest stay refused.
                { to: { module: { origin: 'external', source: 'qrcode-generator' } } },
                // The second (plan S2-1 Task 1): Seazn's scoring engine, at the subpaths its own
                // `phone-subpaths.json` names, pure TS over zod. Not `testkit` (vitest, fast-check) or the
                // web's subpaths; not zod itself, which domain never names (test/domainBoundary.test.ts).
                {
                  to: {
                    module: {
                      origin: 'external',
                      source: '@seazn/engine',
                      internalPath: ['core', 'sport', 'sports', 'sports/*', 'pad'],
                    },
                  },
                },
              ],
            },
            {
              // Pure, like domain, but with no external allowance at all, so no react. It may
              // name domain types (a mode's name key), since both are pure.
              from: { element: { type: 'i18n' } },
              allow: [
                { to: { element: { type: 'i18n' } } },
                { to: { element: { type: 'domain' } } },
              ],
            },
            {
              from: { element: { type: 'ui' } },
              allow: [
                { to: { element: { type: 'ui' } } },
                { to: { element: { type: 'domain' } } },
                { to: { element: { type: 'hooks' } } },
                { to: { element: { type: 'i18n' } } },
                { to: { module: { origin: ['external', 'core'] } } },
              ],
            },
            {
              // Type-only: a screen may name a port's types (Route, ScanResult,
              // …), which carry no native code. Values still come through usePorts().
              from: { element: { type: 'ui' } },
              dependency: { kind: 'type' },
              allow: [
                { to: { element: { type: 'services' } } },
                { to: { element: { type: 'scanner' } } },
              ],
            },
            {
              from: { element: { type: 'hooks' } },
              allow: [
                { to: { element: { type: 'hooks' } } },
                { to: { element: { type: 'domain' } } },
                { to: { element: { type: 'services' } } },
                { to: { element: { type: 'i18n' } } },
                { to: { element: { type: 'engine' } } },
                { to: { element: { type: 'scanner' } } },
                { to: { module: { origin: ['external', 'core'] } } },
              ],
            },
            {
              from: { element: { type: 'services' } },
              allow: [
                { to: { element: { type: 'services' } } },
                { to: { element: { type: 'domain' } } },
                { to: { element: { type: 'contracts' } } },
                { to: { module: { origin: ['external', 'core'] } } },
              ],
            },
            {
              // Routes are thin: they import ui, hooks and packages only.
              from: { element: { type: 'app' } },
              allow: [
                { to: { element: { type: 'ui' } } },
                { to: { element: { type: 'hooks' } } },
                { to: { module: { origin: ['external', 'core'] } } },
              ],
            },
            {
              from: { element: { type: 'engine' } },
              allow: [
                { to: { element: { type: 'engine' } } },
                { to: { element: { type: 'domain' } } },
                { to: { module: { origin: ['external', 'core'] } } },
              ],
            },
            {
              from: { element: { type: 'scanner' } },
              allow: [
                { to: { element: { type: 'scanner' } } },
                { to: { module: { origin: ['external', 'core'] } } },
              ],
            },
            {
              from: { element: { type: 'contracts' } },
              allow: [{ to: { element: { type: 'contracts' } } }],
            },
          ],
        },
      ],
    },
  },
  {
    // Screens and components never touch a native capability directly: it
    // arrives through the Ports object, which is what lets them render on
    // react-native-web in tests. ShellFrame is the one exception, for insets.
    files: ['src/ui/**/*.{ts,tsx}'],
    ignores: ['src/ui/components/ShellFrame.tsx'],
    rules: {
      // Port and value types (Route, …) are fine: they carry no native code.
      'no-restricted-imports': uiRestrictedImports(
        '@/services/*',
        'Screens reach native capabilities through ports (spec §9)',
      ),
    },
  },
  {
    // The kit draws any sport's pad (padView.ts): it names no sport (SPORT_MODULES). Repeats the ui rule, since this
    // block's `no-restricted-imports` replaces the one above for these files. ShellFrame keeps its insets exception. The
    // screens every sport shares (the sport picker, the states) are held the same way.
    files: ['src/ui/components/**/*.{ts,tsx}', ...SPORT_GENERIC_SCREENS],
    ignores: [
      'src/ui/components/ShellFrame.tsx',
      '**/*.test.ts',
      '**/*.test.tsx',
      ...SPORT_OWN_FILES,
    ],
    rules: {
      'no-restricted-imports': uiRestrictedImports(
        '@/services/*',
        'Screens reach native capabilities through ports (spec §9)',
        SPORT_MODULES,
      ),
    },
  },
  {
    // The match runtime is the same for every sport (SPORT_MODULES). Tests may drive it with any sport's fixtures.
    files: SPORT_GENERIC_FILES,
    ignores: ['**/*.test.ts', '**/*.test.tsx', ...SPORT_OWN_FILES],
    rules: { 'no-restricted-imports': ['error', { patterns: [SPORT_MODULES] }] },
  },
  {
    // Colour comes from the theme and nowhere else (AGENTS §5). Repeats NO_ANY:
    // this block's `no-restricted-syntax` replaces the one above for these files.
    files: ['src/ui/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}'],
    ignores: ['src/ui/theme/**'],
    rules: { 'no-restricted-syntax': ['error', NO_ANY, ...NO_COLOUR_LITERALS] },
  },
  {
    // UI tests seed and inspect storage through the same pure services the
    // fake ports are built from (STORE_KEYS, createModeStore, the in-memory
    // KeyValueStore). The rule above exists to keep native code out of what
    // renders on react-native-web, so native services stay barred here too.
    files: ['src/ui/**/*.test.tsx'],
    rules: {
      'no-restricted-imports': uiRestrictedImports(
        '@/services/native/*',
        'UI tests render through fake ports; native services never load (spec §9)',
      ),
    },
  },
  {
    // Tests may import the test runner. The purity rule exists to keep React
    // Native out of what ships and to keep domain tests fast; vitest is neither
    // shipped nor slow.
    files: ['**/*.test.ts', '**/*.test.tsx', 'test/**/*.ts'],
    rules: { 'boundaries/dependencies': 'off' },
  },
  prettier,
];
