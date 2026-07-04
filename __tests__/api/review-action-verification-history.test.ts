/**
 * Tests for verification_history recording in POST /api/review/action.
 *
 * Verifies that verify, unverify, and flag actions all create entries
 * in the verification_history table, and that notes are properly passed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
} from '../helpers/mock-supabase';
import { createTestRequest } from '../helpers/mock-next';

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

// Suppress console.error noise from route error handling
vi.spyOn(console, 'error').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Import handler under test (AFTER mocks)
// ---------------------------------------------------------------------------

import { POST as postAction } from '@/app/api/review/action/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = '00000000-0000-4000-8000-000000000001';
// A distinct id from VALID_UUID (the content_items.id) — verification_history is
// source_document_id-keyed post ID-131 {131.29} re-parent, so the content-item
// fetch's resolved source_document_id is the value actually written.
const SOURCE_DOC_UUID = '00000000-0000-4000-8000-000000000002';

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
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/review/action — verification_history recording', () => {
  beforeEach(resetMocks);

  /** Pick out the verification_history insert payload, if any. */
  function recordedHistoryInsert(): Record<string, unknown> | null {
    return (
      mockSupabase._chain.insert.mock.calls
        .map((c: unknown[]) => c[0] as Record<string, unknown>)
        .find(
          (payload) =>
            payload &&
            typeof payload === 'object' &&
            'action_type' in payload &&
            'performed_by' in payload,
        ) ?? null
    );
  }

  it('records verify action in verification_history', async () => {
    configureRole(mockSupabase, 'editor');

    // Content item exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, source_document_id: SOURCE_DOC_UUID },
      error: null,
    });

    // All subsequent operations succeed
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const req = createTestRequest('/api/review/action', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'verify' },
    });

    const res = await postAction(req);
    expect(res.status).toBe(200);

    // Content-of-write is the observable here: a verify action must
    // produce a history row carrying the action, target item, and actor.
    expect(recordedHistoryInsert()).toEqual({
      source_document_id: SOURCE_DOC_UUID,
      action_type: 'verify',
      note: null,
      performed_by: 'test-user-id',
    });
  });

  it('records verify action with note in verification_history', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, source_document_id: SOURCE_DOC_UUID },
      error: null,
    });

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const req = createTestRequest('/api/review/action', {
      method: 'POST',
      body: {
        item_id: VALID_UUID,
        action: 'verify',
        note: 'Looks good, verified content accuracy',
      },
    });

    const res = await postAction(req);
    expect(res.status).toBe(200);

    expect(recordedHistoryInsert()).toEqual({
      source_document_id: SOURCE_DOC_UUID,
      action_type: 'verify',
      note: 'Looks good, verified content accuracy',
      performed_by: 'test-user-id',
    });
  });

  it('records unverify action in verification_history', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, source_document_id: SOURCE_DOC_UUID },
      error: null,
    });

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const req = createTestRequest('/api/review/action', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'unverify' },
    });

    const res = await postAction(req);
    expect(res.status).toBe(200);

    expect(recordedHistoryInsert()).toEqual({
      source_document_id: SOURCE_DOC_UUID,
      action_type: 'unverify',
      note: null,
      performed_by: 'test-user-id',
    });
  });

  it('records unverify action with note in verification_history', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, source_document_id: SOURCE_DOC_UUID },
      error: null,
    });

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const req = createTestRequest('/api/review/action', {
      method: 'POST',
      body: {
        item_id: VALID_UUID,
        action: 'unverify',
        note: 'Content is out of date',
      },
    });

    const res = await postAction(req);
    expect(res.status).toBe(200);

    expect(recordedHistoryInsert()).toEqual({
      source_document_id: SOURCE_DOC_UUID,
      action_type: 'unverify',
      note: 'Content is out of date',
      performed_by: 'test-user-id',
    });
  });

  it('records flag action in verification_history with flag_details as note', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, source_document_id: SOURCE_DOC_UUID },
      error: null,
    });

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const req = createTestRequest('/api/review/action', {
      method: 'POST',
      body: {
        item_id: VALID_UUID,
        action: 'flag',
        flag_details: 'Outdated statistics',
      },
    });

    const res = await postAction(req);
    expect(res.status).toBe(200);

    expect(recordedHistoryInsert()).toEqual({
      source_document_id: SOURCE_DOC_UUID,
      action_type: 'flag',
      note: 'Outdated statistics',
      performed_by: 'test-user-id',
    });
  });

  it('records flag action in verification_history with null note when no flag_details', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, source_document_id: SOURCE_DOC_UUID },
      error: null,
    });

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const req = createTestRequest('/api/review/action', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'flag' },
    });

    const res = await postAction(req);
    expect(res.status).toBe(200);

    expect(recordedHistoryInsert()).toEqual({
      source_document_id: SOURCE_DOC_UUID,
      action_type: 'flag',
      note: null,
      performed_by: 'test-user-id',
    });
  });

  it('rejects note longer than 500 characters', async () => {
    configureRole(mockSupabase, 'editor');

    const longNote = 'x'.repeat(501);

    const req = createTestRequest('/api/review/action', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'verify', note: longNote },
    });

    const res = await postAction(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe('Validation failed');
  });

  it('accepts note at exactly 500 characters', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, source_document_id: SOURCE_DOC_UUID },
      error: null,
    });

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const exactNote = 'x'.repeat(500);

    const req = createTestRequest('/api/review/action', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'verify', note: exactNote },
    });

    const res = await postAction(req);
    expect(res.status).toBe(200);
  });

  it('does not record verification_history for skip action', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, source_document_id: SOURCE_DOC_UUID },
      error: null,
    });

    const req = createTestRequest('/api/review/action', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'skip' },
    });

    const res = await postAction(req);
    expect(res.status).toBe(200);

    // No history row is written for the no-op skip action — content-of-write
    // is observable here as the absence of any action_type/performed_by row.
    expect(recordedHistoryInsert()).toBeNull();
  });
});
