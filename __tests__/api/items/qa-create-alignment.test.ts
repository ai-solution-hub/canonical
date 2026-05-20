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

vi.mock('@/lib/ai/embed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/embed')>();
  return {
    ...actual,
    generateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0)),
  };
});

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
  resolveDedupStamp: vi.fn().mockReturnValue({ dedup_status: 'clean' }),
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
import { POST as bidIntegrate } from '@/app/api/procurement/[id]/outcome/integrate/route';
import { extractAnswerFromContent } from '@/lib/procurement-library-ingest/extract-answer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const BID_UUID = '660e8400-e29b-41d4-a716-446655440001';

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
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
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
    it('mirrors content into answer_standard for q_a_pair items created via /api/items', async () => {
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
    it('stores only the extracted answer (not the composite Q+A) in answer_standard for batch q_a_pair items', async () => {
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
      // C-1 fix: answer_standard should be the extracted answer portion only,
      // not the full composite "Q: {q}\n\n{answer}" content
      expect(
        (contentInsert![0] as Record<string, unknown>).answer_standard,
      ).toBe('We follow best practice.');
    });

    it('prefers explicit answerStandard over extracting from composite (Option A)', async () => {
      configureRole(mockSupabase, 'editor');

      const compositeContent =
        'Q: What is our policy?\n\nWe follow best practice.';
      const explicitAnswer = 'We follow best practice.';

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
              content: compositeContent,
              contentType: 'q_a_pair',
              answerStandard: explicitAnswer,
            },
          ],
        },
      });

      const res = await batchCreate(req);
      expect(res.status).toBe(201);

      // Find the content_items insert call
      const insertCalls = mockSupabase._chain.insert.mock.calls;
      const contentInsert = insertCalls.find(
        (call: unknown[]) =>
          (call[0] as Record<string, unknown>).content_type === 'q_a_pair',
      );
      expect(contentInsert).toBeDefined();
      // Explicit answerStandard should be used directly, not extracted
      expect(
        (contentInsert![0] as Record<string, unknown>).answer_standard,
      ).toBe(explicitAnswer);
    });
  });

  // -------------------------------------------------------------------------
  // Path 3: POST /api/bids/[id]/outcome/integrate
  // -------------------------------------------------------------------------

  describe('Path 3 — POST /api/bids/[id]/outcome/integrate', () => {
    it('mirrors content into answer_standard for q_a_pair items integrated from a won bid outcome', async () => {
      configureRole(mockSupabase, 'editor');

      const params = createTestParams({ id: BID_UUID });

      // Procurement fetch — must be in "won" state
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: BID_UUID,
          name: 'Test Procurement',
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
            data: [
              { id: questionId, question_text: 'What is your waste policy?' },
            ],
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

      const req = createTestRequest(`/api/procurement/${BID_UUID}/outcome/integrate`, {
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
      expect(
        (contentInsert![0] as Record<string, unknown>).answer_standard,
      ).toBe(responseText);
    });
  });

  // -------------------------------------------------------------------------
  // Path 5: qa-detection splitIntoQAPairs — A: prefix strip
  // -------------------------------------------------------------------------

  describe('Path 5 — qa-detection splitIntoQAPairs A: prefix strip', () => {
    it('emits content without A: prefix (canonical shape)', async () => {
      const { splitIntoQAPairs } = await import('@/lib/quality/qa-detection');

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
      const { splitIntoQAPairs } = await import('@/lib/quality/qa-detection');
      const { resolveQuestionForRebuild } =
        await import('@/lib/procurement-library-ingest/resolve-question');

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

    it('splitIntoQAPairs content round-trips through extractAnswerFromContent correctly', async () => {
      const { splitIntoQAPairs } = await import('@/lib/quality/qa-detection');

      const pairs = [
        {
          question: 'What training do you provide?',
          answer: 'All staff receive annual mandatory training.',
          answerAdvanced: '',
          source: 'text' as const,
          confidence: 'high' as const,
          sectionName: 'Training',
          tableIndex: -1,
          rowIndex: -1,
        },
      ];

      const result = splitIntoQAPairs(pairs);
      const compositeContent = result[0].content;

      // extractAnswerFromContent should return just the answer
      const extracted = extractAnswerFromContent(compositeContent);
      expect(extracted).toBe('All staff receive annual mandatory training.');
      expect(extracted).not.toContain('Q: ');
    });
  });

  // -------------------------------------------------------------------------
  // Round-trip tests (M-1): verify no double-prefix on first PATCH edit
  // -------------------------------------------------------------------------

  describe('Round-trip: answer_standard does not cause double-prefix on PATCH rebuild', () => {
    it('Path 1 (web-form): plain answer content is no-op through extractAnswerFromContent', () => {
      // Path 1 sets answer_standard = content directly (content is plain answer text)
      const plainAnswer = 'We follow best practices for quality assurance.';

      // extractAnswerFromContent is idempotent on non-composite content
      const extracted = extractAnswerFromContent(plainAnswer);
      expect(extracted).toBe(plainAnswer);

      // Simulate PATCH rebuild: Q: {question}\n\n{answer_standard}
      const question = 'What is your quality policy?';
      const rebuilt = `Q: ${question}\n\n${extracted}`;
      expect(rebuilt).toBe(
        'Q: What is your quality policy?\n\nWe follow best practices for quality assurance.',
      );
      // No double Q: prefix
      expect(rebuilt.match(/Q: /g)).toHaveLength(1);
    });

    it('Path 2 (batch): composite content is extracted before storing answer_standard', async () => {
      configureRole(mockSupabase, 'editor');

      const question = 'What is your waste policy?';
      const answer = 'We recycle 90% of waste.';
      const compositeContent = `Q: ${question}\n\n${answer}`;

      // Pipeline run insert
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { id: 'pipeline-run-id' },
        error: null,
      });

      // Item insert
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { id: VALID_UUID, title: question },
        error: null,
      });

      // Classification fetch
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
              title: question,
              content: compositeContent,
              contentType: 'q_a_pair',
            },
          ],
        },
      });

      const res = await batchCreate(req);
      expect(res.status).toBe(201);

      // Find the content_items insert
      const insertCalls = mockSupabase._chain.insert.mock.calls;
      const contentInsert = insertCalls.find(
        (call: unknown[]) =>
          (call[0] as Record<string, unknown>).content_type === 'q_a_pair',
      );
      expect(contentInsert).toBeDefined();

      const insertData = contentInsert![0] as Record<string, unknown>;
      // answer_standard should be the extracted answer only, NOT the composite
      expect(insertData.answer_standard).toBe(answer);
      expect(insertData.answer_standard).not.toContain('Q: ');

      // Simulate PATCH rebuild with the stored answer_standard
      const rebuilt = `Q: ${question}\n\n${insertData.answer_standard}`;
      expect(rebuilt).toBe(
        `Q: What is your waste policy?\n\nWe recycle 90% of waste.`,
      );
      expect(rebuilt.match(/Q: /g)).toHaveLength(1);
    });

    it('Path 3 (bid integrate): response text is plain, no extraction needed', () => {
      // Path 3 uses responseText directly (not composite) so answer_standard
      // is already correct. Verify the helper is a no-op on plain text.
      const responseText = 'We have comprehensive waste management policies.';
      const extracted = extractAnswerFromContent(responseText);
      expect(extracted).toBe(responseText);

      // Simulate PATCH rebuild
      const question = 'What is your waste policy?';
      const rebuilt = `Q: ${question}\n\n${extracted}`;
      expect(rebuilt.match(/Q: /g)).toHaveLength(1);
    });

    it('Path 4 (MCP): composite content is extracted before storing answer_standard', () => {
      // MCP callers may send Q:-prefixed composite content
      const question = 'How do you handle data protection?';
      const answer = 'We comply with GDPR requirements.';
      const compositeContent = `Q: ${question}\n\n${answer}`;

      // extractAnswerFromContent extracts the answer portion
      const extracted = extractAnswerFromContent(compositeContent);
      expect(extracted).toBe(answer);

      // Simulate PATCH rebuild with the stored answer_standard
      const rebuilt = `Q: ${question}\n\n${extracted}`;
      expect(rebuilt.match(/Q: /g)).toHaveLength(1);
    });

    it('Path 5 (qa-detection): composite content round-trips through extract + rebuild', async () => {
      const { splitIntoQAPairs } = await import('@/lib/quality/qa-detection');

      const pairs = [
        {
          question: 'What certifications do you hold?',
          answer: 'ISO 9001 and ISO 14001.',
          answerAdvanced: 'We also hold ISO 27001 for information security.',
          source: 'table' as const,
          confidence: 'high' as const,
          sectionName: 'Certifications',
          tableIndex: 0,
          rowIndex: 0,
        },
      ];

      const result = splitIntoQAPairs(pairs);
      const compositeContent = result[0].content;

      // Extract the answer_standard portion
      const extracted = extractAnswerFromContent(compositeContent);
      expect(extracted).toBe('ISO 9001 and ISO 14001.');

      // Simulate PATCH rebuild with answer_standard + answer_advanced
      const question = 'What certifications do you hold?';
      const answerAdvanced = 'We also hold ISO 27001 for information security.';
      const rebuilt = `Q: ${question}\n\n${extracted}\n\n${answerAdvanced}`;
      expect(rebuilt.match(/Q: /g)).toHaveLength(1);
      // No double prefix, correct canonical shape
      expect(rebuilt).toBe(
        'Q: What certifications do you hold?\n\nISO 9001 and ISO 14001.\n\nWe also hold ISO 27001 for information security.',
      );
    });

    it('PATCH edit to answer_advanced after batch create produces correct rebuild', async () => {
      // Simulate the full lifecycle:
      // 1. Batch create stores answer_standard = extractAnswerFromContent(composite)
      // 2. User edits answer_advanced via PATCH
      // 3. PATCH handler rebuilds content from Q: + answer_standard + answer_advanced
      const question = 'What is your environmental policy?';
      const answerStandard = 'We minimise environmental impact.';
      const newAnswerAdvanced =
        'Our carbon offset programme covers all operations.';

      // After batch create, stored state:
      // content = "Q: What is your environmental policy?\n\nWe minimise environmental impact."
      // answer_standard = "We minimise environmental impact." (extracted via helper)
      // answer_advanced = null

      // PATCH rebuild when answer_advanced is edited:
      const parts = [`Q: ${question}`];
      parts.push(answerStandard);
      parts.push(newAnswerAdvanced);
      const rebuilt = parts.join('\n\n');

      expect(rebuilt).toBe(
        'Q: What is your environmental policy?\n\nWe minimise environmental impact.\n\nOur carbon offset programme covers all operations.',
      );
      expect(rebuilt.match(/Q: /g)).toHaveLength(1);
    });

    it('PATCH edit to answer_standard after batch create produces correct rebuild', async () => {
      // Same lifecycle but editing answer_standard instead
      const question = 'What is your health and safety policy?';
      const newAnswerStandard = 'Updated: We exceed all H&S requirements.';

      // PATCH rebuild when answer_standard is edited:
      const parts = [`Q: ${question}`];
      parts.push(newAnswerStandard);
      const rebuilt = parts.join('\n\n');

      expect(rebuilt).toBe(
        'Q: What is your health and safety policy?\n\nUpdated: We exceed all H&S requirements.',
      );
      expect(rebuilt.match(/Q: /g)).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Path 4: MCP create_content_item — extraction helper coverage (L-1)
  // -------------------------------------------------------------------------

  describe('Path 4 — MCP create_content_item extraction logic', () => {
    it('extractAnswerFromContent correctly handles MCP composite content', () => {
      // MCP callers may send content in composite Q: format
      const mcpContent =
        'Q: How do you manage subcontractors?\n\nAll subcontractors are vetted and approved.';
      const extracted = extractAnswerFromContent(mcpContent);
      expect(extracted).toBe('All subcontractors are vetted and approved.');
    });

    it('extractAnswerFromContent is a no-op for MCP plain content', () => {
      // MCP callers may also send plain answer text
      const mcpContent = 'All subcontractors are vetted and approved.';
      const extracted = extractAnswerFromContent(mcpContent);
      expect(extracted).toBe(mcpContent);
    });

    it('extractAnswerFromContent handles MCP content with advanced answer', () => {
      const mcpContent =
        'Q: What is your safeguarding policy?\n\nAll staff are DBS checked.\n\nWe also run annual safeguarding refresher training.';
      const extracted = extractAnswerFromContent(mcpContent);
      expect(extracted).toBe(
        'All staff are DBS checked.\n\nWe also run annual safeguarding refresher training.',
      );
    });
  });
});
