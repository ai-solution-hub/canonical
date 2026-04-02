/**
 * WP2: Content Governance Chain Integration Tests
 *
 * Tests that PATCH /api/items/[id] triggers a governance review when a
 * significant field (e.g. primary_domain) changes, and does NOT trigger
 * when a minor field (e.g. title) changes. Also verifies best-effort
 * behaviour — main update succeeds even when governance fails.
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

// Mock embeddings — not relevant to governance tests
vi.mock('@/lib/ai/embed', () => ({
  generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}));

// ---------------------------------------------------------------------------
// Import AFTER mocks
// ---------------------------------------------------------------------------

import { PATCH } from '@/app/api/items/[id]/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

function configureRole(role: 'admin' | 'editor' | 'viewer') {
  configureRoleHelper(mockSupabase, role);
}

function configureItemFetch(overrides: Record<string, unknown> = {}) {
  mockSupabase._chain.single.mockResolvedValueOnce({
    data: {
      title: 'Existing Item',
      content: 'Some content',
      brief: null,
      detail: null,
      reference: null,
      suggested_title: null,
      ai_keywords: null,
      primary_domain: 'Corporate',
      primary_subtopic: 'Company History',
      secondary_domain: null,
      secondary_subtopic: null,
      priority: null,
      ai_summary: null,
      content_type: 'article',
      platform: 'web',
      author_name: null,
      user_tags: null,
      ...overrides,
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
  // Clear from() call history so previous test calls don't bleed
  mockSupabase.from.mockClear();
  mockSupabase.from.mockReturnValue(chain);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Governance chain via PATCH /api/items/[id]', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('triggers governance review when primary_domain changes', async () => {
    configureRole('editor');
    configureItemFetch({ primary_domain: 'Corporate' });

    // Configure governance config lookup
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        posture: 'review_on_change',
        reviewer_id: 'reviewer-user-id',
        timeout_days: 7,
      },
      error: null,
    });

    // Version history lookup
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { version: 1 },
      error: null,
    });

    const request = createTestRequest(`/api/items/${VALID_UUID}`, {
      method: 'PATCH',
      body: { field: 'primary_domain', value: 'Technical' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(200);

    // Verify governance_config was queried (from('governance_config') called)
    const fromCalls = mockSupabase.from.mock.calls.map((c: unknown[]) => c[0]);
    expect(fromCalls).toContain('governance_config');

    // Verify notification was inserted for the reviewer
    expect(fromCalls).toContain('notifications');
  });

  it('does NOT trigger governance for author_name change (non-significant field)', async () => {
    configureRole('editor');
    configureItemFetch({ author_name: 'Old Author' });

    // Version history lookup
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { version: 1 },
      error: null,
    });

    const request = createTestRequest(`/api/items/${VALID_UUID}`, {
      method: 'PATCH',
      body: { field: 'author_name', value: 'New Author' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(200);

    // Verify governance_config was NOT queried
    const fromCalls = mockSupabase.from.mock.calls.map((c: unknown[]) => c[0]);
    expect(fromCalls).not.toContain('governance_config');
  });

  it('succeeds even when governance check fails (best-effort)', async () => {
    configureRole('editor');
    configureItemFetch({ primary_domain: 'Corporate' });

    // Governance config lookup throws an error
    mockSupabase._chain.single.mockRejectedValueOnce(
      new Error('Database connection failed'),
    );

    // Version history lookup
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { version: 1 },
      error: null,
    });

    const request = createTestRequest(`/api/items/${VALID_UUID}`, {
      method: 'PATCH',
      body: { field: 'content', value: 'Updated content for governance test' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    // Main update should still succeed — governance is best-effort
    expect(response.status).toBe(200);
  });

  it('triggers governance for content field change', async () => {
    configureRole('editor');
    configureItemFetch({ primary_domain: 'Technical' });

    // Governance config: no review posture set
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { posture: 'no_review', reviewer_id: null, timeout_days: null },
      error: null,
    });

    // Version history lookup
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { version: 2 },
      error: null,
    });

    const request = createTestRequest(`/api/items/${VALID_UUID}`, {
      method: 'PATCH',
      body: { field: 'content', value: 'Updated content here' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(200);

    // Governance config IS queried (content is a significant field)
    const fromCalls = mockSupabase.from.mock.calls.map((c: unknown[]) => c[0]);
    expect(fromCalls).toContain('governance_config');
  });
});
