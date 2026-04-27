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
    include: [
      '__tests__/**/*.test.{ts,tsx}',
      'eslint-rules/tests/**/*.test.ts',
    ],
    exclude: ['__tests__/**/*.integration.test.{ts,tsx}', 'node_modules'],
    globals: true,
    setupFiles: ['__tests__/setup.ts'],
    pool: 'forks',
    maxWorkers: 4,
    coverage: {
      provider: 'v8',
      include: [
        'lib/**/*.ts',
        'lib/**/*.tsx',
        'app/api/**/*.ts',
        'components/**/*.tsx',
        'hooks/**/*.ts',
      ],
      exclude: [
        'lib/supabase/**',
        'lib/anthropic.ts',
        'lib/anthropic-files.ts',
      ],
    },
  },
});
