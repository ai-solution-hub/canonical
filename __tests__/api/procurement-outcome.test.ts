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
const FORM_ID = '00000000-0000-4000-8000-000000000099';
const QUESTION_ID = '00000000-0000-4000-8000-000000000010';
const QUESTION_ID_2 = '00000000-0000-4000-8000-000000000011';
const CONTENT_ID = '00000000-0000-4000-8000-000000000020';

// ID-130 T-B9: outcome recording now targets the FORM. The route sequence after
// the auth role lookup is: workspace verify (`.single()`), single-v1 form fetch
// (awaited list -> `.then`), then the form UPDATE (awaited list -> `.then`).
// `configureWorkspaceAndForm` queues the workspace row + the form-fetch result so
// each test only needs to add the UPDATE outcome (and any KB queries).
function configureWorkspaceAndForm(
  workflowState: string,
  formType: string | null = 'bid',
) {
  // workspace verify — only the procurement discriminator + id matter now.
  mockSupabase._chain.single.mockResolvedValueOnce({
    data: { id: BID_ID },
    error: null,
  });
  // single-v1 form fetch (awaited list).
  mockSupabase._chain.then.mockImplementationOnce(
    (resolve: (v: unknown) => void) =>
      resolve({
        data: [
          { id: FORM_ID, form_type: formType, workflow_state: workflowState },
        ],
        error: null,
      }),
  );
}

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

    // Form found but in 'draft' state — cannot transition to 'won'. The
    // transition is validated against the FORM's workflow_state (T-B10).
    configureWorkspaceAndForm('draft');

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

  it('returns 409 when the workspace has no form', async () => {
    configureRole(mockSupabase, 'editor');

    // Workspace verify succeeds, but the single-v1 form fetch returns empty.
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: BID_ID },
      error: null,
    });
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const req = createTestRequest(`/api/procurement/${BID_ID}/outcome`, {
      method: 'POST',
      body: { outcome: 'won' },
    });
    const params = createTestParams({ id: BID_ID });
    const res = await postOutcome(req, { params });

    expect(res.status).toBe(409);
  });

  it('returns 200 on successful outcome (won without KB integration)', async () => {
    configureRole(mockSupabase, 'editor');

    // Form found in 'submitted' state.
    configureWorkspaceAndForm('submitted');

    // Form UPDATE succeeds and returns the written row (row-count verify).
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: FORM_ID }], error: null }),
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

  it('records the terminal outcome + audit atomically onto the form', async () => {
    configureRole(mockSupabase, 'editor');

    configureWorkspaceAndForm('submitted');

    // Form UPDATE succeeds.
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: FORM_ID }], error: null }),
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

    // The outcome is persisted via a void UPDATE onto the FORM — the response
    // merely echoes the request input, so the UPDATE payload is the sole proof
    // that workflow_state + the {outcome, outcome_notes, recorded_at/by} triad
    // are persisted ATOMICALLY (one form UPDATE), with the audit provenance set
    // server-side. It must NOT carry a domain_metadata writer.
    const updateArg = mockSupabase._chain.update.mock.calls[0][0];
    expect(updateArg).toMatchObject({
      workflow_state: 'lost',
      outcome: 'lost',
      outcome_notes: 'Price was too high',
      outcome_recorded_by: 'test-user-id',
    });
    expect(typeof updateArg.outcome_recorded_at).toBe('string');
    expect(updateArg).not.toHaveProperty('domain_metadata');
    expect(updateArg).not.toHaveProperty('status');
  });

  it('withdrawn sets workflow_state=withdrawn with outcome=NULL and no audit', async () => {
    configureRole(mockSupabase, 'editor');

    configureWorkspaceAndForm('submitted');

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: FORM_ID }], error: null }),
    );

    const req = createTestRequest(`/api/procurement/${BID_ID}/outcome`, {
      method: 'POST',
      body: { outcome: 'withdrawn' },
    });
    const params = createTestParams({ id: BID_ID });
    const res = await postOutcome(req, { params });

    expect(res.status).toBe(200);

    // withdrawn is a workflow terminal, NOT an outcome (AD-4): the form's
    // workflow_state flips to 'withdrawn' and outcome is cleared to NULL, with
    // NO audit provenance written.
    const updateArg = mockSupabase._chain.update.mock.calls[0][0];
    expect(updateArg).toMatchObject({
      workflow_state: 'withdrawn',
      outcome: null,
    });
    expect(updateArg).not.toHaveProperty('outcome_recorded_at');
    expect(updateArg).not.toHaveProperty('outcome_recorded_by');
  });

  it('returns KB candidates recommending new_entry when won with integrate_to_kb (BL-395: update_existing retired)', async () => {
    configureRole(mockSupabase, 'editor');

    // Form found in 'submitted' state (consumes the form-fetch .then-once).
    configureWorkspaceAndForm('submitted');

    // Subsequent .then calls: 1 = form UPDATE, 2 = form_questions, 3 = responses
    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1) {
          // form UPDATE (returns the written row for the row-count verify)
          return resolve({ data: [{ id: FORM_ID }], error: null });
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
    // BL-395: recommendation is always 'new_entry' now — 'update_existing'
    // had no consumer, and the source_content_ids-driven computation that
    // used to pick it has been removed as dead code.
    expect(json.kb_candidates[0].recommendation).toBe('new_entry');
    expect(json.kb_candidates[0]).not.toHaveProperty('source_content_ids');
  });

  it('returns 500 when the form update fails', async () => {
    configureRole(mockSupabase, 'editor');

    configureWorkspaceAndForm('submitted');

    // Form UPDATE fails.
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
});

// ---------------------------------------------------------------------------
// POST /api/bids/:id/outcome/integrate
// ---------------------------------------------------------------------------

describe('POST /api/bids/:id/outcome/integrate', () => {
  // ID-130 {130.17}: the won-state gate now reads the form's outcome
  // (form_templates.outcome via .maybeSingle), NOT workspaces.status. Default
  // the form-gate fetch to a won form so the happy-path tests exercise the
  // post-re-anchor gate; the not-won test overrides this below.
  beforeEach(() => {
    resetMocks();
    mockSupabase._chain.maybeSingle.mockResolvedValue({
      data: { outcome: 'won', workflow_state: 'won' },
      error: null,
    });
  });

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

  it('returns 400 when the form outcome is not won', async () => {
    configureRole(mockSupabase, 'editor');

    // Procurement found, but the form's outcome is not 'won' (ID-130 {130.17}:
    // the gate reads form_templates.outcome, not workspaces.status). A submitted
    // form has outcome=null (not yet decided).
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: BID_ID,
        name: 'Test Procurement',
        domain_metadata: {},
      },
      error: null,
    });
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { outcome: null, workflow_state: 'submitted' },
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
    expect(json.error).toContain('only available for won procurements');
    expect(json.current_outcome).toBeNull();
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

  it('creates a draft q_a_pair for new_entry action (ID-131 {131.28} Part 2 — HYBRID RETIRE)', async () => {
    configureRole(mockSupabase, 'editor');

    const newPairId = '00000000-0000-4000-8000-000000000050';

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
                id: 'form-response-1',
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

    // Insert returns new q_a_pair ID
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: newPairId },
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
    expect(json.created).toBe(1);
    expect(json.updated).toBe(0);
    expect(json.skipped).toBe(0);
    expect(json.items[0].action).toBe('created');
    expect(json.items[0].q_a_pair_id).toBe(newPairId);

    // DR-025/DR-026 (proposal-shaped admission): no embedding at insert.
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();

    // Verify insert was called with the UC5 promote-path draft shape onto
    // q_a_pairs — never content_items.
    expect(mockSupabase.from).toHaveBeenCalledWith('q_a_pairs');
    expect(mockSupabase._chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        question_text: 'Describe your approach to security',
        answer_standard: '<p>We implement ISO 27001</p>',
        origin_kind: 'derived_from_form_response',
        publication_status: 'draft',
        source_form_response_id: 'form-response-1',
        source_question_id: QUESTION_ID,
        source_workspace_id: BID_ID,
      }),
    );
  });

  it('rejects update_existing as an invalid action (retired per HYBRID RETIRE)', async () => {
    configureRole(mockSupabase, 'editor');

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

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Validation failed');
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
  // Dedup retirement (ID-131.15, G-DEDUP legacy dedup-family retirement,
  // S446): the new_entry skip-and-log exact-hash pre-check (backed by the
  // now-DROPped find_exact_duplicates RPC) was removed — it was already
  // checking the wrong table by this point ({131.28} re-pointed the write
  // onto `q_a_pairs`, but the check still queried the legacy `content_items`
  // exact-hash RPC). new_entry now always proceeds to the q_a_pairs insert;
  // `skip_dedup` is a no-op for admin and non-admin callers alike.
  // ─────────────────────────────────────────────────────────────────────

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

  it('creates new_entry unconditionally — no on-ingest exact-hash check runs', async () => {
    configureRole(mockSupabase, 'editor');
    primeBidAndQuestions();

    // Insert returns new q_a_pair id
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: '00000000-0000-4000-8000-000000000051' },
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
    expect(json.created).toBe(1);
    expect(json.skipped).toBe(0);
    expect(json.items[0].action).toBe('created');
    // DR-025/DR-026 (proposal-shaped admission): no embedding at insert.
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
  });

  it('skip_dedup=true is a no-op — new_entry still creates (admin or non-admin)', async () => {
    configureRole(mockSupabase, 'admin');
    primeBidAndQuestions();

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: '00000000-0000-4000-8000-000000000051' },
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
    expect(json.created).toBe(1);
    expect(json.skipped).toBe(0);
    expect(json.items[0].action).toBe('created');
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
  });
});
