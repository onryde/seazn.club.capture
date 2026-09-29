import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

const alias = {
  '@/domain': path('./src/domain'),
  '@/ui': path('./src/ui'),
  '@/hooks': path('./src/hooks'),
  '@/services': path('./src/services'),
  '@/i18n': path('./src/i18n'),
  '@/engine': path('./modules/capture-engine/src'),
  '@/scanner': path('./modules/code-scanner/src'),
  '@/contracts': path('./contracts'),
};

/**
 * Two projects, on purpose (AGENTS.md §10).
 *
 * `domain` runs plain Node with no React Native anywhere: that speed is the
 * whole point of keeping `src/domain` and `src/i18n` pure.
 *
 * `ui` renders components, screens and hooks through react-native-web in
 * jsdom. It only works because screens never import a native module — every
 * native capability arrives through a port with a fake (spec §9).
 */
export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'domain',
          include: ['src/**/*.test.ts', 'modules/**/*.test.ts', 'test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        define: { __DEV__: true },
        resolve: {
          alias: { ...alias, 'react-native': 'react-native-web' },
          extensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.mjs', '.js', '.json'],
        },
        test: {
          name: 'ui',
          include: ['src/**/*.test.tsx', 'modules/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['./test/setup-ui.ts'],
        },
      },
    ],
  },
});
