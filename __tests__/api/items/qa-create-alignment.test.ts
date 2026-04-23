/**
 * Q&A create-path answer_standard alignment tests.
 *
 * Per P0-BM Phase 3 spec ss4.6 (bug B2 fix): all 5 non-CLI create paths
 * must populate `answer_standard` when `content_type === 'q_a_pair'` so
 * that the first PATCH edit does not destroy creation content.
 *
 * Paths covered:
 *   1. POST /api/items (web-form)
 *   2. POST /api/items/batch (bulk Q&A from qa-detection)
 *   3. POST /api/bids/[id]/outcome/integrate (bid outcome → KB)
 *   4. create_content_item MCP tool
 *   5. qa-detection.ts splitIntoQAPairs (A: prefix strip — spec ss4.7)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
} from '../../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

const { mockCookies } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

vi.mock('@/lib/ai/embed', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0)),
}));

vi.mock('@/lib/content/strip-markdown', () => ({
  stripMarkdown: vi.fn((text: string) => text),
}));

vi.mock('@/lib/content/chunk-store', () => ({
  regenerateChunks: vi.fn().mockResolvedValue({ errors: [] }),
}));

vi.mock('@/lib/dedup', () => ({
  checkForDuplicates: vi.fn().mockResolvedValue({
    has_duplicates: false,
    matches: [],
  }),
  checkExactDuplicate: vi.fn().mockResolvedValue({
    isDuplicate: false,
    existingId: null,
    existingTitle: null,
  }),
  formatDedupWarning: vi.fn().mockReturnValue(null),
  resolveDedupStamp: vi
    .fn()
    .mockReturnValue({ dedup_status: 'clean' }),
}));

vi.mock('@/lib/ai/classify', () => ({
  classifyContent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/ai/summarise', () => ({
  generateSummary: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/layer-inference', () => ({
  inferLayer: vi.fn().mockReturnValue({
    suggestedLayer: 'operational',
    reason: 'test',
    confidence: 'medium',
  }),
}));

vi.mock('@/lib/topic-inference', () => ({
  suggestTopic: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/guide-section-mapping', () => ({
  suggestGuideSections: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/quality/quality-score', () => ({
  calculateAndRoundQualityScore: vi.fn().mockReturnValue(50),
}));

vi.mock('@/lib/pipeline/record-run', () => ({
  recordPipelineRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/change-summary', () => ({
  generateSingleFieldChangeSummary: vi.fn().mockReturnValue('Field updated'),
}));

vi.mock('@/lib/editor-utils', () => ({
  htmlToPlainText: vi.fn((text: string) => text),
}));

// Import route handlers AFTER mocks are registered
import { POST as createItem } from '@/app/api/items/route';
import { POST as batchCreate } from '@/app/api/items/batch/route';
import { POST as bidIntegrate } from '@/app/api/bids/[id]/outcome/integrate/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const BID_UUID = 'b1b2c3d4-e5f6-7890-abcd-ef1234567890';

/**
 * Reset all mock chains and configure standard auth + return values.
 */
function setupMocks() {
  vi.clearAllMocks();

  mockCookies.mockResolvedValue({ getAll: () => [], set: () => {} });

  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

  const chainable = [
    'select',
    'insert',
    'update',
    'upsert',
    'delete',
    'eq',
    'neq',
    'in',
    'is',
    'not',
    'ilike',
    'contains',
    'gte',
    'lte',
    'gt',
    'lt',
    'or',
    'order',
    'limit',
    'range',
  ] as const;
  for (const m of chainable) {
    mockSupabase._chain[m].mockReturnValue(mockSupabase._chain);
  }

  mockSupabase._chain.single.mockReset();
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle.mockReset();
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
  });
  mockSupabase._chain.then.mockReset();
  mockSupabase._chain.then.mockImplementation(
    (resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null, count: 0 }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Q&A create-path answer_standard alignment (bug B2 fix)', () => {
  beforeEach(() => {
    setupMocks();
  });

  // -------------------------------------------------------------------------
  // Path 1: POST /api/items
  // -------------------------------------------------------------------------

  describe('Path 1 — POST /api/items', () => {
    it('sets answer_standard = content for q_a_pair creation', async () => {
      configureRole(mockSupabase, 'editor');

      const itemContent = 'This is the answer to our question.';

      // Insert returns created item
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: VALID_UUID,
          title: 'What is our policy?',
          content_type: 'q_a_pair',
          created_at: '2026-04-23T00:00:00Z',
        },
        error: null,
      });

      const req = createTestRequest('/api/items', {
        method: 'POST',
        body: {
          title: 'What is our policy?',
          content: itemContent,
          content_type: 'q_a_pair',
        },
      });

      const res = await createItem(req);
      expect(res.status).toBe(201);

      // Verify the insert call includes answer_standard = content
      const insertCall = mockSupabase._chain.insert.mock.calls[0][0];
      expect(insertCall.answer_standard).toBe(itemContent);
      expect(insertCall.content_type).toBe('q_a_pair');
      expect(insertCall.content).toBe(itemContent);
    });

    it('does NOT set answer_standard for non-q_a_pair types', async () => {
      configureRole(mockSupabase, 'editor');

      // Insert returns created item
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: VALID_UUID,
          title: 'An Article',
          content_type: 'article',
          created_at: '2026-04-23T00:00:00Z',
        },
        error: null,
      });

      const req = createTestRequest('/api/items', {
        method: 'POST',
        body: {
          title: 'An Article',
          content: 'Article body text.',
          content_type: 'article',
        },
      });

      const res = await createItem(req);
      expect(res.status).toBe(201);

      const insertCall = mockSupabase._chain.insert.mock.calls[0][0];
      expect(insertCall.answer_standard).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Path 2: POST /api/items/batch
  // -------------------------------------------------------------------------

  describe('Path 2 — POST /api/items/batch', () => {
    it('sets answer_standard = item.content for each q_a_pair in batch', async () => {
      configureRole(mockSupabase, 'editor');

      const batchContent = 'Q: What is our policy?\n\nWe follow best practice.';

      // Pipeline run insert
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { id: 'pipeline-run-id' },
        error: null,
      });

      // Item insert
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { id: VALID_UUID, title: 'What is our policy?' },
        error: null,
      });

      // Classification fetch (topic suggestion)
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { primary_domain: null, primary_subtopic: null },
        error: null,
      });

      // Quality score fetch
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          freshness: 'current',
          classification_confidence: 0.9,
          brief: null,
          detail: null,
          reference: null,
          summary: null,
          citation_count: 0,
        },
        error: null,
      });

      const req = createTestRequest('/api/items/batch', {
        method: 'POST',
        body: {
          items: [
            {
              title: 'What is our policy?',
              content: batchContent,
              contentType: 'q_a_pair',
            },
          ],
        },
      });

      const res = await batchCreate(req);
      expect(res.status).toBe(201);

      // Find the content_items insert call (skip the pipeline_runs insert)
      const insertCalls = mockSupabase._chain.insert.mock.calls;
      // The first insert is pipeline_runs, the second is the content_items insert
      const contentInsert = insertCalls.find(
        (call: unknown[]) =>
          (call[0] as Record<string, unknown>).content_type === 'q_a_pair',
      );
      expect(contentInsert).toBeDefined();
      expect((contentInsert![0] as Record<string, unknown>).answer_standard).toBe(batchContent);
    });
  });

  // -------------------------------------------------------------------------
  // Path 3: POST /api/bids/[id]/outcome/integrate
  // -------------------------------------------------------------------------

  describe('Path 3 — POST /api/bids/[id]/outcome/integrate', () => {
    it('sets answer_standard = content for q_a_pair created from bid outcome', async () => {
      configureRole(mockSupabase, 'editor');

      const params = createTestParams({ id: BID_UUID });

      // Bid fetch — must be in "won" state
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: BID_UUID,
          name: 'Test Bid',
          status: 'won',
          domain_metadata: { domain: 'waste-management' },
        },
        error: null,
      });

      const questionId = 'c1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const responseText = 'We have comprehensive waste management policies.';

      // Questions fetch
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({
            data: [{ id: questionId, question_text: 'What is your waste policy?' }],
            error: null,
          }),
      );

      // Responses fetch
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({
            data: [{ question_id: questionId, response_text: responseText }],
            error: null,
          }),
      );

      // Content item insert
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { id: VALID_UUID },
        error: null,
      });

      const req = createTestRequest(`/api/bids/${BID_UUID}/outcome/integrate`, {
        method: 'POST',
        body: {
          integrations: [
            {
              question_id: questionId,
              action: 'new_entry',
              content_type: 'q_a_pair',
            },
          ],
        },
      });

      const res = await bidIntegrate(req, { params });
      expect(res.status).toBe(200);

      // Find the content_items insert call
      const insertCalls = mockSupabase._chain.insert.mock.calls;
      const contentInsert = insertCalls.find(
        (call: unknown[]) =>
          (call[0] as Record<string, unknown>).content_type === 'q_a_pair',
      );
      expect(contentInsert).toBeDefined();
      expect((contentInsert![0] as Record<string, unknown>).answer_standard).toBe(responseText);
    });
  });

  // -------------------------------------------------------------------------
  // Path 5: qa-detection splitIntoQAPairs — A: prefix strip
  // -------------------------------------------------------------------------

  describe('Path 5 — qa-detection splitIntoQAPairs A: prefix strip', () => {
    it('emits content without A: prefix (canonical shape)', async () => {
      const { splitIntoQAPairs } = await import(
        '@/lib/quality/qa-detection'
      );

      const pairs = [
        {
          question: 'What is your quality policy?',
          answer: 'We follow ISO 9001 standards.',
          answerAdvanced: '',
          source: 'table' as const,
          confidence: 'high' as const,
          sectionName: 'Quality',
          tableIndex: 0,
          rowIndex: 1,
        },
      ];

      const result = splitIntoQAPairs(pairs);
      expect(result).toHaveLength(1);

      // Canonical shape: "Q: {question}\n\n{answer}" — no "A: " prefix
      expect(result[0].content).toBe(
        'Q: What is your quality policy?\n\nWe follow ISO 9001 standards.',
      );
      // Verify no A: prefix
      expect(result[0].content).not.toContain('\n\nA: ');
    });

    it('emits content that aligns with PATCH rebuild shape', async () => {
      const { splitIntoQAPairs } = await import(
        '@/lib/quality/qa-detection'
      );
      const { resolveQuestionForRebuild } = await import(
        '@/lib/bid-library-ingest/resolve-question'
      );

      const pairs = [
        {
          question: 'How do you handle complaints?',
          answer: 'Via our formal complaints process.',
          answerAdvanced: '',
          source: 'heading' as const,
          confidence: 'medium' as const,
          sectionName: '',
          tableIndex: -1,
          rowIndex: -1,
        },
      ];

      const result = splitIntoQAPairs(pairs);
      const content = result[0].content;

      // Verify the question can be round-tripped via resolveQuestionForRebuild
      const extractedQuestion = resolveQuestionForRebuild(content, null);
      expect(extractedQuestion).toBe('How do you handle complaints?');

      // Verify the answer portion (after Q: line + \n\n) has no A: prefix
      const afterQuestion = content.split('\n\n').slice(1).join('\n\n');
      expect(afterQuestion).toBe('Via our formal complaints process.');
      expect(afterQuestion).not.toMatch(/^A: /);
    });
  });
});
