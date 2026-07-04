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

const { mockCookies } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

// Mock createNotification to avoid side effects
const { mockCreateNotification } = vi.hoisted(() => ({
  mockCreateNotification: vi.fn().mockResolvedValue({ error: null }),
}));

vi.mock('@/lib/notifications', () => ({
  createNotification: mockCreateNotification,
}));

// Import route AFTER mocks are registered
const { POST } =
  await import('@/app/api/source-documents/[id]/send-to-review/route');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DOC_ID = '550e8400-e29b-41d4-a716-446655440011';
const ITEM_ID_1 = '550e8400-e29b-41d4-a716-446655440022';
const ITEM_ID_2 = '550e8400-e29b-41d4-a716-446655440033';
const ITEM_ID_3 = '550e8400-e29b-41d4-a716-446655440044';
const ITEM_ID_4 = '550e8400-e29b-41d4-a716-446655440055';

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  mockCookies.mockResolvedValue({ getAll: () => [], set: () => {} });

  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

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

  mockSupabase._chain.single
    .mockReset()
    .mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle
    .mockReset()
    .mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.then
    .mockReset()
    .mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null, count: 0 }),
    );
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/source-documents/[id]/send-to-review', () => {
  // 1. Unauthenticated returns 401
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(
      `/api/source-documents/${DOC_ID}/send-to-review`,
      { method: 'POST', body: { item_ids: [ITEM_ID_1] } },
    );
    const params = createTestParams({ id: DOC_ID });
    const res = await POST(req, { params });
    expect(res.status).toBe(401);
  });

  // 2. Viewer returns 403
  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(
      `/api/source-documents/${DOC_ID}/send-to-review`,
      { method: 'POST', body: { item_ids: [ITEM_ID_1] } },
    );
    const params = createTestParams({ id: DOC_ID });
    const res = await POST(req, { params });
    expect(res.status).toBe(403);
  });

  // 3. Editor succeeds
  it('returns 200 for editor role with eligible items', async () => {
    configureRole(mockSupabase, 'editor');

    // Fetch record_lifecycle rows — eligible (NULL status)
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              source_document_id: ITEM_ID_1,
              governance_review_status: null,
              content_owner_id: 'owner-1',
              source_documents: {
                id: ITEM_ID_1,
                filename: 'item-one.docx',
                suggested_title: 'Item One',
              },
            },
          ],
          error: null,
        }),
    );

    // record_lifecycle update succeeds
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    // source_documents updated_at stamp succeeds (best-effort secondary write)
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    // Source document filename lookup (now uses maybeSingle())
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { filename: 'policy-v2.docx' },
      error: null,
    });

    const req = createTestRequest(
      `/api/source-documents/${DOC_ID}/send-to-review`,
      { method: 'POST', body: { item_ids: [ITEM_ID_1] } },
    );
    const params = createTestParams({ id: DOC_ID });
    const res = await POST(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.sent).toBe(1);
    expect(body.sent_ids).toContain(ITEM_ID_1);
  });

  // 4. Empty item_ids returns 400
  it('returns 400 for empty item_ids array', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(
      `/api/source-documents/${DOC_ID}/send-to-review`,
      { method: 'POST', body: { item_ids: [] } },
    );
    const params = createTestParams({ id: DOC_ID });
    const res = await POST(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  // 5. Invalid UUID returns 400
  it('returns 400 for invalid UUID in item_ids', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(
      `/api/source-documents/${DOC_ID}/send-to-review`,
      { method: 'POST', body: { item_ids: ['not-a-uuid'] } },
    );
    const params = createTestParams({ id: DOC_ID });
    const res = await POST(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  // 6. Eligible items get governance_review_status = 'pending'
  it('updates eligible items with governance_review_status pending', async () => {
    configureRole(mockSupabase, 'editor');

    // Fetch record_lifecycle rows — eligible (NULL and approved)
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              source_document_id: ITEM_ID_1,
              governance_review_status: null,
              content_owner_id: 'owner-1',
              source_documents: {
                id: ITEM_ID_1,
                filename: 'item-one.docx',
                suggested_title: 'Item One',
              },
            },
            {
              source_document_id: ITEM_ID_2,
              governance_review_status: 'approved',
              content_owner_id: 'owner-2',
              source_documents: {
                id: ITEM_ID_2,
                filename: 'item-two.docx',
                suggested_title: 'Item Two',
              },
            },
          ],
          error: null,
        }),
    );

    // record_lifecycle update succeeds
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    // source_documents updated_at stamp succeeds (best-effort secondary write)
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    // Source document filename lookup (now uses maybeSingle())
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { filename: 'policy-v2.docx' },
      error: null,
    });

    const req = createTestRequest(
      `/api/source-documents/${DOC_ID}/send-to-review`,
      { method: 'POST', body: { item_ids: [ITEM_ID_1, ITEM_ID_2] } },
    );
    const params = createTestParams({ id: DOC_ID });
    await POST(req, { params });

    // Verify both updates were called: record_lifecycle carries the
    // governance fields, source_documents carries the updated_at stamp
    // (split into two writes — ID-131 {131.19} moved governance fields onto
    // the record_lifecycle facet, separate from the owning source document).
    expect(mockSupabase._chain.update).toHaveBeenCalledTimes(2);
    const lifecycleUpdateCall = mockSupabase._chain.update.mock.calls[0][0];
    expect(lifecycleUpdateCall.governance_review_status).toBe('pending');
    expect(lifecycleUpdateCall.governance_review_due).toBeDefined();

    const sourceDocUpdateCall = mockSupabase._chain.update.mock.calls[1][0];
    expect(sourceDocUpdateCall.updated_at).toBeDefined();
  });

  // 7. Already-pending items are skipped (idempotent)
  it('skips already-pending items without error', async () => {
    configureRole(mockSupabase, 'editor');

    // Fetch record_lifecycle rows — all already pending
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              source_document_id: ITEM_ID_1,
              governance_review_status: 'pending',
              content_owner_id: 'owner-1',
              source_documents: {
                id: ITEM_ID_1,
                filename: 'item-one.docx',
                suggested_title: 'Item One',
              },
            },
          ],
          error: null,
        }),
    );

    const req = createTestRequest(
      `/api/source-documents/${DOC_ID}/send-to-review`,
      { method: 'POST', body: { item_ids: [ITEM_ID_1] } },
    );
    const params = createTestParams({ id: DOC_ID });
    const res = await POST(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.already_pending).toBe(1);
    expect(body.sent).toBe(0);

    // No update call should have been made
    expect(mockSupabase._chain.update).not.toHaveBeenCalled();
  });

  // 8. Draft items are skipped
  it('skips draft items without error', async () => {
    configureRole(mockSupabase, 'editor');

    // Fetch record_lifecycle rows — draft
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              source_document_id: ITEM_ID_1,
              governance_review_status: 'draft',
              content_owner_id: null,
              source_documents: {
                id: ITEM_ID_1,
                filename: 'draft-item.docx',
                suggested_title: 'Draft Item',
              },
            },
          ],
          error: null,
        }),
    );

    const req = createTestRequest(
      `/api/source-documents/${DOC_ID}/send-to-review`,
      { method: 'POST', body: { item_ids: [ITEM_ID_1] } },
    );
    const params = createTestParams({ id: DOC_ID });
    const res = await POST(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.skipped_draft).toBe(1);
    expect(body.sent).toBe(0);

    // No update call should have been made
    expect(mockSupabase._chain.update).not.toHaveBeenCalled();
  });

  // 9. Response has correct counts
  it('returns correct sent, already_pending, skipped_draft counts', async () => {
    configureRole(mockSupabase, 'editor');

    // Fetch record_lifecycle rows — mixed statuses
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              source_document_id: ITEM_ID_1,
              governance_review_status: null,
              content_owner_id: 'owner-1',
              source_documents: {
                id: ITEM_ID_1,
                filename: 'eligible.docx',
                suggested_title: 'Eligible',
              },
            },
            {
              source_document_id: ITEM_ID_2,
              governance_review_status: 'pending',
              content_owner_id: 'owner-2',
              source_documents: {
                id: ITEM_ID_2,
                filename: 'already-pending.docx',
                suggested_title: 'Already Pending',
              },
            },
            {
              source_document_id: ITEM_ID_3,
              governance_review_status: 'draft',
              content_owner_id: null,
              source_documents: {
                id: ITEM_ID_3,
                filename: 'draft.docx',
                suggested_title: 'Draft',
              },
            },
            {
              source_document_id: ITEM_ID_4,
              governance_review_status: 'changes_requested',
              content_owner_id: 'owner-3',
              source_documents: {
                id: ITEM_ID_4,
                filename: 'changes-req.docx',
                suggested_title: 'Changes Req',
              },
            },
          ],
          error: null,
        }),
    );

    // record_lifecycle update succeeds
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    // source_documents updated_at stamp succeeds (best-effort secondary write)
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    // Source document filename lookup (now uses maybeSingle())
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { filename: 'doc.docx' },
      error: null,
    });

    const req = createTestRequest(
      `/api/source-documents/${DOC_ID}/send-to-review`,
      {
        method: 'POST',
        body: { item_ids: [ITEM_ID_1, ITEM_ID_2, ITEM_ID_3, ITEM_ID_4] },
      },
    );
    const params = createTestParams({ id: DOC_ID });
    const res = await POST(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.sent).toBe(2);
    expect(body.already_pending).toBe(1);
    expect(body.skipped_draft).toBe(1);
    expect(body.total_requested).toBe(4);
    expect(body.sent_ids).toHaveLength(2);
    expect(body.sent_ids).toContain(ITEM_ID_1);
    expect(body.sent_ids).toContain(ITEM_ID_4);
  });

  // 10. Response includes review_url with source_document_id
  it('returns review_url containing the source document ID', async () => {
    configureRole(mockSupabase, 'editor');

    // Fetch record_lifecycle rows — eligible
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              source_document_id: ITEM_ID_1,
              governance_review_status: null,
              content_owner_id: 'owner-1',
              source_documents: {
                id: ITEM_ID_1,
                filename: 'item.docx',
                suggested_title: 'Item',
              },
            },
          ],
          error: null,
        }),
    );

    // record_lifecycle update succeeds
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    // source_documents updated_at stamp succeeds (best-effort secondary write)
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    // Source document filename lookup (now uses maybeSingle())
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { filename: 'doc.docx' },
      error: null,
    });

    const req = createTestRequest(
      `/api/source-documents/${DOC_ID}/send-to-review`,
      { method: 'POST', body: { item_ids: [ITEM_ID_1] } },
    );
    const params = createTestParams({ id: DOC_ID });
    const res = await POST(req, { params });
    const body = await res.json();

    expect(body.review_url).toBe(
      `/review?status=all&source_document_id=${DOC_ID}`,
    );
    expect(body.review_url).toContain('source_document_id');
  });

  // 11. Notifications created for content owners of sent items
  it('creates governance_review_needed notifications for content owners', async () => {
    configureRole(mockSupabase, 'editor');

    // Fetch record_lifecycle rows — eligible with owners
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              source_document_id: ITEM_ID_1,
              governance_review_status: null,
              content_owner_id: 'owner-1',
              source_documents: {
                id: ITEM_ID_1,
                filename: 'item-one.docx',
                suggested_title: 'Item One',
              },
            },
            {
              source_document_id: ITEM_ID_2,
              governance_review_status: 'approved',
              content_owner_id: 'owner-2',
              source_documents: {
                id: ITEM_ID_2,
                filename: 'item-two.docx',
                suggested_title: 'Item Two',
              },
            },
          ],
          error: null,
        }),
    );

    // record_lifecycle update succeeds
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    // source_documents updated_at stamp succeeds (best-effort secondary write)
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    // Source document filename lookup (now uses maybeSingle())
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { filename: 'policy-v2.docx' },
      error: null,
    });

    const req = createTestRequest(
      `/api/source-documents/${DOC_ID}/send-to-review`,
      { method: 'POST', body: { item_ids: [ITEM_ID_1, ITEM_ID_2] } },
    );
    const params = createTestParams({ id: DOC_ID });
    await POST(req, { params });

    // Verify createNotification was called for each eligible item's owner
    expect(mockCreateNotification).toHaveBeenCalledTimes(2);

    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'owner-1',
        type: 'governance_review_needed',
        entityType: 'content_item',
        entityId: ITEM_ID_1,
        title: 'Source document review',
        message: expect.stringContaining('policy-v2.docx'),
      }),
    );

    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'owner-2',
        type: 'governance_review_needed',
        entityType: 'content_item',
        entityId: ITEM_ID_2,
        message: expect.stringContaining('policy-v2.docx'),
      }),
    );
  });
});
