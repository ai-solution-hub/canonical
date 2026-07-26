import rule from '../no-unchecked-supabase-error.js';
import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';

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

    // ── RC-1 carve-outs — bare await statements that are NOT raw queries ──
    // Bare await through the sb() wrapper — errors throw, nothing discarded.
    {
      code: "async function f() { await sb(supabase.from('x').delete().eq('id', 1)); }",
    },
    // Bare await on a non-Supabase call.
    {
      code: "async function f() { await fetch('/api/x'); }",
    },
    // Bare await on the Storage API — `.from('bucket')` names a bucket, and
    // storage methods throw/return differently; out of this rule's scope.
    {
      code: "async function f() { await supabase.storage.from('bucket').remove(['a']); }",
    },
    // Bare await whose result IS captured is the VariableDeclarator case,
    // not RC-1 — checked result stays valid.
    {
      code: "async function f() { const r = await supabase.from('x').update({ a: 1 }); if (r.error) throw r.error; }",
    },

    // ── RC-2 carve-outs — origin resolution must not overreach ──
    // Variable initialised from a NON-factory — receiver name not in the
    // allowlist, origin not a create*Client call: not a Supabase client.
    {
      code: "async function f() { const httpApi = makeHttpApi(); await httpApi.from('x').send(); }",
    },
    // `storage` alias of the Storage API — member-expression origin, never
    // a factory call, and the name is not in the allowlist.
    {
      code: "async function f() { const storage = supabase.storage; await storage.from('bucket').remove(['a']); }",
    },
    // Factory-origin receiver used CORRECTLY — destructure includes error.
    {
      code: "async function f() { const serviceClient = createServiceClient(); const { data, error } = await serviceClient.from('x').select(); return { data, error }; }",
    },
    // Factory-origin receiver, result variable with an error check.
    {
      code: "async function f() { const publishServiceClient = createServiceClient(); const r = await publishServiceClient.from('x').insert({}); if (r.error) throw r.error; }",
    },
    // Destructured-from-auth receiver used correctly.
    {
      code: "async function f() { const { supabase: authed } = await getAuthorisedClient(); const { data, error } = await authed.from('x').select(); return { data, error }; }",
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

    // ── RC-1 — bare `await` statements discard the response entirely ──
    {
      code: "async function f() { await supabase.from('x').update({ a: 1 }).eq('id', 1); }",
      errors: [{ messageId: 'discardedQueryResult' }],
    },
    {
      code: "async function f() { await supabase.from('x').insert({ a: 1 }); }",
      errors: [{ messageId: 'discardedQueryResult' }],
    },
    {
      code: "async function f() { await supabase.from('x').delete().eq('id', 1); }",
      errors: [{ messageId: 'discardedQueryResult' }],
    },
    {
      code: "async function f() { await supabase.rpc('foo', { a: 1 }); }",
      errors: [{ messageId: 'discardedQueryResult' }],
    },
    // Bare await without braces inside a conditional is still a statement.
    {
      code: "async function f(cond) { if (cond) await supabase.from('x').update({ a: 1 }); }",
      errors: [{ messageId: 'discardedQueryResult' }],
    },

    // ── RC-2 — receivers resolved by ORIGIN, not just name ──
    // The priority blind spot: `serviceClient` (now also in the name set).
    {
      code: "async function f() { const serviceClient = createServiceClient(); const { data } = await serviceClient.from('x').select(); return data; }",
      errors: [{ messageId: 'missingErrorDestructure' }],
    },
    // Arbitrary name, factory origin.
    {
      code: "async function f() { const publishServiceClient = createServiceClient(); const { data } = await publishServiceClient.from('x').select(); return data; }",
      errors: [{ messageId: 'missingErrorDestructure' }],
    },
    // Async factory origin (`await createClient()`).
    {
      code: "async function f() { const conn = await createClient(); const { data } = await conn.from('x').select(); return data; }",
      errors: [{ messageId: 'missingErrorDestructure' }],
    },
    // Factory origin + bare await (RC-1 × RC-2).
    {
      code: "async function f() { const serviceClient = createServiceClient(); await serviceClient.from('x').update({ a: 1 }).eq('id', 1); }",
      errors: [{ messageId: 'discardedQueryResult' }],
    },
    {
      code: "async function f() { const mcp = createMcpClient(info); await mcp.rpc('foo'); }",
      errors: [{ messageId: 'discardedQueryResult' }],
    },
    // Destructured from an auth result under a renamed binding.
    {
      code: "async function f() { const { supabase: authed } = await getAuthorisedClient(); const { data } = await authed.from('x').select(); return data; }",
      errors: [{ messageId: 'missingErrorDestructure' }],
    },
    // Name fallback: `serviceClient` param with unresolvable origin.
    {
      code: "async function f(serviceClient) { const { data } = await serviceClient.from('x').select(); return data; }",
      errors: [{ messageId: 'missingErrorDestructure' }],
    },
    // Member-expression receiver generalised beyond `auth.supabase`.
    {
      code: "async function f(args) { const { data } = await args.supabase.from('x').select(); return data; }",
      errors: [{ messageId: 'missingErrorDestructure' }],
    },
    // Unchecked result variable through an origin-resolved receiver.
    {
      code: "async function f() { const serviceClient = createServiceClient(); const r = await serviceClient.from('x').insert({}); return r.data; }",
      errors: [{ messageId: 'uncheckedResultVariable' }],
    },
  ],
});

// ── RC-2 with TypeScript syntax — client-type annotations resolve origin ──
// The production lint run parses with typescript-eslint (via
// eslint-config-next), so `param: SupabaseClient<Database>` annotations are
// visible to the rule. Pin that behaviour with the TS parser.
const tsRuleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

tsRuleTester.run(
  'no-unchecked-supabase-error (TS annotations)',
  rule as never,
  {
    valid: [
      // Annotated param used correctly.
      {
        code: "async function f(sc: SupabaseClient<Database>) { const { data, error } = await sc.from('x').select(); return { data, error }; }",
      },
      // Annotation on an unrelated type — not a client.
      {
        code: "async function f(api: RestApi) { const { data } = await api.from('x').select(); return data; }",
      },
    ],
    invalid: [
      // `SupabaseClient`-annotated param under an arbitrary name.
      {
        code: "async function f(anyName: SupabaseClient<Database>) { const { data } = await anyName.from('x').select(); return data; }",
        errors: [{ messageId: 'missingErrorDestructure' }],
      },
      // Local type alias annotation.
      {
        code: "async function f(conn: DbClient) { await conn.from('x').update({ a: 1 }).eq('id', 1); }",
        errors: [{ messageId: 'discardedQueryResult' }],
      },
      // Annotated const binding.
      {
        code: "async function f() { const sc: SupabaseClient<Database> = getInjectedClient(); const { data } = await sc.from('x').select(); return data; }",
        errors: [{ messageId: 'missingErrorDestructure' }],
      },
    ],
  },
);
