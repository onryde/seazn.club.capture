import tsParser from '@typescript-eslint/parser';
import boundaries from 'eslint-plugin-boundaries';
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
  'react-native-webview',
  'expo-video',
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
 * The on-air phase is not a colour: `connecting` is phase `live`, yet its plate
 * is inert. A plate or component that coloured itself from the phase would
 * paint connecting red, so ui never reads it; `tallyPlateFor` and `tallyTone`
 * are the one colour authority (D14, batch 7 carry 5).
 */
const NO_PHASE_AS_COLOUR = {
  name: '@/hooks/engineSelectors',
  importNames: ['selectOnAirPhase', 'OnAirPhase'],
  message:
    'The on-air phase is not a colour (D14): plates take theirs from tallyPlateFor and tallyTone; ask selectIsOnAir for on/off.',
};

/** The ui import rule, for a given list of services the files may not import. */
function uiRestrictedImports(services, message) {
  return [
    'error',
    {
      paths: [NO_PHASE_AS_COLOUR],
      patterns: [{ group: [...UI_NATIVE_IMPORTS, services], allowTypeImports: true, message }],
    },
  ];
}

/**
 * The layering rule IS the architecture. See AGENTS.md §3.
 *
 * `domain/` must stay pure TypeScript so its tests run in milliseconds with no
 * React Native preset. That purity is enforced here, not by convention: the
 * domain policy below grants no external-module allowance, so any import of
 * react, react-native or expo from src/domain fails the build.
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
    plugins: { boundaries },
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
      'no-restricted-syntax': ['error', NO_ANY],
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          // Required so external packages are checked, not just local elements.
          checkAllOrigins: true,
          policies: [
            {
              // No external allowance: this is the domain purity rule.
              from: { element: { type: 'domain' } },
              allow: [
                { to: { element: { type: 'domain' } } },
                { to: { element: { type: 'contracts' } } },
              ],
            },
            {
              // Pure, like domain: no external allowance, so no react. It may
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
