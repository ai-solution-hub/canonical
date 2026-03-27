import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: [
    'app/**/*.{ts,tsx}',
    'lib/**/*.ts',
    'components/**/*.{ts,tsx}',
    'hooks/**/*.ts',
    'contexts/**/*.{ts,tsx}',
    'types/**/*.ts',
  ],
  project: ['**/*.{ts,tsx}'],
  ignore: [
    // CLI scripts (run via bun, not imported)
    'scripts/**',
    // MCP Apps (separate Vite builds)
    'mcp-apps/**',
    // E2E tests (Playwright, separate runner)
    'e2e/**',
    // Auto-generated types (never edit manually)
    'supabase/types/**',
  ],
  ignoreDependencies: [
    // Transitive deps used implicitly
    'pdfjs-dist',
    'postcss',
    'postcss-load-config',
    // Loaded via @plugin directive in globals.css, not JS imports
    '@tailwindcss/typography',
    // Core framework — loaded by Next.js/PostCSS, not direct imports
    'tailwindcss',
  ],
};

export default config;
