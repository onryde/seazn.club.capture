import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

/**
 * Domain tests run in plain Node with no React Native preset — that speed is
 * the whole point of keeping `src/domain` pure (AGENTS.md §3, §10).
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'modules/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@/domain': path('./src/domain'),
      '@/ui': path('./src/ui'),
      '@/hooks': path('./src/hooks'),
      '@/services': path('./src/services'),
      '@/navigation': path('./src/navigation'),
      '@/engine': path('./modules/capture-engine/src'),
      '@/contracts': path('./contracts'),
    },
  },
});
