import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      // `server-only` throws at import time outside React Server Components.
      // For Vitest (jsdom env) we route it to the no-op `empty.js` so
      // server-side modules can be tested without RSC ceremony. Production
      // builds use the real entry — Turbopack catches accidental client
      // imports of server-only files at build time (the original WP2 goal).
      'server-only': path.resolve(
        __dirname,
        'node_modules/server-only/empty.js',
      ),
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
