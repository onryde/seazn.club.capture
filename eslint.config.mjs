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
];

/** The ui import rule, for a given list of services the files may not import. */
function uiRestrictedImports(services, message) {
  return [
    'error',
    {
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
