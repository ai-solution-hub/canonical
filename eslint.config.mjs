import { defineConfig, globalIgnores } from 'eslint/config';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import tanstackQuery from '@tanstack/eslint-plugin-query';
import localRules from './eslint-rules/index.js';

const eslintConfig = defineConfig([
  ...nextCoreWebVitals,
  ...nextTypescript,
  ...tanstackQuery.configs['flat/recommended'],
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    '.claude/**',
    '.planning/**',
    'scripts/**',
    'supabase/**',
  ]),
  {
    // Downgrade new React 19 / React Compiler rules to warnings for now.
    // These flag pre-existing patterns (setState in useEffect, Math.random
    // in render) that are widespread in the codebase and will be addressed
    // incrementally.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/incompatible-library': 'warn',
      // Allow underscore-prefixed variables/args to be unused — standard
      // convention for intentionally ignored destructured values and params.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      '@tanstack/query/no-unstable-deps': 'warn',
      '@tanstack/query/exhaustive-deps': 'warn',
    },
  },
  {
    // Silent-failure prevention — Supabase error checks
    // (spec: docs/specs/silent-failure-prevention-spec.md).
    // Catches unchecked `.data` destructures across route handlers, library
    // code, AND Server Components / page+layout files in app/**/*.tsx.
    // OPS-31: extended to app/**/*.tsx so Next.js 16 Server Component data
    // fetching is in-scope (previously only app/api/** + lib/**).
    // The `lib/supabase/safe.ts` ignore is only because the wrapper itself
    // destructures raw.
    files: ['app/api/**/*.ts', 'lib/**/*.ts', 'app/**/*.tsx'],
    ignores: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      '**/*.stories.tsx',
      '__tests__/**',
      '**/__tests__/**/*.tsx',
      'e2e/**',
      'scripts/**',
      'lib/supabase/safe.ts', // the wrapper itself destructures raw
    ],
    plugins: {
      local: localRules,
    },
    rules: {
      'local/no-unchecked-supabase-error': 'error',
    },
  },
  {
    // Silent-failure prevention — promise catch swallows
    // (spec: docs/specs/silent-failure-prevention-spec.md).
    // Scope intentionally NARROWER than `no-unchecked-supabase-error`: the
    // app/**/*.tsx Server Component surface contains many existing
    // `.catch(() => ...)` patterns in client components that are out of
    // scope for OPS-31 and need a separate sweep before the rule can be
    // applied there. Ships at `error` from day one (Q-22) for the original
    // route+lib surface.
    files: ['app/api/**/*.ts', 'lib/**/*.ts'],
    ignores: [
      '**/*.test.ts',
      '**/*.spec.ts',
      '__tests__/**',
      'e2e/**',
      'scripts/**',
      'lib/supabase/safe.ts',
    ],
    plugins: {
      local: localRules,
    },
    rules: {
      'local/no-silent-promise-catch': 'error',
    },
  },
]);

export default eslintConfig;
