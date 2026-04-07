// @ts-expect-error - CommonJS rule, no .d.ts
import rule from '../no-silent-promise-catch.js';
import { RuleTester } from 'eslint';

// RuleTester uses Mocha-style describe/it globals; vitest provides them when
// `globals: true` is set in vitest.config.ts (which it is for this repo).

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

ruleTester.run('no-silent-promise-catch', rule as never, {
  valid: [
    // Handler logs the error
    {
      code: 'async function f() { await foo().catch((err) => console.warn(err)); }',
    },
    // Explicit ignore via `_err` — intent is visible
    {
      code: 'async function f() { await foo().catch((_err) => undefined); }',
    },
    // Method reference — can't statically prove either way, skip
    {
      code: 'async function f() { await foo().catch(handleError); }',
    },
    // Rest parameter counts as ≥1 param
    {
      code: 'async function f() { await foo().catch((...rest) => undefined); }',
    },
    // Zero-argument `.catch()` — not the shape we target
    {
      code: 'async function f() { await foo().catch(); }',
    },
    // Chained then/catch with logging handler
    {
      code: 'async function f() { await foo().then((x) => x).catch((err) => log(err)); }',
    },
  ],

  invalid: [
    {
      code: 'async function f() { await foo().catch(() => undefined); }',
      errors: [{ messageId: 'silentCatch' }],
    },
    {
      code: 'async function f() { await foo().catch(() => null); }',
      errors: [{ messageId: 'silentCatch' }],
    },
    {
      code: 'async function f() { await foo().catch(() => {}); }',
      errors: [{ messageId: 'silentCatch' }],
    },
    {
      code: 'async function f() { await foo().catch(function () { return null; }); }',
      errors: [{ messageId: 'silentCatch' }],
    },
    // async arrow with no params still counts
    {
      code: 'async function f() { await foo().catch(async () => undefined); }',
      errors: [{ messageId: 'silentCatch' }],
    },
    // Chained then/catch where catch swallows silently
    {
      code: 'async function f() { await foo().then((x) => x).catch(() => {}); }',
      errors: [{ messageId: 'silentCatch' }],
    },
  ],
});
