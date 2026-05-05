/**
 * Vitest configuration for integration tests.
 *
 * Extends the base config with:
 * - Longer timeout (120s) for tests that hit real DB + AI APIs
 * - Scoped include pattern for __tests__/integration/ only
 * - Same setup file as regular tests
 * - forks pool with fileParallelism: false for sequential execution (real DB tests share state)
 */
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      // Mirror the unit-test config: route `server-only` to the no-op so
      // tests that import from `@/lib/logger` (or any server-only module)
      // can evaluate freely. Production builds use the real entry point.
      'server-only': path.resolve(
        __dirname,
        'node_modules/server-only/empty.js',
      ),
    },
  },
  test: {
    environment: 'node',
    include: [
      '__tests__/integration/**/*.test.{ts,tsx}',
      '__tests__/integration/**/*.integration.test.{ts,tsx}',
    ],
    globals: true,
    setupFiles: ['__tests__/setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 30_000,
    pool: 'forks',
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.ts', 'lib/**/*.tsx', 'app/api/**/*.ts'],
    },
  },
});
