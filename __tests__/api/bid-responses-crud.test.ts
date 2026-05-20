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

vi.spyOn(console, 'error').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Import handlers under test (AFTER mocks)
// ---------------------------------------------------------------------------

import { GET, PATCH } from '@/app/api/procurement/[id]/responses/[rId]/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BID_ID = '00000000-0000-4000-8000-000000000001';
const RESPONSE_ID = '00000000-0000-4000-8000-000000000002';
const QUESTION_ID = '00000000-0000-4000-8000-000000000003';

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
}

// ---------------------------------------------------------------------------
// GET /api/bids/:id/responses/:rId
// ---------------------------------------------------------------------------

describe('GET /api/bids/:id/responses/:rId', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(
      `/api/bids/${BID_ID}/responses/${RESPONSE_ID}`,
    );
    const params = createTestParams({ id: BID_ID, rId: RESPONSE_ID });
    const res = await GET(req, { params });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns 400 for invalid bid UUID', async () => {
    const req = createTestRequest(
      `/api/bids/not-a-uuid/responses/${RESPONSE_ID}`,
    );
    const params = createTestParams({ id: 'not-a-uuid', rId: RESPONSE_ID });
    const res = await GET(req, { params });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid ID');
  });

  it('returns 400 for invalid response UUID', async () => {
    const req = createTestRequest(`/api/bids/${BID_ID}/responses/bad-id`);
    const params = createTestParams({ id: BID_ID, rId: 'bad-id' });
    const res = await GET(req, { params });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid ID');
  });

  it('returns 404 when response not found', async () => {
    // First .single() call — response lookup returns null
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(
      `/api/bids/${BID_ID}/responses/${RESPONSE_ID}`,
    );
    const params = createTestParams({ id: BID_ID, rId: RESPONSE_ID });
    const res = await GET(req, { params });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Response not found');
  });

  it('returns 404 when response does not belong to the bid', async () => {
    // First .single() — response found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: RESPONSE_ID,
        question_id: QUESTION_ID,
        response_text: '<p>Answer</p>',
        response_text_advanced: null,
        source_content_ids: [],
        metadata: null,
        review_status: 'draft',
        version: 1,
        drafted_by: 'test-user-id',
        last_edited_by: null,
        approved_by: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      error: null,
    });
    // Second .single() — question not found in this bid
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(
      `/api/bids/${BID_ID}/responses/${RESPONSE_ID}`,
    );
    const params = createTestParams({ id: BID_ID, rId: RESPONSE_ID });
    const res = await GET(req, { params });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Response not found in this bid');
  });

  it('returns 200 with response data and empty citations', async () => {
    // First .single() — response
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: RESPONSE_ID,
        question_id: QUESTION_ID,
        response_text: '<p>Our approach is...</p>',
        response_text_advanced: null,
        source_content_ids: [],
        metadata: {},
        review_status: 'ai_drafted',
        version: 1,
        drafted_by: 'test-user-id',
        last_edited_by: null,
        approved_by: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      error: null,
    });
    // Second .single() — question
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: QUESTION_ID,
        question_text: 'Describe your methodology',
        word_limit: 500,
        section_name: 'Technical',
        confidence_posture: 'strong',
      },
      error: null,
    });

    const req = createTestRequest(
      `/api/bids/${BID_ID}/responses/${RESPONSE_ID}`,
    );
    const params = createTestParams({ id: BID_ID, rId: RESPONSE_ID });
    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.id).toBe(RESPONSE_ID);
    expect(json.question_id).toBe(QUESTION_ID);
    expect(json.question.question_text).toBe('Describe your methodology');
    expect(json.question.word_limit).toBe(500);
    expect(json.question.section_name).toBe('Technical');
    expect(json.question.confidence_posture).toBe('strong');
    expect(json.response_text).toBe('<p>Our approach is...</p>');
    expect(json.citations).toEqual([]);
    expect(json.source_content).toEqual([]);
    expect(json.quality_check).toBeNull();
    expect(json.review_status).toBe('ai_drafted');
  });

  it('returns 200 with citations and quality data from metadata', async () => {
    const metadata = {
      citations_data: {
        citations: [
          { content_id: 'c1', text: 'ISO 27001 compliant', confidence: 0.9 },
        ],
      },
      quality_data: {
        overall_score: 85,
        word_count: 120,
        word_limit_compliance: true,
        citation_count: 1,
        unsupported_claims: [],
        suggestions: [],
        issues: [],
      },
    };

    // First .single() — response with metadata
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: RESPONSE_ID,
        question_id: QUESTION_ID,
        response_text: '<p>ISO 27001 compliant systems</p>',
        response_text_advanced: null,
        source_content_ids: [],
        metadata,
        review_status: 'edited',
        version: 2,
        drafted_by: 'test-user-id',
        last_edited_by: 'test-user-id',
        approved_by: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-02-01T00:00:00Z',
      },
      error: null,
    });
    // Second .single() — question
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: QUESTION_ID,
        question_text: 'Security certifications?',
        word_limit: 200,
        section_name: 'Security',
        confidence_posture: 'partial',
      },
      error: null,
    });

    const req = createTestRequest(
      `/api/bids/${BID_ID}/responses/${RESPONSE_ID}`,
    );
    const params = createTestParams({ id: BID_ID, rId: RESPONSE_ID });
    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.citations).toHaveLength(1);
    expect(json.citations[0].content_id).toBe('c1');
    expect(json.quality_check).toBeDefined();
    expect(json.quality_check.overall_score).toBe(85);
    expect(json.quality_check.word_count).toBe(120);
  });

  it('returns source content items when source_content_ids present', async () => {
    const sourceId = '00000000-0000-4000-8000-000000000099';

    // First .single() — response with source IDs
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: RESPONSE_ID,
        question_id: QUESTION_ID,
        response_text: '<p>Answer</p>',
        response_text_advanced: null,
        source_content_ids: [sourceId],
        metadata: {},
        review_status: 'draft',
        version: 1,
        drafted_by: 'test-user-id',
        last_edited_by: null,
        approved_by: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      error: null,
    });
    // Second .single() — question
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: QUESTION_ID,
        question_text: 'Question?',
        word_limit: null,
        section_name: null,
        confidence_posture: null,
      },
      error: null,
    });
    // Then-awaited query for content_items — returns source content
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: sourceId,
              suggested_title: 'ISO 27001 Policy',
              content_type: 'policy',
              primary_domain: 'Information Security',
              summary: 'Our ISO 27001 certification details',
            },
          ],
          error: null,
        }),
    );

    const req = createTestRequest(
      `/api/bids/${BID_ID}/responses/${RESPONSE_ID}`,
    );
    const params = createTestParams({ id: BID_ID, rId: RESPONSE_ID });
    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.source_content).toHaveLength(1);
    expect(json.source_content[0].id).toBe(sourceId);
    expect(json.source_content[0].title).toBe('ISO 27001 Policy');
    expect(json.source_content[0].content_type).toBe('policy');
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/bids/:id/responses/:rId
// ---------------------------------------------------------------------------

describe('PATCH /api/bids/:id/responses/:rId', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(
      `/api/bids/${BID_ID}/responses/${RESPONSE_ID}`,
      {
        method: 'PATCH',
        body: { response_text: 'Updated' },
      },
    );
    const params = createTestParams({ id: BID_ID, rId: RESPONSE_ID });
    const res = await PATCH(req, { params });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(
      `/api/bids/${BID_ID}/responses/${RESPONSE_ID}`,
      {
        method: 'PATCH',
        body: { response_text: 'Updated' },
      },
    );
    const params = createTestParams({ id: BID_ID, rId: RESPONSE_ID });
    const res = await PATCH(req, { params });

    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid bid UUID', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(
      `/api/bids/not-valid/responses/${RESPONSE_ID}`,
      {
        method: 'PATCH',
        body: { response_text: 'Updated' },
      },
    );
    const params = createTestParams({ id: 'not-valid', rId: RESPONSE_ID });
    const res = await PATCH(req, { params });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid ID');
  });

  it('returns 400 for invalid response UUID', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(`/api/bids/${BID_ID}/responses/bad`, {
      method: 'PATCH',
      body: { response_text: 'Updated' },
    });
    const params = createTestParams({ id: BID_ID, rId: 'bad' });
    const res = await PATCH(req, { params });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid review_status value', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(
      `/api/bids/${BID_ID}/responses/${RESPONSE_ID}`,
      {
        method: 'PATCH',
        body: { review_status: 'rejected' },
      },
    );
    const params = createTestParams({ id: BID_ID, rId: RESPONSE_ID });
    const res = await PATCH(req, { params });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Validation failed');
  });

  it('returns 404 when response not found', async () => {
    configureRole(mockSupabase, 'editor');

    // Role lookup consumed by configureRole, then response lookup returns not found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(
      `/api/bids/${BID_ID}/responses/${RESPONSE_ID}`,
      {
        method: 'PATCH',
        body: { response_text: 'Updated' },
      },
    );
    const params = createTestParams({ id: BID_ID, rId: RESPONSE_ID });
    const res = await PATCH(req, { params });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Response not found');
  });

  it('returns 404 when question does not belong to the bid', async () => {
    configureRole(mockSupabase, 'editor');

    // Response found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: RESPONSE_ID, question_id: QUESTION_ID, metadata: {} },
      error: null,
    });
    // Question not found in this bid
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const req = createTestRequest(
      `/api/bids/${BID_ID}/responses/${RESPONSE_ID}`,
      {
        method: 'PATCH',
        body: { response_text: 'Updated' },
      },
    );
    const params = createTestParams({ id: BID_ID, rId: RESPONSE_ID });
    const res = await PATCH(req, { params });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Response not found in this bid');
  });

  it('returns 200 on successful text update', async () => {
    configureRole(mockSupabase, 'editor');

    // Response found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: RESPONSE_ID, question_id: QUESTION_ID, metadata: {} },
      error: null,
    });
    // Question found
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: QUESTION_ID, word_limit: 500 },
      error: null,
    });
    // Update returns updated row
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: RESPONSE_ID,
        question_id: QUESTION_ID,
        response_text: '<p>Updated answer</p>',
        response_text_advanced: null,
        review_status: 'draft',
        version: 2,
        last_edited_by: 'test-user-id',
        approved_by: null,
        updated_at: '2026-02-01T00:00:00Z',
      },
      error: null,
    });

    const req = createTestRequest(
      `/api/bids/${BID_ID}/responses/${RESPONSE_ID}`,
      {
        method: 'PATCH',
        body: { response_text: '<p>Updated answer</p>' },
      },
    );
    const params = createTestParams({ id: BID_ID, rId: RESPONSE_ID });
    const res = await PATCH(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe(RESPONSE_ID);
    expect(json.response_text).toBe('<p>Updated answer</p>');
    expect(json.last_edited_by).toBe('test-user-id');
  });

  it('records the approver when a response is approved', async () => {
    configureRole(mockSupabase, 'admin');

    // Response found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: RESPONSE_ID, question_id: QUESTION_ID, metadata: {} },
      error: null,
    });
    // Question found
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: QUESTION_ID, word_limit: null },
      error: null,
    });
    // Update returns row
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: RESPONSE_ID,
        question_id: QUESTION_ID,
        response_text: '<p>Answer</p>',
        response_text_advanced: null,
        review_status: 'approved',
        version: 3,
        last_edited_by: 'test-user-id',
        approved_by: 'test-user-id',
        updated_at: '2026-02-01T00:00:00Z',
      },
      error: null,
    });

    const req = createTestRequest(
      `/api/bids/${BID_ID}/responses/${RESPONSE_ID}`,
      {
        method: 'PATCH',
        body: { review_status: 'approved' },
      },
    );
    const params = createTestParams({ id: BID_ID, rId: RESPONSE_ID });
    const res = await PATCH(req, { params });

    expect(res.status).toBe(200);

    // Verify approved_by was set in the update call
    expect(mockSupabase._chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        approved_by: 'test-user-id',
        last_edited_by: 'test-user-id',
      }),
    );
  });

  it('returns 500 when update fails', async () => {
    configureRole(mockSupabase, 'editor');

    // Response found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: RESPONSE_ID, question_id: QUESTION_ID, metadata: {} },
      error: null,
    });
    // Question found
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: QUESTION_ID, word_limit: null },
      error: null,
    });
    // Update fails
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'Permission denied' },
    });

    const req = createTestRequest(
      `/api/bids/${BID_ID}/responses/${RESPONSE_ID}`,
      {
        method: 'PATCH',
        body: { review_status: 'edited' },
      },
    );
    const params = createTestParams({ id: BID_ID, rId: RESPONSE_ID });
    const res = await PATCH(req, { params });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to update response');
  });

  it('calls rpc to set change_reason when provided', async () => {
    configureRole(mockSupabase, 'editor');

    // Response found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: RESPONSE_ID, question_id: QUESTION_ID, metadata: {} },
      error: null,
    });
    // Question found
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: QUESTION_ID, word_limit: null },
      error: null,
    });
    // Update returns row
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: RESPONSE_ID,
        question_id: QUESTION_ID,
        response_text: '<p>Answer</p>',
        response_text_advanced: null,
        review_status: 'edited',
        version: 2,
        last_edited_by: 'test-user-id',
        approved_by: null,
        updated_at: '2026-02-01T00:00:00Z',
      },
      error: null,
    });

    const req = createTestRequest(
      `/api/bids/${BID_ID}/responses/${RESPONSE_ID}`,
      {
        method: 'PATCH',
        body: {
          response_text: '<p>Answer</p>',
          review_status: 'edited',
          change_reason: 'Improved clarity',
        },
      },
    );
    const params = createTestParams({ id: BID_ID, rId: RESPONSE_ID });
    const res = await PATCH(req, { params });

    expect(res.status).toBe(200);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('set_config', {
      setting: 'app.change_reason',
      value: 'Improved clarity',
      is_local: true,
    });
  });

  it('updates question status to complete when review_status is approved', async () => {
    configureRole(mockSupabase, 'editor');

    // Response found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: RESPONSE_ID, question_id: QUESTION_ID, metadata: {} },
      error: null,
    });
    // Question found
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: QUESTION_ID, word_limit: null },
      error: null,
    });
    // Update returns row
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: RESPONSE_ID,
        question_id: QUESTION_ID,
        response_text: '<p>Answer</p>',
        response_text_advanced: null,
        review_status: 'approved',
        version: 2,
        last_edited_by: 'test-user-id',
        approved_by: 'test-user-id',
        updated_at: '2026-02-01T00:00:00Z',
      },
      error: null,
    });

    const req = createTestRequest(
      `/api/bids/${BID_ID}/responses/${RESPONSE_ID}`,
      {
        method: 'PATCH',
        body: { review_status: 'approved' },
      },
    );
    const params = createTestParams({ id: BID_ID, rId: RESPONSE_ID });
    const res = await PATCH(req, { params });

    expect(res.status).toBe(200);

    // Verify bid_questions was updated to 'complete'
    expect(mockSupabase.from).toHaveBeenCalledWith('bid_questions');
    expect(mockSupabase._chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'complete' }),
    );
  });
});
