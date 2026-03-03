import { defineConfig, globalIgnores } from 'eslint/config';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextCoreWebVitals,
  ...nextTypescript,
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
    },
  },
]);

export default eslintConfig;
