/**
 * WP1: Bid State Machine Integration Tests
 *
 * Tests the bid state machine transitions through the PATCH /api/bids/[id] route.
 * Validates valid transitions succeed, invalid transitions return 400, and
 * terminal states block further transitions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestRequest, createTestParams } from '../helpers/mock-next';
import {
  createMockSupabaseClient,
  configureRole as configureRoleHelper,
} from '../helpers/mock-supabase';

// ---------------------------------------------------------------------------
// Shared mock client — lazy references in vi.mock() avoid hoisting issues
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
// Import AFTER mocks
// ---------------------------------------------------------------------------

import { PATCH } from '@/app/api/procurement/[id]/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

function configureRole(role: 'admin' | 'editor' | 'viewer') {
  configureRoleHelper(mockSupabase, role);
}

function configureBidFetch(status: string) {
  // Second .single() call is the bid fetch
  mockSupabase._chain.single.mockResolvedValueOnce({
    data: {
      id: VALID_UUID,
      name: 'Test Bid',
      description: null,
      status,
      domain_metadata: { buyer: 'Test Buyer' },
    },
    error: null,
  });
}

function configureUpdateSuccess(status: string) {
  mockSupabase._chain.single.mockResolvedValueOnce({
    data: {
      id: VALID_UUID,
      name: 'Test Bid',
      description: null,
      status,
      domain_metadata: { buyer: 'Test Buyer' },
      is_archived: false,
      created_by: 'test-user-id',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: new Date().toISOString(),
      updated_by: 'test-user-id',
    },
    error: null,
  });
}

function resetMocks() {
  mockSupabase.auth.getUser.mockReset();
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  mockSupabase._chain.single.mockReset();
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });

  mockSupabase._chain.then.mockReset();
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  const chain = mockSupabase._chain;
  const chainableMethods: (keyof typeof chain)[] = [
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
  ];
  for (const method of chainableMethods) {
    chain[method].mockReturnValue(chain);
  }
  mockSupabase.from.mockReturnValue(chain);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Bid state machine via PATCH /api/bids/[id]', () => {
  beforeEach(() => {
    resetMocks();
  });

  // ── Valid transitions ──

  it('allows draft → questions_extracted', async () => {
    configureRole('editor');
    configureBidFetch('draft');
    configureUpdateSuccess('questions_extracted');

    const request = createTestRequest(`/api/bids/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'questions_extracted' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe('questions_extracted');
  });

  it('allows questions_extracted → matching', async () => {
    configureRole('editor');
    configureBidFetch('questions_extracted');
    configureUpdateSuccess('matching');

    const request = createTestRequest(`/api/bids/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'matching' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(200);
  });

  it('allows matching → drafting', async () => {
    configureRole('editor');
    configureBidFetch('matching');
    configureUpdateSuccess('drafting');

    const request = createTestRequest(`/api/bids/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'drafting' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(200);
  });

  it('allows drafting → in_review', async () => {
    configureRole('editor');
    configureBidFetch('drafting');
    configureUpdateSuccess('in_review');

    const request = createTestRequest(`/api/bids/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'in_review' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(200);
  });

  it('allows in_review → ready_for_export', async () => {
    configureRole('editor');
    configureBidFetch('in_review');
    configureUpdateSuccess('ready_for_export');

    const request = createTestRequest(`/api/bids/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'ready_for_export' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(200);
  });

  it('allows ready_for_export → submitted', async () => {
    configureRole('editor');
    configureBidFetch('ready_for_export');
    configureUpdateSuccess('submitted');

    const request = createTestRequest(`/api/bids/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'submitted' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(200);
  });

  it('allows submitted → won', async () => {
    configureRole('editor');
    configureBidFetch('submitted');
    configureUpdateSuccess('won');

    const request = createTestRequest(`/api/bids/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'won' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(200);
  });

  it('allows submitted → lost', async () => {
    configureRole('editor');
    configureBidFetch('submitted');
    configureUpdateSuccess('lost');

    const request = createTestRequest(`/api/bids/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'lost' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(200);
  });

  it('allows any active state → withdrawn', async () => {
    configureRole('editor');
    configureBidFetch('drafting');
    configureUpdateSuccess('withdrawn');

    const request = createTestRequest(`/api/bids/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'withdrawn' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(200);
  });

  // ── Invalid transitions ──

  it('rejects draft → submitted (skipping states)', async () => {
    configureRole('editor');
    configureBidFetch('draft');

    const request = createTestRequest(`/api/bids/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'submitted' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.current_status).toBe('draft');
    expect(body.requested_status).toBe('submitted');
    expect(body.error).toContain('Cannot transition');
  });

  it('rejects draft → in_review (non-adjacent)', async () => {
    configureRole('editor');
    configureBidFetch('draft');

    const request = createTestRequest(`/api/bids/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'in_review' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.current_status).toBe('draft');
    expect(body.requested_status).toBe('in_review');
  });

  // ── Terminal state enforcement ──

  it('blocks transitions from won (terminal state)', async () => {
    configureRole('editor');
    configureBidFetch('won');

    const request = createTestRequest(`/api/bids/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'draft' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.current_status).toBe('won');
    expect(body.error).toContain('Cannot transition');
  });

  it('blocks transitions from lost (terminal state)', async () => {
    configureRole('editor');
    configureBidFetch('lost');

    const request = createTestRequest(`/api/bids/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'in_review' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.current_status).toBe('lost');
  });

  it('blocks transitions from withdrawn (terminal state)', async () => {
    configureRole('editor');
    configureBidFetch('withdrawn');

    const request = createTestRequest(`/api/bids/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'draft' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.current_status).toBe('withdrawn');
  });

  // ── Backward transition validation ──

  it('allows in_review → drafting (backward allowed)', async () => {
    configureRole('editor');
    configureBidFetch('in_review');
    configureUpdateSuccess('drafting');

    const request = createTestRequest(`/api/bids/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'drafting' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(200);
  });

  it('allows submitted → in_review (backward allowed)', async () => {
    configureRole('editor');
    configureBidFetch('submitted');
    configureUpdateSuccess('in_review');

    const request = createTestRequest(`/api/bids/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'in_review' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(200);
  });
});
