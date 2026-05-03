import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: [
    'app/**/{page,layout,loading,error,not-found,route,proxy}.{ts,tsx}',
    'app/**/{default,template}.{ts,tsx}',
    'app/api/**/route.ts',
    'instrumentation.ts',
    'instrumentation-client.ts',
    'next.config.ts',
    'next.config.{js,mjs}',
    'scripts/*.{ts,js}',
    'scripts/**/*.{ts,js}',
    'lib/mcp/route-handler.ts',
    'lib/mcp/server.ts',
    'lib/mcp/transport.ts',
    'lib/mcp/index.ts',
    'lib/mcp/server-factory.ts',
    'lib/mcp/registrations.ts',
    'lib/mcp/setup-server.ts',
    'lib/mcp/handler.ts',
    'lib/mcp/resources.ts',
    'vitest.config.ts',
    'vitest.config.{ts,mts}',
    'playwright.config.ts',
    'tailwind.config.{ts,js}',
    'postcss.config.{ts,js,mjs}',
    'drizzle.config.ts',
    // Tailwind v4 CSS-first plugin activation: globals.css is the entry
    // for CSS-loaded deps (`@plugin`, `@import`). See `syncCompilers.css` below.
    'app/globals.css',
  ],
  project: [
    'app/**/*.{ts,tsx}',
    'components/**/*.{ts,tsx}',
    'contexts/**/*.{ts,tsx}',
    'hooks/**/*.{ts,tsx}',
    'lib/**/*.{ts,tsx}',
    'types/**/*.{ts,tsx}',
    'scripts/**/*.{ts,tsx}',
    'instrumentation*.{ts,tsx}',
    'proxy.ts',
    // Tailwind v4 CSS-first plugin activation — see `syncCompilers.css` below.
    'app/globals.css',
  ],
  ignore: [
    '.next/**',
    'node_modules/**',
    'mcp-apps/*/dist/**',
    'mcp-apps/*/node_modules/**',
    'supabase/types/**',
    'supabase/.temp/**',
    'playwright-report/**',
    'test-results/**',
    '.claude/**',
    'docs/**',
    '.planning/**',
    '**/*.d.ts',
  ],
  ignoreDependencies: [
    '@types/node',
    '@types/react',
    '@types/react-dom',
    '@vitest/coverage-v8',
    'tsx',
    'tailwindcss',
    '@tailwindcss/postcss',
    'autoprefixer',
    'postcss',
  ],
  // Tailwind v4 CSS-first plugin activation: knip can't see `@plugin "..."`
  // directives in globals.css natively, so we synthesise virtual JS imports
  // from `@plugin` and `@import` directives. This lets knip detect deps like
  // `@tailwindcss/typography` that v4 loads via CSS rather than a JS config
  // file. Pattern: https://www.jimmy.codes/blog/fix-knip-false-positives-tailwindcss-v4
  // Using `syncCompilers` (not `compilers`) — knip 6.x ConfigurationChief
  // only reads syncCompilers/asyncCompilers despite the schema accepting both.
  syncCompilers: {
    css: (text: string) => {
      const directives = [
        ...text.matchAll(/@(?:plugin|import)\s+["']([^"']+)["']/g),
      ];
      return directives.map(([, dep]) => `import "${dep}";`).join('\n');
    },
  },
  vitest: {
    config: 'vitest.config.ts',
    entry: ['__tests__/**/*.{test,spec}.{ts,tsx}'],
  },
  playwright: {
    config: 'playwright.config.ts',
    entry: ['e2e/tests/**/*.spec.ts'],
  },
};

export default config;
