/**
 * Vitest configuration for integration tests.
 *
 * Extends the base config with:
 * - Longer timeout (30s) for tests that may hit the database
 * - Scoped include pattern for __tests__/integration/ only
 * - Same setup file as regular tests
 */
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['__tests__/integration/**/*.test.{ts,tsx}'],
    globals: true,
    setupFiles: ['__tests__/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: [
        'lib/**/*.ts',
        'lib/**/*.tsx',
        'app/api/**/*.ts',
      ],
    },
  },
});
