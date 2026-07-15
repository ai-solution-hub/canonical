const isFullRun = process.env.STRYKER_SCOPE === 'full';
const relatedTests = process.env.STRYKER_RELATED !== 'false';

const productionMutations = [
  'lib/**/*.ts',
  'lib/**/*.tsx',
  'app/api/**/*.ts',
  'components/**/*.tsx',
  'hooks/**/*.ts',
  '!**/*.test.ts',
  '!**/*.test.tsx',
  '!**/*.spec.ts',
  '!**/*.spec.tsx',
  '!lib/supabase/**',
  '!lib/anthropic.ts',
];

const config = {
  $schema: './node_modules/@stryker-mutator/core/schema/stryker-schema.json',
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.config.ts',
    related: relatedTests,
  },
  mutate: isFullRun ? productionMutations : ['lib/extraction/url-normalise.ts'],
  testFiles: isFullRun
    ? [
        '__tests__/**/*.test.{ts,tsx}',
        'tools/**/*.test.{ts,tsx}',
        'eslint-rules/tests/**/*.test.ts',
      ]
    : ['__tests__/lib/extraction/url-normalise.test.ts'],
  reporters: ['clear-text', 'html', 'json'],
  htmlReporter: {
    fileName: 'reports/mutation/stryker.html',
  },
  jsonReporter: {
    fileName: 'reports/mutation/stryker.json',
  },
  coverageAnalysis: 'perTest',
  concurrency: 2,
  timeoutFactor: 2,
  timeoutMS: 10_000,
  ignorePatterns: [
    '/.bin',
    '/.cache',
    '/.claude',
    '/.design-sync',
    '/docs',
    '/e2e',
    '/.user-scratch',
    '/.venv',
    '/mcp-apps/*/dist',
    '/public',
    '/reports',
    '/scripts/tests',
    '/supabase/types',
    '/tools/ast-dataflow/__tests__/fixtures',
  ],
  cleanTempDir: 'always',
};

export default config;
