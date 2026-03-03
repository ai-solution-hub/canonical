/** @type {import("prettier").Config} */
const config = {
  // Basic formatting
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 80,
  tabWidth: 2,
  useTabs: false,

  // JSX
  jsxSingleQuote: false,
  bracketSameLine: false,

  // Object formatting
  bracketSpacing: true,

  // Arrow functions
  arrowParens: 'always',

  // Prose (markdown)
  proseWrap: 'always',

  // End of line
  endOfLine: 'lf',

  // Embedded language formatting
  embeddedLanguageFormatting: 'auto',

  // HTML whitespace sensitivity
  htmlWhitespaceSensitivity: 'css',

  // Quote props
  quoteProps: 'as-needed',

  // Overrides for specific file types
  overrides: [
    {
      files: '*.md',
      options: {
        proseWrap: 'always',
        embeddedLanguageFormatting: 'auto',
      },
    },
    {
      files: '*.json',
      options: {
        printWidth: 120,
        tabWidth: 2,
      },
    },
    {
      files: ['*.yml', '*.yaml'],
      options: {
        tabWidth: 2,
        singleQuote: false,
      },
    },
  ],
};
export default config;
