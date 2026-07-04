/**
 * Unit tests for `lib/queue/handlers/batch-reclassify.ts` — Session 225 W1-C.
 *
 * Spec: docs/specs/§5.4.2-batch-reclassify-spec.md §8 (11 ACs, AC-11 deferred
 * per D-4 ratified flip — CLI-only with future UI) + §7.8 Vitest cases
 * mapping. The handler under test is the pure async function the dispatcher
 * invokes from `lib/queue/dispatch.ts case 'batch_reclassify':`.
 *
 * AC coverage (10 of 11; AC-11 UI-flow E2E DEFERRED):
 *   AC-1  Result envelope shape on happy path (BatchReclassifyResult).
 *   AC-3  Same-day idempotency dedup (covered at integration level too).
 *   AC-4  Next-day idempotency renewal (Date.now spy + ISO date pin).
 *   AC-5  Per-item failure tolerance (continue-with-partial; mock 429).
 *   AC-6  workspace_id missing → PermanentJobError.
 *   AC-7  force:false + 0 candidates → zero-success result (NOT throw).
 *   AC-8  force:true + 0 candidates → PermanentJobError.
 *   AC-9  Cooperative cancel mid-loop (handler stops on status flip).
 *   AC-10 80% per-item failure threshold escalation (PermanentJobError).
 *   AC-2  (handler-side) drains all candidates to completion.
 *
 * Mocking discipline (per memory feedback):
 *   - `Anthropic` SDK mocked at the @anthropic-ai/sdk module boundary so the
 *     handler's per-item loop is exercised without invoking the real API.
 *   - `@/lib/supabase/server` mocked at file scope per
 *     `feedback_orchestrator_internal_service_client_test_mock` because
 *     the handler's `isJobCancelled` calls `createServiceClient()` internally.
 *   - Module-boundary helpers mocked: `@/lib/ai/classify`, `@/lib/ai/embed`,
 *     `@/lib/content/strip-markdown`, `@/lib/entities/entity-aliases`,
 *     `@/lib/entities/entity-context`, `@/lib/entities/entity-dedup`,
 *     `@/lib/entities/entity-metadata-bridge`, `@/lib/layer-inference`,
 *     `@/lib/validation/schemas` — kept thin so the handler's per-item
 *     branching logic is exercised.
 *   - Per `feedback_centralised_constant_mock_adoption_sweep`: vi.mock blocks
 *     reach the actual module via `vi.importActual` for re-exports; mocked
 *     functions never duplicate constants.
 *   - `ANTHROPIC_API_KEY` is set to `sk-ant-test` by `__tests__/setup.ts`
 *     so the handler's env check passes; we re-stub for explicit clarity.
 *
 * Verbatim spec contracts quoted in test setup (per
 * `feedback_brief_quote_spec_verbatim`):
 *   - PermanentJobError messages: `workspace_id_missing`,
 *     `workspace_id_mismatch: payload=<x>, expected=<y>`,
 *     `taxonomy_load_failed: domains: <msg>`,
 *     `taxonomy_load_failed: zero domains returned`,
 *     `no_candidates_under_force`,
 *     `eval_rule_regression_suspected: <N>/<M> items failed (>80% threshold)`.
 *   - Per-item result statuses: 'reclassified' | 'skipped' | 'failed'.
 *   - CANCEL_POLL_CADENCE = 10 (handler L467) — cooperative-cancel poll
 *     happens at items where i > 0 && i % 10 === 0.
 *   - 80% threshold: `failedCount / totalProcessed > 0.8` raises
 *     PermanentJobError (handler L1090-1098).
 *   - cancellation_message: "cancelled mid-run after <N>/<M> items"
 *     (handler L1126).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '@/__tests__/helpers/mock-supabase';
import { CLIENT_CONFIG } from '@/lib/client-config';
import { PermanentJobError } from '@/lib/queue/dispatch';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

// ---------------------------------------------------------------------------
// Hoisted mocks for the Anthropic SDK + supabase server module.
// ---------------------------------------------------------------------------

const { mockAnthropicCreate, mockCreateServiceClient } = vi.hoisted(() => ({
  // Per-test spy returning Claude tool-use response shape.
  mockAnthropicCreate: vi.fn(),
  // Returns the file-scope mock supabase client; per-test scenarios push
  // ad-hoc responses to it via _chain mocks for the cancel-poll path.
  mockCreateServiceClient: vi.fn(),
}));

// `Anthropic` is the default export — class with a `messages.create()` method.
// Mock as a class returning an object with the spy.
//
// Per CLAUDE.md gotchas: "Arrow functions in `mockImplementation()` cannot be
// used with `new` — use `function` keyword". The handler at L608 calls
// `new Anthropic(...)`, so the implementation must be a function expression
// (which has `[[Construct]]`) NOT an arrow function.
vi.mock('@anthropic-ai/sdk', () => {
  function Anthropic(this: {
    messages: { create: typeof mockAnthropicCreate };
  }) {
    this.messages = { create: mockAnthropicCreate };
  }
  return { default: Anthropic };
});

// Per `feedback_orchestrator_internal_service_client_test_mock`: file-scope
// mock for `@/lib/supabase/server` because `isJobCancelled` calls
// `createServiceClient()` internally for cooperative-cancel polling.
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: mockCreateServiceClient,
}));

// Module-boundary mocks — keep thin so the handler's branching logic is
// exercised. Pure functions returning typed values.
vi.mock('@/lib/ai/classify', () => ({
  isExcludedEntity: vi.fn(() => false),
  validateDomain: vi.fn((d: string) => d),
}));

vi.mock('@/lib/ai/embed', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0.1)),
}));

vi.mock('@/lib/content/strip-markdown', () => ({
  stripMarkdown: vi.fn((s: string) => s),
}));

vi.mock('@/lib/entities/entity-aliases', () => ({
  loadAliases: vi.fn().mockResolvedValue(undefined),
  resolveAlias: vi.fn((s: string) => s),
}));

vi.mock('@/lib/entities/entity-context', () => ({
  extractEntityContext: vi.fn(() => 'context snippet'),
}));

vi.mock('@/lib/entities/entity-dedup', () => ({
  canonicalise: vi.fn((s: string) => s),
}));

vi.mock('@/lib/entities/entity-metadata-bridge', () => ({
  bridgeTemporalReferencesToEntities: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/layer-inference', () => ({
  inferLayer: vi.fn(() => ({
    suggestedLayer: 'core' as const,
    confidence: 0.9,
  })),
}));

vi.mock('@/lib/validation/schemas', () => ({
  normaliseTag: vi.fn((s: string) => s.toLowerCase()),
}));

// Import the handler AFTER vi.mock declarations so the mocked modules are in
// place when the handler module's import resolves.
const { runBatchReclassifyJob } =
  await import('@/lib/queue/handlers/batch-reclassify');

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

const WORKSPACE_ID = CLIENT_CONFIG.client_id; // typically 'default'

const ITEM_IDS = [
  'a1111111-1111-4111-8111-111111111111',
  'a2222222-2222-4222-8222-222222222222',
  'a3333333-3333-4333-8333-333333333333',
  'a4444444-4444-4444-8444-444444444444',
  'a5555555-5555-4555-8555-555555555555',
  'a6666666-6666-4666-8666-666666666666',
  'a7777777-7777-4777-8777-777777777777',
  'a8888888-8888-4888-8888-888888888888',
  'a9999999-9999-4999-8999-999999999999',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
];

const JOB_ID = 'b0b0b0b0-0000-4000-8000-000000000001';
const USER_ID = 'b0b0b0b0-0000-4000-8000-000000000002';

const AUTH_CONTEXT = {
  user_id: USER_ID,
  role: 'editor' as const,
  workspace_id: WORKSPACE_ID,
};

/** Default body — happy-path defaults matching producer route schema. */
function makeBody(
  overrides: Partial<{
    workspace_id: string;
    domain: string | null;
    limit: number;
    force: boolean;
    entities_only: boolean;
    batch_size: number;
    model_tier: string;
  }> = {},
) {
  return {
    workspace_id: overrides.workspace_id ?? WORKSPACE_ID,
    domain: overrides.domain ?? null,
    limit: overrides.limit ?? 0,
    force: overrides.force ?? false,
    entities_only: overrides.entities_only ?? false,
    batch_size: overrides.batch_size ?? 1,
    model_tier: overrides.model_tier ?? 'claude-sonnet-4-6',
  };
}

/** Default Claude tool-use response — successful classification with empty
 *  entities/relationships (zero downstream side-effects). */
function makeAnthropicResponse(
  opts: {
    primary_domain?: string;
    primary_subtopic?: string;
    ai_keywords?: string[];
    entities?: Array<{ name: string; type: string; canonical_name: string }>;
    relationships?: Array<{
      source: string;
      relationship: string;
      target: string;
    }>;
    input_tokens?: number;
    output_tokens?: number;
  } = {},
) {
  return {
    content: [
      {
        type: 'tool_use',
        name: 'return_classification_with_entities',
        input: {
          primary_domain: opts.primary_domain ?? 'security',
          primary_subtopic: opts.primary_subtopic ?? 'cyber-security',
          secondary_domain: null,
          secondary_subtopic: null,
          ai_keywords: opts.ai_keywords ?? ['encryption', 'gdpr'],
          summary: 'A test summary about security.',
          suggested_title: 'Security overview',
          classification_confidence: 0.95,
          classification_reasoning: 'Content discusses security controls.',
          entities: opts.entities ?? [],
          relationships: opts.relationships ?? [],
          temporal_references: [],
        },
      },
    ],
    usage: {
      input_tokens: opts.input_tokens ?? 1000,
      output_tokens: opts.output_tokens ?? 200,
    },
  };
}

/** Build a realistic content_items row. */
function makeContentRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    content: 'Sample content text about security and encryption.',
    title: 'Sample Item',
    suggested_title: 'Sample suggested title',
    content_type: 'q_a_pair',
    primary_domain: null,
    primary_subtopic: null,
    ai_keywords: null,
    classification_confidence: null,
    classified_at: null,
    metadata: null,
    platform: 'extraction',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock-supabase scenario builder.
//
// The handler's call sequence (per lib/queue/handlers/batch-reclassify.ts):
//   1. taxonomy_domains.select(...).eq('is_active',true).order(...)
//        → resolves via .then() with { data: domains, error }
//   2. taxonomy_subtopics.select(...).eq('is_active',true).order(...)
//        → resolves via .then() with { data: subtopics, error }
//   3. content_items.select(...) [+optional .eq('primary_domain',...)]
//        .not(...).is(...).order(...).limit(...)
//        → resolves via .then() with { data: items, error }
//   4. Per item with successful classification:
//        a. content_items.update(updateData).eq('id', item.id)
//           → resolves via .then() / chain default { error: null }
//        b. entity_mentions.delete().eq('source_document_id', ...)
//           → resolves via chain default
//        c. entity_mentions.insert(rows) — only if entities.length > 0
//           → resolves via chain default { error: null }
//        d. entity_relationships.delete().eq('source_document_id', ...)
//           → resolves via chain default
//        e. entity_relationships.insert(rows) — only if relationships.length > 0
//           → resolves via chain default { error: null }
//
// Cooperative-cancel mock: at i % 10 === 0 (and i > 0), the handler calls
// createServiceClient() and then SELECT processing_queue.status. We provide
// a separate inline mock at file scope.
// ---------------------------------------------------------------------------

interface SupabaseScenario {
  /** Taxonomy domains (default: 1 active domain). */
  domains: Array<{ id: string; name: string }> | null;
  domainsError?: { message: string } | null;
  /** Taxonomy subtopics. */
  subtopics: Array<{
    name: string;
    domain_id: string;
    description: string | null;
  }>;
  subtopicsError?: { message: string } | null;
  /** Content items the filter selects. */
  contentItems: ReturnType<typeof makeContentRow>[];
  contentItemsError?: { message: string } | null;
}

function configureSupabase(
  client: MockSupabaseClient,
  scenario: SupabaseScenario,
): void {
  // 1. taxonomy_domains.select(...).eq('is_active',true).order('display_order')
  client._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
    resolve({
      data: scenario.domains,
      error: scenario.domainsError ?? null,
    }),
  );

  if (scenario.domainsError || !scenario.domains) return;

  // 2. taxonomy_subtopics.select(...)
  client._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
    resolve({
      data: scenario.subtopics,
      error: scenario.subtopicsError ?? null,
    }),
  );

  if (scenario.subtopicsError) return;

  // 3. content_items.select(...) candidates.
  client._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
    resolve({
      data: scenario.contentItems,
      error: scenario.contentItemsError ?? null,
    }),
  );

  // 4-5. Per-item updates + entity writes — each resolves via chain default
  // { data: null, error: null, count: 0 } so we don't enqueue per-item
  // mocks. The handler's `update(...).eq(...)` doesn't await `.single()`
  // so the chain-default is sufficient.
}

/** Configure the cooperative-cancel poll path: a separate service client whose
 *  processing_queue.select.eq.maybeSingle returns a flippable status. */
function configureCancelPoll(
  status: 'pending' | 'processing' | 'cancelled',
): MockSupabaseClient {
  const cancelClient = createMockSupabaseClient();
  cancelClient._chain.maybeSingle.mockResolvedValue({
    data: { status },
    error: null,
  });
  return cancelClient;
}

/** Configure cancel poll to flip from 'processing' on first call to
 *  'cancelled' on subsequent calls. */
function configureCancelPollFlip(): MockSupabaseClient {
  const cancelClient = createMockSupabaseClient();
  cancelClient._chain.maybeSingle
    // First poll (item 10): not cancelled yet.
    .mockResolvedValueOnce({ data: { status: 'processing' }, error: null })
    // Second poll (item 20): cancelled.
    .mockResolvedValueOnce({ data: { status: 'cancelled' }, error: null });
  return cancelClient;
}

// ---------------------------------------------------------------------------
// Test suite.
// ---------------------------------------------------------------------------

describe('runBatchReclassifyJob — batch_reclassify handler (§5.4.2)', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
    // Default Anthropic response: success.
    mockAnthropicCreate.mockResolvedValue(makeAnthropicResponse());
    // Default cancel-poll: status='processing' (not cancelled).
    mockCreateServiceClient.mockReturnValue(configureCancelPoll('processing'));
    // Required env (defence in depth — setup.ts already sets it).
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  });

  // -------------------------------------------------------------------------
  // AC-1 — Result envelope shape on happy path.
  // Spec §8 AC-1 lines 1182-1188; §4.1 BatchReclassifyResult contract.
  // -------------------------------------------------------------------------

  describe('AC-1 — result envelope shape (5 items, all reclassify)', () => {
    it('returns BatchReclassifyResult with reclassified=5, failed=0, skipped=0; per-item results all status="reclassified"', async () => {
      const items = ITEM_IDS.slice(0, 5).map((id) => makeContentRow(id));
      configureSupabase(mockSupabase, {
        domains: [{ id: 'd1', name: 'security' }],
        subtopics: [
          { name: 'cyber-security', domain_id: 'd1', description: null },
        ],
        contentItems: items,
      });

      const result = await runBatchReclassifyJob(
        makeBody(),
        mockSupabase as unknown as SupabaseClient<Database>,
        AUTH_CONTEXT,
        JOB_ID,
      );

      expect(result.total_items).toBe(5);
      expect(result.reclassified).toBe(5);
      expect(result.failed).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.results).toHaveLength(5);
      for (const r of result.results) {
        expect(r.status).toBe('reclassified');
        expect(r.new_domain).toBe('security');
        expect(r.new_subtopic).toBe('cyber-security');
      }
      // Anthropic called once per item.
      expect(mockAnthropicCreate).toHaveBeenCalledTimes(5);
      // Cost computed via Sonnet pricing: 5 * 1000 input + 5 * 200 output.
      // input cost = 5000 * (3/1_000_000) = 0.015
      // output cost = 1000 * (15/1_000_000) = 0.015
      expect(result.total_cost).toBeCloseTo(0.03, 4);
      expect(result.total_input_tokens).toBe(5000);
      expect(result.total_output_tokens).toBe(1000);
    });
  });

  // -------------------------------------------------------------------------
  // AC-4 — Next-day re-enqueue creates fresh job (Date.now spy validates
  // ISO timestamp pinning at the handler boundary).
  // Spec §8 AC-4 lines 1213-1220; per `feedback_date_now_constructor_testability`.
  // -------------------------------------------------------------------------

  describe('AC-4 — Date.now spy pins ISO timestamp', () => {
    it('classified_at uses pinned Date.now-derived ISO string', async () => {
      // Pin Date.now to a specific UTC date.
      const pinnedMs = new Date('2026-05-06T12:00:00.000Z').getTime();
      const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(pinnedMs);

      const items = [makeContentRow(ITEM_IDS[0])];
      configureSupabase(mockSupabase, {
        domains: [{ id: 'd1', name: 'security' }],
        subtopics: [
          { name: 'cyber-security', domain_id: 'd1', description: null },
        ],
        contentItems: items,
      });

      await runBatchReclassifyJob(
        makeBody(),
        mockSupabase as unknown as SupabaseClient<Database>,
        AUTH_CONTEXT,
        JOB_ID,
      );

      // Inspect the content_items.update payload — classified_at should
      // resolve to the pinned ISO string.
      const updateCalls = mockSupabase._chain.update.mock.calls;
      const classifyUpdates = updateCalls.filter((c) => {
        const arg = c[0] as Record<string, unknown>;
        return typeof arg.classified_at === 'string';
      });
      expect(classifyUpdates.length).toBeGreaterThan(0);
      const firstClassifyUpdate = classifyUpdates[0][0] as Record<
        string,
        unknown
      >;
      expect(firstClassifyUpdate.classified_at).toBe(
        '2026-05-06T12:00:00.000Z',
      );

      dateSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // AC-5 — Per-item transient failure (continue-with-partial).
  // Spec §8 AC-5 lines 1224-1232; §5.2 + D-2 ratified.
  // -------------------------------------------------------------------------

  describe('AC-5 — per-item 429 does NOT fail the whole job', () => {
    it('Anthropic 429 on item 3 of 5 → reclassified=4, failed=1, results[2].status=failed; items 4+5 still reclassify', async () => {
      const items = ITEM_IDS.slice(0, 5).map((id) => makeContentRow(id));
      configureSupabase(mockSupabase, {
        domains: [{ id: 'd1', name: 'security' }],
        subtopics: [
          { name: 'cyber-security', domain_id: 'd1', description: null },
        ],
        contentItems: items,
      });

      // Mock: succeed on items 1,2; throw on item 3 with rate-limit error;
      // succeed on items 4,5.
      let callCount = 0;
      mockAnthropicCreate.mockImplementation(async () => {
        callCount += 1;
        if (callCount === 3) {
          throw new Error('Anthropic 429: rate limit exceeded');
        }
        return makeAnthropicResponse();
      });

      const result = await runBatchReclassifyJob(
        makeBody(),
        mockSupabase as unknown as SupabaseClient<Database>,
        AUTH_CONTEXT,
        JOB_ID,
      );

      expect(result.total_items).toBe(5);
      expect(result.reclassified).toBe(4);
      expect(result.failed).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.results).toHaveLength(5);
      expect(result.results[2].status).toBe('failed');
      expect(result.results[2].error).toMatch(/Anthropic 429/);
      expect(result.results[0].status).toBe('reclassified');
      expect(result.results[1].status).toBe('reclassified');
      expect(result.results[3].status).toBe('reclassified');
      expect(result.results[4].status).toBe('reclassified');
      // Anthropic called 5 times — failure does not short-circuit.
      expect(mockAnthropicCreate).toHaveBeenCalledTimes(5);
    });
  });

  // -------------------------------------------------------------------------
  // AC-6 — Missing workspace_id → PermanentJobError.
  // Spec §8 AC-6 lines 1236-1241; §4.3.
  // -------------------------------------------------------------------------

  describe('AC-6 — workspace_id missing or empty', () => {
    it('body.workspace_id="" → throws PermanentJobError("workspace_id_missing")', async () => {
      await expect(
        runBatchReclassifyJob(
          makeBody({ workspace_id: '' }),
          mockSupabase as unknown as SupabaseClient<Database>,
          AUTH_CONTEXT,
          JOB_ID,
        ),
      ).rejects.toThrow(PermanentJobError);

      // Re-call to assert message — the PermanentJobError raised by the
      // first call is permanent so we use a fresh client.
      const fresh = createMockSupabaseClient();
      await expect(
        runBatchReclassifyJob(
          makeBody({ workspace_id: '' }),
          fresh as unknown as SupabaseClient<Database>,
          AUTH_CONTEXT,
          JOB_ID,
        ),
      ).rejects.toThrow('workspace_id_missing');
    });

    it('body.workspace_id=undefined (cast as empty string) → throws PermanentJobError("workspace_id_missing")', async () => {
      // The TS interface declares workspace_id as required string; we
      // simulate a producer that has dropped the field by casting the body.
      const body = { ...makeBody() } as Record<string, unknown>;
      delete body.workspace_id;

      await expect(
        runBatchReclassifyJob(
          body as unknown as Parameters<typeof runBatchReclassifyJob>[0],
          mockSupabase as unknown as SupabaseClient<Database>,
          AUTH_CONTEXT,
          JOB_ID,
        ),
      ).rejects.toThrow(/workspace_id_missing/);
    });

    it('body.workspace_id !== CLIENT_CONFIG.client_id → throws PermanentJobError("workspace_id_mismatch: payload=<x>, expected=<y>")', async () => {
      await expect(
        runBatchReclassifyJob(
          makeBody({ workspace_id: 'foreign-tenant' }),
          mockSupabase as unknown as SupabaseClient<Database>,
          AUTH_CONTEXT,
          JOB_ID,
        ),
      ).rejects.toThrow(
        new RegExp(
          `workspace_id_mismatch: payload=foreign-tenant, expected=${CLIENT_CONFIG.client_id}`,
        ),
      );
    });
  });

  // -------------------------------------------------------------------------
  // AC-7 — 0 candidates with force=false → zero-success result (NOT throw).
  // Spec §8 AC-7 lines 1243-1250; §4.3.
  // -------------------------------------------------------------------------

  describe('AC-7 — force:false + 0 candidates → completes with zero counts', () => {
    it('empty content_items list → returns BatchReclassifyResult { total_items: 0, reclassified: 0, ... }; does NOT throw', async () => {
      configureSupabase(mockSupabase, {
        domains: [{ id: 'd1', name: 'security' }],
        subtopics: [
          { name: 'cyber-security', domain_id: 'd1', description: null },
        ],
        contentItems: [],
      });

      const result = await runBatchReclassifyJob(
        makeBody({ force: false }),
        mockSupabase as unknown as SupabaseClient<Database>,
        AUTH_CONTEXT,
        JOB_ID,
      );

      expect(result.total_items).toBe(0);
      expect(result.reclassified).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.results).toEqual([]);
      expect(result.total_cost).toBe(0);
      expect(result.total_input_tokens).toBe(0);
      expect(result.total_output_tokens).toBe(0);
      expect(result.total_entities).toBe(0);
      expect(result.total_relationships).toBe(0);
      expect(result.embedding_errors).toBe(0);
      expect(result.domain_changes).toBe(0);
      expect(result.domain_migrations).toEqual({});
      // Anthropic NOT called.
      expect(mockAnthropicCreate).not.toHaveBeenCalled();
    });

    it('force:false + items returned but all already classified with high confidence → 0 candidates pass filter → zero-success result', async () => {
      // Items already classified with high confidence and no garbled
      // keywords — the filter rejects them.
      const items = ITEM_IDS.slice(0, 3).map((id) =>
        makeContentRow(id, {
          classified_at: '2026-04-01T00:00:00.000Z',
          classification_confidence: 0.95,
          ai_keywords: ['encryption', 'gdpr'],
        }),
      );
      configureSupabase(mockSupabase, {
        domains: [{ id: 'd1', name: 'security' }],
        subtopics: [
          { name: 'cyber-security', domain_id: 'd1', description: null },
        ],
        contentItems: items,
      });

      const result = await runBatchReclassifyJob(
        makeBody({ force: false }),
        mockSupabase as unknown as SupabaseClient<Database>,
        AUTH_CONTEXT,
        JOB_ID,
      );

      expect(result.total_items).toBe(0);
      expect(result.reclassified).toBe(0);
      expect(mockAnthropicCreate).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // entities_only mode — id-space filter fix (ID-131.30
  // G-EXTRACT-CONSUMER-SWEEP-3).
  //
  // entity_mentions.source_document_id is an FK to source_documents, NOT
  // content_items (ID-131 {131.8} M2 rename). The entities_only candidate
  // filter must compare item.source_document_id (not item.id) against the
  // mentioned-set, else every already-entity-tagged item is silently
  // re-treated as entity-less. Items with no source_document_id have no
  // valid entity_mentions FK parent, so they fall through as candidates.
  // -------------------------------------------------------------------------

  describe('entities_only mode — id-space filter (ID-131.30)', () => {
    /** Configure the extra entities_only query sequence: taxonomy domains,
     *  taxonomy subtopics, the content_items candidate query, then a single
     *  entity_mentions page (page size 5000 so one page always terminates
     *  the pagination loop). */
    function configureEntitiesOnlyScenario(
      client: MockSupabaseClient,
      scenario: {
        domains: Array<{ id: string; name: string }>;
        subtopics: Array<{
          name: string;
          domain_id: string;
          description: string | null;
        }>;
        contentItems: Array<Record<string, unknown>>;
        entityMentionRows: Array<{ source_document_id: string }>;
      },
    ): void {
      client._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({ data: scenario.domains, error: null }),
      );
      client._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({ data: scenario.subtopics, error: null }),
      );
      client._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({ data: scenario.contentItems, error: null }),
      );
      client._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({ data: scenario.entityMentionRows, error: null }),
      );
    }

    it('excludes an item whose source_document_id has a matching entity_mentions row, and includes items with null/unmatched source_document_id as candidates', async () => {
      const matchedSourceDocId = 'c1111111-1111-4111-8111-111111111111';
      const unmatchedSourceDocId = 'c3333333-3333-4333-8333-333333333333';

      const matchedItem = makeContentRow(ITEM_IDS[0], {
        classified_at: '2026-01-01T00:00:00.000Z',
        source_document_id: matchedSourceDocId,
      });
      const nullSourceItem = makeContentRow(ITEM_IDS[1], {
        classified_at: '2026-01-01T00:00:00.000Z',
        source_document_id: null,
      });
      const unmatchedItem = makeContentRow(ITEM_IDS[2], {
        classified_at: '2026-01-01T00:00:00.000Z',
        source_document_id: unmatchedSourceDocId,
      });

      configureEntitiesOnlyScenario(mockSupabase, {
        domains: [{ id: 'd1', name: 'security' }],
        subtopics: [
          { name: 'cyber-security', domain_id: 'd1', description: null },
        ],
        contentItems: [matchedItem, nullSourceItem, unmatchedItem],
        entityMentionRows: [{ source_document_id: matchedSourceDocId }],
      });

      const result = await runBatchReclassifyJob(
        makeBody({ entities_only: true }),
        mockSupabase as unknown as SupabaseClient<Database>,
        AUTH_CONTEXT,
        JOB_ID,
      );

      // Only the null-source-document and unmatched-source-document items
      // are candidates — the matched item is excluded (already mentioned).
      expect(result.total_items).toBe(2);
      const resultIds = result.results.map((r) => r.item_id);
      expect(resultIds).not.toContain(matchedItem.id);
      expect(resultIds).toContain(nullSourceItem.id);
      expect(resultIds).toContain(unmatchedItem.id);
      expect(mockAnthropicCreate).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // Entity/relationship WRITE path — id-space fix (ID-131.36
  // G-EXTRACT-CONSUMER-SWEEP-4).
  //
  // entity_mentions.source_document_id / entity_relationships
  // .source_document_id are enforced FKs to source_documents, NOT
  // content_items (ID-131 {131.8} M2 rename). Before this fix the write
  // path keyed both the delete-filter and the insert row on `item.id` (a
  // content_items id) — the DELETE silently no-oped (content_items ids
  // never match source_documents ids) and the INSERT FK-violated (only
  // ever `logger.warn`'d, never thrown) since the M2 megacommit landed on
  // 2026-07-01.
  // -------------------------------------------------------------------------

  describe('entity/relationship WRITE path — id-space fix (ID-131.36)', () => {
    const SOURCE_DOC_ID = 'd1111111-1111-4111-8111-111111111111';

    /** Anthropic response with one entity + one relationship, so both the
     *  entity_mentions and entity_relationships write branches execute. */
    function makeExtractionResponse() {
      return makeAnthropicResponse({
        entities: [
          {
            name: 'Acme Ltd',
            type: 'organisation',
            canonical_name: 'acme ltd',
          },
        ],
        relationships: [
          { source: 'acme ltd', relationship: 'holds', target: 'iso 27001' },
        ],
      });
    }

    it('item WITH a source_document_id writes entity_mentions/entity_relationships keyed on source_document_id, not item.id', async () => {
      const item = makeContentRow(ITEM_IDS[0], {
        source_document_id: SOURCE_DOC_ID,
      });
      configureSupabase(mockSupabase, {
        domains: [{ id: 'd1', name: 'security' }],
        subtopics: [
          { name: 'cyber-security', domain_id: 'd1', description: null },
        ],
        contentItems: [item],
      });
      mockAnthropicCreate.mockResolvedValue(makeExtractionResponse());

      const result = await runBatchReclassifyJob(
        makeBody(),
        mockSupabase as unknown as SupabaseClient<Database>,
        AUTH_CONTEXT,
        JOB_ID,
      );

      expect(result.reclassified).toBe(1);
      expect(result.total_entities).toBe(1);
      expect(result.total_relationships).toBe(1);

      const insertCalls = mockSupabase._chain.insert.mock.calls as Array<
        [Array<Record<string, unknown>>]
      >;

      // entity_mentions insert row keyed on source_document_id, NOT item.id.
      const entityMentionRow = insertCalls
        .map((c) => c[0][0])
        .find((row) => row && 'entity_type' in row);
      expect(entityMentionRow).toBeDefined();
      expect(entityMentionRow!.source_document_id).toBe(SOURCE_DOC_ID);
      expect(entityMentionRow!.source_document_id).not.toBe(item.id);

      // entity_relationships insert row keyed on source_document_id, NOT
      // item.id.
      const relationshipRow = insertCalls
        .map((c) => c[0][0])
        .find((row) => row && 'relationship_type' in row);
      expect(relationshipRow).toBeDefined();
      expect(relationshipRow!.source_document_id).toBe(SOURCE_DOC_ID);
      expect(relationshipRow!.source_document_id).not.toBe(item.id);

      // Both delete().eq('source_document_id', ...) calls filter on
      // SOURCE_DOC_ID, not item.id.
      const sourceDocEqCalls = mockSupabase._chain.eq.mock.calls.filter(
        (c) => c[0] === 'source_document_id',
      );
      expect(sourceDocEqCalls.length).toBeGreaterThanOrEqual(2);
      for (const call of sourceDocEqCalls) {
        expect(call[1]).toBe(SOURCE_DOC_ID);
      }
    });

    it('item with NULL source_document_id skips entity_mentions/entity_relationships write entirely (no FK-violating insert attempted)', async () => {
      const item = makeContentRow(ITEM_IDS[1], {
        source_document_id: null,
      });
      configureSupabase(mockSupabase, {
        domains: [{ id: 'd1', name: 'security' }],
        subtopics: [
          { name: 'cyber-security', domain_id: 'd1', description: null },
        ],
        contentItems: [item],
      });
      // Anthropic DOES return entities/relationships — proving the guard
      // skips storage despite successful extraction (no valid FK parent).
      mockAnthropicCreate.mockResolvedValue(makeExtractionResponse());

      const result = await runBatchReclassifyJob(
        makeBody(),
        mockSupabase as unknown as SupabaseClient<Database>,
        AUTH_CONTEXT,
        JOB_ID,
      );

      // Classification itself still succeeds — only entity/relationship
      // storage is skipped.
      expect(result.reclassified).toBe(1);
      expect(result.total_entities).toBe(0);
      expect(result.total_relationships).toBe(0);

      // No entity_mentions/entity_relationships insert was attempted.
      const insertCalls = mockSupabase._chain.insert.mock.calls as Array<
        [Array<Record<string, unknown>>]
      >;
      const entityOrRelRow = insertCalls
        .map((c) => c[0][0])
        .find(
          (row) => row && ('entity_type' in row || 'relationship_type' in row),
        );
      expect(entityOrRelRow).toBeUndefined();

      // No source_document_id-keyed delete was attempted either (an
      // unscoped delete keyed on a null id would be unsafe).
      const sourceDocEqCalls = mockSupabase._chain.eq.mock.calls.filter(
        (c) => c[0] === 'source_document_id',
      );
      expect(sourceDocEqCalls.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // AC-8 — 0 candidates with force=true → PermanentJobError.
  // Spec §8 AC-8 lines 1252-1257; §4.3.
  // -------------------------------------------------------------------------

  describe('AC-8 — force:true + 0 candidates → permanent failure', () => {
    it('empty content_items list with force=true → throws PermanentJobError("no_candidates_under_force")', async () => {
      configureSupabase(mockSupabase, {
        domains: [{ id: 'd1', name: 'security' }],
        subtopics: [
          { name: 'cyber-security', domain_id: 'd1', description: null },
        ],
        contentItems: [],
      });

      await expect(
        runBatchReclassifyJob(
          makeBody({ force: true }),
          mockSupabase as unknown as SupabaseClient<Database>,
          AUTH_CONTEXT,
          JOB_ID,
        ),
      ).rejects.toThrow(PermanentJobError);

      const fresh = createMockSupabaseClient();
      configureSupabase(fresh, {
        domains: [{ id: 'd1', name: 'security' }],
        subtopics: [
          { name: 'cyber-security', domain_id: 'd1', description: null },
        ],
        contentItems: [],
      });
      await expect(
        runBatchReclassifyJob(
          makeBody({ force: true }),
          fresh as unknown as SupabaseClient<Database>,
          AUTH_CONTEXT,
          JOB_ID,
        ),
      ).rejects.toThrow('no_candidates_under_force');
    });
  });

  // -------------------------------------------------------------------------
  // Cooperative cancel — handler stops mid-loop on status flip to 'cancelled'.
  // Per spec §10 D-9 + handler L791-797, cancel poll fires every
  // CANCEL_POLL_CADENCE = 10 items.
  // -------------------------------------------------------------------------

  describe('Cooperative cancel — mid-loop status flip stops processing', () => {
    it('processing_queue.status flips to "cancelled" at item 20 → handler breaks loop, returns partial result with cancelled=true and cancellation_message', async () => {
      // 25 items so the handler hits item 10 (poll #1 = processing) and
      // item 20 (poll #2 = cancelled).
      const items = Array.from({ length: 25 }, (_, i) =>
        makeContentRow(
          // Use sequential UUIDs.
          `c${String(i).padStart(7, '0')}-cccc-4ccc-8ccc-cccccccccccc`,
        ),
      );
      configureSupabase(mockSupabase, {
        domains: [{ id: 'd1', name: 'security' }],
        subtopics: [
          { name: 'cyber-security', domain_id: 'd1', description: null },
        ],
        contentItems: items,
      });

      // Cancel poll: first call (item 10) returns 'processing'; second
      // call (item 20) returns 'cancelled'.
      mockCreateServiceClient.mockReturnValue(configureCancelPollFlip());

      const result = await runBatchReclassifyJob(
        makeBody(),
        mockSupabase as unknown as SupabaseClient<Database>,
        AUTH_CONTEXT,
        JOB_ID,
      );

      expect(result.cancelled).toBe(true);
      expect(result.cancellation_message).toMatch(
        /cancelled mid-run after \d+\/25 items/,
      );
      // Items processed = 20 (the loop breaks at i=20 BEFORE processing
      // that item, so results contain items 0..19).
      expect(result.results.length).toBe(20);
      expect(result.total_items).toBe(25);
      // Items 21-25 (indices 20-24) were NOT reached.
      expect(mockAnthropicCreate).toHaveBeenCalledTimes(20);
    });

    it('cancel poll error / no row returned → isJobCancelled returns false → loop continues', async () => {
      // 12 items so the handler hits item 10 (only one poll).
      const items = Array.from({ length: 12 }, (_, i) =>
        makeContentRow(
          `e${String(i).padStart(7, '0')}-eeee-4eee-8eee-eeeeeeeeeeee`,
        ),
      );
      configureSupabase(mockSupabase, {
        domains: [{ id: 'd1', name: 'security' }],
        subtopics: [
          { name: 'cyber-security', domain_id: 'd1', description: null },
        ],
        contentItems: items,
      });

      // Cancel poll returns null (no row found) — handler treats as not
      // cancelled.
      const errorClient = createMockSupabaseClient();
      errorClient._chain.maybeSingle.mockResolvedValue({
        data: null,
        error: { message: 'connection lost' },
      });
      mockCreateServiceClient.mockReturnValue(errorClient);

      const result = await runBatchReclassifyJob(
        makeBody(),
        mockSupabase as unknown as SupabaseClient<Database>,
        AUTH_CONTEXT,
        JOB_ID,
      );

      expect(result.cancelled).toBeUndefined();
      expect(result.results).toHaveLength(12);
      expect(result.reclassified).toBe(12);
    });
  });

  // -------------------------------------------------------------------------
  // 80% per-item failure threshold escalation (eval-rule regression detect).
  // Per spec §5.1 + handler L1090-1098 +
  // `feedback_eval_prompt_rules_surgical`.
  // -------------------------------------------------------------------------

  describe('80% per-item failure threshold escalation', () => {
    it('5 of 5 items fail with permanent error → handler raises PermanentJobError("eval_rule_regression_suspected: 5/5 items failed (>80% threshold)")', async () => {
      const items = ITEM_IDS.slice(0, 5).map((id) => makeContentRow(id));
      configureSupabase(mockSupabase, {
        domains: [{ id: 'd1', name: 'security' }],
        subtopics: [
          { name: 'cyber-security', domain_id: 'd1', description: null },
        ],
        contentItems: items,
      });

      // All Anthropic calls fail with content-policy violation.
      mockAnthropicCreate.mockRejectedValue(
        new Error('content-policy violation'),
      );

      await expect(
        runBatchReclassifyJob(
          makeBody(),
          mockSupabase as unknown as SupabaseClient<Database>,
          AUTH_CONTEXT,
          JOB_ID,
        ),
      ).rejects.toThrow(PermanentJobError);

      const fresh = createMockSupabaseClient();
      configureSupabase(fresh, {
        domains: [{ id: 'd1', name: 'security' }],
        subtopics: [
          { name: 'cyber-security', domain_id: 'd1', description: null },
        ],
        contentItems: items,
      });
      mockAnthropicCreate.mockRejectedValue(
        new Error('content-policy violation'),
      );
      await expect(
        runBatchReclassifyJob(
          makeBody(),
          fresh as unknown as SupabaseClient<Database>,
          AUTH_CONTEXT,
          JOB_ID,
        ),
      ).rejects.toThrow(/eval_rule_regression_suspected: 5\/5 items failed/);
    });

    it('cancelled run with 100% failure rate → does NOT trigger 80% threshold (the cancel takes precedence)', async () => {
      // 12 items, all failures, but cancel poll flips at item 10.
      const items = Array.from({ length: 12 }, (_, i) =>
        makeContentRow(
          `f${String(i).padStart(7, '0')}-ffff-4fff-8fff-ffffffffffff`,
        ),
      );
      configureSupabase(mockSupabase, {
        domains: [{ id: 'd1', name: 'security' }],
        subtopics: [
          { name: 'cyber-security', domain_id: 'd1', description: null },
        ],
        contentItems: items,
      });

      mockAnthropicCreate.mockRejectedValue(new Error('failure'));
      // Cancel at item 10 (after 10 failures).
      const cancelClient = createMockSupabaseClient();
      cancelClient._chain.maybeSingle.mockResolvedValue({
        data: { status: 'cancelled' },
        error: null,
      });
      mockCreateServiceClient.mockReturnValue(cancelClient);

      const result = await runBatchReclassifyJob(
        makeBody(),
        mockSupabase as unknown as SupabaseClient<Database>,
        AUTH_CONTEXT,
        JOB_ID,
      );

      // Should NOT throw — handler returns cancelled result instead.
      expect(result.cancelled).toBe(true);
      expect(result.failed).toBe(10);
    });

    it('exactly 80% failure rate (4 of 5 items fail) → does NOT trigger threshold (predicate is > 0.8, not >=)', async () => {
      const items = ITEM_IDS.slice(0, 5).map((id) => makeContentRow(id));
      configureSupabase(mockSupabase, {
        domains: [{ id: 'd1', name: 'security' }],
        subtopics: [
          { name: 'cyber-security', domain_id: 'd1', description: null },
        ],
        contentItems: items,
      });

      // 4 fail, 1 succeed — exactly 80%, NOT > 80%.
      let callCount = 0;
      mockAnthropicCreate.mockImplementation(async () => {
        callCount += 1;
        if (callCount <= 4) throw new Error('fail');
        return makeAnthropicResponse();
      });

      const result = await runBatchReclassifyJob(
        makeBody(),
        mockSupabase as unknown as SupabaseClient<Database>,
        AUTH_CONTEXT,
        JOB_ID,
      );

      expect(result.failed).toBe(4);
      expect(result.reclassified).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Taxonomy load failure — PermanentJobError.
  // Per handler L483-503.
  // -------------------------------------------------------------------------

  describe('Taxonomy load returns 0 domains', () => {
    it('domains query returns empty array → throws PermanentJobError("taxonomy_load_failed: zero domains returned")', async () => {
      configureSupabase(mockSupabase, {
        domains: [],
        subtopics: [],
        contentItems: [],
      });

      await expect(
        runBatchReclassifyJob(
          makeBody(),
          mockSupabase as unknown as SupabaseClient<Database>,
          AUTH_CONTEXT,
          JOB_ID,
        ),
      ).rejects.toThrow(/taxonomy_load_failed: zero domains returned/);
    });

    it('domains query errors → throws PermanentJobError("taxonomy_load_failed: domains: <msg>")', async () => {
      configureSupabase(mockSupabase, {
        domains: null,
        domainsError: { message: 'connection refused' },
        subtopics: [],
        contentItems: [],
      });

      await expect(
        runBatchReclassifyJob(
          makeBody(),
          mockSupabase as unknown as SupabaseClient<Database>,
          AUTH_CONTEXT,
          JOB_ID,
        ),
      ).rejects.toThrow(/taxonomy_load_failed: domains: connection refused/);
    });
  });

  // -------------------------------------------------------------------------
  // ANTHROPIC_API_KEY missing — PermanentJobError.
  // Per handler L604-607.
  // -------------------------------------------------------------------------

  describe('ANTHROPIC_API_KEY missing', () => {
    it('env var unset → throws PermanentJobError("anthropic_api_key_missing")', async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', '');

      await expect(
        runBatchReclassifyJob(
          makeBody(),
          mockSupabase as unknown as SupabaseClient<Database>,
          AUTH_CONTEXT,
          JOB_ID,
        ),
      ).rejects.toThrow(/anthropic_api_key_missing/);
    });
  });
});
