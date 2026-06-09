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

const mockGenerateEmbedding = vi
  .fn()
  .mockResolvedValue(new Array(1024).fill(0));

vi.mock('@/lib/ai/embed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/embed')>();
  return {
    ...actual,
    generateEmbedding: (...args: unknown[]) => mockGenerateEmbedding(...args),
  };
});

// Bypass rate-limit — the in-memory counter leaks across tests and
// tripping the 10/min gate masks real assertion failures.
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true, remaining: 10 })),
}));

vi.spyOn(console, 'error').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Import handlers under test (AFTER mocks)
// ---------------------------------------------------------------------------

import { POST as postOutcome } from '@/app/api/procurement/[id]/outcome/route';
import { POST as postIntegrate } from '@/app/api/procurement/[id]/outcome/integrate/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BID_ID = '00000000-0000-4000-8000-000000000001';
const QUESTION_ID = '00000000-0000-4000-8000-000000000010';
const QUESTION_ID_2 = '00000000-0000-4000-8000-000000000011';
const CONTENT_ID = '00000000-0000-4000-8000-000000000020';

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

  mockGenerateEmbedding.mockResolvedValue(new Array(1024).fill(0));
}

// ---------------------------------------------------------------------------
// POST /api/bids/:id/outcome
// ---------------------------------------------------------------------------

describe('POST /api/bids/:id/outcome', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(`/api/procurement/${BID_ID}/outcome`, {
      method: 'POST',
      body: { outcome: 'won' },
    });
    const params = createTestParams({ id: BID_ID });
    const res = await postOutcome(req, { params });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(`/api/procurement/${BID_ID}/outcome`, {
      method: 'POST',
      body: { outcome: 'won' },
    });
    const params = createTestParams({ id: BID_ID });
    const res = await postOutcome(req, { params });

    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid bid UUID', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/procurement/not-a-uuid/outcome', {
      method: 'POST',
      body: { outcome: 'won' },
    });
    const params = createTestParams({ id: 'not-a-uuid' });
    const res = await postOutcome(req, { params });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid bid ID');
  });

  it('returns 400 for invalid outcome value', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(`/api/procurement/${BID_ID}/outcome`, {
      method: 'POST',
      body: { outcome: 'cancelled' },
    });
    const params = createTestParams({ id: BID_ID });
    const res = await postOutcome(req, { params });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Validation failed');
  });

  it('returns 404 when bid not found', async () => {
    configureRole(mockSupabase, 'editor');

    // Role lookup consumed, then bid lookup returns not found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(`/api/procurement/${BID_ID}/outcome`, {
      method: 'POST',
      body: { outcome: 'won' },
    });
    const params = createTestParams({ id: BID_ID });
    const res = await postOutcome(req, { params });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Procurement not found');
  });

  it('returns 400 when state transition is invalid', async () => {
    configureRole(mockSupabase, 'editor');

    // Procurement found but in 'draft' state — cannot transition to 'won'
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: BID_ID,
        status: 'draft',
        domain_metadata: {},
      },
      error: null,
    });

    const req = createTestRequest(`/api/procurement/${BID_ID}/outcome`, {
      method: 'POST',
      body: { outcome: 'won' },
    });
    const params = createTestParams({ id: BID_ID });
    const res = await postOutcome(req, { params });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Cannot transition');
    expect(json.current_status).toBe('draft');
    expect(json.requested_outcome).toBe('won');
  });

  it('returns 200 on successful outcome (won without KB integration)', async () => {
    configureRole(mockSupabase, 'editor');

    // Procurement found in 'submitted' state
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: BID_ID,
        status: 'submitted',
        domain_metadata: { buyer: 'ACME Corp' },
      },
      error: null,
    });

    // Update succeeds (awaited via .then)
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const req = createTestRequest(`/api/procurement/${BID_ID}/outcome`, {
      method: 'POST',
      body: { outcome: 'won' },
    });
    const params = createTestParams({ id: BID_ID });
    const res = await postOutcome(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('won');
    expect(json.kb_candidates).toEqual([]);
  });

  it('returns 200 on successful lost outcome with notes', async () => {
    configureRole(mockSupabase, 'editor');

    // Procurement found in 'submitted' state
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: BID_ID,
        status: 'submitted',
        domain_metadata: {},
      },
      error: null,
    });

    // Update succeeds
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const req = createTestRequest(`/api/procurement/${BID_ID}/outcome`, {
      method: 'POST',
      body: { outcome: 'lost', notes: 'Price was too high' },
    });
    const params = createTestParams({ id: BID_ID });
    const res = await postOutcome(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('lost');
    expect(json.kb_candidates).toEqual([]);

    // Verify update was called with outcome in metadata
    expect(mockSupabase._chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'lost',
        updated_by: 'test-user-id',
        domain_metadata: expect.objectContaining({
          outcome: 'lost',
          outcome_notes: 'Price was too high',
          outcome_recorded_by: 'test-user-id',
        }),
      }),
    );
  });

  it('returns KB candidates when won with integrate_to_kb', async () => {
    configureRole(mockSupabase, 'editor');

    // Procurement found in 'submitted' state
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: BID_ID,
        status: 'submitted',
        domain_metadata: {},
      },
      error: null,
    });

    // Update succeeds
    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1) {
          // workspace update
          return resolve({ data: null, error: null });
        }
        if (thenCallCount === 2) {
          // form_questions query
          return resolve({
            data: [
              { id: QUESTION_ID, question_text: 'Describe your approach' },
            ],
            error: null,
          });
        }
        if (thenCallCount === 3) {
          // form_responses query
          return resolve({
            data: [
              {
                question_id: QUESTION_ID,
                response_text: '<p>Our approach is...</p>',
                source_content_ids: [CONTENT_ID],
                review_status: 'approved',
              },
            ],
            error: null,
          });
        }
        return resolve({ data: [], error: null });
      },
    );

    const req = createTestRequest(`/api/procurement/${BID_ID}/outcome`, {
      method: 'POST',
      body: { outcome: 'won', integrate_to_kb: true },
    });
    const params = createTestParams({ id: BID_ID });
    const res = await postOutcome(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('won');
    expect(json.kb_candidates).toHaveLength(1);
    expect(json.kb_candidates[0].question_id).toBe(QUESTION_ID);
    expect(json.kb_candidates[0].question_text).toBe('Describe your approach');
    expect(json.kb_candidates[0].recommendation).toBe('update_existing');
  });

  it('returns 500 when workspace update fails', async () => {
    configureRole(mockSupabase, 'editor');

    // Procurement found in 'submitted' state
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: BID_ID,
        status: 'submitted',
        domain_metadata: {},
      },
      error: null,
    });

    // Update fails
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: null,
          error: { code: '42501', message: 'Permission denied' },
        }),
    );

    const req = createTestRequest(`/api/procurement/${BID_ID}/outcome`, {
      method: 'POST',
      body: { outcome: 'won' },
    });
    const params = createTestParams({ id: BID_ID });
    const res = await postOutcome(req, { params });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to record outcome');
  });

  it('recommends new_entry when response has no source_content_ids', async () => {
    configureRole(mockSupabase, 'editor');

    // Procurement in submitted state
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: BID_ID, status: 'submitted', domain_metadata: {} },
      error: null,
    });

    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1) return resolve({ data: null, error: null });
        if (thenCallCount === 2) {
          return resolve({
            data: [{ id: QUESTION_ID, question_text: 'New question' }],
            error: null,
          });
        }
        if (thenCallCount === 3) {
          return resolve({
            data: [
              {
                question_id: QUESTION_ID,
                response_text: '<p>Fresh response</p>',
                source_content_ids: [],
                review_status: 'edited',
              },
            ],
            error: null,
          });
        }
        return resolve({ data: [], error: null });
      },
    );

    const req = createTestRequest(`/api/procurement/${BID_ID}/outcome`, {
      method: 'POST',
      body: { outcome: 'won', integrate_to_kb: true },
    });
    const params = createTestParams({ id: BID_ID });
    const res = await postOutcome(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.kb_candidates[0].recommendation).toBe('new_entry');
  });
});

// ---------------------------------------------------------------------------
// POST /api/bids/:id/outcome/integrate
// ---------------------------------------------------------------------------

describe('POST /api/bids/:id/outcome/integrate', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(
      `/api/procurement/${BID_ID}/outcome/integrate`,
      {
        method: 'POST',
        body: { integrations: [] },
      },
    );
    const params = createTestParams({ id: BID_ID });
    const res = await postIntegrate(req, { params });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(
      `/api/procurement/${BID_ID}/outcome/integrate`,
      {
        method: 'POST',
        body: { integrations: [] },
      },
    );
    const params = createTestParams({ id: BID_ID });
    const res = await postIntegrate(req, { params });

    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid bid UUID', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/procurement/bad-id/outcome/integrate', {
      method: 'POST',
      body: { integrations: [] },
    });
    const params = createTestParams({ id: 'bad-id' });
    const res = await postIntegrate(req, { params });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid bid ID');
  });

  it('returns 400 for invalid integration action', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(
      `/api/procurement/${BID_ID}/outcome/integrate`,
      {
        method: 'POST',
        body: {
          integrations: [{ question_id: QUESTION_ID, action: 'delete' }],
        },
      },
    );
    const params = createTestParams({ id: BID_ID });
    const res = await postIntegrate(req, { params });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Validation failed');
  });

  it('returns 404 when bid not found', async () => {
    configureRole(mockSupabase, 'editor');

    // Procurement not found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(
      `/api/procurement/${BID_ID}/outcome/integrate`,
      {
        method: 'POST',
        body: {
          integrations: [{ question_id: QUESTION_ID, action: 'skip' }],
        },
      },
    );
    const params = createTestParams({ id: BID_ID });
    const res = await postIntegrate(req, { params });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Procurement not found');
  });

  it('returns 400 when bid is not in won state', async () => {
    configureRole(mockSupabase, 'editor');

    // Procurement found but in 'submitted' state
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: BID_ID,
        name: 'Test Procurement',
        status: 'submitted',
        domain_metadata: {},
      },
      error: null,
    });

    const req = createTestRequest(
      `/api/procurement/${BID_ID}/outcome/integrate`,
      {
        method: 'POST',
        body: {
          integrations: [{ question_id: QUESTION_ID, action: 'new_entry' }],
        },
      },
    );
    const params = createTestParams({ id: BID_ID });
    const res = await postIntegrate(req, { params });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('only available for won bids');
    expect(json.current_status).toBe('submitted');
  });

  it('returns 200 with skip action counted correctly', async () => {
    configureRole(mockSupabase, 'editor');

    // Procurement in won state
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: BID_ID,
        name: 'Won Procurement',
        status: 'won',
        domain_metadata: { domain: 'Technology' },
      },
      error: null,
    });

    // Questions and responses queries
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const req = createTestRequest(
      `/api/procurement/${BID_ID}/outcome/integrate`,
      {
        method: 'POST',
        body: {
          integrations: [
            { question_id: QUESTION_ID, action: 'skip' },
            { question_id: QUESTION_ID_2, action: 'skip' },
          ],
        },
      },
    );
    const params = createTestParams({ id: BID_ID });
    const res = await postIntegrate(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.created).toBe(0);
    expect(json.updated).toBe(0);
    expect(json.skipped).toBe(2);
    expect(json.items).toHaveLength(2);
    expect(json.items[0].action).toBe('skipped');
    expect(json.items[1].action).toBe('skipped');
  });

  it('creates new KB entry for new_entry action', async () => {
    configureRole(mockSupabase, 'editor');

    const newItemId = '00000000-0000-4000-8000-000000000050';

    // Procurement in won state
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: BID_ID,
        name: 'Won Procurement',
        status: 'won',
        domain_metadata: { domain: 'Technology' },
      },
      error: null,
    });

    // Questions query
    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1) {
          // Questions
          return resolve({
            data: [
              {
                id: QUESTION_ID,
                question_text: 'Describe your approach to security',
              },
            ],
            error: null,
          });
        }
        if (thenCallCount === 2) {
          // Responses
          return resolve({
            data: [
              {
                question_id: QUESTION_ID,
                response_text: '<p>We implement ISO 27001</p>',
              },
            ],
            error: null,
          });
        }
        return resolve({ data: [], error: null });
      },
    );

    // Insert returns new item ID
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: newItemId },
      error: null,
    });

    const req = createTestRequest(
      `/api/procurement/${BID_ID}/outcome/integrate`,
      {
        method: 'POST',
        body: {
          integrations: [
            {
              question_id: QUESTION_ID,
              action: 'new_entry',
              title: 'Security Approach',
              content_type: 'capability',
            },
          ],
        },
      },
    );
    const params = createTestParams({ id: BID_ID });
    const res = await postIntegrate(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.created).toBe(1);
    expect(json.updated).toBe(0);
    expect(json.skipped).toBe(0);
    expect(json.items[0].action).toBe('created');
    expect(json.items[0].content_item_id).toBe(newItemId);

    // Verify embedding was generated
    expect(mockGenerateEmbedding).toHaveBeenCalled();

    // Verify insert was called with correct data
    expect(mockSupabase._chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Security Approach',
        content_type: 'capability',
        platform: 'extraction',
        created_by: 'test-user-id',
        primary_domain: 'Technology',
        // S206 WP-A Phase 2 (AC3.7): content_owner_id peer to created_by.
        // EP10 has NO admin-override semantics — owner is always caller.
        content_owner_id: 'test-user-id',
      }),
    );
  });

  it('updates existing KB entry for update_existing action', async () => {
    configureRole(mockSupabase, 'editor');

    // Procurement in won state
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: BID_ID,
        name: 'Won Procurement',
        status: 'won',
        domain_metadata: {},
      },
      error: null,
    });

    // Questions query
    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1) {
          return resolve({
            data: [{ id: QUESTION_ID, question_text: 'ISO compliance?' }],
            error: null,
          });
        }
        if (thenCallCount === 2) {
          return resolve({
            data: [
              {
                question_id: QUESTION_ID,
                response_text: '<p>Fully compliant</p>',
              },
            ],
            error: null,
          });
        }
        // content_items update and embedding update (both are .then-awaited)
        return resolve({ data: null, error: null });
      },
    );

    const req = createTestRequest(
      `/api/procurement/${BID_ID}/outcome/integrate`,
      {
        method: 'POST',
        body: {
          integrations: [
            {
              question_id: QUESTION_ID,
              action: 'update_existing',
              target_content_id: CONTENT_ID,
            },
          ],
        },
      },
    );
    const params = createTestParams({ id: BID_ID });
    const res = await postIntegrate(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.updated).toBe(1);
    expect(json.items[0].action).toBe('updated');
    expect(json.items[0].content_item_id).toBe(CONTENT_ID);

    // Verify embedding regenerated for the updated content
    expect(mockGenerateEmbedding).toHaveBeenCalled();
  });

  it('skips entries with empty response text', async () => {
    configureRole(mockSupabase, 'editor');

    // Procurement in won state
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: BID_ID,
        name: 'Won Procurement',
        status: 'won',
        domain_metadata: {},
      },
      error: null,
    });

    // Questions and responses queries
    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1) {
          return resolve({
            data: [{ id: QUESTION_ID, question_text: 'Question?' }],
            error: null,
          });
        }
        if (thenCallCount === 2) {
          // Response text is empty
          return resolve({
            data: [{ question_id: QUESTION_ID, response_text: '' }],
            error: null,
          });
        }
        return resolve({ data: [], error: null });
      },
    );

    const req = createTestRequest(
      `/api/procurement/${BID_ID}/outcome/integrate`,
      {
        method: 'POST',
        body: {
          integrations: [{ question_id: QUESTION_ID, action: 'new_entry' }],
        },
      },
    );
    const params = createTestParams({ id: BID_ID });
    const res = await postIntegrate(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skipped).toBe(1);
    expect(json.created).toBe(0);
    expect(json.items[0].action).toBe('skipped');

    // Embedding should NOT have been generated for empty content
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
  });

  // ─────────────────────────────────────────────────────────────────────
  // Dedup soft-block: new_entry path = skip-and-log on exact match
  // (WP1 / spec §6 D1, D2 — bid-outcome variant)
  // ─────────────────────────────────────────────────────────────────────

  const EXISTING_ITEM_ID = '00000000-0000-4000-8000-000000000099';
  const LONG_RESPONSE =
    '<p>We implement a comprehensive information-security management system aligned with ISO 27001:2022 across all operational areas.</p>';

  function primeBidAndQuestions(responseText: string = LONG_RESPONSE): void {
    // Procurement in won state
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: BID_ID,
        name: 'Won Procurement',
        status: 'won',
        domain_metadata: { domain: 'Technology' },
      },
      error: null,
    });

    // Questions + responses via .then
    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1) {
          return resolve({
            data: [
              {
                id: QUESTION_ID,
                question_text: 'Describe your security posture',
              },
            ],
            error: null,
          });
        }
        if (thenCallCount === 2) {
          return resolve({
            data: [{ question_id: QUESTION_ID, response_text: responseText }],
            error: null,
          });
        }
        return resolve({ data: [], error: null });
      },
    );
  }

  it('skips new_entry when exact hash matches existing KB item', async () => {
    configureRole(mockSupabase, 'editor');
    primeBidAndQuestions();

    // find_exact_duplicates returns an existing match
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [{ id: EXISTING_ITEM_ID, title: 'Existing ISO Entry' }],
      error: null,
    });

    const req = createTestRequest(
      `/api/procurement/${BID_ID}/outcome/integrate`,
      {
        method: 'POST',
        body: {
          integrations: [{ question_id: QUESTION_ID, action: 'new_entry' }],
        },
      },
    );
    const params = createTestParams({ id: BID_ID });
    const res = await postIntegrate(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.created).toBe(0);
    expect(json.skipped).toBe(1);
    expect(json.items[0].action).toBe('skipped');
    expect(json.items[0].content_item_id).toBe(EXISTING_ITEM_ID);
    expect(json.warnings.length).toBeGreaterThan(0);
    expect(json.warnings[0]).toContain(EXISTING_ITEM_ID);

    // Insert should NOT have been called for the skipped item
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
  });

  it('admin skip_dedup=true forces insert even on exact match', async () => {
    configureRole(mockSupabase, 'admin');
    primeBidAndQuestions();

    // Insert returns new item id
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: '00000000-0000-4000-8000-000000000051' },
      error: null,
    });

    // find_exact_duplicates should NOT be queried when skip_dedup=true
    // and role=admin. We don't queue a dedup response; any RPC call
    // would consume the unqueued default ({ data: null, error: null }).

    const req = createTestRequest(
      `/api/procurement/${BID_ID}/outcome/integrate`,
      {
        method: 'POST',
        body: {
          integrations: [{ question_id: QUESTION_ID, action: 'new_entry' }],
          skip_dedup: true,
        },
      },
    );
    const params = createTestParams({ id: BID_ID });
    const res = await postIntegrate(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.created).toBe(1);
    expect(json.skipped).toBe(0);
    expect(json.items[0].action).toBe('created');
    expect(mockGenerateEmbedding).toHaveBeenCalled();
  });

  it('non-admin skip_dedup=true is silently ignored — dedup still skips', async () => {
    configureRole(mockSupabase, 'editor');
    primeBidAndQuestions();

    // Editor cannot bypass — dedup check runs, match causes skip
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [{ id: EXISTING_ITEM_ID, title: 'Existing' }],
      error: null,
    });

    const req = createTestRequest(
      `/api/procurement/${BID_ID}/outcome/integrate`,
      {
        method: 'POST',
        body: {
          integrations: [{ question_id: QUESTION_ID, action: 'new_entry' }],
          skip_dedup: true,
        },
      },
    );
    const params = createTestParams({ id: BID_ID });
    const res = await postIntegrate(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skipped).toBe(1);
    expect(json.created).toBe(0);
  });
});
