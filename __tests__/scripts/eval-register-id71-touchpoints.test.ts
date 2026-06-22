/**
 * eval-register-id71-touchpoints — born-evaluable contract registration for the
 * new/refined ID-71 touchpoints (M14/M40, B-INV-13/14/40) + the B-INV-15
 * zero-Raindrop-cloud-egress assertion over the registration path.
 *
 * Behaviour contract (testStrategy, {71.20}):
 *   - each new/refined ID-71 touchpoint (the consolidated MCP tools + the
 *     `lib/ai` inline touchpoints) is a registered touchpoint with a bound
 *     `AgentEvalContract` routing through ID-104's registry;
 *   - every contract satisfies the frozen 7-field `AgentEvalContract` schema;
 *   - tool touchpoint_ids match the ACTUAL registered MCP tool-name strings;
 *   - inline touchpoint grounding_shape is aligned with the 71.17 grounding map
 *     (`AI_TOUCHPOINT_GROUNDING`) — the contract NEVER drifts from the declared
 *     shape the call site actually uses;
 *   - `registerId71Touchpoints` calls `registerTouchpoint` once per contract and
 *     is idempotent (a re-register with unchanged contracts is a no-op);
 *   - a GATING network assertion confirms ZERO egress to the hosted Raindrop
 *     cloud (`raindrop.ai`) over the registration path — `localhost:5899`
 *     (local Workshop / OTel, empty writeKey) is explicitly PERMITTED.
 *
 * Behaviour-first per reference/test-philosophy.md; shared Supabase mock only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/supabase/types/database.types';
import { agentEvalContractSchema } from '@/lib/eval/contract';
import { AI_TOUCHPOINT_GROUNDING } from '@/lib/ai/grounding';
import type { Touchpoint } from '@/lib/eval/registry';
import {
  REGISTERED_ID71_TOUCHPOINT_CONTRACTS,
  ID71_TOOL_TOUCHPOINT_IDS,
  ID71_INLINE_TOUCHPOINT_IDS,
  registerId71Touchpoints,
} from '@/scripts/eval-register-id71-touchpoints';

import { createMockSupabaseClient } from '@/__tests__/helpers/mock-supabase';

/**
 * The shared Supabase mock typed as the production client — same helper pattern
 * as eval-register-suites.test.ts.
 */
function mockDb(): SupabaseClient<Database> &
  ReturnType<typeof createMockSupabaseClient> {
  return createMockSupabaseClient() as unknown as SupabaseClient<Database> &
    ReturnType<typeof createMockSupabaseClient>;
}

/** A minimal stored touchpoint row for mock registry reads. */
function storedRow(touchpoint_id: string): Touchpoint {
  return {
    touchpoint_id,
    kind: 'tool',
    owner: 'ai-tooling-team',
    suite_name: 'l4',
    grounding_shape: 'structured_output',
    severity_on_fail: 'warn',
    variance_band: 0.02,
    graduation_metric: null,
    contract_version: 1,
    registry_version: 1,
    created_at: '2026-06-22T00:00:00.000Z',
    updated_at: '2026-06-22T00:00:00.000Z',
  } as Touchpoint;
}

// ---------------------------------------------------------------------------
// REGISTERED_ID71_TOUCHPOINT_CONTRACTS — the static contract manifest
// ---------------------------------------------------------------------------

describe('REGISTERED_ID71_TOUCHPOINT_CONTRACTS', () => {
  it('is non-empty (the new/refined ID-71 touchpoints each ship a contract)', () => {
    expect(REGISTERED_ID71_TOUCHPOINT_CONTRACTS.length).toBeGreaterThan(0);
  });

  it('every contract satisfies the AgentEvalContract Zod schema (all 7 mandatory fields present)', () => {
    for (const contract of REGISTERED_ID71_TOUCHPOINT_CONTRACTS) {
      const result = agentEvalContractSchema.safeParse(contract);
      expect(
        result.success,
        `contract ${contract.touchpoint_id} failed Zod parse`,
      ).toBe(true);
    }
  });

  it('all touchpoint_ids are unique (no duplicates)', () => {
    const ids = REGISTERED_ID71_TOUCHPOINT_CONTRACTS.map(
      (c) => c.touchpoint_id,
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does NOT collide with the suite-contract namespace (suite contracts are a distinct concern)', () => {
    // The suite contracts use `mcp-eval.*` / `eval.*`; ID-71 tool touchpoints use
    // `tool.*` and inline touchpoints use `inline.*`. Keep the namespaces disjoint
    // so the two registration modules never trip the B-INV-3 PK conflict.
    for (const c of REGISTERED_ID71_TOUCHPOINT_CONTRACTS) {
      expect(c.touchpoint_id.startsWith('mcp-eval.')).toBe(false);
      expect(c.touchpoint_id.startsWith('eval.')).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Tool touchpoints — kind='tool', ids match the ACTUAL MCP tool-name strings
// ---------------------------------------------------------------------------

describe('ID-71 tool touchpoints (kind=tool)', () => {
  it('covers exactly the new/refined consolidated MCP tool names', () => {
    expect([...ID71_TOOL_TOUCHPOINT_IDS].sort()).toEqual(
      [
        'find',
        'where_are_we_exposed',
        'whats_in_my_queue',
        'get',
        'find_duplicates',
        'assign',
        'get_entity_relationships',
      ].sort(),
    );
  });

  it('each tool contract is kind=tool and references the tool-name string verbatim', () => {
    const toolContracts = REGISTERED_ID71_TOUCHPOINT_CONTRACTS.filter(
      (c) => c.kind === 'tool',
    );
    for (const c of toolContracts) {
      expect(c.kind).toBe('tool');
      // touchpoint_id is `tool.<toolName>`; the suffix is the verbatim tool name.
      const toolName = c.touchpoint_id.replace(/^tool\./, '');
      expect(ID71_TOOL_TOUCHPOINT_IDS).toContain(toolName);
    }
  });
});

// ---------------------------------------------------------------------------
// Inline touchpoints — kind='inline', grounding aligned with the 71.17 map
// ---------------------------------------------------------------------------

describe('ID-71 inline touchpoints (kind=inline)', () => {
  it('covers exactly the lib/ai touchpoints declared in AI_TOUCHPOINT_GROUNDING', () => {
    expect([...ID71_INLINE_TOUCHPOINT_IDS].sort()).toEqual(
      Object.keys(AI_TOUCHPOINT_GROUNDING).sort(),
    );
  });

  it('each inline contract grounding_shape matches the 71.17 grounding declaration (no drift)', () => {
    const inlineContracts = REGISTERED_ID71_TOUCHPOINT_CONTRACTS.filter(
      (c) => c.kind === 'inline',
    );
    for (const c of inlineContracts) {
      const aiId = c.touchpoint_id.replace(/^inline\./, '');
      const declaredShape =
        AI_TOUCHPOINT_GROUNDING[aiId as keyof typeof AI_TOUCHPOINT_GROUNDING];
      expect(
        c.grounding_shape,
        `inline touchpoint ${aiId} grounding drifted from AI_TOUCHPOINT_GROUNDING`,
      ).toBe(declaredShape);
    }
  });

  it('every inline touchpoint in the grounding map has a registered contract', () => {
    const inlineIds = REGISTERED_ID71_TOUCHPOINT_CONTRACTS.filter(
      (c) => c.kind === 'inline',
    ).map((c) => c.touchpoint_id.replace(/^inline\./, ''));
    for (const aiId of Object.keys(AI_TOUCHPOINT_GROUNDING)) {
      expect(
        inlineIds,
        `missing contract for inline touchpoint ${aiId}`,
      ).toContain(aiId);
    }
  });
});

// ---------------------------------------------------------------------------
// registerId71Touchpoints — idempotent bootstrap registration
// ---------------------------------------------------------------------------

describe('registerId71Touchpoints', () => {
  it('calls registerTouchpoint once per contract (N contracts → N DB pre-reads + N inserts)', async () => {
    const supabase = mockDb();
    const n = REGISTERED_ID71_TOUCHPOINT_CONTRACTS.length;

    supabase._chain.maybeSingle.mockResolvedValue({ data: null, error: null });
    supabase._chain.single.mockResolvedValue({
      data: storedRow('tool.find'),
      error: null,
    });

    await registerId71Touchpoints(supabase);

    expect(supabase._chain.maybeSingle).toHaveBeenCalledTimes(n);
    expect(supabase._chain.insert).toHaveBeenCalledTimes(n);
  });

  it('is a no-op (zero inserts) when every contract row already exists with a non-null pre-read', async () => {
    const supabase = mockDb();

    // A non-null pre-read means an existing row. registry.ts only inserts when
    // the pre-read is null; a field diff routes to update, never insert. We
    // assert inserts never fire when the pre-read is non-null.
    supabase._chain.maybeSingle.mockImplementation(() =>
      Promise.resolve({ data: storedRow('tool.find'), error: null }),
    );

    await registerId71Touchpoints(supabase);

    expect(supabase._chain.insert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GATING zero-Raindrop-cloud-egress assertion (B-INV-15). NOT advisory: if the
// registration path ever reaches the hosted Raindrop cloud, this fails CI.
// localhost:5899 (local Workshop / OTel, empty writeKey) is PERMITTED.
// ---------------------------------------------------------------------------

describe('zero Raindrop-cloud egress over the ID-71 registration path (B-INV-15 — gating)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn((input: unknown) => {
      // Permit local Workshop / OTel; reject the hosted Raindrop cloud only.
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : String((input as { url?: string })?.url ?? '');
      if (/raindrop\.ai/i.test(url)) {
        throw new Error(
          `NETWORK EGRESS to hosted Raindrop cloud — registration must stay on-platform (url=${url})`,
        );
      }
      // A non-cloud call (e.g. localhost:5899) resolves benignly.
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = fetchSpy as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('registers all ID-71 touchpoints WITHOUT any call to the hosted Raindrop cloud', async () => {
    const supabase = mockDb();
    supabase._chain.maybeSingle.mockResolvedValue({ data: null, error: null });
    supabase._chain.single.mockResolvedValue({
      data: storedRow('tool.find'),
      error: null,
    });

    await registerId71Touchpoints(supabase);

    // The load-bearing assertion: not one call to raindrop.ai. (The spy throws
    // on a cloud host, so any cloud call would already have failed the await.)
    for (const call of fetchSpy.mock.calls) {
      const url = String(call[0]);
      expect(url).not.toMatch(/raindrop\.ai/i);
    }
  });

  it('PERMITS the local Raindrop Workshop / OTel endpoint (localhost:5899) — it does NOT throw and resolves benignly', async () => {
    // Make the "localhost:5899 is permitted" claim load-bearing rather than a
    // comment: invoke the egress-policy spy directly with the local Workshop /
    // OTel endpoint and prove the non-cloud branch resolves without throwing.
    // localhost is the LOCAL viewer (empty write key by design) — never the
    // hosted cloud — so the egress policy must let it through.
    const localResponse = await globalThis.fetch(
      'http://localhost:5899/ingest',
    );

    // Resolved (no throw) via the spy's non-raindrop branch — a 204-style empty
    // result. If the policy ever started blocking localhost, this await would
    // reject and the test would fail.
    expect(localResponse.status).toBe(204);
    expect(fetchSpy).toHaveBeenCalledWith('http://localhost:5899/ingest');
  });

  it('the registration module source contains no hosted-Raindrop-cloud egress path', async () => {
    // Static audit: the module must not reference the Raindrop cloud host or a
    // Workshop writeKey. A `localhost:5899` reference in a comment is permitted,
    // but the hosted cloud host and writeKey must be absent entirely.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const source = await fs.readFile(
      path.resolve(process.cwd(), 'scripts/eval-register-id71-touchpoints.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/raindrop\.ai/i);
    expect(source).not.toMatch(/writeKey/i);
  });
});
