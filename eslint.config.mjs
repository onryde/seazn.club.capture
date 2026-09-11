import tsParser from '@typescript-eslint/parser';
import boundaries from 'eslint-plugin-boundaries';
import prettier from 'eslint-config-prettier';

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
        { type: 'navigation', pattern: 'src/navigation/**' },
        { type: 'engine', pattern: 'modules/capture-engine/**' },
        { type: 'contracts', pattern: 'contracts/**' },
      ],
      'boundaries/include': ['src/**', 'modules/**', 'contracts/**'],
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
              from: { element: { type: 'ui' } },
              allow: [
                { to: { element: { type: 'ui' } } },
                { to: { element: { type: 'domain' } } },
                { to: { element: { type: 'hooks' } } },
                { to: { module: { origin: ['external', 'core'] } } },
              ],
            },
            {
              from: { element: { type: 'hooks' } },
              allow: [
                { to: { element: { type: 'hooks' } } },
                { to: { element: { type: 'domain' } } },
                { to: { element: { type: 'services' } } },
                { to: { element: { type: 'engine' } } },
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
              from: { element: { type: 'navigation' } },
              allow: [
                { to: { element: { type: 'navigation' } } },
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
              from: { element: { type: 'contracts' } },
              allow: [{ to: { element: { type: 'contracts' } } }],
            },
          ],
        },
      ],
    },
  },
  {
    // Tests may import the test runner. The purity rule exists to keep React
    // Native out of what ships and to keep domain tests fast; vitest is neither
    // shipped nor slow.
    files: ['**/*.test.ts'],
    rules: { 'boundaries/dependencies': 'off' },
  },
  prettier,
];
