// @ts-expect-error - CommonJS rule, no .d.ts
import rule from '../no-unchecked-supabase-error.js';
import { RuleTester } from 'eslint';

// RuleTester uses Mocha-style describe/it globals; vitest provides them when
// `globals: true` is set in vitest.config.ts (which it is for this repo).

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

ruleTester.run('no-unchecked-supabase-error', rule as never, {
  valid: [
    // Destructure includes error
    {
      code: "async function f() { const { data, error } = await supabase.from('x').select(); return { data, error }; }",
    },
    {
      code: "async function f() { const { data: items, error: err } = await supabase.from('x').select(); return { items, err }; }",
    },
    // sb() wrapper handles errors
    {
      code: "async function f() { const items = await sb(supabase.from('x').select()); return items; }",
    },
    // tryQuery wrapper
    {
      code: "async function f() { const result = await tryQuery(supabase.from('x').select()); return result; }",
    },
    // Variable assigned, error explicitly checked
    {
      code: "async function f() { const r = await supabase.from('x').select(); if (r.error) throw r.error; return r.data; }",
    },
    // Receivers: sb / client / db / auth.supabase
    {
      code: "async function f() { const { data, error } = await sb.from('x').select(); return { data, error }; }",
    },
    {
      code: "async function f() { const { data, error } = await client.from('x').select(); return { data, error }; }",
    },
    {
      code: "async function f() { const { data, error } = await db.from('x').select(); return { data, error }; }",
    },
    {
      code: "async function f() { const { data, error } = await auth.supabase.from('x').select(); return { data, error }; }",
    },
    // RPC variants
    {
      code: "async function f() { const r = await supabase.rpc('foo'); if (r.error) throw r.error; return r.data; }",
    },
    {
      code: "async function f() { const { data, error } = await supabase.rpc('foo', { a: 1 }); return { data, error }; }",
    },
    // Non-Supabase await — should not be flagged
    {
      code: "async function f() { const { data } = await fetch('/api/x').then(r => r.json()); return data; }",
    },
  ],

  invalid: [
    {
      code: "async function f() { const { data } = await supabase.from('x').select(); return data; }",
      errors: [{ messageId: 'missingErrorDestructure' }],
    },
    {
      code: "async function f() { const { data: items } = await supabase.from('x').select(); return items; }",
      errors: [{ messageId: 'missingErrorDestructure' }],
    },
    {
      code: "async function f() { const { data, count } = await supabase.from('x').select(); return { data, count }; }",
      errors: [{ messageId: 'missingErrorDestructure' }],
    },
    {
      code: "async function f() { const r = await supabase.from('x').select(); return r.data; }",
      errors: [{ messageId: 'uncheckedResultVariable' }],
    },
    // Renamed receivers should still trigger
    {
      code: "async function f() { const { data } = await sb.from('x').select(); return data; }",
      errors: [{ messageId: 'missingErrorDestructure' }],
    },
    {
      code: "async function f() { const r = await client.from('x').select(); return r.data; }",
      errors: [{ messageId: 'uncheckedResultVariable' }],
    },
    // RPC variants
    {
      code: "async function f() { const { data } = await supabase.rpc('foo'); return data; }",
      errors: [{ messageId: 'missingErrorDestructure' }],
    },
    {
      code: "async function f() { const r = await supabase.rpc('foo', { a: 1 }); return r.data; }",
      errors: [{ messageId: 'uncheckedResultVariable' }],
    },
  ],
});
