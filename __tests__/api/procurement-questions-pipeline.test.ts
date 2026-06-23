import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: () => [],
    set: () => {},
  }),
}));

// ---------------------------------------------------------------------------
// Mock AI services — vi.hoisted() to avoid hoisting issues with vi.mock()
// ---------------------------------------------------------------------------

const {
  mockExtractPDFQuestions,
  mockExtractDOCXQuestions,
  mockExtractTenderMetadata,
  mockGenerateSearchQueries,
  mockGenerateEmbedding,
  mockDeduplicateResults,
  mockAssessConfidence,
} = vi.hoisted(() => ({
  mockExtractPDFQuestions: vi.fn(),
  mockExtractDOCXQuestions: vi.fn(),
  mockExtractTenderMetadata: vi.fn(),
  mockGenerateSearchQueries: vi.fn(),
  mockGenerateEmbedding: vi.fn(),
  mockDeduplicateResults: vi.fn(),
  mockAssessConfidence: vi.fn(),
}));

vi.mock('@/lib/domains/procurement/ai/extract-questions', () => ({
  extractPDFQuestions: mockExtractPDFQuestions,
  extractDOCXQuestions: mockExtractDOCXQuestions,
  extractTenderMetadata: mockExtractTenderMetadata,
  generateSearchQueries: mockGenerateSearchQueries,
}));

vi.mock('@/lib/ai/embed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/embed')>();
  return {
    ...actual,
    generateEmbedding: mockGenerateEmbedding,
  };
});

vi.mock('@/lib/ai/match', () => ({
  deduplicateResults: mockDeduplicateResults,
  assessConfidence: mockAssessConfidence,
  MATCH_THRESHOLDS: { strong: 0.8, partial: 0.5, weak: 0.3 },
}));

vi.mock('mammoth', () => ({
  default: {
    convertToHtml: vi
      .fn()
      .mockResolvedValue({ value: '<p>Tender content</p>' }),
  },
}));

// Suppress console.error/warn noise
vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Import handlers under test (AFTER mocks are registered)
// ---------------------------------------------------------------------------

import {
  GET as getQuestions,
  POST as postQuestion,
} from '@/app/api/procurement/[id]/questions/route';
import { POST as extractQuestions } from '@/app/api/procurement/[id]/questions/extract/route';
import { POST as matchQuestions } from '@/app/api/procurement/[id]/questions/match/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = '00000000-0000-4000-8000-000000000001';
const BID_UUID = '00000000-0000-4000-8000-000000000010';
const QUESTION_UUID = '00000000-0000-4000-8000-000000000020';

function resetMocks() {
  vi.clearAllMocks();

  // Reset terminators to clear any leaked mockResolvedValueOnce queues
  mockSupabase._chain.single.mockReset();
  mockSupabase._chain.maybeSingle.mockReset();
  mockSupabase._chain.then.mockReset();

  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  const chainableMethods = [
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
  for (const method of chainableMethods) {
    mockSupabase._chain[method].mockReturnValue(mockSupabase._chain);
  }

  mockSupabase._chain.single.mockResolvedValue({
    data: null,
    error: null,
    count: null,
  });
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
    count: null,
  });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

  // Reset storage mock
  const storageBucket = {
    upload: vi
      .fn()
      .mockResolvedValue({ data: { path: 'test-path' }, error: null }),
    download: vi
      .fn()
      .mockResolvedValue({ data: new Blob(['test']), error: null }),
    remove: vi.fn().mockResolvedValue({ data: [], error: null }),
    list: vi.fn().mockResolvedValue({ data: [], error: null }),
    getPublicUrl: vi
      .fn()
      .mockReturnValue({ data: { publicUrl: 'https://example.com/file' } }),
  };
  mockSupabase.storage.from.mockReturnValue(storageBucket);

  // Reset AI mocks
  mockExtractPDFQuestions.mockResolvedValue({ sections: [] });
  mockExtractDOCXQuestions.mockResolvedValue({ sections: [] });
  mockExtractTenderMetadata.mockResolvedValue(null);
  mockGenerateSearchQueries.mockResolvedValue({ queries: ['test query'] });
  mockGenerateEmbedding.mockResolvedValue(new Array(1024).fill(0));
  mockDeduplicateResults.mockImplementation((results: unknown[]) => results);
  mockAssessConfidence.mockReturnValue('no_content');
}

// ===========================================================================
// GET /api/bids/:id/questions
// ===========================================================================

describe('GET /api/bids/:id/questions', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(`/api/procurement/${BID_UUID}/questions`);
    const params = createTestParams({ id: BID_UUID });
    const res = await getQuestions(req, { params });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns 400 for invalid bid UUID', async () => {
    const req = createTestRequest('/api/procurement/not-a-uuid/questions');
    const params = createTestParams({ id: 'not-a-uuid' });
    const res = await getQuestions(req, { params });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid bid ID');
  });

  it('returns 404 when bid does not exist', async () => {
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(`/api/procurement/${BID_UUID}/questions`);
    const params = createTestParams({ id: BID_UUID });
    const res = await getQuestions(req, { params });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Procurement not found');
  });

  it('returns 200 with enriched questions on success', async () => {
    // 1st single(): bid exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: BID_UUID },
      error: null,
    });

    const mockQuestions = [
      {
        id: QUESTION_UUID,
        workspace_id: BID_UUID,
        section_name: 'Technical',
        section_sequence: 1,
        question_text: 'Describe your approach',
        question_sequence: 1,
        word_limit: 500,
        evaluation_weight: 20,
        confidence_posture: 'strong',
        matched_content_ids: [VALID_UUID],
        status: null,
        has_variants: false,
        assigned_to: null,
        created_by: 'test-user-id',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ];

    const mockResponses = [
      {
        id: '00000000-0000-4000-8000-000000000030',
        question_id: QUESTION_UUID,
        review_status: 'ai_drafted',
        response_text: 'Our approach involves comprehensive testing',
      },
    ];

    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1) {
          // Fetch questions
          return resolve({ data: mockQuestions, error: null });
        }
        if (thenCallCount === 2) {
          // Fetch response previews
          return resolve({ data: mockResponses, error: null });
        }
        return resolve({ data: [], error: null, count: 0 });
      },
    );

    mockSupabase.rpc.mockResolvedValue({
      data: [{ total: 1, matched: 1, unmatched: 0 }],
      error: null,
    });

    const req = createTestRequest(`/api/procurement/${BID_UUID}/questions`);
    const params = createTestParams({ id: BID_UUID });
    const res = await getQuestions(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.questions).toHaveLength(1);
    expect(json.questions[0].id).toBe(QUESTION_UUID);
    expect(json.questions[0].question_text).toBe('Describe your approach');
    expect(json.questions[0].response).toBeDefined();
    expect(json.questions[0].response.review_status).toBe('ai_drafted');
    expect(json.questions[0].response.word_count).toBe(5);

    expect(json.stats).toBeDefined();
  });
});

// ===========================================================================
// POST /api/bids/:id/questions
// ===========================================================================

describe('POST /api/bids/:id/questions', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(`/api/procurement/${BID_UUID}/questions`, {
      method: 'POST',
      body: { question_text: 'Test question?' },
    });
    const params = createTestParams({ id: BID_UUID });
    const res = await postQuestion(req, { params });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(`/api/procurement/${BID_UUID}/questions`, {
      method: 'POST',
      body: { question_text: 'Test question?' },
    });
    const params = createTestParams({ id: BID_UUID });
    const res = await postQuestion(req, { params });

    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid bid UUID', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/procurement/bad-id/questions', {
      method: 'POST',
      body: { question_text: 'Test question?' },
    });
    const params = createTestParams({ id: 'bad-id' });
    const res = await postQuestion(req, { params });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid bid ID');
  });

  it('returns 404 when bid does not exist', async () => {
    configureRole(mockSupabase, 'editor');

    // The bid lookup returns not found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(`/api/procurement/${BID_UUID}/questions`, {
      method: 'POST',
      body: { question_text: 'Test question?' },
    });
    const params = createTestParams({ id: BID_UUID });
    const res = await postQuestion(req, { params });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Procurement not found');
  });

  it('returns 201 on successful single question creation', async () => {
    configureRole(mockSupabase, 'editor');

    // Procurement exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: BID_UUID },
      error: null,
    });

    // Max sequence query returns empty (first question)
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    // Insert returns the created question
    const mockCreated = {
      id: QUESTION_UUID,
      workspace_id: BID_UUID,
      question_text: 'What is your methodology?',
      question_sequence: 1,
      section_sequence: 0,
      created_by: 'test-user-id',
    };
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: mockCreated,
      error: null,
    });

    const req = createTestRequest(`/api/procurement/${BID_UUID}/questions`, {
      method: 'POST',
      body: { question_text: 'What is your methodology?' },
    });
    const params = createTestParams({ id: BID_UUID });
    const res = await postQuestion(req, { params });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.question_text).toBe('What is your methodology?');
    expect(json.id).toBe(QUESTION_UUID);
  });

  it('returns 201 on successful batch question creation', async () => {
    configureRole(mockSupabase, 'editor');

    // Procurement exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: BID_UUID },
      error: null,
    });

    // Batch insert
    const mockBatch = [
      { id: QUESTION_UUID, question_text: 'Q1', question_sequence: 0 },
      {
        id: '00000000-0000-4000-8000-000000000021',
        question_text: 'Q2',
        question_sequence: 1,
      },
    ];
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: mockBatch, error: null }),
    );

    const req = createTestRequest(`/api/procurement/${BID_UUID}/questions`, {
      method: 'POST',
      body: {
        questions: [{ question_text: 'Q1' }, { question_text: 'Q2' }],
      },
    });
    const params = createTestParams({ id: BID_UUID });
    const res = await postQuestion(req, { params });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.questions).toHaveLength(2);
    expect(json.count).toBe(2);
  });
});

// ===========================================================================
// POST /api/bids/:id/questions/extract
// ===========================================================================

describe('POST /api/bids/:id/questions/extract', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(
      `/api/procurement/${BID_UUID}/questions/extract`,
      {
        method: 'POST',
        body: { document_path: 'tender.pdf', format: 'pdf' },
      },
    );
    const params = createTestParams({ id: BID_UUID });
    const res = await extractQuestions(req, { params });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(
      `/api/procurement/${BID_UUID}/questions/extract`,
      {
        method: 'POST',
        body: { document_path: 'tender.pdf', format: 'pdf' },
      },
    );
    const params = createTestParams({ id: BID_UUID });
    const res = await extractQuestions(req, { params });

    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid bid UUID', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/procurement/bad-id/questions/extract', {
      method: 'POST',
      body: { document_path: 'tender.pdf', format: 'pdf' },
    });
    const params = createTestParams({ id: 'bad-id' });
    const res = await extractQuestions(req, { params });

    expect(res.status).toBe(400);
  });

  it('returns 400 for missing document_path', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(
      `/api/procurement/${BID_UUID}/questions/extract`,
      {
        method: 'POST',
        body: { format: 'pdf' },
      },
    );
    const params = createTestParams({ id: BID_UUID });
    const res = await extractQuestions(req, { params });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Validation failed');
  });

  it('returns 404 when bid does not exist', async () => {
    configureRole(mockSupabase, 'editor');

    // Procurement lookup fails
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(
      `/api/procurement/${BID_UUID}/questions/extract`,
      {
        method: 'POST',
        body: { document_path: 'tender.pdf', format: 'pdf' },
      },
    );
    const params = createTestParams({ id: BID_UUID });
    const res = await extractQuestions(req, { params });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Procurement not found');
  });

  it('returns 200 with extracted questions for PDF format', async () => {
    configureRole(mockSupabase, 'editor');

    // Procurement exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: BID_UUID },
      error: null,
    });

    // Mock PDF extraction result
    mockExtractPDFQuestions.mockResolvedValueOnce({
      sections: [
        {
          section_name: 'Technical Approach',
          section_sequence: 1,
          questions: [
            {
              question_text: 'Describe your methodology',
              question_sequence: 1,
              word_limit: 500,
              evaluation_weight: 20,
            },
          ],
        },
      ],
    });

    // No existing questions (dedup check), insert, status update, fetch saved
    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1) {
          // Existing questions check
          return resolve({ data: [], error: null });
        }
        if (thenCallCount === 2) {
          // Insert result
          return resolve({ data: null, error: null });
        }
        if (thenCallCount === 3) {
          // Status update
          return resolve({ data: null, error: null });
        }
        if (thenCallCount === 4) {
          // Fetch saved questions
          return resolve({
            data: [
              {
                id: QUESTION_UUID,
                workspace_id: BID_UUID,
                section_name: 'Technical Approach',
                question_text: 'Describe your methodology',
                question_sequence: 1,
                section_sequence: 1,
                word_limit: 500,
                evaluation_weight: 20,
                confidence_posture: null,
                matched_content_ids: null,
                assigned_to: null,
                created_by: 'test-user-id',
                created_at: '2026-01-01T00:00:00Z',
                updated_at: '2026-01-01T00:00:00Z',
              },
            ],
            error: null,
          });
        }
        return resolve({ data: [], error: null });
      },
    );

    const req = createTestRequest(
      `/api/procurement/${BID_UUID}/questions/extract`,
      {
        method: 'POST',
        body: { document_path: 'tender.pdf', format: 'pdf' },
      },
    );
    const params = createTestParams({ id: BID_UUID });
    const res = await extractQuestions(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('complete');
    expect(json.questions_found).toBe(1);
    expect(json.sections_found).toBe(1);
    expect(json.questions_inserted).toBe(1);
    expect(json.questions).toHaveLength(1);

    expect(mockExtractPDFQuestions).toHaveBeenCalled();
  });

  it('skips duplicate questions already existing for the bid', async () => {
    configureRole(mockSupabase, 'editor');

    // Procurement exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: BID_UUID },
      error: null,
    });

    // Mock extraction returns one question
    mockExtractPDFQuestions.mockResolvedValueOnce({
      sections: [
        {
          section_name: 'Section 1',
          section_sequence: 1,
          questions: [
            {
              question_text: 'Existing question?',
              question_sequence: 1,
              word_limit: null,
              evaluation_weight: null,
            },
          ],
        },
      ],
    });

    // Existing questions already contain this question
    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1) {
          return resolve({
            data: [{ question_text: 'Existing question?' }],
            error: null,
          });
        }
        return resolve({ data: [], error: null });
      },
    );

    const req = createTestRequest(
      `/api/procurement/${BID_UUID}/questions/extract`,
      {
        method: 'POST',
        body: { document_path: 'tender.pdf', format: 'pdf' },
      },
    );
    const params = createTestParams({ id: BID_UUID });
    const res = await extractQuestions(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.duplicates_skipped).toBe(1);
    expect(json.questions_inserted).toBe(0);
    expect(json.message).toContain('already exist');
  });
});

// ===========================================================================
// POST /api/bids/:id/questions/match
// ===========================================================================

describe('POST /api/bids/:id/questions/match', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(
      `/api/procurement/${BID_UUID}/questions/match`,
      {
        method: 'POST',
        body: {},
      },
    );
    const params = createTestParams({ id: BID_UUID });
    const res = await matchQuestions(req, { params });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(
      `/api/procurement/${BID_UUID}/questions/match`,
      {
        method: 'POST',
        body: {},
      },
    );
    const params = createTestParams({ id: BID_UUID });
    const res = await matchQuestions(req, { params });

    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid bid UUID', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/procurement/bad-id/questions/match', {
      method: 'POST',
      body: {},
    });
    const params = createTestParams({ id: 'bad-id' });
    const res = await matchQuestions(req, { params });

    expect(res.status).toBe(400);
  });

  it('returns 404 when bid does not exist', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(
      `/api/procurement/${BID_UUID}/questions/match`,
      {
        method: 'POST',
        body: {},
      },
    );
    const params = createTestParams({ id: BID_UUID });
    const res = await matchQuestions(req, { params });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Procurement not found');
  });

  it('returns 200 with empty results when no questions to match', async () => {
    configureRole(mockSupabase, 'editor');

    // Procurement exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: BID_UUID,
        status: 'questions_extracted',
        domain_metadata: {},
      },
      error: null,
    });

    // No unmatched questions found
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const req = createTestRequest(
      `/api/procurement/${BID_UUID}/questions/match`,
      {
        method: 'POST',
        body: {},
      },
    );
    const params = createTestParams({ id: BID_UUID });
    const res = await matchQuestions(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.matched).toBe(0);
    expect(json.results).toHaveLength(0);
    expect(json.message).toBe('No questions to match');
  });

  it('returns 200 with match results for questions', async () => {
    configureRole(mockSupabase, 'editor');

    // Procurement exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: BID_UUID,
        status: 'questions_extracted',
        domain_metadata: {},
      },
      error: null,
    });

    // One unmatched question
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: QUESTION_UUID,
              question_text: 'What is your approach?',
              confidence_posture: null,
            },
          ],
          error: null,
        }),
    );

    // generateSearchQueries returns queries
    mockGenerateSearchQueries.mockResolvedValueOnce({
      queries: ['approach methodology'],
    });

    // generateEmbedding returns a vector
    mockGenerateEmbedding.mockResolvedValueOnce(new Array(1024).fill(0.1));

    // RPC search returns matches
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [
        {
          id: VALID_UUID,
          similarity: 0.85,
          title: 'Our Methodology',
          content_type: 'q_a_pair',
        },
      ],
      error: null,
    });

    // deduplicateResults passes through
    mockDeduplicateResults.mockReturnValueOnce([
      {
        id: VALID_UUID,
        similarity: 0.85,
        suggested_title: 'Our Methodology',
        content_type: 'q_a_pair',
      },
    ]);

    // assessConfidence returns strong
    mockAssessConfidence.mockReturnValueOnce('strong');

    // Update question + unmatched count check (via chain)
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null, count: 0 }),
    );

    const req = createTestRequest(
      `/api/procurement/${BID_UUID}/questions/match`,
      {
        method: 'POST',
        body: {},
      },
    );
    const params = createTestParams({ id: BID_UUID });
    const res = await matchQuestions(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.matched).toBe(1);
    expect(json.results).toHaveLength(1);
    expect(json.results[0].question_id).toBe(QUESTION_UUID);
    expect(json.results[0].confidence_posture).toBe('strong');
    expect(json.results[0].matched_content_ids).toContain(VALID_UUID);

    expect(mockGenerateSearchQueries).toHaveBeenCalledWith(
      'What is your approach?',
    );
    expect(mockGenerateEmbedding).toHaveBeenCalled();
    expect(mockAssessConfidence).toHaveBeenCalled();
  });
});
