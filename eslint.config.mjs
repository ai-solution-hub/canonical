import { defineConfig, globalIgnores } from 'eslint/config';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import tanstackQuery from '@tanstack/eslint-plugin-query';
import reactHooks from 'eslint-plugin-react-hooks';
import unusedImports from 'eslint-plugin-unused-imports';
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
    // Local code-intelligence artefact dir (gitignored, untracked) — not
    // part of the repo, must never be linted (bl-272).
    '.gitnexus/**',
    '.cache/**',
    'docs-site/.astro/**',
    // Deliberately-dead ast-dataflow test fixtures — these contain unused
    // exports/imports/vars by design (they exercise the dead-export and
    // unused-symbol queries), so they must stay out of the unused-imports
    // error gate (S391 eslint-tightening path (a)).
    '__tests__/lib/ast-dataflow/fixtures/**',
    // Generated artefacts — committed but never hand-edited, and on the
    // sandbox Read-deny list (bl-209) so lint should never try to read them.
    // (scripts/ and supabase/ are now linted as of S391, so these two
    // generated files must be ignored explicitly rather than via the broad
    // 'supabase/**' / wildcard exclusions that previously covered them.)
    'supabase/types/database.types.ts',
    'lib/mcp/plugin-bundle.ts',
  ]),
  {
    // Downgrade new React 19 / React Compiler rules to warnings for now.
    // These flag pre-existing patterns (setState in useEffect, Math.random
    // in render) that are widespread in the codebase and will be addressed
    // incrementally.
    //
    // eslint-plugin-react-hooks@7 (pulled in by eslint-config-next@16) ships
    // these React-Compiler rules in its `recommended` preset. Under flat
    // config a rule reference must resolve the plugin from a config object
    // that registers it; eslint-config-next registers `react-hooks` only on
    // its own `files`-scoped object, so this unscoped override could not see
    // the plugin (bl-272). Register it explicitly here.
    plugins: {
      'react-hooks': reactHooks,
      'unused-imports': unusedImports,
    },
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/incompatible-library': 'warn',
      // Unused-imports/vars gate (S391 eslint-tightening path (a)). The
      // base @typescript-eslint/no-unused-vars rule is delegated to
      // eslint-plugin-unused-imports, which separates unused imports (auto-
      // fixable) from unused vars. Allow underscore-prefixed identifiers to
      // be unused — standard convention for intentionally ignored
      // destructured values and params.
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'error',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
          // Preserve the established underscore convention for intentionally
          // ignored caught errors (the prior @typescript-eslint/no-unused-vars
          // config carried this; the base rule defaults caughtErrors to 'all').
          caughtErrorsIgnorePattern: '^_',
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
  {
    // Supabase record-cast prevention — flags `as Record<string, unknown>`
    // casts on structured Supabase RPC return values, which discard the typed
    // row shape from database.types.ts.
    // (spec: docs/specs/id-16-ast-dataflow-tool/type-safety-pipeline/TECH.md §ESLint
    // rule design). JSONB columns, third-party API responses, and test files
    // are exempt via the rule's built-in escape hatches.
    files: ['lib/**/*.ts', 'app/api/**/*.ts'],
    ignores: [
      '**/*.test.ts',
      '**/*.spec.ts',
      '__tests__/**',
      'e2e/**',
      'scripts/**',
    ],
    plugins: {
      local: localRules,
    },
    rules: {
      'local/no-supabase-record-cast': 'error',
    },
  },
  {
    // D-9 console-to-logger migration regression guard
    // (spec: docs/specs/structured-logging-spec.md §5 Phase 4).
    // After the Phase 4 sweep closure (kh-prod-readiness-S34), zero
    // unintentional `console.*` calls remain in `app/` + `lib/`. The rule
    // bans them outright with a small allowlist for the 4 documented
    // intentional residuals:
    //   - lib/logger/client.ts        — chokepoint shim (forwards to logger).
    //   - lib/client-telemetry.ts     — dev-mode debug, gated on NODE_ENV.
    //   - lib/eval/reporter.ts        — CLI eval reporter (human-readable
    //                                   stdout + JSON for CI consumption).
    //   - lib/mcp/app-bundles.ts      — autogenerated bundle artefact —
    //                                   the console.* calls live inside the
    //                                   embedded JS string literals, NOT in
    //                                   real TS code.
    // Scripts (Python pipeline + Node CLI scripts) are out of scope.
    files: ['app/**/*.ts', 'app/**/*.tsx', 'lib/**/*.ts', 'lib/**/*.tsx'],
    ignores: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      '__tests__/**',
      'e2e/**',
      'scripts/**',
      'lib/logger/client.ts',
      'lib/client-telemetry.ts',
      'lib/eval/reporter.ts',
      'lib/mcp/app-bundles.ts',
    ],
    rules: {
      'no-console': 'error',
    },
  },
]);

export default eslintConfig;
