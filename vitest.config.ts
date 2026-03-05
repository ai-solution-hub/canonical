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
    include: ['__tests__/**/*.test.{ts,tsx}'],
    globals: true,
    setupFiles: ['__tests__/setup.ts'],
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
