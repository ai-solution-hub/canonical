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

// ID-131 {131.19}: content_items is dying — item_id IS the source_documents
// id directly now (every content_item was already 1:1 with its backing
// source_document), so the existence-check fetch resolves `item.id` back to
// the same value posted as `item_id`, and that's what verification_history
// records as source_document_id. No separate resolved id exists anymore.
const VALID_UUID = '00000000-0000-4000-8000-000000000001';

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
      data: { id: VALID_UUID },
      error: null,
    });

    // All subsequent operations succeed
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: 'facet-row-id' }], error: null }),
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
      source_document_id: VALID_UUID,
      action_type: 'verify',
      note: null,
      performed_by: 'test-user-id',
    });
  });

  it('records verify action with note in verification_history', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: 'facet-row-id' }], error: null }),
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
      source_document_id: VALID_UUID,
      action_type: 'verify',
      note: 'Looks good, verified content accuracy',
      performed_by: 'test-user-id',
    });
  });

  it('records unverify action in verification_history', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: 'facet-row-id' }], error: null }),
    );

    const req = createTestRequest('/api/review/action', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'unverify' },
    });

    const res = await postAction(req);
    expect(res.status).toBe(200);

    expect(recordedHistoryInsert()).toEqual({
      source_document_id: VALID_UUID,
      action_type: 'unverify',
      note: null,
      performed_by: 'test-user-id',
    });
  });

  it('records unverify action with note in verification_history', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: 'facet-row-id' }], error: null }),
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
      source_document_id: VALID_UUID,
      action_type: 'unverify',
      note: 'Content is out of date',
      performed_by: 'test-user-id',
    });
  });

  it('records flag action in verification_history with flag_details as note', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: 'facet-row-id' }], error: null }),
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
      source_document_id: VALID_UUID,
      action_type: 'flag',
      note: 'Outdated statistics',
      performed_by: 'test-user-id',
    });
  });

  it('records flag action in verification_history with null note when no flag_details', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: 'facet-row-id' }], error: null }),
    );

    const req = createTestRequest('/api/review/action', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'flag' },
    });

    const res = await postAction(req);
    expect(res.status).toBe(200);

    expect(recordedHistoryInsert()).toEqual({
      source_document_id: VALID_UUID,
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
      data: { id: VALID_UUID },
      error: null,
    });

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: 'facet-row-id' }], error: null }),
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
      data: { id: VALID_UUID },
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

// ---------------------------------------------------------------------------
// ID-131 {131.19}: the old single content_items UPDATE (verified_at +
// verified_by + updated_by together) is now split across two tables — the
// record_lifecycle facet write (governance signal) and a separate
// source_documents updated_by stamp. Verify both writes actually happen,
// with the correct payload on each.
// ---------------------------------------------------------------------------

describe('POST /api/review/action — record_lifecycle / source_documents write split', () => {
  beforeEach(resetMocks);

  /** Pick out the record_lifecycle-shaped update payload (verified_at key present). */
  function facetUpdatePayload(): Record<string, unknown> | undefined {
    return mockSupabase._chain.update.mock.calls
      .map((c: unknown[]) => c[0] as Record<string, unknown>)
      .find((payload) => payload && 'verified_at' in payload);
  }

  /** Pick out the source_documents-shaped update payload (updated_by only). */
  function sourceDocumentUpdatePayload(): Record<string, unknown> | undefined {
    return mockSupabase._chain.update.mock.calls
      .map((c: unknown[]) => c[0] as Record<string, unknown>)
      .find(
        (payload) =>
          payload && 'updated_by' in payload && !('verified_at' in payload),
      );
  }

  it('verify writes verified_at/verified_by to record_lifecycle AND updated_by to source_documents', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: 'facet-row-id' }], error: null }),
    );

    const req = createTestRequest('/api/review/action', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'verify' },
    });
    const res = await postAction(req);
    expect(res.status).toBe(200);

    const facetPayload = facetUpdatePayload();
    expect(facetPayload).toMatchObject({ verified_by: 'test-user-id' });
    expect(facetPayload?.verified_at).toEqual(expect.any(String));
    expect(sourceDocumentUpdatePayload()).toEqual({
      updated_by: 'test-user-id',
    });
  });

  it('unverify writes null verified_at/verified_by to record_lifecycle AND updated_by to source_documents', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: 'facet-row-id' }], error: null }),
    );

    const req = createTestRequest('/api/review/action', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'unverify' },
    });
    const res = await postAction(req);
    expect(res.status).toBe(200);

    expect(facetUpdatePayload()).toEqual({
      verified_at: null,
      verified_by: null,
    });
    expect(sourceDocumentUpdatePayload()).toEqual({
      updated_by: 'test-user-id',
    });
  });

  it('flag clears verified_at/verified_by on record_lifecycle AND stamps updated_by on source_documents', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: 'facet-row-id' }], error: null }),
    );

    const req = createTestRequest('/api/review/action', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'flag', flag_details: 'Outdated' },
    });
    const res = await postAction(req);
    expect(res.status).toBe(200);

    expect(facetUpdatePayload()).toEqual({
      verified_at: null,
      verified_by: null,
    });
    expect(sourceDocumentUpdatePayload()).toEqual({
      updated_by: 'test-user-id',
    });
  });

  it('verify 500s the request when the record_lifecycle write fails, without ever attempting the source_documents write', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });
    // The record_lifecycle write is the primary, error-checked write — make
    // the first awaited chain (the facet update) fail.
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: { message: 'facet write failed' } }),
    );

    const req = createTestRequest('/api/review/action', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'verify' },
    });
    const res = await postAction(req);

    expect(res.status).toBe(500);
    // Only one .update() call was attempted — the record_lifecycle write.
    // The route returns before reaching the source_documents best-effort
    // write on this path.
    expect(mockSupabase._chain.update).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// ID-131.19 Blocker 1 fix: no record_lifecycle facet row is ever minted
// anywhere in the system yet (system-wide gap until the Phase 2 facet-mint
// migration ships) — a Postgres UPDATE matching 0 rows is NOT an error, so
// verify/flag/unverify must chain `.select('id')` and check the returned row
// count explicitly. 0 rows must return an honest error, never a false
// `{success:true}` plus a verification_history audit row for a write that
// changed nothing.
// ---------------------------------------------------------------------------

describe('POST /api/review/action — 0-row facet update honesty (ID-131.19 Blocker 1)', () => {
  beforeEach(resetMocks);

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

  it('verify returns an explicit error and writes no verification_history row when the facet update matches 0 rows', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });
    // Facet UPDATE matches nothing — no record_lifecycle row exists for
    // this item yet. Not a Postgres error: data resolves to an empty array.
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const req = createTestRequest('/api/review/action', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'verify' },
    });
    const res = await postAction(req);

    expect(res.status).toBe(409);
    expect(recordedHistoryInsert()).toBeNull();
  });

  it('unverify returns an explicit error and writes no verification_history row when the facet update matches 0 rows', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const req = createTestRequest('/api/review/action', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'unverify' },
    });
    const res = await postAction(req);

    expect(res.status).toBe(409);
    expect(recordedHistoryInsert()).toBeNull();
  });

  it('flag returns an explicit error and writes no verification_history row (nor ingestion_quality_log flag) when the facet update matches 0 rows', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
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

    expect(res.status).toBe(409);
    expect(recordedHistoryInsert()).toBeNull();
    // No ingestion_quality_log insert was attempted — the facet gate is
    // checked before the flag insert.
    expect(mockSupabase._chain.insert).not.toHaveBeenCalled();
  });

  it('verify succeeds and writes verification_history when the facet update matches >=1 row', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: 'facet-row-id' }], error: null }),
    );

    const req = createTestRequest('/api/review/action', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'verify' },
    });
    const res = await postAction(req);

    expect(res.status).toBe(200);
    expect(recordedHistoryInsert()).toMatchObject({ action_type: 'verify' });
  });
});
