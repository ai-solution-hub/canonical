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

// Import route AFTER mocks are registered
const { POST } = await import(
  '@/app/api/source-documents/[id]/diff/route'
);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OLD_DOC_ID = '11111111-1111-1111-1111-111111111111';
const NEW_DOC_ID = '22222222-2222-2222-2222-222222222222';

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
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'in', 'is', 'not', 'ilike', 'contains',
    'gte', 'lte', 'gt', 'lt', 'or', 'order', 'limit', 'range',
  ] as const;
  for (const m of chainable) {
    mockSupabase._chain[m].mockReturnValue(mockSupabase._chain);
  }

  mockSupabase._chain.single.mockReset().mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle.mockReset().mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.then.mockReset().mockImplementation(
    (resolve: (v: unknown) => void) => resolve({ data: [], error: null, count: 0 }),
  );
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/source-documents/[id]/diff', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(`/api/source-documents/${OLD_DOC_ID}/diff`, {
      method: 'POST',
      body: { new_document_id: NEW_DOC_ID },
    });
    const params = createTestParams({ id: OLD_DOC_ID });
    const res = await POST(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(`/api/source-documents/${OLD_DOC_ID}/diff`, {
      method: 'POST',
      body: { new_document_id: NEW_DOC_ID },
    });
    const params = createTestParams({ id: OLD_DOC_ID });
    const res = await POST(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid old document ID format', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/source-documents/not-a-uuid/diff', {
      method: 'POST',
      body: { new_document_id: NEW_DOC_ID },
    });
    const params = createTestParams({ id: 'not-a-uuid' });
    const res = await POST(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Invalid document ID format');
  });

  it('returns 400 for missing new_document_id', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(`/api/source-documents/${OLD_DOC_ID}/diff`, {
      method: 'POST',
      body: {},
    });
    const params = createTestParams({ id: OLD_DOC_ID });
    const res = await POST(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('new_document_id is required and must be a valid UUID');
  });

  it('returns 400 for invalid new_document_id format', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(`/api/source-documents/${OLD_DOC_ID}/diff`, {
      method: 'POST',
      body: { new_document_id: 'not-a-uuid' },
    });
    const params = createTestParams({ id: OLD_DOC_ID });
    const res = await POST(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('new_document_id is required and must be a valid UUID');
  });

  it('returns 400 when diffing a document with itself', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(`/api/source-documents/${OLD_DOC_ID}/diff`, {
      method: 'POST',
      body: { new_document_id: OLD_DOC_ID },
    });
    const params = createTestParams({ id: OLD_DOC_ID });
    const res = await POST(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Cannot diff a document with itself');
  });

  it('returns 404 when old document not found', async () => {
    configureRole(mockSupabase, 'editor');

    // Role lookup succeeds (from configureRole), then old doc lookup fails
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'Not found', code: 'PGRST116' },
    });

    const req = createTestRequest(`/api/source-documents/${OLD_DOC_ID}/diff`, {
      method: 'POST',
      body: { new_document_id: NEW_DOC_ID },
    });
    const params = createTestParams({ id: OLD_DOC_ID });
    const res = await POST(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Old source document not found');
  });

  it('returns 404 when new document not found', async () => {
    configureRole(mockSupabase, 'editor');

    // Old doc found
    mockSupabase._chain.single
      .mockResolvedValueOnce({
        data: {
          id: OLD_DOC_ID,
          extracted_text: 'Q: Name?\nA: Acme',
          filename: 'old.docx',
        },
        error: null,
      })
      // New doc not found
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'Not found', code: 'PGRST116' },
      });

    const req = createTestRequest(`/api/source-documents/${OLD_DOC_ID}/diff`, {
      method: 'POST',
      body: { new_document_id: NEW_DOC_ID },
    });
    const params = createTestParams({ id: OLD_DOC_ID });
    const res = await POST(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('New source document not found');
  });

  it('computes diff and returns results for editor', async () => {
    configureRole(mockSupabase, 'editor');

    const oldText = [
      'Q: What is your company name?',
      'A: Acme Corp',
      'Q: How many employees?',
      'A: 150',
    ].join('\n');

    const newText = [
      'Q: What is your company name?',
      'A: Acme Corporation Ltd',
      'Q: How many employees?',
      'A: 150',
      'Q: Do you have ISO 27001?',
      'A: Yes',
    ].join('\n');

    // Old doc found
    mockSupabase._chain.single
      .mockResolvedValueOnce({
        data: { id: OLD_DOC_ID, extracted_text: oldText, filename: 'v1.docx' },
        error: null,
      })
      // New doc found
      .mockResolvedValueOnce({
        data: { id: NEW_DOC_ID, extracted_text: newText, filename: 'v2.docx' },
        error: null,
      });

    // Insert succeeds (via .then on chain)
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const req = createTestRequest(`/api/source-documents/${OLD_DOC_ID}/diff`, {
      method: 'POST',
      body: { new_document_id: NEW_DOC_ID },
    });
    const params = createTestParams({ id: OLD_DOC_ID });
    const res = await POST(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.old_document_id).toBe(OLD_DOC_ID);
    expect(body.new_document_id).toBe(NEW_DOC_ID);
    expect(body.summary).toBeDefined();
    expect(body.summary.modified).toBe(1);    // company name answer changed
    expect(body.summary.unchanged).toBe(1);   // employees unchanged
    expect(body.summary.added).toBe(1);       // ISO 27001 added
    expect(body.entries).toHaveLength(3);
  });

  it('stores diff rows in source_document_diffs table', async () => {
    configureRole(mockSupabase, 'admin');

    const oldText = 'Q: Name?\nA: Acme';
    const newText = 'Q: Name?\nA: Acme Corp';

    mockSupabase._chain.single
      .mockResolvedValueOnce({
        data: { id: OLD_DOC_ID, extracted_text: oldText, filename: 'v1.docx' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: NEW_DOC_ID, extracted_text: newText, filename: 'v2.docx' },
        error: null,
      });

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const req = createTestRequest(`/api/source-documents/${OLD_DOC_ID}/diff`, {
      method: 'POST',
      body: { new_document_id: NEW_DOC_ID },
    });
    const params = createTestParams({ id: OLD_DOC_ID });
    await POST(req, { params });

    // Verify from('source_document_diffs') was called
    expect(mockSupabase.from).toHaveBeenCalledWith('source_document_diffs');

    // Verify insert was called with the diff rows
    expect(mockSupabase._chain.insert).toHaveBeenCalled();
    const insertCall = mockSupabase._chain.insert.mock.calls[0][0];
    expect(insertCall).toBeInstanceOf(Array);
    expect(insertCall[0]).toMatchObject({
      old_document_id: OLD_DOC_ID,
      new_document_id: NEW_DOC_ID,
      diff_type: 'modified',
      status: 'pending_review',
    });
  });

  it('returns 500 when insert fails', async () => {
    configureRole(mockSupabase, 'editor');

    const oldText = 'Q: Name?\nA: Acme';
    const newText = 'Q: Name?\nA: Acme Corp';

    mockSupabase._chain.single
      .mockResolvedValueOnce({
        data: { id: OLD_DOC_ID, extracted_text: oldText, filename: 'v1.docx' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: NEW_DOC_ID, extracted_text: newText, filename: 'v2.docx' },
        error: null,
      });

    // Insert fails
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: { message: 'DB constraint violation' } }),
    );

    const req = createTestRequest(`/api/source-documents/${OLD_DOC_ID}/diff`, {
      method: 'POST',
      body: { new_document_id: NEW_DOC_ID },
    });
    const params = createTestParams({ id: OLD_DOC_ID });
    const res = await POST(req, { params });
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toContain('Failed to store diff results');
  });

  it('handles documents with no extracted text gracefully', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single
      .mockResolvedValueOnce({
        data: { id: OLD_DOC_ID, extracted_text: null, filename: 'v1.docx' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: NEW_DOC_ID, extracted_text: null, filename: 'v2.docx' },
        error: null,
      });

    const req = createTestRequest(`/api/source-documents/${OLD_DOC_ID}/diff`, {
      method: 'POST',
      body: { new_document_id: NEW_DOC_ID },
    });
    const params = createTestParams({ id: OLD_DOC_ID });
    const res = await POST(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.summary.total_old).toBe(0);
    expect(body.summary.total_new).toBe(0);
    expect(body.entries).toHaveLength(0);
  });

  it('returns 400 for invalid JSON body', async () => {
    configureRole(mockSupabase, 'editor');

    // Create a request with non-JSON body
    const url = new URL(`/api/source-documents/${OLD_DOC_ID}/diff`, 'http://localhost:3000');
    const req = new (await import('next/server')).NextRequest(url, {
      method: 'POST',
      body: 'not-json',
      headers: { 'content-type': 'text/plain' },
    });
    const params = createTestParams({ id: OLD_DOC_ID });
    const res = await POST(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Invalid JSON body');
  });
});
