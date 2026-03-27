/**
 * POST /api/items/batch — Batch Q&A pair creation endpoint tests.
 *
 * Tests the batch creation pipeline for Q&A auto-split feature (Phase 3).
 * Items are created sequentially with full AI processing per item.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../helpers/mock-supabase';

// ---------------------------------------------------------------------------
// Shared mock setup
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

/**
 * Service client mock — uses a more granular approach where we track
 * which table `from()` is called with and return appropriate chains.
 */
const { mockServiceClient, mockPipelineChain, mockContentChain, mockHistoryChain } = vi.hoisted(() => {
  // Create separate chains for different tables
  function createChain(defaultSingleResult: unknown = { data: null, error: null }) {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      eq: vi.fn(),
      contains: vi.fn(),
      single: vi.fn().mockResolvedValue(defaultSingleResult),
      then: vi.fn((resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
      ),
    };

    // Make all methods chainable (except terminators)
    for (const key of ['select', 'insert', 'update', 'eq', 'contains']) {
      chain[key].mockReturnValue(chain);
    }

    return chain;
  }

  const pipelineChain = createChain({ data: { id: 'pipeline-run-1' }, error: null });
  const contentChain = createChain({ data: { id: 'item-1', title: 'Q1?' }, error: null });
  const historyChain = createChain({ data: null, error: null });

  const client = {
    from: vi.fn((table: string) => {
      if (table === 'pipeline_runs') return pipelineChain;
      if (table === 'content_history') return historyChain;
      return contentChain; // content_items and anything else
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };

  return {
    mockServiceClient: client,
    mockPipelineChain: pipelineChain,
    mockContentChain: contentChain,
    mockHistoryChain: historyChain,
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockServiceClient),
}));

const { mockCookies } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

// Mock AI processing modules — we don't want real AI calls in tests
vi.mock('@/lib/ai/embed', () => ({
  generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}));

vi.mock('@/lib/ai/classify', () => ({
  classifyContent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/ai/summarise', () => ({
  generateSummary: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/layer-inference', () => ({
  inferLayer: vi.fn().mockReturnValue({
    suggestedLayer: 'bid_detail',
    reason: 'Q&A pair',
    confidence: 'high',
  }),
}));

vi.mock('@/lib/topic-inference', () => ({
  suggestTopic: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/quality/quality-score', () => ({
  calculateAndRoundQualityScore: vi.fn().mockReturnValue(65),
}));

vi.mock('@/lib/editor-utils', () => ({
  htmlToPlainText: vi.fn((text: string) => text),
}));

// Import route AFTER mocks are registered
const { POST } = await import('@/app/api/items/batch/route');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/items/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeSampleItems(count: number = 2) {
  return Array.from({ length: count }, (_, i) => ({
    title: `Question ${i + 1}?`,
    content: `Q: Question ${i + 1}?\n\nA: Answer ${i + 1}.`,
    contentType: 'q_a_pair',
    sectionName: 'Test Section',
    answerAdvanced: '',
    source: 'table' as const,
    confidence: 'high' as const,
  }));
}

/**
 * Configure default mock responses for a successful batch creation flow.
 *
 * Pipeline chain:
 *   1. Token check (contains query) — returns empty (no existing run)
 *   2. Pipeline run insert — returns pipeline run ID
 *   3. Pipeline run update(s) — returns OK
 *
 * Content chain:
 *   - Item insert — returns item ID + title
 *   - Item update / select — returns enrichment data
 */
function configureSuccessFlow(_itemCount: number = 1) {
  // Pipeline chain: token check returns empty via then()
  mockPipelineChain.then.mockImplementation(
    (resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null, count: 0 }),
  );

  // Pipeline chain: insert().select().single() for creating pipeline run
  mockPipelineChain.single.mockResolvedValue({
    data: { id: 'pipeline-run-1' },
    error: null,
  });

  // Content chain: insert/select for each item
  let contentSingleCallCount = 0;
  mockContentChain.single.mockImplementation(() => {
    contentSingleCallCount++;
    // Item inserts — returns an item per call
    return Promise.resolve({
      data: {
        id: `item-${contentSingleCallCount}`,
        title: `Question ${contentSingleCallCount}?`,
        // Fields used by quality score and topic inference
        freshness: 'fresh',
        classification_confidence: 0.9,
        brief: null,
        detail: null,
        reference: null,
        ai_summary: null,
        metadata: {},
        primary_domain: 'Technology',
        primary_subtopic: 'Cyber Security',
      },
      error: null,
    });
  });

  // Content chain: updates succeed silently
  mockContentChain.then.mockImplementation(
    (resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null, count: 0 }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/items/batch', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: authenticated user with editor role
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'editor@example.com' } },
      error: null,
    });

    // Re-chain methods after clearAllMocks
    for (const chain of [mockPipelineChain, mockContentChain, mockHistoryChain]) {
      for (const key of ['select', 'insert', 'update', 'eq', 'contains']) {
        chain[key].mockReturnValue(chain);
      }
    }

    // Re-set up the from() router
    mockServiceClient.from.mockImplementation((table: string) => {
      if (table === 'pipeline_runs') return mockPipelineChain;
      if (table === 'content_history') return mockHistoryChain;
      return mockContentChain;
    });
    mockServiceClient.rpc.mockResolvedValue({ data: null, error: null });

    // Default successful flow
    configureSuccessFlow();
  });

  // -------------------------------------------------------------------------
  // Authentication and authorisation
  // -------------------------------------------------------------------------

  describe('authentication and authorisation', () => {
    it('returns 401 when not authenticated', async () => {
      configureUnauthenticated(mockSupabase);

      const res = await POST(makeRequest({ items: makeSampleItems() }));
      expect(res.status).toBe(401);
    });

    it('returns 403 for viewer role', async () => {
      configureRole(mockSupabase, 'viewer');

      const res = await POST(makeRequest({ items: makeSampleItems() }));
      expect(res.status).toBe(403);
    });

    it('allows editor role', async () => {
      configureRole(mockSupabase, 'editor');

      const res = await POST(makeRequest({ items: makeSampleItems(1) }));
      expect(res.status).toBe(201);
    });

    it('allows admin role', async () => {
      configureRole(mockSupabase, 'admin');

      const res = await POST(makeRequest({ items: makeSampleItems(1) }));
      expect(res.status).toBe(201);
    });
  });

  // -------------------------------------------------------------------------
  // Request validation
  // -------------------------------------------------------------------------

  describe('request validation', () => {
    it('returns 400 when items array is empty', async () => {
      configureRole(mockSupabase, 'editor');

      const res = await POST(makeRequest({ items: [] }));
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toBe('Validation failed');
    });

    it('returns 400 when items array is missing', async () => {
      configureRole(mockSupabase, 'editor');

      const res = await POST(makeRequest({}));
      expect(res.status).toBe(400);
    });

    it('returns 400 when item has no title', async () => {
      configureRole(mockSupabase, 'editor');

      const res = await POST(
        makeRequest({
          items: [{ content: 'Q: ?\n\nA: Yes.', contentType: 'q_a_pair' }],
        }),
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when item has no content', async () => {
      configureRole(mockSupabase, 'editor');

      const res = await POST(
        makeRequest({
          items: [{ title: 'Question?', contentType: 'q_a_pair' }],
        }),
      );
      expect(res.status).toBe(400);
    });

    it('validates source_document_id is a UUID when provided', async () => {
      configureRole(mockSupabase, 'editor');

      const res = await POST(
        makeRequest({
          items: makeSampleItems(1),
          source_document_id: 'not-a-uuid',
        }),
      );
      expect(res.status).toBe(400);
    });

    it('accepts valid source_document_id UUID', async () => {
      configureRole(mockSupabase, 'editor');

      const res = await POST(
        makeRequest({
          items: makeSampleItems(1),
          source_document_id: 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5',
        }),
      );

      expect(res.status).toBe(201);
    });
  });

  // -------------------------------------------------------------------------
  // Item creation
  // -------------------------------------------------------------------------

  describe('item creation', () => {
    it('creates items with correct content_type and platform', async () => {
      configureRole(mockSupabase, 'editor');

      await POST(makeRequest({ items: makeSampleItems(1) }));

      // Find the content_items insert call
      const insertCalls = mockContentChain.insert.mock.calls;
      const contentItemInsert = insertCalls.find(
        (call: unknown[]) =>
          typeof call[0] === 'object' &&
          call[0] !== null &&
          'content_type' in call[0],
      );

      expect(contentItemInsert).toBeDefined();
      if (contentItemInsert) {
        expect(contentItemInsert[0].content_type).toBe('q_a_pair');
        expect(contentItemInsert[0].platform).toBe('extraction');
      }
    });

    it('sets source_document_id when provided', async () => {
      configureRole(mockSupabase, 'editor');

      const sourceDocId = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';
      await POST(
        makeRequest({
          items: makeSampleItems(1),
          source_document_id: sourceDocId,
        }),
      );

      const insertCalls = mockContentChain.insert.mock.calls;
      const contentItemInsert = insertCalls.find(
        (call: unknown[]) =>
          typeof call[0] === 'object' &&
          call[0] !== null &&
          'source_document_id' in call[0],
      );

      expect(contentItemInsert).toBeDefined();
      if (contentItemInsert) {
        expect(contentItemInsert[0].source_document_id).toBe(sourceDocId);
      }
    });

    it('sets ingestion_source to upload_autosplit in metadata', async () => {
      configureRole(mockSupabase, 'editor');

      await POST(makeRequest({ items: makeSampleItems(1) }));

      const insertCalls = mockContentChain.insert.mock.calls;
      const contentItemInsert = insertCalls.find(
        (call: unknown[]) =>
          typeof call[0] === 'object' &&
          call[0] !== null &&
          'metadata' in call[0],
      );

      expect(contentItemInsert).toBeDefined();
      if (contentItemInsert) {
        expect(contentItemInsert[0].metadata.ingestion_source).toBe('upload_autosplit');
      }
    });

    it('returns created and failed counts', async () => {
      configureRole(mockSupabase, 'editor');

      const res = await POST(makeRequest({ items: makeSampleItems(2) }));
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.created).toBeGreaterThanOrEqual(0);
      expect(typeof body.failed).toBe('number');
      expect(Array.isArray(body.items)).toBe(true);
    });

    it('returns pipeline_run_id', async () => {
      configureRole(mockSupabase, 'editor');

      const res = await POST(makeRequest({ items: makeSampleItems(1) }));
      const body = await res.json();

      expect(body.pipeline_run_id).toBeDefined();
    });

    it('returns batch_id for linking items', async () => {
      configureRole(mockSupabase, 'editor');

      const res = await POST(makeRequest({ items: makeSampleItems(1) }));
      const body = await res.json();

      expect(body.batch_id).toBeDefined();
      expect(typeof body.batch_id).toBe('string');
    });

    it('includes section_name in metadata when provided', async () => {
      configureRole(mockSupabase, 'editor');

      await POST(
        makeRequest({
          items: [
            {
              title: 'Question?',
              content: 'Q: Question?\n\nA: Answer.',
              contentType: 'q_a_pair',
              sectionName: 'Quality Management',
            },
          ],
        }),
      );

      const insertCalls = mockContentChain.insert.mock.calls;
      const contentItemInsert = insertCalls.find(
        (call: unknown[]) => {
          const obj = call[0] as Record<string, unknown>;
          return (
            typeof obj === 'object' &&
            obj !== null &&
            'metadata' in obj &&
            typeof obj.metadata === 'object' &&
            obj.metadata !== null &&
            'section_name' in (obj.metadata as Record<string, unknown>)
          );
        },
      );

      expect(contentItemInsert).toBeDefined();
      if (contentItemInsert) {
        const meta = (contentItemInsert[0] as Record<string, Record<string, unknown>>).metadata;
        expect(meta.section_name).toBe('Quality Management');
      }
    });

    it('sets answer_advanced when provided', async () => {
      configureRole(mockSupabase, 'editor');

      await POST(
        makeRequest({
          items: [
            {
              title: 'Question?',
              content: 'Q: Question?\n\nA: Standard answer.',
              contentType: 'q_a_pair',
              answerAdvanced: 'Advanced answer with more detail.',
            },
          ],
        }),
      );

      const insertCalls = mockContentChain.insert.mock.calls;
      const contentItemInsert = insertCalls.find(
        (call: unknown[]) =>
          typeof call[0] === 'object' &&
          call[0] !== null &&
          'answer_advanced' in call[0],
      );

      expect(contentItemInsert).toBeDefined();
      if (contentItemInsert) {
        expect(contentItemInsert[0].answer_advanced).toBe(
          'Advanced answer with more detail.',
        );
      }
    });

    it('creates content_history entry per item', async () => {
      configureRole(mockSupabase, 'editor');

      await POST(makeRequest({ items: makeSampleItems(1) }));

      const historyInsertCalls = mockHistoryChain.insert.mock.calls;
      expect(historyInsertCalls.length).toBeGreaterThanOrEqual(1);

      if (historyInsertCalls.length > 0) {
        const entry = historyInsertCalls[0][0];
        expect(entry.version).toBe(1);
        expect(entry.change_type).toBe('create');
        expect(entry.change_summary).toContain('auto-split');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Pipeline tracking
  // -------------------------------------------------------------------------

  describe('pipeline tracking', () => {
    it('creates a pipeline_runs record with pipeline_name qa_autosplit', async () => {
      configureRole(mockSupabase, 'editor');

      await POST(makeRequest({ items: makeSampleItems(1) }));

      // Check that from('pipeline_runs') was called
      const fromCalls = mockServiceClient.from.mock.calls;
      const pipelineRunCalls = fromCalls.filter(
        (call: string[]) => call[0] === 'pipeline_runs',
      );
      expect(pipelineRunCalls.length).toBeGreaterThan(0);

      // Check that insert was called with pipeline_name
      const insertCalls = mockPipelineChain.insert.mock.calls;
      const pipelineInsert = insertCalls.find(
        (call: unknown[]) =>
          typeof call[0] === 'object' &&
          call[0] !== null &&
          'pipeline_name' in call[0] &&
          (call[0] as Record<string, unknown>).pipeline_name === 'qa_autosplit',
      );
      expect(pipelineInsert).toBeDefined();
    });

    it('updates pipeline_runs progress after each item', async () => {
      configureRole(mockSupabase, 'editor');

      await POST(makeRequest({ items: makeSampleItems(2) }));

      // Check update calls on pipeline chain
      const updateCalls = mockPipelineChain.update.mock.calls;
      // Should have at least: per-item updates + final completion update
      expect(updateCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  // -------------------------------------------------------------------------
  // Batch token single-use enforcement
  // -------------------------------------------------------------------------

  describe('batch token single-use enforcement', () => {
    it('rejects with 409 when batch token already used', async () => {
      configureRole(mockSupabase, 'editor');

      // Override: token check returns existing pipeline run
      mockPipelineChain.then.mockImplementation(
        (resolve: (v: unknown) => void) =>
          resolve({
            data: [{ id: 'existing-run' }],
            error: null,
            count: 1,
          }),
      );

      const res = await POST(
        makeRequest({
          items: makeSampleItems(1),
          batch_token: 'already-used-token',
        }),
      );

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toContain('already');
    });

    it('allows batch without token (token is optional)', async () => {
      configureRole(mockSupabase, 'editor');

      const res = await POST(
        makeRequest({
          items: makeSampleItems(1),
        }),
      );

      expect(res.status).toBe(201);
    });

    it('allows batch with unused token', async () => {
      configureRole(mockSupabase, 'editor');

      // Token check returns empty (no existing run)
      mockPipelineChain.then.mockImplementation(
        (resolve: (v: unknown) => void) =>
          resolve({ data: [], error: null, count: 0 }),
      );

      const res = await POST(
        makeRequest({
          items: makeSampleItems(1),
          batch_token: 'fresh-token-123',
        }),
      );

      expect(res.status).toBe(201);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('handles individual item failure without stopping the batch', async () => {
      configureRole(mockSupabase, 'editor');

      // First item insert fails, second succeeds
      let contentSingleCallCount = 0;
      mockContentChain.single.mockImplementation(() => {
        contentSingleCallCount++;
        if (contentSingleCallCount === 1) {
          // First item — fail the insert
          return Promise.resolve({
            data: null,
            error: { message: 'Simulated insert failure' },
          });
        }
        // Subsequent items succeed
        return Promise.resolve({
          data: {
            id: `item-${contentSingleCallCount}`,
            title: `Question ${contentSingleCallCount}?`,
            freshness: 'fresh',
            classification_confidence: 0.9,
            brief: null,
            detail: null,
            reference: null,
            ai_summary: null,
            metadata: {},
            primary_domain: 'Technology',
            primary_subtopic: 'Cyber Security',
          },
          error: null,
        });
      });

      const res = await POST(makeRequest({ items: makeSampleItems(2) }));
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.failed).toBeGreaterThanOrEqual(1);
      expect(
        body.items.some((item: { status: string }) => item.status === 'failed'),
      ).toBe(true);
    });

    it('returns 500 on unexpected error', async () => {
      configureRole(mockSupabase, 'editor');

      // Make the initial JSON parsing fail by sending invalid JSON
      const req = new NextRequest('http://localhost:3000/api/items/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json{{{',
      });

      const res = await POST(req);
      expect(res.status).toBe(500);
    });

    it('returns items array with status for each item', async () => {
      configureRole(mockSupabase, 'editor');

      const res = await POST(makeRequest({ items: makeSampleItems(2) }));
      const body = await res.json();

      expect(Array.isArray(body.items)).toBe(true);
      for (const item of body.items) {
        expect(['created', 'failed']).toContain(item.status);
        expect(typeof item.title).toBe('string');
      }
    });
  });
});
