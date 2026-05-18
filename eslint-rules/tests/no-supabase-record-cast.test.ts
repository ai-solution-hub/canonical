import rule from '../no-supabase-record-cast.js';
import { RuleTester } from 'eslint';

// RuleTester uses Mocha-style describe/it globals; vitest provides them when
// `globals: true` is set in vitest.config.ts (which it is for this repo).

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parser: await import('@typescript-eslint/parser'),
  },
});

ruleTester.run('no-supabase-record-cast', rule as never, {
  // -------------------------------------------------------------------------
  // Valid cases — rule must NOT fire
  // -------------------------------------------------------------------------
  valid: [
    // ---- Escape hatch 1: JSONB column bare member access ----
    // domain_metadata is a known JSONB column
    {
      code: `const meta = workspace.domain_metadata as Record<string, unknown>;`,
    },
    // summary_data is a known JSONB column
    {
      code: `const sd = item.summary_data as Record<string, unknown> | null;`,
    },
    // extraction_metadata is a known JSONB column
    {
      code: `const em = doc.extraction_metadata as Record<string, unknown>;`,
    },

    // ---- Escape hatch 1b: JSONB column with nullish coalescing ----
    // `(foo.domain_metadata ?? {})` unwraps to the JSONB column
    {
      code: `const meta = (workspace.domain_metadata ?? {}) as Record<string, unknown>;`,
    },
    // `metadata` column is JSONB across multiple tables
    {
      code: `const m = item.metadata as Record<string, unknown> | null;`,
    },
    // `(item.metadata ?? {})` — nullish coalesce on JSONB column
    {
      code: `const m = (item.metadata ?? {}) as Record<string, unknown>;`,
    },

    // ---- Escape hatch 2: third-party API response (fetch / JSON.parse) ----
    // Cast on res.json() is a legitimate API response shape
    {
      code: `async function f() { const data = (await res.json()) as Record<string, unknown>; }`,
    },
    // Cast on JSON.parse result
    {
      code: `const parsed = JSON.parse(raw) as Record<string, unknown>;`,
    },

    // ---- Escape hatch 3: non-Supabase chains ----
    // A plain object that is NOT from a Supabase chain
    {
      code: `const obj = someObject as Record<string, unknown>;`,
    },
    // Spreading into a JSON result column is fine (not a Supabase-origin cast)
    {
      code: `const result = { ...currentSnapshot } as unknown as Record<string, unknown>;`,
    },

    // ---- Direct property accesses — no cast needed (already typed) ----
    {
      code: `
        async function f(supabase: any) {
          const { data } = await supabase.from('content_items').select('id').single();
          const id = data?.id;
        }
      `,
    },

    // ---- Cast on a non-Record target type ----
    // Only Record<string, unknown> is flagged — other casts are fine
    {
      code: `
        async function f(supabase: any) {
          const { data } = await supabase.from('foo').select('x').single();
          const x = data as string;
        }
      `,
    },
  ],

  // -------------------------------------------------------------------------
  // Invalid cases — rule MUST fire
  // -------------------------------------------------------------------------
  invalid: [
    // ---- Pattern 1: direct chain `.from(...).select(...).data` ----
    {
      code: `
        async function f(supabase: any) {
          const { data } = await supabase.from('content_items').select('id').single();
          const row = data as Record<string, unknown>;
        }
      `,
      errors: [{ messageId: 'recordCast' }],
    },

    // ---- Pattern 1b: direct chain with array cast ----
    {
      code: `
        async function f(supabase: any) {
          const { data: rows } = await supabase.from('content_items').select('id');
          const items = (rows ?? []) as Record<string, unknown>[];
        }
      `,
      errors: [{ messageId: 'recordCast' }],
    },

    // ---- Pattern 2: cast on destructured `data` from Supabase chain ----
    // The inner expression `data` is a MemberExpression `.data` on the chain
    {
      code: `
        async function f(supabase: any) {
          const result = await supabase.from('bid_responses').select('metadata').single();
          const row = result.data as Record<string, unknown>;
        }
      `,
      errors: [{ messageId: 'recordCast' }],
    },

    // ---- Pattern 3: RPC result cast ----
    {
      code: `
        async function f(supabase: any) {
          const { data: rows } = await supabase.rpc('get_bid_question_stats_batch', { p_project_ids: [] });
          const first = (rows ?? []) as Record<string, unknown>[];
        }
      `,
      errors: [{ messageId: 'recordCast' }],
    },

    // ---- Canonical site 1 variant: cast on rpc() result .data (historical pattern) ----
    {
      code: `
        async function f(supabase: any) {
          const batchStats = await supabase.rpc('get_bid_question_stats_batch', {});
          const allRows = batchStats.data as Record<string, unknown>[];
        }
      `,
      errors: [{ messageId: 'recordCast' }],
    },

    // ---- Canonical site 2: lib/mcp/tools/search.ts (historical) ----
    {
      code: `
        async function f(supabase: any) {
          const { data: results } = await supabase.rpc('hybrid_search', {});
          const items = (results ?? []) as Record<string, unknown>[];
        }
      `,
      errors: [{ messageId: 'recordCast' }],
    },

    // ---- Canonical site 3: lib/mcp/tools/content.ts (historical) ----
    {
      code: `
        async function f(supabase: any) {
          const { data: rows } = await supabase.from('content_items').select('id, title').in('id', []);
          const items = (rows ?? []) as Record<string, unknown>[];
        }
      `,
      errors: [{ messageId: 'recordCast' }],
    },

    // ---- RPC .data member access cast ----
    {
      code: `
        async function f(supabase: any, isOk: any) {
          const result = await supabase.from('content_items').select('updated_by').maybeSingle();
          const detail = isOk(result) ? (result.data as Record<string, unknown> | null) : null;
        }
      `,
      errors: [{ messageId: 'recordCast' }],
    },

    // ---- Shape F1: for...of loop variable cast (lib/topic-inference.ts:177 pattern) ----
    // `for (const item of items)` where items = data from Supabase; cast on the loop var
    {
      code: `
        async function f(supabase: any) {
          const { data: items } = await supabase.from('content_items').select('id, title, layer');
          for (const item of items) {
            const layer = (item as Record<string, unknown>).layer;
          }
        }
      `,
      errors: [{ messageId: 'recordCast' }],
    },

    // ---- Shape F1b: for...of with ?? [] guard on the array ----
    {
      code: `
        async function f(supabase: any) {
          const { data: items } = await supabase.from('content_items').select('id, layer');
          for (const item of (items ?? [])) {
            const layer = (item as Record<string, unknown>).layer;
          }
        }
      `,
      errors: [{ messageId: 'recordCast' }],
    },

    // ---- Shape F2: array callback parameter cast (.filter) (lib/topic-inference.ts:309 pattern) ----
    {
      code: `
        async function f(supabase: any, domain: any) {
          const { data: detailItems } = await supabase.from('content_items').select('id, primary_domain, layer');
          const candidates = detailItems.filter((item) => {
            const itemLayer = (item as Record<string, unknown>).layer;
            return itemLayer !== domain;
          });
        }
      `,
      errors: [{ messageId: 'recordCast' }],
    },

    // ---- Shape F2b: array callback parameter cast (.map) ----
    {
      code: `
        async function f(supabase: any) {
          const { data: rows } = await supabase.from('content_items').select('id, layer');
          const layers = rows.map((item) => (item as Record<string, unknown>).layer);
        }
      `,
      errors: [{ messageId: 'recordCast' }],
    },

    // ---- Shape F3: candidate[0] direct element access cast (lib/topic-inference.ts:322 pattern) ----
    {
      code: `
        async function f(supabase: any, domain: any) {
          const { data: detailItems } = await supabase.from('content_items').select('id, layer');
          const candidates = detailItems.filter((item) => item.id !== null);
          const bestMatch = candidates[0];
          const matchLayer = (bestMatch as Record<string, unknown>).layer;
        }
      `,
      errors: [{ messageId: 'recordCast' }],
    },
  ],
});
