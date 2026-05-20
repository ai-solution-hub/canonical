/**
 * Procurement readiness API route tests.
 *
 * Tests GET /api/bids/:id/readiness — export readiness checklist.
 *
 * Covers:
 *   - Auth enforcement (editor/admin only)
 *   - UUID validation
 *   - Fully ready bid (all criteria pass)
 *   - Missing responses (has response check fails)
 *   - Draft status (review status check fails)
 *   - Low quality score (quality check fails)
 *   - Summary counts are correct
 *   - Procurement not found returns 404
 */
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

// Suppress console.error noise
vi.spyOn(console, 'error').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Import route handler AFTER mocks
// ---------------------------------------------------------------------------

import { GET } from '@/app/api/procurement/[id]/readiness/route';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BID_UUID = '00000000-0000-4000-8000-000000000001';
const Q1_UUID = '00000000-0000-4000-8000-000000000010';
const Q2_UUID = '00000000-0000-4000-8000-000000000011';
const Q3_UUID = '00000000-0000-4000-8000-000000000012';

// ---------------------------------------------------------------------------
// Reset helper
// ---------------------------------------------------------------------------

function resetMocks() {
  vi.clearAllMocks();

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
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );
  mockSupabase.from.mockReturnValue(mockSupabase._chain);
}

// ---------------------------------------------------------------------------
// Helper: build a mock response row
// ---------------------------------------------------------------------------

function mockResponse(
  questionId: string,
  overrides: {
    response_text?: string | null;
    review_status?: string | null;
    overall_score?: number;
    word_limit_compliance?: boolean;
    unsupported_claims?: string[];
    citation_count?: number;
    issues?: Array<{ type: string; severity: string; message: string }>;
  } = {},
) {
  const {
    response_text = '<p>A solid response with evidence.</p>',
    review_status = 'approved',
    overall_score = 80,
    word_limit_compliance = true,
    unsupported_claims = [],
    citation_count = 3,
    issues = [],
  } = overrides;

  return {
    question_id: questionId,
    response_text,
    review_status,
    metadata: {
      quality_data: {
        overall_score,
        word_count: 150,
        word_limit_compliance,
        citation_count,
        unsupported_claims,
        suggestions: [],
        issues,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: configure mock for a full readiness flow
// ---------------------------------------------------------------------------

function configureBidAndQuestions(
  questions: Array<{
    id: string;
    question_text: string;
    question_sequence: number;
  }>,
  responses: unknown[],
) {
  // Call 1: getAuthorisedClient -> user_roles (role check)
  configureRole(mockSupabase, 'editor');

  // Call 2: from('workspaces').select().eq().eq().single() -> bid
  // Since we reset after configureRole, the next single call is the bid
  mockSupabase._chain.single.mockResolvedValueOnce({
    data: { id: BID_UUID },
    error: null,
  });

  // Call 3: from('bid_questions').select().eq().order().order() -> questions
  // This is awaited directly (not .single()), so we override .then
  mockSupabase._chain.then.mockImplementationOnce(
    (resolve: (v: unknown) => void) =>
      resolve({
        data: questions.map((q) => ({
          id: q.id,
          question_text: q.question_text,
          question_sequence: q.question_sequence,
          section_name: 'General',
          word_limit: 500,
        })),
        error: null,
      }),
  );

  // Call 4: from('bid_responses').select().in() -> responses
  mockSupabase._chain.then.mockImplementationOnce(
    (resolve: (v: unknown) => void) =>
      resolve({
        data: responses,
        error: null,
      }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/bids/:id/readiness', () => {
  beforeEach(resetMocks);

  // -- Auth -----------------------------------------------------------------

  it('returns 401 for unauthenticated user', async () => {
    configureUnauthenticated(mockSupabase);
    const req = createTestRequest('/api/procurement/test/readiness');
    const params = createTestParams({ id: BID_UUID });
    const res = await GET(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');
    const req = createTestRequest('/api/procurement/test/readiness');
    const params = createTestParams({ id: BID_UUID });
    const res = await GET(req, { params });
    expect(res.status).toBe(403);
  });

  // -- Validation -----------------------------------------------------------

  it('returns 400 for invalid UUID', async () => {
    configureRole(mockSupabase, 'editor');
    const req = createTestRequest('/api/procurement/not-a-uuid/readiness');
    const params = createTestParams({ id: 'not-a-uuid' });
    const res = await GET(req, { params });
    expect(res.status).toBe(400);
  });

  it('returns 404 when bid not found', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'not found' },
    });
    const req = createTestRequest(`/api/procurement/${BID_UUID}/readiness`);
    const params = createTestParams({ id: BID_UUID });
    const res = await GET(req, { params });
    expect(res.status).toBe(404);
  });

  // -- Fully ready bid ------------------------------------------------------

  it('returns ready=true when all criteria pass', async () => {
    const questions = [
      {
        id: Q1_UUID,
        question_text: 'Describe your approach',
        question_sequence: 1,
      },
      {
        id: Q2_UUID,
        question_text: 'Risk management plan',
        question_sequence: 2,
      },
    ];
    const responses = [mockResponse(Q1_UUID), mockResponse(Q2_UUID)];
    configureBidAndQuestions(questions, responses);

    const req = createTestRequest(`/api/procurement/${BID_UUID}/readiness`);
    const params = createTestParams({ id: BID_UUID });
    const res = await GET(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ready).toBe(true);
    expect(body.summary.total_questions).toBe(2);
    expect(body.summary.answered).toBe(2);
    expect(body.summary.approved).toBe(2);
    expect(body.criteria.every((c: { passed: boolean }) => c.passed)).toBe(
      true,
    );
    expect(body.issues).toHaveLength(0);
  });

  // -- Missing responses ----------------------------------------------------

  it('fails "has response" check when response_text is empty', async () => {
    const questions = [
      {
        id: Q1_UUID,
        question_text: 'Describe your approach',
        question_sequence: 1,
      },
      {
        id: Q2_UUID,
        question_text: 'Risk management plan',
        question_sequence: 2,
      },
    ];
    const responses = [
      mockResponse(Q1_UUID),
      mockResponse(Q2_UUID, { response_text: null }),
    ];
    configureBidAndQuestions(questions, responses);

    const req = createTestRequest(`/api/procurement/${BID_UUID}/readiness`);
    const params = createTestParams({ id: BID_UUID });
    const res = await GET(req, { params });
    const body = await res.json();

    expect(body.ready).toBe(false);
    expect(body.summary.answered).toBe(1);

    const answeredCriterion = body.criteria.find(
      (c: { name: string }) => c.name === 'All questions answered',
    );
    expect(answeredCriterion.passed).toBe(false);
    expect(answeredCriterion.details).toBe('1 of 2 questions answered');
  });

  // -- Draft status ---------------------------------------------------------

  it('fails review status check when response is draft', async () => {
    const questions = [
      {
        id: Q1_UUID,
        question_text: 'Describe your approach',
        question_sequence: 1,
      },
    ];
    const responses = [mockResponse(Q1_UUID, { review_status: 'draft' })];
    configureBidAndQuestions(questions, responses);

    const req = createTestRequest(`/api/procurement/${BID_UUID}/readiness`);
    const params = createTestParams({ id: BID_UUID });
    const res = await GET(req, { params });
    const body = await res.json();

    expect(body.ready).toBe(false);
    expect(body.summary.approved).toBe(0);

    const reviewCriterion = body.criteria.find(
      (c: { name: string }) => c.name === 'All responses reviewed',
    );
    expect(reviewCriterion.passed).toBe(false);
  });

  // -- Low quality score ----------------------------------------------------

  it('fails quality check when score is below threshold', async () => {
    const questions = [
      {
        id: Q1_UUID,
        question_text: 'Describe your approach',
        question_sequence: 1,
      },
      {
        id: Q2_UUID,
        question_text: 'Risk management plan',
        question_sequence: 2,
      },
    ];
    const responses = [
      mockResponse(Q1_UUID, { overall_score: 45 }),
      mockResponse(Q2_UUID, { overall_score: 80 }),
    ];
    configureBidAndQuestions(questions, responses);

    const req = createTestRequest(`/api/procurement/${BID_UUID}/readiness`);
    const params = createTestParams({ id: BID_UUID });
    const res = await GET(req, { params });
    const body = await res.json();

    expect(body.ready).toBe(false);
    expect(body.summary.quality_checked).toBe(2);
    expect(body.summary.passing_quality).toBe(1);

    const qualityCriterion = body.criteria.find(
      (c: { name: string }) => c.name === 'Quality threshold met',
    );
    expect(qualityCriterion.passed).toBe(false);
  });

  // -- Summary counts -------------------------------------------------------

  it('returns correct summary counts', async () => {
    const questions = [
      { id: Q1_UUID, question_text: 'Question 1', question_sequence: 1 },
      { id: Q2_UUID, question_text: 'Question 2', question_sequence: 2 },
      { id: Q3_UUID, question_text: 'Question 3', question_sequence: 3 },
    ];
    const responses = [
      mockResponse(Q1_UUID, { review_status: 'approved', overall_score: 75 }),
      mockResponse(Q2_UUID, { review_status: 'draft', overall_score: 50 }),
      // Q3 has no response
    ];
    configureBidAndQuestions(questions, responses);

    const req = createTestRequest(`/api/procurement/${BID_UUID}/readiness`);
    const params = createTestParams({ id: BID_UUID });
    const res = await GET(req, { params });
    const body = await res.json();

    expect(body.summary).toEqual({
      total_questions: 3,
      answered: 2,
      approved: 1,
      quality_checked: 2,
      passing_quality: 1,
    });
  });

  // -- Word limit compliance ------------------------------------------------

  it('reports word limit violations in issues', async () => {
    const questions = [
      {
        id: Q1_UUID,
        question_text: 'Describe your approach',
        question_sequence: 1,
      },
    ];
    const responses = [mockResponse(Q1_UUID, { word_limit_compliance: false })];
    configureBidAndQuestions(questions, responses);

    const req = createTestRequest(`/api/procurement/${BID_UUID}/readiness`);
    const params = createTestParams({ id: BID_UUID });
    const res = await GET(req, { params });
    const body = await res.json();

    const wordLimitCriterion = body.criteria.find(
      (c: { name: string }) => c.name === 'Word limits met',
    );
    expect(wordLimitCriterion.passed).toBe(false);
  });

  // -- Unsupported claims ---------------------------------------------------

  it('reports unsupported claims', async () => {
    const questions = [
      { id: Q1_UUID, question_text: 'Our track record', question_sequence: 1 },
    ];
    const responses = [
      mockResponse(Q1_UUID, {
        unsupported_claims: ['We are the market leader'],
      }),
    ];
    configureBidAndQuestions(questions, responses);

    const req = createTestRequest(`/api/procurement/${BID_UUID}/readiness`);
    const params = createTestParams({ id: BID_UUID });
    const res = await GET(req, { params });
    const body = await res.json();

    const claimsCriterion = body.criteria.find(
      (c: { name: string }) => c.name === 'No unsupported claims',
    );
    expect(claimsCriterion.passed).toBe(false);
  });

  // -- Critical issues ------------------------------------------------------

  it('fails critical issues check when critical/error severity present', async () => {
    const questions = [
      { id: Q1_UUID, question_text: 'Security approach', question_sequence: 1 },
    ];
    const responses = [
      mockResponse(Q1_UUID, {
        issues: [
          {
            type: 'weak_language',
            severity: 'error',
            message: 'Vague language',
          },
        ],
      }),
    ];
    configureBidAndQuestions(questions, responses);

    const req = createTestRequest(`/api/procurement/${BID_UUID}/readiness`);
    const params = createTestParams({ id: BID_UUID });
    const res = await GET(req, { params });
    const body = await res.json();

    const issuesCriterion = body.criteria.find(
      (c: { name: string }) => c.name === 'No critical issues',
    );
    expect(issuesCriterion.passed).toBe(false);
  });

  // -- Admin access ---------------------------------------------------------

  it('allows admin role', async () => {
    const questions = [
      { id: Q1_UUID, question_text: 'Test question', question_sequence: 1 },
    ];
    const responses = [mockResponse(Q1_UUID)];
    configureRole(mockSupabase, 'admin');

    // Procurement
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: BID_UUID },
      error: null,
    });

    // Questions
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: questions.map((q) => ({
            id: q.id,
            question_text: q.question_text,
            question_sequence: q.question_sequence,
            section_name: 'General',
            word_limit: 500,
          })),
          error: null,
        }),
    );

    // Responses
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: responses, error: null }),
    );

    const req = createTestRequest(`/api/procurement/${BID_UUID}/readiness`);
    const params = createTestParams({ id: BID_UUID });
    const res = await GET(req, { params });
    expect(res.status).toBe(200);
  });
});
